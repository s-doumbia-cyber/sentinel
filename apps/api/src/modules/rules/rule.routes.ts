import mongoose, { type Types } from "mongoose";
import { objectIdSchema, ruleDefinitionSchema, ruleUpdateSchema, type RuleDefinition } from "@sentinel/shared";
import { z } from "zod";
import type { AppConfig } from "../../config/index.js";
import { AppError } from "../../lib/errors.js";
import { ah, authOf, parsed, validate } from "../../lib/http.js";
import { PolicyRouter } from "../../lib/routes.js";
import { Rule } from "../../models/tenant.js";
import { auditFromRequest } from "../audit/audit.service.js";
import { MAX_TEST_FLOWS, definitionOf, ensureStarterRules, type RuleService } from "./rule.service.js";

const idParams = z.object({ id: objectIdSchema });
const isoDate = z.string().datetime({ offset: true });
const scopeBody = z
  .object({ datasetId: objectIdSchema.optional(), from: isoDate.optional(), to: isoDate.optional() })
  .strict()
  .default({});

type LeanRule = { _id: Types.ObjectId; key: string; definition: unknown; enabled: boolean; starter: boolean; version: number; updatedAt?: Date };

function toRuleResponse(r: LeanRule) {
  return { id: String(r._id), starter: r.starter, version: r.version, updatedAt: r.updatedAt ?? null, ...definitionOf(r) };
}

function zodDetails(err: z.ZodError) {
  return err.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
}

export interface RuleRouteDeps {
  rules: RuleService;
  /** Queues rules and the model-alert backfill (durable with Redis). */
  scheduleDetections: (orgId: Types.ObjectId, datasetId?: Types.ObjectId) => Promise<void>;
}

export function ruleRoutes(config: AppConfig, deps: RuleRouteDeps): PolicyRouter {
  const r = new PolicyRouter(config);

  r.route(
    "get",
    "/rules",
    "rules:read",
    ah(async (req, res) => {
      const { orgId } = authOf(req);
      await ensureStarterRules(orgId);
      const rules = await Rule.find({ orgId }).sort({ key: 1 }).lean<LeanRule[]>();
      res.json({ items: rules.map(toRuleResponse) });
    }),
  );

  r.route(
    "post",
    "/rules",
    "rules:manage",
    ah(async (req, res) => {
      const { orgId, userId } = authOf(req);
      const result = ruleDefinitionSchema.safeParse(req.body);
      if (!result.success) throw AppError.validation("Invalid rule definition", zodDetails(result.error));
      const def = result.data;
      if (await Rule.exists({ orgId, key: def.key })) throw AppError.conflict(`A rule with key ${def.key} already exists`);
      const rule = await Rule.create({ orgId, key: def.key, definition: def, enabled: def.enabled, starter: false, updatedBy: userId });
      await auditFromRequest(req, "rule.create", { type: "rule", id: def.key }, { definition: def });
      res.status(201).json(toRuleResponse(rule.toObject() as LeanRule));
    }),
  );

  r.route(
    "patch",
    "/rules/:id",
    "rules:manage",
    validate("params", idParams),
    validate("body", ruleUpdateSchema),
    ah(async (req, res) => {
      const { orgId, userId } = authOf(req);
      const { id } = parsed<{ id: string }>(req, "params");
      const patch = parsed<z.infer<typeof ruleUpdateSchema>>(req, "body");
      const rule = await Rule.findOne({ orgId, _id: id }).lean<LeanRule>();
      if (!rule) throw AppError.notFound("Rule");
      const before = definitionOf(rule);
      const merged = ruleDefinitionSchema.safeParse({ ...before, ...patch, key: before.key });
      if (!merged.success) throw AppError.validation("Invalid rule definition", zodDetails(merged.error));
      const after: RuleDefinition = merged.data;
      const definitionChanged = JSON.stringify({ ...before, enabled: true }) !== JSON.stringify({ ...after, enabled: true });
      const updated = await Rule.findOneAndUpdate(
        { orgId, _id: id },
        { $set: { definition: after, enabled: after.enabled, updatedBy: userId }, ...(definitionChanged ? { $inc: { version: 1 } } : {}) },
        { new: true },
      ).lean<LeanRule>();
      if (!updated) throw AppError.notFound("Rule");
      // The before/after pair is the reviewable diff of the change.
      await auditFromRequest(req, "rule.update", { type: "rule", id: before.key }, { before, after });
      res.json(toRuleResponse(updated));
    }),
  );

  r.route(
    "delete",
    "/rules/:id",
    "rules:manage",
    validate("params", idParams),
    ah(async (req, res) => {
      const { orgId } = authOf(req);
      const { id } = parsed<{ id: string }>(req, "params");
      const rule = await Rule.findOne({ orgId, _id: id }).lean<LeanRule>();
      if (!rule) throw AppError.notFound("Rule");
      if (rule.starter) throw AppError.conflict("Starter rules cannot be deleted; disable the rule instead");
      await Rule.deleteOne({ orgId, _id: id });
      await auditFromRequest(req, "rule.delete", { type: "rule", id: rule.key }, { definition: rule.definition });
      res.status(204).end();
    }),
  );

  r.route(
    "post",
    "/rules/:id/test",
    "rules:test",
    validate("params", idParams),
    validate("body", scopeBody),
    ah(async (req, res) => {
      const { orgId } = authOf(req);
      const { id } = parsed<{ id: string }>(req, "params");
      const scope = parsed<z.infer<typeof scopeBody>>(req, "body");
      const rule = await Rule.findOne({ orgId, _id: id }).lean<LeanRule>();
      if (!rule) throw AppError.notFound("Rule");
      // Tests the definition even when the rule is disabled; never creates alerts.
      const def = { ...definitionOf(rule), enabled: true };
      const { scanned, hits } = await deps.rules.evaluate(
        orgId,
        [def],
        {
          datasetId: scope.datasetId ? new mongoose.Types.ObjectId(scope.datasetId) : undefined,
          from: scope.from ? new Date(scope.from) : undefined,
          to: scope.to ? new Date(scope.to) : undefined,
        },
        MAX_TEST_FLOWS,
      );
      res.json({
        rule: def.key,
        flowsScanned: scanned,
        truncated: scanned >= MAX_TEST_FLOWS,
        hitCount: hits.length,
        hits: hits.slice(0, 100).map(({ hit }) => ({
          group: hit.group,
          value: hit.value,
          flowCount: hit.flowCount,
          windowStart: hit.windowStart,
          windowEnd: hit.windowEnd,
          sampleFlowIds: hit.sampleFlowIds.slice(0, 5),
        })),
      });
    }),
  );

  r.route(
    "post",
    "/detections/run",
    "detections:run",
    validate("body", scopeBody),
    ah(async (req, res) => {
      const { orgId } = authOf(req);
      const { datasetId } = parsed<z.infer<typeof scopeBody>>(req, "body");
      await auditFromRequest(req, "detections.run", { type: "org", id: String(orgId) }, { datasetId: datasetId ?? null });
      await deps.scheduleDetections(orgId, datasetId ? new mongoose.Types.ObjectId(datasetId) : undefined);
      res.status(202).json({ started: true });
    }),
  );

  return r;
}
