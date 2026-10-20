import type { Types } from "mongoose";
import {
  INCIDENT_STATUSES,
  PRIORITIES,
  createIncidentBodySchema,
  incidentNoteBodySchema,
  objectIdSchema,
  updateIncidentBodySchema,
} from "@sentinel/shared";
import { z } from "zod";
import type { AppConfig } from "../../config/index.js";
import { AppError } from "../../lib/errors.js";
import { ah, authOf, parsed, validate } from "../../lib/http.js";
import { PolicyRouter } from "../../lib/routes.js";
import { Membership } from "../../models/identity.js";
import { Alert, Incident } from "../../models/tenant.js";
import { auditFromRequest } from "../audit/audit.service.js";
import { recordIncidentEvent, type IncidentEventKind } from "./events.js";
import { respondWith, toIncidentResponse, userNames, type LeanIncident } from "./incident.dto.js";

const idParams = z.object({ id: objectIdSchema });
const listQuery = z.object({
  status: z.enum(INCIDENT_STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

const EVENT_FOR_FIELD: Record<string, IncidentEventKind> = {
  status: "status_changed",
  priority: "priority_changed",
  severity: "severity_changed",
  assigneeId: "assignee_changed",
  title: "title_changed",
};

/** An assignee must be a member of the same org. */
export async function assertMember(orgId: Types.ObjectId, userId: string | null | undefined) {
  if (!userId) return;
  if (!(await Membership.exists({ orgId, userId }))) throw AppError.validation("Assignee is not a member of this organisation");
}

export function incidentRoutes(config: AppConfig): PolicyRouter {
  const r = new PolicyRouter(config);

  r.route(
    "get",
    "/incidents",
    "incidents:read",
    validate("query", listQuery),
    ah(async (req, res) => {
      const { orgId } = authOf(req);
      const q = parsed<z.infer<typeof listQuery>>(req, "query");
      const filter: Record<string, unknown> = { orgId };
      if (q.status) filter.status = q.status;
      if (q.priority) filter.priority = q.priority;
      const items = await Incident.find(filter).sort({ updatedAt: -1 }).limit(q.limit).lean<LeanIncident[]>();
      const names = await userNames(items.flatMap((i) => [i.assigneeId, ...(i.notes ?? []).map((n) => n.authorId)]));
      res.json({ items: items.map((i) => toIncidentResponse(i, names)) });
    }),
  );

  r.route(
    "get",
    "/incidents/:id",
    "incidents:read",
    validate("params", idParams),
    ah(async (req, res) => {
      const { id } = parsed<{ id: string }>(req, "params");
      const incident = await Incident.findOne({ orgId: authOf(req).orgId, _id: id }).lean<LeanIncident>();
      if (!incident) throw AppError.notFound("Incident");
      res.json(await respondWith(incident));
    }),
  );

  r.route(
    "post",
    "/incidents",
    "incidents:write",
    validate("body", createIncidentBodySchema),
    ah(async (req, res) => {
      const { orgId, userId } = authOf(req);
      const body = parsed<z.infer<typeof createIncidentBodySchema>>(req, "body");
      await assertMember(orgId, body.assigneeId);
      const incident = await Incident.create({
        ...body,
        orgId,
        createdBy: userId,
        origin: "manual",
        entities: body.sourceIp ? [{ type: "ip", value: body.sourceIp, role: "source" }] : [],
      });
      await auditFromRequest(req, "incident.create", { type: "incident", id: String(incident._id) }, { title: body.title });
      await recordIncidentEvent(req, orgId, incident._id, "created", { title: body.title, origin: "manual" }, { audit: false });
      res.status(201).json(await respondWith(incident.toObject() as unknown as LeanIncident));
    }),
  );

  r.route(
    "patch",
    "/incidents/:id",
    "incidents:write",
    validate("params", idParams),
    validate("body", updateIncidentBodySchema),
    ah(async (req, res) => {
      const { orgId } = authOf(req);
      const { id } = parsed<{ id: string }>(req, "params");
      const body = parsed<z.infer<typeof updateIncidentBodySchema>>(req, "body");
      await assertMember(orgId, body.assigneeId);
      const before = await Incident.findOne({ orgId, _id: id }).lean<LeanIncident>();
      if (!before) throw AppError.notFound("Incident");
      const incident = await Incident.findOneAndUpdate({ orgId, _id: id }, { $set: body }, { new: true, runValidators: true }).lean<LeanIncident>();
      if (!incident) throw AppError.notFound("Incident");
      const changes = Object.fromEntries(
        Object.keys(body).map((k) => [k, { from: (before as unknown as Record<string, unknown>)[k] ?? null, to: (body as Record<string, unknown>)[k] }]),
      );
      await auditFromRequest(req, "incident.update", { type: "incident", id }, { changes });
      for (const [field, change] of Object.entries(changes)) {
        const kind = EVENT_FOR_FIELD[field];
        if (kind && String(change.from) !== String(change.to)) {
          await recordIncidentEvent(req, orgId, incident._id, kind, { from: change.from === null ? null : String(change.from), to: change.to === null ? null : String(change.to) }, { audit: false });
        }
      }
      res.json(await respondWith(incident));
    }),
  );

  r.route(
    "post",
    "/incidents/:id/notes",
    "incidents:write",
    validate("params", idParams),
    validate("body", incidentNoteBodySchema),
    ah(async (req, res) => {
      const { orgId, userId } = authOf(req);
      const { id } = parsed<{ id: string }>(req, "params");
      const { text } = parsed<{ text: string }>(req, "body");
      const incident = await Incident.findOneAndUpdate(
        { orgId, _id: id },
        { $push: { notes: { authorId: userId, text, createdAt: new Date() } } },
        { new: true },
      ).lean<LeanIncident>();
      if (!incident) throw AppError.notFound("Incident");
      await auditFromRequest(req, "incident.note", { type: "incident", id });
      await recordIncidentEvent(req, orgId, incident._id, "note", { text }, { audit: false });
      res.status(201).json(await respondWith(incident));
    }),
  );

  r.route(
    "delete",
    "/incidents/:id",
    "incidents:delete",
    validate("params", idParams),
    ah(async (req, res) => {
      const { orgId } = authOf(req);
      const { id } = parsed<{ id: string }>(req, "params");
      const incident = await Incident.findOneAndDelete({ orgId, _id: id }).lean<LeanIncident>();
      if (!incident) throw AppError.notFound("Incident");
      // Alerts survive the incident and can be grouped again.
      await Alert.updateMany({ orgId, incidentId: incident._id }, { $set: { incidentId: null } });
      await auditFromRequest(req, "incident.delete", { type: "incident", id }, { title: incident.title });
      res.status(204).end();
    }),
  );

  return r;
}
