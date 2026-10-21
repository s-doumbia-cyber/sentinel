import type { Types } from "mongoose";
import { SEVERITIES, severityRank, type Severity } from "@sentinel/shared";
import { Alert } from "../../models/tenant.js";

const SEVERITY_BY_RANK = Object.fromEntries(SEVERITIES.map((s) => [severityRank(s), s])) as Record<number, Severity>;
export const ACTIVE_ALERT_STATUSES = ["open", "needs_review", "acknowledged"] as const;

export interface TimeRange {
  from?: Date | null;
  to?: Date | null;
}

/** An alert belongs to a range when its activity overlaps it. No bounds means all time. */
export function alertRangeFilter(orgId: Types.ObjectId, range: TimeRange = {}): Record<string, unknown> {
  return {
    orgId,
    ...(range.from ? { lastSeen: { $gte: range.from } } : {}),
    ...(range.to ? { firstSeen: { $lte: range.to } } : {}),
  };
}

export interface AlertSummary {
  byStatus: Record<string, number>;
  activeBySeverity: Record<string, number>;
  /** Every status, by severity: what a report counts. */
  bySeverity: Record<string, number>;
  byType: Record<string, number>;
  total: number;
}

/**
 * The one place alert totals are computed: the Command Center, `GET /alerts/summary` and the executive
 * report all call it, so the same range gives the same numbers everywhere.
 */
export async function summarizeAlerts(orgId: Types.ObjectId, range: TimeRange = {}): Promise<AlertSummary> {
  const rows = await Alert.aggregate<{ _id: { status: string; rank: number; type: string }; n: number }>([
    { $match: alertRangeFilter(orgId, range) },
    { $group: { _id: { status: "$status", rank: "$severityRank", type: "$type" }, n: { $sum: 1 } } },
  ]);
  const byStatus: Record<string, number> = {};
  const activeBySeverity: Record<string, number> = {};
  const bySeverity: Record<string, number> = {};
  const byType: Record<string, number> = {};
  let total = 0;
  for (const row of rows) {
    const sev = SEVERITY_BY_RANK[row._id.rank] ?? "info";
    total += row.n;
    byStatus[row._id.status] = (byStatus[row._id.status] ?? 0) + row.n;
    bySeverity[sev] = (bySeverity[sev] ?? 0) + row.n;
    byType[row._id.type] = (byType[row._id.type] ?? 0) + row.n;
    if ((ACTIVE_ALERT_STATUSES as readonly string[]).includes(row._id.status)) activeBySeverity[sev] = (activeBySeverity[sev] ?? 0) + row.n;
  }
  return { byStatus, activeBySeverity, bySeverity, byType, total };
}
