import type { Request } from "express";
import type { Types } from "mongoose";
import { AuditLog } from "../../models/tenant.js";

export interface AuditEntry {
  orgId: Types.ObjectId;
  actorId: Types.ObjectId | null;
  action: string;
  target: { type: string; id?: string | null };
  meta?: Record<string, unknown>;
}

/** Appends one audit entry. Callers pass only non-secret metadata. */
export async function writeAudit(req: Request | null, entry: AuditEntry): Promise<void> {
  await AuditLog.create({
    ...entry,
    target: { type: entry.target.type, id: entry.target.id ?? null },
    meta: entry.meta ?? {},
    ts: new Date(),
    ip: req?.ip ?? "",
    requestId: req?.id ?? "",
  });
}

/** Convenience for authenticated routes: actor and org come from the request context. */
export function auditFromRequest(
  req: Request,
  action: string,
  target: AuditEntry["target"],
  meta?: Record<string, unknown>,
): Promise<void> {
  if (!req.auth) throw new Error("auditFromRequest requires an authenticated request");
  return writeAudit(req, { orgId: req.auth.orgId, actorId: req.auth.userId, action, target, meta });
}
