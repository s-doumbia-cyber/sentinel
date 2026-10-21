import type { Types } from "mongoose";
import { SEVERITIES, type Severity } from "@sentinel/shared";
import { Org } from "../../models/identity.js";
import { Alert, AuditLog, Dataset, Flow, Incident, Rule } from "../../models/tenant.js";
import { alertRangeFilter, summarizeAlerts, type TimeRange } from "../alerts/summary.js";
import { buildFlowFilter } from "../flows/flow.filters.js";
import { evaluation, overview, top, breakdown } from "../stats/stats.service.js";

/** Triage times are computed over at most this many alerts (newest first) to keep the report quick. */
export const TRIAGE_SAMPLE_LIMIT = 5000;
export const EXECUTIVE_REPORT_VERSION = 1;

export interface ExecutiveReport {
  meta: { reportVersion: number; generatedAt: string; organisation: string; timezone: "UTC"; range: { from: string | null; to: string | null } };
  headline: string[];
  flows: Awaited<ReturnType<typeof overview>>;
  verdicts: { key: string | null; count: number }[];
  topSources: Awaited<ReturnType<typeof top>>;
  topPorts: Awaited<ReturnType<typeof top>>;
  alerts: Awaited<ReturnType<typeof summarizeAlerts>>;
  incidents: { total: number; openNow: number; byStatus: Record<string, number>; bySeverity: Record<string, number>; byType: Record<string, number> };
  triage: { alertsConsidered: number; triaged: number; untriaged: number; meanMinutes: number | null; medianMinutes: number | null; basis: string };
  evaluation: { evaluatedFlows: number; macroF1: number | null; perClass: Awaited<ReturnType<typeof evaluation>>["perClass"]; modelVersions: string[] } | null;
  provenance: {
    datasets: { name: string; sourceKind: string; sha256: string | null; flows: number }[];
    flowsWithoutDataset: number;
    models: string[];
    rules: { key: string; version: number | null }[];
  };
  limitations: string[];
}

const isoOrNull = (d: Date | null | undefined) => (d ? d.toISOString() : null);

function median(sorted: number[]): number | null {
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[mid] ?? null) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/** Incidents whose activity overlaps the range; ones without activity times fall back to their creation time. */
function incidentRangeFilter(orgId: Types.ObjectId, range: TimeRange): Record<string, unknown> {
  if (!range.from && !range.to) return { orgId };
  const overlap: Record<string, unknown> = {
    ...(range.to ? { firstSeen: { $lte: range.to } } : {}),
    ...(range.from ? { lastSeen: { $gte: range.from } } : {}),
  };
  const created: Record<string, Date> = {};
  if (range.from) created.$gte = range.from;
  if (range.to) created.$lte = range.to;
  return { orgId, $or: [overlap, { firstSeen: null, createdAt: created }] };
}

/** Wall-clock minutes from Sentinel raising an alert to the first analyst change on it (audit log). */
async function triageStats(orgId: Types.ObjectId, range: TimeRange): Promise<ExecutiveReport["triage"]> {
  const alerts = await Alert.find(alertRangeFilter(orgId, range)).select("createdAt").sort({ createdAt: -1 }).limit(TRIAGE_SAMPLE_LIMIT).lean();
  const basis = "Time between Sentinel raising an alert and the first change an analyst made to it (status or verdict), in wall-clock time. Alerts nobody has touched are counted as untriaged, not as zero.";
  if (!alerts.length) return { alertsConsidered: 0, triaged: 0, untriaged: 0, meanMinutes: null, medianMinutes: null, basis };
  const created = new Map(alerts.map((a) => [String(a._id), (a as { createdAt?: Date }).createdAt ?? null]));
  const firstTouch = await AuditLog.aggregate<{ _id: string; ts: Date }>([
    { $match: { orgId, action: "alert.update", "target.type": "alert", "target.id": { $in: [...created.keys()] }, actorId: { $ne: null } } },
    { $group: { _id: "$target.id", ts: { $min: "$ts" } } },
  ]);
  const minutes = firstTouch
    .flatMap((t) => {
      const at = created.get(t._id);
      return at ? [Math.max(0, (t.ts.getTime() - at.getTime()) / 60_000)] : [];
    })
    .sort((a, b) => a - b);
  const mean = minutes.length ? minutes.reduce((a, b) => a + b, 0) / minutes.length : null;
  return { alertsConsidered: alerts.length, triaged: minutes.length, untriaged: alerts.length - minutes.length, meanMinutes: mean, medianMinutes: median(minutes), basis };
}

export const EXECUTIVE_LIMITATIONS = [
  "Flow, verdict and source numbers are counted over event time (when the traffic happened); alert and incident numbers count those whose activity overlaps the period.",
  "Malicious means a model verdict or a rule hit, never a dataset label. Verdicts can be wrong; benchmark scores measured on a public dataset are not production performance.",
  "Detection quality is shown only where flows carry ground-truth labels (imported datasets). Live traffic has no labels, so no accuracy figure exists for it.",
  "Time to triage covers alerts that an analyst has touched; it says nothing about alerts that were reviewed without changing their status or verdict.",
  "Sentinel reads network flows (addresses, ports, volumes, timing), not payloads or host logs; it cannot say whether an attack succeeded.",
  "Sentinel recommends and simulates responses; it does not block, isolate or change anything in the network.",
];

/**
 * Org-level report over a time range. Every figure comes from the same functions the dashboard uses
 * (`overview`, `breakdown`, `top`, `summarizeAlerts`), so the same range gives the same numbers.
 */
