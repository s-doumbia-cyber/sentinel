import mongoose, { type Types } from "mongoose";
import {
  BLOCKLIST_FORMATS,
  IDENTITY_SOURCE_LABEL,
  KNOWLEDGE_BASE,
  KNOWLEDGE_BASE_VERSION,
  SEVERITIES,
  addressScope,
  can,
  estimateDeviceType,
  generateBlocklist,
  objectIdSchema,
  severityRank,
  type AttackClass,
  type Severity,
} from "@sentinel/shared";
import { z } from "zod";
import type { AppConfig } from "../../config/index.js";
import { AppError } from "../../lib/errors.js";
import { ah, authOf, parsed, validate } from "../../lib/http.js";
import { PolicyRouter } from "../../lib/routes.js";
import { Asset } from "../../models/context.js";
import { Org } from "../../models/identity.js";
import { Alert, Dataset, Flow, Incident, IncidentEvent } from "../../models/tenant.js";
import { auditFromRequest } from "../audit/audit.service.js";
import { attributeAddress } from "../identity/identity.service.js";
import { linkAlerts } from "./correlation.service.js";
import { recordIncidentEvent } from "./events.js";
import { respondWith, userNames, type LeanIncident } from "./incident.dto.js";
import { buildAttackTimeline, type TimelineAlert } from "./timeline.js";

const SEVERITY_BY_RANK = Object.fromEntries(SEVERITIES.map((s) => [severityRank(s), s])) as Record<number, Severity>;
const PRIORITY: Record<Severity, "P1" | "P2" | "P3" | "P4"> = { critical: "P1", high: "P2", medium: "P3", low: "P4", info: "P4" };
const idParams = z.object({ id: objectIdSchema });
const alertIdsBody = z.object({ alertIds: z.array(objectIdSchema).min(1).max(200), title: z.string().trim().min(3).max(200).optional() }).strict();

const oid = (id: string) => new mongoose.Types.ObjectId(id);

async function incidentAlerts(orgId: Types.ObjectId, incidentId: Types.ObjectId): Promise<TimelineAlert[]> {
  const alerts = await Alert.find({ orgId, incidentId }).select("-hitKeys -ruleHits").sort({ firstSeen: 1 }).lean();
  return alerts.map((a) => ({
    id: String(a._id),
    type: a.type as AttackClass,
    severity: SEVERITY_BY_RANK[a.severityRank] ?? "info",
    srcIp: a.srcIp ?? null,
    dstIp: a.dstIp ?? null,
    dstPort: a.dstPort ?? null,
    count: a.count,
    firstSeen: a.firstSeen,
    lastSeen: a.lastSeen,
    sources: a.sources,
    status: a.status,
    verdict: a.verdict ?? null,
  }));
}

async function investigationLog(orgId: Types.ObjectId, incidentId: Types.ObjectId) {
  const events = await IncidentEvent.find({ orgId, incidentId }).sort({ ts: 1 }).limit(1000).lean();
  const names = await userNames(events.map((e) => e.actorId));
  return events.map((e) => ({
    id: String(e._id),
    ts: e.ts,
    kind: e.kind,
    actor: e.actorId ? (names.get(String(e.actorId)) ?? "Former member") : "Sentinel",
    payload: e.payload,
  }));
}

