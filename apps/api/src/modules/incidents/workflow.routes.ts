import mongoose from "mongoose";
import {
  BLOCKLIST_FORMATS,
  KNOWLEDGE_BASE,
  KNOWLEDGE_BASE_VERSION,
  SEVERITIES,
  addressScope,
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
import { Alert, Incident } from "../../models/tenant.js";
import { auditFromRequest } from "../audit/audit.service.js";
import { linkAlerts } from "./correlation.service.js";
import { recordIncidentEvent } from "./events.js";
import { respondWith, type LeanIncident } from "./incident.dto.js";
import { buildIncidentReport, incidentAlerts, investigationLog } from "./report.service.js";
import { buildAttackTimeline } from "./timeline.js";

const SEVERITY_BY_RANK = Object.fromEntries(SEVERITIES.map((s) => [severityRank(s), s])) as Record<number, Severity>;
const PRIORITY: Record<Severity, "P1" | "P2" | "P3" | "P4"> = { critical: "P1", high: "P2", medium: "P3", low: "P4", info: "P4" };
const idParams = z.object({ id: objectIdSchema });
const alertIdsBody = z.object({ alertIds: z.array(objectIdSchema).min(1).max(200), title: z.string().trim().min(3).max(200).optional() }).strict();

const oid = (id: string) => new mongoose.Types.ObjectId(id);

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
      const generatedAt = new Date();
      const report = await buildIncidentReport(orgId, role, incident, generatedAt);
      await recordIncidentEvent(req, orgId, incident._id, "report_generated", { generatedAt: generatedAt.toISOString(), by: String(userId) });
      res.json(report);
    }),
  );

  return r;
}
