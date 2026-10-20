import type { Types } from "mongoose";
import { severityRank, SEVERITIES, type Severity } from "@sentinel/shared";
import { IdentityImport, IdentityObservation } from "../../models/context.js";
import { Alert, AuditLog, Dataset, Flow, IncidentEvent } from "../../models/tenant.js";
import { userNames } from "./incident.dto.js";

export const TRACE_STAGES = ["ingest", "context", "detect", "triage", "investigate", "respond", "report"] as const;
export type TraceStage = (typeof TRACE_STAGES)[number];

export interface TraceEntry {
  ts: Date;
  stage: TraceStage;
  /** A member's name, "Sentinel" for automated steps, or null when nobody was recorded (command-line import). */
  actor: string | null;
  summary: string;
  ref: { type: "dataset" | "alert" | "incident" | "identity_import"; id: string };
}

const SEVERITY_BY_RANK = Object.fromEntries(SEVERITIES.map((s) => [severityRank(s), s])) as Record<number, Severity>;

const EVENT_STAGE: Record<string, TraceStage> = {
  created: "investigate",
  correlated: "investigate",
  alerts_linked: "investigate",
  status_changed: "investigate",
  priority_changed: "investigate",
  severity_changed: "investigate",
  assignee_changed: "investigate",
  title_changed: "investigate",
  note: "investigate",
  action_recorded: "respond",
  simulation_generated: "respond",
  report_generated: "report",
};

function eventSummary(kind: string, p: Record<string, unknown>): string {
  const from = p.from === null || p.from === undefined ? "none" : String(p.from);
  const to = p.to === null || p.to === undefined ? "none" : String(p.to);
  switch (kind) {
    case "created":
      return `Opened the incident (${String(p.origin ?? "manual").replace("_", " ")}).`;
    case "correlated":
      return `Grouped ${String(p.alerts ?? "")} alerts into this incident: ${String(p.basis ?? "")}.`;
    case "alerts_linked":
      return `Linked ${String(p.count ?? "")} alert(s): ${String(p.basis ?? "")}.`;
    case "note":
      return "Added a note.";
    case "action_recorded":
      return `Reported an action (not verified by Sentinel): ${String(p.description ?? "")}`;
    case "simulation_generated":
      return `Generated a ${String(p.format ?? "")} blocklist simulation for ${Array.isArray(p.ips) ? p.ips.join(", ") : ""}; not applied.`;
    case "report_generated":
      return "Generated the incident report.";
    default:
      return `Changed ${kind.replace("_changed", "")}: ${from} → ${to}.`;
  }
}

function triageSummary(meta: unknown, type: string): string {
  const changes = (meta as { changes?: Record<string, { from: unknown; to: unknown }> } | null)?.changes ?? {};
  const parts = Object.entries(changes).map(([k, v]) => `${k} ${String(v.from ?? "none")} → ${String(v.to ?? "none")}`);
  return `Triaged the ${type} alert${parts.length ? `: ${parts.join(", ")}` : ""}.`;
}

/**
 * The incident's chain of custody in wall-clock order: which files the evidence
 * came from and who imported them, which identity imports gave context, when
 * Sentinel raised each alert and with which rules or models, who triaged it,
 * and everything recorded on the incident since (axis 10).
 */
