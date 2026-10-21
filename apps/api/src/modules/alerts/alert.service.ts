import { createHash, randomUUID } from "node:crypto";
import type { Types } from "mongoose";
import { DEFAULT_SEVERITY_BY_CLASS, severityRank, type AttackClass, type RuleDefinition } from "@sentinel/shared";
import { Alert, Flow } from "../../models/tenant.js";
import type { RuleHit } from "../rules/evaluator.js";
import { isAllowlisted, type AlertPolicy } from "./policy.js";

/** Evidence for the same (source, destination, type) within this bucket lands on one alert. */
export const ALERT_BUCKET_MS = 10 * 60 * 1000;
const MAX_FLOW_IDS = 50;
const MAX_HIT_KEYS = 500;
const MAX_RULE_HITS = 20;

export function alertDedupeKey(orgId: Types.ObjectId, src: string | null, dst: string | null, type: string, at: Date): string {
  const bucket = Math.floor(at.getTime() / ALERT_BUCKET_MS);
  return createHash("sha256").update([String(orgId), src ?? "*", dst ?? "*", type, bucket].join("|")).digest("hex");
}

interface Evidence {
  orgId: Types.ObjectId;
  type: AttackClass;
  srcIp: string | null;
  dstIp: string | null;
  dstPort: number | null;
  firstSeen: Date;
  lastSeen: Date;
  count: number;
  severity: number;
  source: string;
  confidence?: number;
  topFlow?: { id: Types.ObjectId; confidence: number };
  modelVersion?: string;
  ruleKey?: string;
  hit?: RuleHit;
  flowIds: Types.ObjectId[];
}

export interface ModelVerdictEvidence {
  flowId: Types.ObjectId;
  timestamp: Date;
  sourceIp: string;
  destinationIp: string;
  destinationPort: number;
  label: AttackClass;
  confidence: number;
  modelVersion: string;
}

/**
 * Creates or updates alerts from model verdicts and rule hits (docs/ARCHITECTURE.md §3.3).
 * Status: `needs_review` while the only evidence is low-confidence model
 * output; `open` once a rule fired or a verdict reached the org threshold.
 * Analyst-set statuses (acknowledged, dismissed, resolved) are never overwritten.
 */
export class AlertService {
  private async upsert(e: Evidence, threshold: number): Promise<"created" | "updated" | "skipped"> {
    const dedupeKey = alertDedupeKey(e.orgId, e.srcIp, e.dstIp, e.type, e.lastSeen);
    const filter = { orgId: e.orgId, dedupeKey };
    // Re-evaluating the same flows yields the same hit key: count it once.
    if (e.hit && (await Alert.exists({ ...filter, hitKeys: e.hit.hitKey }))) return "skipped";
    const update = {
      $setOnInsert: { type: e.type, srcIp: e.srcIp, dstIp: e.dstIp, dstPort: e.dstPort, status: "needs_review", verdict: null },
      $inc: { count: e.count },
      $min: { firstSeen: e.firstSeen },
      $max: { lastSeen: e.lastSeen, maxConfidence: e.confidence ?? 0, severityRank: e.severity },
      $addToSet: {
        sources: e.source,
        ...(e.ruleKey ? { ruleIds: e.ruleKey } : {}),
        ...(e.modelVersion ? { modelVersions: e.modelVersion } : {}),
      },
      $push: {
        flowIds: { $each: e.flowIds, $slice: -MAX_FLOW_IDS },
        ...(e.hit
          ? {
              hitKeys: { $each: [e.hit.hitKey], $slice: -MAX_HIT_KEYS },
              ruleHits: {
                $each: [{ ruleKey: e.hit.ruleKey, value: e.hit.value, flowCount: e.hit.flowCount, windowStart: e.hit.windowStart, windowEnd: e.hit.windowEnd }],
                $slice: -MAX_RULE_HITS,
              },
            }
          : {}),
      },
    };
    let created = false;
    try {
      const res = await Alert.updateOne(filter, update, { upsert: true });
      created = res.upsertedCount > 0;
    } catch (err) {
      // Two concurrent upserts on a new key: the loser retries as an update.
      if ((err as { code?: number }).code !== 11000) throw err;
      await Alert.updateOne(filter, update);
    }
    if (e.topFlow) {
      await Alert.updateOne(
        { ...filter, $or: [{ topConfidence: null }, { topConfidence: { $lt: e.topFlow.confidence } }] },
        { $set: { topFlowId: e.topFlow.id, topConfidence: e.topFlow.confidence } },
      );
    }
    await Alert.updateOne({ ...filter, status: { $in: ["open", "needs_review"] } }, [
      {
        $set: {
          status: {
            $cond: [{ $or: [{ $gt: [{ $size: { $ifNull: ["$ruleIds", []] } }, 0] }, { $gte: ["$maxConfidence", threshold] }] }, "open", "needs_review"],
          },
        },
      },
    ]);
    return created ? "created" : "updated";
  }

