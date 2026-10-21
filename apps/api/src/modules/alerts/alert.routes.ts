import mongoose from "mongoose";
import {
  ALERT_STATUSES,
  ATTACK_CLASSES,
  MITRE_BY_CLASS,
  SEVERITIES,
  objectIdSchema,
  severityRank,
  updateAlertBodySchema,
  type AttackClass,
  type Severity,
} from "@sentinel/shared";
import { z } from "zod";
import type { AppConfig } from "../../config/index.js";
import { AppError } from "../../lib/errors.js";
import { ah, authOf, parsed, validate } from "../../lib/http.js";
import { PolicyRouter } from "../../lib/routes.js";
import { can, estimateDeviceType, IDENTITY_SOURCE_LABEL } from "@sentinel/shared";
import { Asset } from "../../models/context.js";
import { User } from "../../models/identity.js";
import { Alert, AuditLog, Dataset, Flow, Incident, Rule, type AlertDoc } from "../../models/tenant.js";
import { auditFromRequest } from "../audit/audit.service.js";
import { toFlowResponse, type LeanFlow } from "../flows/flow.dto.js";
import { decodeCursor, encodeCursor } from "../flows/flow.filters.js";
import { attributeAddress } from "../identity/identity.service.js";
import { definitionOf } from "../rules/rule.service.js";
import { buildAlertAnalysis } from "./analysis.js";
import { summarizeAlerts } from "./summary.js";

const SEVERITY_BY_RANK = Object.fromEntries(SEVERITIES.map((s) => [severityRank(s), s])) as Record<number, Severity>;

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(200).optional(),
  status: z.union([z.enum(ALERT_STATUSES), z.literal("active")]).optional(),
  severity: z.enum(SEVERITIES).optional(),
  type: z.enum(ATTACK_CLASSES).optional(),
  sourceIp: z.string().ip().optional(),
  source: z.enum(["model", "rule"]).optional(),
});

/** Optional range: alerts whose activity overlaps it (all time when omitted). */
const summaryQuery = z.object({
  from: z.string().datetime({ offset: true }).transform((v) => new Date(v)).optional(),
  to: z.string().datetime({ offset: true }).transform((v) => new Date(v)).optional(),
});

type LeanAlert = Omit<AlertDoc, "createdAt" | "updatedAt"> & { createdAt: Date; updatedAt: Date };

