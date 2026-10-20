import mongoose, { type Types } from "mongoose";
import { STARTER_RULE_UPGRADES, STARTER_RULES, ruleDefinitionSchema, type RuleDefinition } from "@sentinel/shared";
import type { Logger } from "../../lib/logger.js";
import { Flow, Rule } from "../../models/tenant.js";
import { AlertService } from "../alerts/alert.service.js";
import { loadAlertPolicy } from "../alerts/policy.js";
import { writeAudit } from "../audit/audit.service.js";
import { RuleEvaluator, type RuleFlow, type RuleHit } from "./evaluator.js";

export interface FlowScope {
  datasetId?: Types.ObjectId | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
}

/** Key-order-independent JSON, so two equal definitions compare equal whatever their source. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Moves an org's starter rule to a revised default when, and only when, its
 * definition still equals the previous default exactly (any analyst edit makes
 * it differ). Its enabled state is kept. The new version is audited with the
 * reason, so the change is visible and traceable.
 */
async function upgradeStarterRules(orgId: Types.ObjectId): Promise<void> {
  for (const up of STARTER_RULE_UPGRADES) {
    const rule = await Rule.findOne({ orgId, key: up.key, starter: true }).lean();
    if (!rule) continue;
    const { enabled: _enabled, ...stored } = ruleDefinitionSchema.parse(rule.definition);
    const { enabled: _old, ...previous } = ruleDefinitionSchema.parse(up.from);
    if (canonical(stored) !== canonical(previous)) continue;
    const target = STARTER_RULES.find((r) => r.key === up.key);
    if (!target) continue;
    const next = { ...ruleDefinitionSchema.parse(target), enabled: rule.enabled };
    const res = await Rule.updateOne({ orgId, _id: rule._id, version: rule.version }, { $set: { definition: next }, $inc: { version: 1 } });
    if (res.modifiedCount) {
      await writeAudit(null, {
        orgId,
        actorId: null,
        action: "rule.upgrade",
        target: { type: "rule", id: String(rule._id) },
        meta: { key: up.key, fromVersion: rule.version, toVersion: rule.version + 1, reason: up.reason },
      });
    }
  }
}

/** Seeds the starter rules for an org once; edited rules are left alone, unedited ones follow revised defaults. */
export async function ensureStarterRules(orgId: Types.ObjectId): Promise<void> {
  await upgradeStarterRules(orgId);
  if ((await Rule.countDocuments({ orgId, starter: true })) >= STARTER_RULES.length) return;
  await Rule.bulkWrite(
    STARTER_RULES.map((r) => {
      const definition = ruleDefinitionSchema.parse(r);
      return {
        updateOne: {
          filter: { orgId, key: definition.key },
          update: { $setOnInsert: { orgId, key: definition.key, definition, enabled: definition.enabled, starter: true, version: 1 } },
          upsert: true,
        },
      };
    }),
    { ordered: false },
  );
}

export function definitionOf(rule: { definition: unknown; enabled: boolean }): RuleDefinition {
  // Stored definitions were validated on write; re-parsing guards against manual edits.
  return { ...ruleDefinitionSchema.parse(rule.definition), enabled: rule.enabled };
}

/** Streams the scope's flows in event-time order with only the fields rules read. */
async function* streamFlows(orgId: Types.ObjectId, scope: FlowScope, limit: number): AsyncGenerator<RuleFlow & { _oid: Types.ObjectId }> {
  const filter: Record<string, unknown> = { orgId };
  if (scope.datasetId) filter.datasetId = scope.datasetId;
  if (scope.from || scope.to) {
    filter.timestamp = { ...(scope.from ? { $gte: scope.from } : {}), ...(scope.to ? { $lte: scope.to } : {}) };
  }
  const cursor = Flow.find(filter)
    .sort({ timestamp: 1, _id: 1 })
    .limit(limit)
    .select("timestamp sourceIp destinationIp sourcePort destinationPort protocol totalPackets flowDurationMs features")
    .lean()
    .cursor({ batchSize: 2000 });
  for await (const f of cursor) {
    const features = f.features instanceof Map ? Object.fromEntries(f.features) : (f.features as Record<string, number | null> | null | undefined);
    yield {
      _oid: f._id as Types.ObjectId,
      id: String(f._id),
      timestamp: f.timestamp,
      sourceIp: f.sourceIp,
      destinationIp: f.destinationIp,
      sourcePort: f.sourcePort,
      destinationPort: f.destinationPort,
      protocol: f.protocol,
      totalPackets: f.totalPackets ?? null,
      flowDurationMs: f.flowDurationMs ?? null,
      features: features ?? null,
    };
  }
}

export const MAX_TEST_FLOWS = 500_000;

/**
 * Rules engine. Rules run over stored flows in event-time order with an
 * in-memory sliding window per group (Redis-backed windows arrive with the
 * ingest queue, roadmap 1.5/2.1). Hits are deterministic, so re-running over
 * the same flows does not double-count alerts.
 */
export class RuleService {
  constructor(
    private readonly alerts: AlertService,
    private readonly logger: Logger,
  ) {}

  async evaluate(orgId: Types.ObjectId, rules: RuleDefinition[], scope: FlowScope, limit = Number.MAX_SAFE_INTEGER) {
    const evaluators = rules.map((r) => ({ rule: r, ev: new RuleEvaluator(r) }));
    const hits: { rule: RuleDefinition; hit: RuleHit }[] = [];
    let scanned = 0;
    for await (const flow of streamFlows(orgId, scope, limit)) {
      scanned++;
      for (const { rule, ev } of evaluators) {
        const hit = ev.push(flow);
        if (hit) hits.push({ rule, hit });
      }
    }
    return { scanned, hits };
  }

  /** Runs every enabled rule over the scope and turns hits into alerts. */
  async run(orgId: Types.ObjectId, scope: FlowScope) {
    await ensureStarterRules(orgId);
    const rules = (await Rule.find({ orgId, enabled: true }).lean()).map(definitionOf);
    if (!rules.length) return { scanned: 0, hits: 0, created: 0, suppressed: 0 };
    const policy = await loadAlertPolicy(orgId);
    const { scanned, hits } = await this.evaluate(orgId, rules, scope);
    let created = 0;
    let suppressed = 0;
    for (const { rule, hit } of hits) {
      const ids = hit.sampleFlowIds.map((id) => new mongoose.Types.ObjectId(id));
      const outcome = await this.alerts.recordRuleHit(orgId, policy, rule, hit, ids);
      if (outcome === "created") created++;
      if (outcome === "suppressed") suppressed++;
    }
    this.logger.info({ orgId: String(orgId), scanned, hits: hits.length, created, suppressed }, "Rules evaluated");
    return { scanned, hits: hits.length, created, suppressed };
  }
}