  /**
   * Folds malicious model verdicts into alerts, one update per (src, dst, type, bucket).
   * Each flow is claimed atomically first, so the scoring path and the backfill
   * running at the same time never count a flow twice. Trade-off: a crash
   * between the claim and the alert update loses that evidence (at-most-once);
   * durable queues (roadmap 1.5) will revisit this.
   *
   * Verdicts below the org's minimum confidence, or involving an allowlisted
   * address, are claimed with the reason in `alertSuppressed` and create no
   * alert; the verdict stays on the flow.
   */
  async recordModelVerdicts(orgId: Types.ObjectId, policy: AlertPolicy, verdicts: ModelVerdictEvidence[]): Promise<number> {
    let malicious = verdicts.filter((v) => v.label !== "Normal");
    if (!malicious.length) return 0;
    if (policy.frozenKeys?.size) {
      // Evidence of an alert an analyst already handled: marked as processed, the alert stays as it is.
      const isFrozen = (v: ModelVerdictEvidence) => policy.frozenKeys?.has(alertDedupeKey(orgId, v.sourceIp, v.destinationIp, v.label, v.timestamp)) ?? false;
      const frozenIds = malicious.filter(isFrozen).map((v) => v.flowId);
      if (frozenIds.length) await Flow.updateMany({ orgId, _id: { $in: frozenIds }, alertedAt: null }, { $set: { alertedAt: new Date() } });
      malicious = malicious.filter((v) => !isFrozen(v));
      if (!malicious.length) return 0;
    }
    const reasonOf = (v: ModelVerdictEvidence) =>
      isAllowlisted(policy, v.sourceIp, v.destinationIp) ? "allowlisted" : v.confidence < policy.modelAlertMinConfidence ? "below_min_confidence" : null;
    for (const reason of ["allowlisted", "below_min_confidence"] as const) {
      const ids = malicious.filter((v) => reasonOf(v) === reason).map((v) => v.flowId);
      if (ids.length) await Flow.updateMany({ orgId, _id: { $in: ids }, alertedAt: null }, { $set: { alertedAt: new Date(), alertSuppressed: reason } });
    }
    const threshold = policy.needsReviewThreshold;
    const claim = randomUUID();
    const ids = malicious.filter((v) => reasonOf(v) === null).map((v) => v.flowId);
    if (!ids.length) return 0;
    await Flow.updateMany({ orgId, _id: { $in: ids }, alertedAt: null }, { $set: { alertedAt: new Date(), alertClaim: claim } });
    // Looked up by _id so the check uses the primary index.
    const claimed = new Set((await Flow.find({ orgId, _id: { $in: ids }, alertClaim: claim }).select("_id").lean()).map((f) => String(f._id)));
    const groups = new Map<string, ModelVerdictEvidence[]>();
    for (const v of malicious) {
      if (!claimed.has(String(v.flowId))) continue;
      const k = alertDedupeKey(orgId, v.sourceIp, v.destinationIp, v.label, v.timestamp);
      groups.set(k, [...(groups.get(k) ?? []), v]);
    }
    let created = 0;
    for (const group of groups.values()) {
      const first = group[0];
      if (!first) continue;
      const top = group.reduce((a, b) => (b.confidence > a.confidence ? b : a));
      const outcome = await this.upsert(
        {
          orgId,
          type: first.label,
          srcIp: first.sourceIp,
          dstIp: first.destinationIp,
          dstPort: first.destinationPort,
          firstSeen: new Date(Math.min(...group.map((g) => g.timestamp.getTime()))),
          lastSeen: new Date(Math.max(...group.map((g) => g.timestamp.getTime()))),
          count: group.length,
          severity: severityRank(DEFAULT_SEVERITY_BY_CLASS[first.label]),
          source: `model:${first.modelVersion}`,
          confidence: top.confidence,
          topFlow: { id: top.flowId, confidence: top.confidence },
          modelVersion: first.modelVersion,
          flowIds: group.map((g) => g.flowId).slice(-MAX_FLOW_IDS),
        },
        threshold,
      );
      if (outcome === "created") created++;
    }
    return created;
  }

  async recordRuleHit(
    orgId: Types.ObjectId,
    policy: AlertPolicy,
    rule: RuleDefinition,
    hit: RuleHit,
    flowIds: Types.ObjectId[],
  ): Promise<"created" | "updated" | "skipped" | "suppressed"> {
    const g = hit.group;
    const srcIp = typeof g.sourceIp === "string" ? g.sourceIp : null;
    const dstIp = typeof g.destinationIp === "string" ? g.destinationIp : null;
    if (policy.frozenKeys?.has(alertDedupeKey(orgId, srcIp, dstIp, rule.alertType, hit.windowEnd))) return "skipped";
    if (isAllowlisted(policy, typeof g.sourceIp === "string" ? g.sourceIp : null, typeof g.destinationIp === "string" ? g.destinationIp : null)) return "suppressed";
    return this.upsert(
      {
        orgId,
        type: rule.alertType,
        srcIp: typeof g.sourceIp === "string" ? g.sourceIp : null,
        dstIp: typeof g.destinationIp === "string" ? g.destinationIp : null,
        dstPort: typeof g.destinationPort === "number" ? g.destinationPort : null,
        firstSeen: hit.windowStart,
        lastSeen: hit.windowEnd,
        count: 1,
        severity: severityRank(rule.severity),
        source: `rule:${rule.key}`,
        ruleKey: rule.key,
        hit,
        flowIds,
      },
      policy.needsReviewThreshold,
    );
  }
}