export function toAlertResponse(a: LeanAlert) {
  return {
    id: String(a._id),
    type: a.type as AttackClass,
    severity: SEVERITY_BY_RANK[a.severityRank] ?? "info",
    status: a.status,
    verdict: a.verdict ?? null,
    srcIp: a.srcIp ?? null,
    dstIp: a.dstIp ?? null,
    dstPort: a.dstPort ?? null,
    count: a.count,
    firstSeen: a.firstSeen,
    lastSeen: a.lastSeen,
    maxConfidence: a.modelVersions.length ? a.maxConfidence : null,
    sources: a.sources,
    ruleIds: a.ruleIds,
    modelVersions: a.modelVersions,
    mitre: MITRE_BY_CLASS[a.type as AttackClass] ?? null,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

export function alertRoutes(config: AppConfig): PolicyRouter {
  const r = new PolicyRouter(config);

  r.route(
    "get",
    "/alerts",
    "alerts:read",
    validate("query", listQuery),
    ah(async (req, res) => {
      const { orgId } = authOf(req);
      const q = parsed<z.infer<typeof listQuery>>(req, "query");
      const filter: Record<string, unknown> = { orgId };
      if (q.status === "active") filter.status = { $in: ["open", "needs_review", "acknowledged"] };
      else if (q.status) filter.status = q.status;
      if (q.severity) filter.severityRank = severityRank(q.severity);
      if (q.type) filter.type = q.type;
      if (q.sourceIp) filter.srcIp = q.sourceIp;
      if (q.source === "rule") filter["ruleIds.0"] = { $exists: true };
      if (q.source === "model") filter["modelVersions.0"] = { $exists: true };
      if (q.cursor) {
        const c = decodeCursor(q.cursor);
        filter.$or = [{ lastSeen: { $lt: c.t } }, { lastSeen: c.t, _id: { $lt: c.id } }];
      }
      const rows = await Alert.find(filter).select("-hitKeys -flowIds -ruleHits").sort({ lastSeen: -1, _id: -1 }).limit(q.limit + 1).lean<LeanAlert[]>();
      const page = rows.slice(0, q.limit);
      const last = page.at(-1);
      res.json({ items: page.map(toAlertResponse), nextCursor: rows.length > q.limit && last ? encodeCursor(last.lastSeen, last._id) : null });
    }),
  );

  r.route(
    "get",
    "/alerts/summary",
    "alerts:read",
    validate("query", summaryQuery),
    ah(async (req, res) => {
      const { orgId } = authOf(req);
      res.json(await summarizeAlerts(orgId, parsed<z.infer<typeof summaryQuery>>(req, "query")));
    }),
  );

  r.route(
    "get",
    "/alerts/:id",
    "alerts:read",
    validate("params", z.object({ id: objectIdSchema })),
    ah(async (req, res) => {
      const { orgId, role } = authOf(req);
      const { id } = parsed<{ id: string }>(req, "params");
      const alert = await Alert.findOne({ orgId, _id: id }).lean<LeanAlert>();
      if (!alert) throw AppError.notFound("Alert");
      const evidenceIds = alert.flowIds.slice(-20);
      const [flows, topFlow, rules, verdictUser] = await Promise.all([
        evidenceIds.length ? Flow.find({ orgId, _id: { $in: evidenceIds } }).select("-features").sort({ timestamp: -1 }).lean<LeanFlow[]>() : [],
        alert.topFlowId ? Flow.findOne({ orgId, _id: alert.topFlowId }).lean<LeanFlow>() : null,
        alert.ruleIds.length ? Rule.find({ orgId, key: { $in: alert.ruleIds } }).lean() : [],
        alert.verdictBy ? User.findById(alert.verdictBy).select("name").lean() : null,
      ]);
      // Provenance and context: where the evidence came from, what else is known, who changed what.
      const evidenceMeta = await Flow.aggregate<{ _id: { d: unknown; k: string; g: string | null }; n: number }>([
        { $match: { orgId, _id: { $in: alert.flowIds } } },
        { $group: { _id: { d: "$datasetId", k: "$sourceKind", g: "$groundTruthLabel" }, n: { $sum: 1 } } },
      ]);
      const datasetIds = [...new Set(evidenceMeta.map((e) => e._id.d).filter(Boolean).map(String))];
      const [datasets, targetAsset, history, incident] = await Promise.all([
        datasetIds.length ? Dataset.find({ orgId, _id: { $in: datasetIds } }).select("name fileSha256 sourceKind createdAt uploadedBy").lean() : [],
        alert.dstIp ? Asset.findOne({ orgId, ip: alert.dstIp }).lean() : null,
        AuditLog.find({ orgId, "target.type": "alert", "target.id": String(alert._id) }).sort({ ts: 1 }).limit(100).lean(),
        alert.incidentId ? Incident.findOne({ orgId, _id: alert.incidentId }).select("title status").lean() : null,
      ]);
      const people = await User.find({ _id: { $in: [...datasets.map((d) => d.uploadedBy), ...history.map((h) => h.actorId)].filter(Boolean) } })
        .select("name")
        .lean();
      const nameOf = (uid: unknown) => (uid ? (people.find((p) => String(p._id) === String(uid))?.name ?? "Former member") : null);
      const groundTruth: Record<string, number> = {};
      for (const e of evidenceMeta) if (e._id.g) groundTruth[e._id.g] = (groundTruth[e._id.g] ?? 0) + e.n;
      const identityAllowed = can(role, "identity:read");
      const attribution = identityAllowed && alert.srcIp ? await attributeAddress(orgId, alert.srcIp, alert.firstSeen, alert.lastSeen) : null;
      const ruleDefs = rules.map((rule) => ({ def: definitionOf(rule), version: rule.version }));
      const analysis = buildAlertAnalysis({
        type: alert.type as AttackClass,
        srcIp: alert.srcIp ?? null,
        dstIp: alert.dstIp ?? null,
        dstPort: alert.dstPort ?? null,
        count: alert.count,
        firstSeen: alert.firstSeen,
        lastSeen: alert.lastSeen,
        maxConfidence: alert.maxConfidence,
        modelVersions: alert.modelVersions,
        rules: ruleDefs.map(({ def, version }) => ({ key: def.key, name: def.name, version, window: def.window, gte: def.condition.gte, distinct: def.condition.distinct })),
        ruleHits: alert.ruleHits.map((h) => ({ ruleKey: h.ruleKey ?? "", value: h.value ?? 0, flowCount: h.flowCount ?? 0 })),
        severity: SEVERITY_BY_RANK[alert.severityRank] ?? "info",
        status: alert.status,
        evidenceFlows: alert.flowIds.length,
        sourceKinds: [...new Set(evidenceMeta.map((e) => e._id.k))].sort(),
        datasets: datasets.map((d) => ({ name: d.name, sha256: d.fileSha256 ?? null })),
        groundTruth,
        targetEstimate: targetAsset
          ? estimateDeviceType(targetAsset.services.map((x) => ({ port: x.port ?? 0, protocol: x.protocol ?? "", flows: x.flows ?? 0 })), targetAsset.flowsAsSource)
          : null,
        attribution: attribution
          ? attribution.candidates.map((c) => ({ label: c.username ?? c.hostname ?? c.mac ?? "unknown", confidence: c.confidence, source: IDENTITY_SOURCE_LABEL[c.source] }))
          : null,
        connectedIdentitySources: attribution?.connectedSources.length ?? 0,
      });
      res.json({
        ...toAlertResponse(alert),
        analysis,
        attribution,
        identityRestricted: !identityAllowed,
        incident: incident ? { id: String(incident._id), title: incident.title, status: incident.status } : null,
        provenance: {
          datasets: datasets.map((d) => ({
            id: String(d._id),
            name: d.name,
            sha256: d.fileSha256 ?? null,
            sourceKind: d.sourceKind,
            importedAt: (d as { createdAt?: Date }).createdAt ?? null,
            importedBy: nameOf(d.uploadedBy),
          })),
          models: alert.modelVersions,
          rules: ruleDefs.map(({ def, version }) => ({ key: def.key, version })),
          createdAt: alert.createdAt,
        },
        history: history.map((h) => ({ ts: h.ts, actor: nameOf(h.actorId) ?? "Sentinel", action: h.action, meta: h.meta })),
        verdictBy: verdictUser ? { id: String(verdictUser._id), name: verdictUser.name } : null,
        verdictAt: alert.verdictAt ?? null,
        ruleHits: alert.ruleHits,
        rules: rules.map((rule) => {
          const d = definitionOf(rule);
          return { key: d.key, name: d.name, description: d.description, window: d.window, groupBy: d.groupBy, condition: d.condition, filter: d.filter, severity: d.severity, version: rule.version };
        }),
        explanationFlow: topFlow ? toFlowResponse(topFlow) : null,
        evidence: flows.map((f) => toFlowResponse(f)),
        evidenceTruncated: alert.flowIds.length > evidenceIds.length,
      });
    }),
  );

  r.route(
    "patch",
    "/alerts/:id",
    "alerts:write",
    validate("params", z.object({ id: objectIdSchema })),
    validate("body", updateAlertBodySchema),
    ah(async (req, res) => {
      const { orgId, userId } = authOf(req);
      const { id } = parsed<{ id: string }>(req, "params");
      const body = parsed<z.infer<typeof updateAlertBodySchema>>(req, "body");
      const before = await Alert.findOne({ orgId, _id: id }).select("status verdict").lean();
      if (!before) throw AppError.notFound("Alert");
      const set: Record<string, unknown> = {};
      if (body.status) set.status = body.status;
      if (body.verdict !== undefined) {
        set.verdict = body.verdict;
        set.verdictBy = body.verdict ? new mongoose.Types.ObjectId(String(userId)) : null;
        set.verdictAt = body.verdict ? new Date() : null;
      }
      const updated = await Alert.findOneAndUpdate({ orgId, _id: id }, { $set: set }, { new: true, runValidators: true })
        .select("-hitKeys -flowIds -ruleHits")
        .lean<LeanAlert>();
      if (!updated) throw AppError.notFound("Alert");
      const changes = Object.fromEntries(
        (["status", "verdict"] as const).filter((k) => k in body).map((k) => [k, { from: before[k] ?? null, to: body[k] ?? null }]),
      );
      await auditFromRequest(req, "alert.update", { type: "alert", id }, { changes });
      res.json(toAlertResponse(updated));
    }),
  );

  return r;
}