export async function buildIncidentTrace(orgId: Types.ObjectId, incidentId: Types.ObjectId, opts: { identity: boolean; entityIps: string[] }) {
  const alerts = await Alert.find({ orgId, incidentId }).select("type severityRank sources ruleIds modelVersions flowIds createdAt srcIp dstIp").lean();
  const flowIds = alerts.flatMap((a) => a.flowIds);
  const [datasetIds, triage, events, identityImportIds] = await Promise.all([
    flowIds.length ? Flow.distinct("datasetId", { orgId, _id: { $in: flowIds } }) : [],
    alerts.length ? AuditLog.find({ orgId, action: "alert.update", "target.type": "alert", "target.id": { $in: alerts.map((a) => String(a._id)) } }).sort({ ts: 1 }).limit(500).lean() : [],
    IncidentEvent.find({ orgId, incidentId }).sort({ ts: 1 }).limit(1000).lean(),
    opts.identity && opts.entityIps.length ? IdentityObservation.distinct("importId", { orgId, ip: { $in: opts.entityIps } }) : [],
  ]);
  const [datasets, identityImports] = await Promise.all([
    datasetIds.length ? Dataset.find({ orgId, _id: { $in: datasetIds } }).select("name fileSha256 sourceKind rowsInserted uploadedBy createdAt completedAt").lean() : [],
    identityImportIds.length ? IdentityImport.find({ orgId, _id: { $in: identityImportIds } }).select("name rowsInserted sources importedBy fileSha256 createdAt").lean() : [],
  ]);
  const names = await userNames([...datasets.map((d) => d.uploadedBy), ...triage.map((t) => t.actorId), ...events.map((e) => e.actorId), ...identityImports.map((i) => i.importedBy)]);
  const who = (id: Types.ObjectId | null | undefined, fallback: string | null) => (id ? (names.get(String(id)) ?? "Former member") : fallback);
  const typeOf = new Map(alerts.map((a) => [String(a._id), a.type]));

  const entries: TraceEntry[] = [
    ...datasets.map((d) => ({
      ts: (d as { createdAt?: Date }).createdAt ?? new Date(0),
      stage: "ingest" as const,
      actor: who(d.uploadedBy, null),
      summary: `Imported ${d.name}: ${d.rowsInserted} flows tagged ${d.sourceKind}, sha256 ${d.fileSha256 ? `${d.fileSha256.slice(0, 16)}…` : "not recorded"}${d.uploadedBy ? "" : " (command-line import, no user recorded)"}.`,
      ref: { type: "dataset" as const, id: String(d._id) },
    })),
    ...identityImports.map((i) => ({
      ts: (i as { createdAt?: Date }).createdAt ?? new Date(0),
      stage: "context" as const,
      actor: who(i.importedBy, null),
      summary: `Imported identity records ${i.name} (${i.rowsInserted} records: ${i.sources.join(", ")}), used to attribute this incident's addresses.`,
      ref: { type: "identity_import" as const, id: String(i._id) },
    })),
    ...alerts.map((a) => ({
      ts: (a as { createdAt?: Date }).createdAt ?? new Date(0),
      stage: "detect" as const,
      actor: "Sentinel",
      summary: `Raised a ${SEVERITY_BY_RANK[a.severityRank] ?? "info"} ${a.type} alert for ${a.srcIp ?? "several sources"} → ${a.dstIp ?? "several targets"} from ${[
        ...a.ruleIds.map((r) => `rule ${r}`),
        ...a.modelVersions.map((m) => `model ${m}`),
      ].join(", ") || "an unknown detector"}.`,
      ref: { type: "alert" as const, id: String(a._id) },
    })),
    ...triage.map((t) => ({
      ts: t.ts,
      stage: "triage" as const,
      actor: who(t.actorId, "Sentinel"),
      summary: triageSummary(t.meta, typeOf.get(String(t.target?.id)) ?? ""),
      ref: { type: "alert" as const, id: String(t.target?.id) },
    })),
    ...events.map((e) => ({
      ts: e.ts,
      stage: EVENT_STAGE[e.kind] ?? "investigate",
      actor: who(e.actorId, "Sentinel"),
      summary: eventSummary(e.kind, (e.payload ?? {}) as Record<string, unknown>),
      ref: { type: "incident" as const, id: String(incidentId) },
    })),
  ].sort((a, b) => a.ts.getTime() - b.ts.getTime());

  const notes = [
    "Times are when each step was recorded (wall clock). The attack timeline shows when the traffic happened.",
    "Each entry comes from a stored record: dataset imports, alerts, the audit log and the incident's append-only events.",
  ];
  if (!opts.identity) notes.push("Identity imports are hidden for your role.");
  return {
    entries,
    coverage: { datasets: datasets.length, alerts: alerts.length, triageChanges: triage.length, incidentEvents: events.length, identityImports: opts.identity ? identityImports.length : null },
    notes,
  };
}
