import type { Types } from "mongoose";
import {
  IDENTITY_SOURCE_LABEL,
  KNOWLEDGE_BASE,
  KNOWLEDGE_BASE_VERSION,
  SEVERITIES,
  addressScope,
  can,
  estimateDeviceType,
  severityRank,
  type AttackClass,
  type Role,
  type Severity,
} from "@sentinel/shared";
import { Asset } from "../../models/context.js";
import { Org } from "../../models/identity.js";
import { Alert, Dataset, Flow, IncidentEvent } from "../../models/tenant.js";
import { attributeAddress } from "../identity/identity.service.js";
import { respondWith, userNames, type LeanIncident } from "./incident.dto.js";
import { buildAttackTimeline, type TimelineAlert } from "./timeline.js";
import { buildIncidentTrace } from "./trace.js";

const SEVERITY_BY_RANK = Object.fromEntries(SEVERITIES.map((s) => [severityRank(s), s])) as Record<number, Severity>;

export async function incidentAlerts(orgId: Types.ObjectId, incidentId: Types.ObjectId): Promise<TimelineAlert[]> {
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

export async function investigationLog(orgId: Types.ObjectId, incidentId: Types.ObjectId) {
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

/**
 * The incident report as data: the web page prints it and the server renders it to PDF, so both say the same
 * thing. Building it records nothing; the route records the `report_generated` event.
 */
export async function buildIncidentReport(orgId: Types.ObjectId, role: Role, incident: LeanIncident, generatedAt: Date) {
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
              : ("restricted" as const),
          };
        }),
      );
      const types = [...new Set(alerts.map((a) => a.type))];
      const trace = await buildIncidentTrace(orgId, incident._id, {
        identity: identityAllowed,
        entityIps: (incident.entities ?? []).map((e) => e.value ?? "").filter(Boolean),
      });
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
        // Chain of custody up to this report (the report_generated event itself is recorded just after).
        trace: trace.entries,
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
      return report;
}
