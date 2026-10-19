import mongoose, { type Types } from "mongoose";
import type { FlowQuery, StatsQuery } from "@sentinel/shared";
import { AppError } from "../../lib/errors.js";

type Filter = Record<string, unknown>;

/**
 * Builds the Mongo filter for flow queries. The org scope is always the first
 * key and comes from the authenticated context, never from the query string.
 */
export function buildFlowFilter(orgId: Types.ObjectId, q: Partial<FlowQuery & StatsQuery>): Filter {
  const filter: Filter = { orgId };
  if (q.from || q.to) {
    const ts: Record<string, Date> = {};
    if (q.from) ts.$gte = new Date(q.from);
    if (q.to) ts.$lte = new Date(q.to);
    filter.timestamp = ts;
  }
  if (q.sourceIp) filter.sourceIp = q.sourceIp;
  if (q.destinationIp) filter.destinationIp = q.destinationIp;
  if (q.port !== undefined) filter.destinationPort = q.port;
  if (q.protocol) filter.protocol = q.protocol;
  if (q.sourceKind) filter.sourceKind = q.sourceKind;
  if (q.datasetId) filter.datasetId = new mongoose.Types.ObjectId(q.datasetId);
  if (q.verdict === "unscored") filter.scoreStatus = "pending";
  else if (q.verdict === "error") filter.scoreStatus = "error";
  else if (q.verdict === "malicious") Object.assign(filter, { scoreStatus: "scored", "scored.label": { $ne: "Normal" } });
  else if (q.verdict) Object.assign(filter, { scoreStatus: "scored", "scored.label": q.verdict });
  if (q.severity) Object.assign(filter, { scoreStatus: "scored", "scored.severity": q.severity });
  if (q.needsReview) Object.assign(filter, { scoreStatus: "scored", "scored.needsReview": true });
  return filter;
}

interface Cursor {
  t: string;
  id: string;
}

export function encodeCursor(timestamp: Date, id: Types.ObjectId): string {
  return Buffer.from(JSON.stringify({ t: timestamp.toISOString(), id: String(id) })).toString("base64url");
}

export function decodeCursor(cursor: string): { t: Date; id: Types.ObjectId } {
  try {
    const c = JSON.parse(Buffer.from(cursor, "base64url").toString("utf-8")) as Cursor;
    const t = new Date(c.t);
    if (Number.isNaN(t.getTime()) || !mongoose.isValidObjectId(c.id)) throw new Error("bad cursor");
    return { t, id: new mongoose.Types.ObjectId(c.id) };
  } catch {
    throw AppError.validation("Invalid cursor");
  }
}
