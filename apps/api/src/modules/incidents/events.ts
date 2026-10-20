import type { Request } from "express";
import type { Types } from "mongoose";
import { IncidentEvent, INCIDENT_EVENT_KINDS } from "../../models/tenant.js";
import { auditFromRequest, writeAudit } from "../audit/audit.service.js";

export type IncidentEventKind = (typeof INCIDENT_EVENT_KINDS)[number];

/**
 * Records one investigation-log event and the matching audit entry, so every
 * incident change is visible both on the incident and in the org audit log
 * (ROADMAP 3.3). `req` null means Sentinel acted (correlation).
 */
export async function recordIncidentEvent(
  req: Request | null,
  orgId: Types.ObjectId,
  incidentId: Types.ObjectId,
  kind: IncidentEventKind,
  payload: Record<string, unknown> = {},
  opts: { audit?: boolean } = {},
): Promise<void> {
  const actorId = req?.auth?.userId ?? null;
  await IncidentEvent.create({ orgId, incidentId, kind, payload, actorId, ts: new Date() });
  // Routes that already write their own audit entry pass audit: false.
  if (opts.audit === false) return;
  const action = `incident.${kind}`;
  if (req?.auth) await auditFromRequest(req, action, { type: "incident", id: String(incidentId) }, payload);
  else await writeAudit(null, { orgId, actorId: null, action, target: { type: "incident", id: String(incidentId) }, meta: payload });
}