export function incidentWorkflowRoutes(config: AppConfig): PolicyRouter {
  const r = new PolicyRouter(config);

  r.route(
    "post",
    "/incidents/from-alerts",
    "incidents:write",
    validate("body", alertIdsBody),
    ah(async (req, res) => {
      const { orgId, userId } = authOf(req);
      const body = parsed<z.infer<typeof alertIdsBody>>(req, "body");
      const alerts = await Alert.find({ orgId, _id: { $in: body.alertIds.map(oid) } }).lean();
      if (alerts.length !== new Set(body.alertIds).size) throw AppError.notFound("Alert");
      const taken = alerts.filter((a) => a.incidentId);
      if (taken.length) throw AppError.conflict(`${taken.length} alert(s) already belong to an incident; open it instead`);
      const top = [...alerts].sort((a, b) => b.severityRank - a.severityRank)[0];
      if (!top) throw AppError.notFound("Alert");
      const severity = SEVERITY_BY_RANK[top.severityRank] ?? "info";
      const incident = await Incident.create({
        orgId,
        title: body.title ?? `${top.type} involving ${top.srcIp ?? top.dstIp ?? "several addresses"}`,
        description: "",
        attackType: top.type,
        severity,
        priority: PRIORITY[severity],
        sourceIp: top.srcIp ?? null,
        createdBy: userId,
        origin: "from_alerts",
      });
      await auditFromRequest(req, "incident.create", { type: "incident", id: String(incident._id) }, { title: incident.title, fromAlerts: alerts.length });
      await recordIncidentEvent(req, orgId, incident._id, "created", { title: incident.title, origin: "from_alerts" }, { audit: false });
      await linkAlerts(req, orgId, incident._id, alerts.map((a) => a._id), "Selected by an analyst");
      const saved = await Incident.findOne({ orgId, _id: incident._id }).lean<LeanIncident>();
      if (!saved) throw AppError.notFound("Incident");
      res.status(201).json(await respondWith(saved));
    }),
  );

  r.route(
    "post",
    "/incidents/:id/alerts",
    "incidents:write",
    validate("params", idParams),
    validate("body", alertIdsBody.pick({ alertIds: true })),
    ah(async (req, res) => {
      const { orgId } = authOf(req);
      const { id } = parsed<{ id: string }>(req, "params");
      const { alertIds } = parsed<{ alertIds: string[] }>(req, "body");
      const incident = await Incident.findOne({ orgId, _id: id }).lean();
      if (!incident) throw AppError.notFound("Incident");
      if ((await Alert.countDocuments({ orgId, _id: { $in: alertIds.map(oid) } })) !== new Set(alertIds).size) throw AppError.notFound("Alert");
      const linked = await linkAlerts(req, orgId, incident._id, alertIds.map(oid), "Added by an analyst");
      res.json({ linked, skipped: alertIds.length - linked });
    }),
  );

  r.route(
    "get",
    "/incidents/:id/timeline",
    "incidents:read",
    validate("params", idParams),
    ah(async (req, res) => {
      const { orgId } = authOf(req);
      const { id } = parsed<{ id: string }>(req, "params");
      const incident = await Incident.findOne({ orgId, _id: id }).lean();
      if (!incident) throw AppError.notFound("Incident");
      const alerts = await incidentAlerts(orgId, incident._id);
      res.json({ attack: buildAttackTimeline(alerts), alerts, log: await investigationLog(orgId, incident._id) });
    }),
  );

  r.route(
    "get",
    "/incidents/:id/guidance",
    "incidents:read",
    validate("params", idParams),
    ah(async (req, res) => {
      const { orgId } = authOf(req);
      const { id } = parsed<{ id: string }>(req, "params");
      const incident = await Incident.findOne({ orgId, _id: id }).lean<LeanIncident>();
      if (!incident) throw AppError.notFound("Incident");
      const types = [...new Set([incident.attackType, ...(await Alert.distinct("type", { orgId, incidentId: incident._id }))])] as AttackClass[];
      const sources = (incident.entities ?? []).filter((e) => e.role === "source" && e.value).map((e) => e.value as string);
      res.json({
        knowledgeBaseVersion: KNOWLEDGE_BASE_VERSION,
        entries: types.flatMap((t) => (KNOWLEDGE_BASE[t] ? [{ type: t, ...KNOWLEDGE_BASE[t] }] : [])),
        blocklistCandidates: sources.map((ip) => ({ ip, scope: addressScope(ip) })),
        enforcement: "none",
        notice: "Sentinel has no enforcement integration: it recommends and simulates, it never blocks, isolates or changes a firewall.",
      });
    }),
  );

  r.route(
    "post",
    "/incidents/:id/actions",
    "incidents:write",
    validate("params", idParams),
    validate(
      "body",
      z
        .object({ description: z.string().trim().min(3).max(2000), performedAt: z.string().datetime({ offset: true }).optional() })
        .strict(),
    ),
    ah(async (req, res) => {
      const { orgId } = authOf(req);
      const { id } = parsed<{ id: string }>(req, "params");
      const body = parsed<{ description: string; performedAt?: string }>(req, "body");
      const incident = await Incident.findOne({ orgId, _id: id }).lean();
      if (!incident) throw AppError.notFound("Incident");
      await recordIncidentEvent(req, orgId, incident._id, "action_recorded", {
        description: body.description,
        performedAt: body.performedAt ?? new Date().toISOString(),
        verification: "Reported by an analyst; not executed or verified by Sentinel",
      });
      res.status(201).json({ recorded: true });
    }),
  );

  r.route(
    "post",
    "/response/blocklist",
    "incidents:write",
    validate(
      "body",
      z
        .object({
          ips: z.array(z.string().ip()).min(1).max(500),
          format: z.enum(BLOCKLIST_FORMATS),
          comment: z.string().max(200).default("sentinel"),
          incidentId: objectIdSchema.optional(),
        })
        .strict(),
    ),
    ah(async (req, res) => {
      const { orgId } = authOf(req);
      const body = parsed<{ ips: string[]; format: (typeof BLOCKLIST_FORMATS)[number]; comment: string; incidentId?: string }>(req, "body");
      const warnings = body.ips
        .filter((ip) => addressScope(ip) === "internal")
        .map((ip) => `${ip} is an internal address: blocking it can cut off a legitimate host or service.`);
      const content = generateBlocklist(body.ips, body.format, body.comment);
      if (body.incidentId) {
        const incident = await Incident.findOne({ orgId, _id: body.incidentId }).lean();
        if (!incident) throw AppError.notFound("Incident");
        await recordIncidentEvent(req, orgId, incident._id, "simulation_generated", { format: body.format, ips: body.ips, applied: false });
      } else {
        await auditFromRequest(req, "response.simulate_blocklist", { type: "org", id: String(orgId) }, { format: body.format, ips: body.ips });
      }
      res.json({ format: body.format, content, simulated: true, applied: false, warnings });
    }),
  );

  r.route(
    "post",
    "/incidents/:id/report",
    "incidents:read",
    validate("params", idParams),
    ah(async (req, res) => {
      const { orgId, role, userId } = authOf(req);
      const { id } = parsed<{ id: string }>(req, "params");
      const incident = await Incident.findOne({ orgId, _id: id }).lean<LeanIncident>();
      if (!incident) throw AppError.notFound("Incident");
      const [org, alerts, alertDocs, log] = await Promise.all([
        Org.findById(orgId).select("name").lean(),
        incidentAlerts(orgId, incident._id),
        Alert.find({ orgId, incidentId: incident._id }).select("flowIds modelVersions ruleIds").lean(),
        investigationLog(orgId, incident._id),
      ]);
      const flowIds = alertDocs.flatMap((a) => a.flowIds);
      const datasetIds = flowIds.length ? await Flow.distinct("datasetId", { orgId, _id: { $in: flowIds } }) : [];
      const datasets = datasetIds.length ? await Dataset.find({ orgId, _id: { $in: datasetIds } }).select("name fileSha256 sourceKind createdAt").lean() : [];
      const window = {
        from: incident.firstSeen ?? alerts[0]?.firstSeen ?? new Date(0),
        to: incident.lastSeen ?? alerts.at(-1)?.lastSeen ?? new Date(),
      };
      const identityAllowed = can(role, "identity:read");
      const entities = await Promise.all(
        (incident.entities ?? []).map(async (e) => {
          const ip = e.value ?? "";
          const asset = await Asset.findOne({ orgId, ip }).lean();
          const attribution = identityAllowed ? await attributeAddress(orgId, ip, window.from, window.to) : null;
          return {
            ip,
            role: e.role,
            scope: addressScope(ip),
            deviceEstimate: asset
              ? estimateDeviceType(asset.services.map((s) => ({ port: s.port ?? 0, protocol: s.protocol ?? "", flows: s.flows ?? 0 })), asset.flowsAsSource)
              : null,
            identity: attribution
              ? {
                  candidates: attribution.candidates.map((c) => ({ ...c, sourceLabel: IDENTITY_SOURCE_LABEL[c.source] })),
                  ambiguous: attribution.ambiguous,
                  caveats: attribution.caveats,
                }
              : "restricted",
          };
        }),
      );
      const types = [...new Set(alerts.map((a) => a.type))];
      const generatedAt = new Date();
      const report = {
        meta: {
          reportVersion: 1,
          generatedAt: generatedAt.toISOString(),
          organisation: org?.name ?? "",
          knowledgeBaseVersion: KNOWLEDGE_BASE_VERSION,
          timezone: "UTC",
        },
        incident: await respondWith(incident),
        attack: buildAttackTimeline(alerts),
        alerts,
        entities,
        response: {
          recommendations: types.flatMap((t) => (KNOWLEDGE_BASE[t] ? [{ type: t, confirm: KNOWLEDGE_BASE[t].confirm, contain: KNOWLEDGE_BASE[t].contain }] : [])),
          recordedActions: log.filter((e) => e.kind === "action_recorded"),
          simulations: log.filter((e) => e.kind === "simulation_generated"),
          enforcement: "Sentinel did not block, isolate or change anything. Recorded actions were reported by analysts and not verified by Sentinel.",
        },
        investigationLog: log,
        provenance: {
          datasets: datasets.map((d) => ({ name: d.name, sha256: d.fileSha256 ?? null, sourceKind: d.sourceKind, importedAt: (d as { createdAt?: Date }).createdAt ?? null })),
          models: [...new Set(alertDocs.flatMap((a) => a.modelVersions))],
          rules: [...new Set(alertDocs.flatMap((a) => a.ruleIds))],
        },
        limitations: [
          "Network flows show addresses, ports, volumes and timing, not payloads or outcomes.",
          "Detections come from a model and rules that can be wrong; benchmark scores are not production performance.",
          "An IP address does not identify a person; identity associations come only from imported records, each with its confidence.",
          "Event times are stored as recorded by the source (UTC assumed).",
        ],
      };
      await recordIncidentEvent(req, orgId, incident._id, "report_generated", { generatedAt: generatedAt.toISOString(), by: String(userId) });
      res.json(report);
    }),
  );

  return r;
}