export async function buildExecutiveReport(orgId: Types.ObjectId, range: TimeRange, generatedAt = new Date()): Promise<ExecutiveReport> {
  const stats = { from: isoOrNull(range.from), to: isoOrNull(range.to) } as { from?: string; to?: string };
  const flowQuery = { ...(stats.from ? { from: stats.from } : {}), ...(stats.to ? { to: stats.to } : {}) };
  const [org, flows, verdicts, topSources, topPorts, alerts, triage, evalResult] = await Promise.all([
    Org.findById(orgId).select("name").lean(),
    overview(orgId, flowQuery),
    breakdown(orgId, flowQuery, "verdict"),
    top(orgId, flowQuery, "attackers", 10),
    top(orgId, flowQuery, "ports", 10),
    summarizeAlerts(orgId, range),
    triageStats(orgId, range),
    evaluation(orgId, flowQuery),
  ]);

  const [incidentDocs, openNow, alertDocs, datasetCounts] = await Promise.all([
    Incident.find(incidentRangeFilter(orgId, range)).select("status severity attackType").lean(),
    Incident.countDocuments({ orgId, status: { $nin: ["Resolved", "Closed"] } }),
    Alert.find(alertRangeFilter(orgId, range)).select("modelVersions ruleIds").limit(TRIAGE_SAMPLE_LIMIT).lean(),
    Flow.aggregate<{ _id: Types.ObjectId | null; n: number }>([{ $match: buildFlowFilter(orgId, flowQuery) }, { $group: { _id: "$datasetId", n: { $sum: 1 } } }]).allowDiskUse(true),
  ]);
  const tally = (values: string[]) => values.reduce<Record<string, number>>((acc, v) => ({ ...acc, [v]: (acc[v] ?? 0) + 1 }), {});
  const incidents = {
    total: incidentDocs.length,
    openNow,
    byStatus: tally(incidentDocs.map((i) => i.status)),
    bySeverity: tally(incidentDocs.map((i) => i.severity)),
    byType: tally(incidentDocs.map((i) => i.attackType)),
  };

  const datasetIds = datasetCounts.flatMap((d) => (d._id ? [d._id] : []));
  const datasetDocs = datasetIds.length ? await Dataset.find({ orgId, _id: { $in: datasetIds } }).select("name sourceKind fileSha256").lean() : [];
  const ruleKeys = [...new Set(alertDocs.flatMap((a) => a.ruleIds))].sort();
  const ruleDocs = ruleKeys.length ? await Rule.find({ orgId, key: { $in: ruleKeys } }).select("key version").lean() : [];
  const provenance: ExecutiveReport["provenance"] = {
    datasets: datasetCounts
      .flatMap((c) => {
        const d = c._id ? datasetDocs.find((x) => String(x._id) === String(c._id)) : undefined;
        return d ? [{ name: d.name, sourceKind: d.sourceKind, sha256: d.fileSha256 ?? null, flows: c.n }] : [];
      })
      .sort((a, b) => b.flows - a.flows),
    flowsWithoutDataset: datasetCounts.filter((c) => !c._id).reduce((a, c) => a + c.n, 0),
    models: [...new Set(alertDocs.flatMap((a) => a.modelVersions))].sort(),
    rules: ruleKeys.map((key) => ({ key, version: ruleDocs.find((r) => r.key === key)?.version ?? null })),
  };

  const sev = (s: Severity) => alerts.bySeverity[s] ?? 0;
  const sevText = SEVERITIES.filter((s) => sev(s) > 0).map((s) => `${sev(s)} ${s}`).join(", ");
  const headline = [
    `${flows.totalFlows.toLocaleString("en-US")} flows in the period; ${flows.maliciousFlows.toLocaleString("en-US")} carry a malicious model verdict, from ${flows.maliciousSourceIps.toLocaleString("en-US")} source address(es). ${flows.pendingFlows.toLocaleString("en-US")} are not scored yet.`,
    alerts.total ? `${alerts.total} alert(s) overlapped the period (${sevText}).` : "No alert overlapped the period.",
    incidents.total ? `${incidents.total} incident(s) overlapped the period; ${incidents.openNow} incident(s) are open now.` : `No incident overlapped the period; ${incidents.openNow} incident(s) are open now.`,
    triage.triaged
      ? `Analysts touched ${triage.triaged} of ${triage.alertsConsidered} alert(s); mean time to first triage ${triage.meanMinutes?.toFixed(1)} min, median ${triage.medianMinutes?.toFixed(1)} min.`
      : triage.alertsConsidered
        ? `No analyst has touched any of the ${triage.alertsConsidered} alert(s) yet, so there is no time to triage.`
        : "There are no alerts to triage.",
  ];

  return {
    meta: { reportVersion: EXECUTIVE_REPORT_VERSION, generatedAt: generatedAt.toISOString(), organisation: org?.name ?? "", timezone: "UTC", range: { from: stats.from ?? null, to: stats.to ?? null } },
    headline,
    flows,
    verdicts,
    topSources,
    topPorts,
    alerts,
    incidents,
    triage,
    evaluation: evalResult.evaluatedFlows ? { evaluatedFlows: evalResult.evaluatedFlows, macroF1: evalResult.macroF1, perClass: evalResult.perClass, modelVersions: evalResult.modelVersions } : null,
    provenance,
    limitations: EXECUTIVE_LIMITATIONS,
  };
}
