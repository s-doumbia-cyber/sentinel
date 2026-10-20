import { MITRE_BY_CLASS, addressScope, type AttackClass, type DeviceEstimate } from "@sentinel/shared";

export interface Statement {
  text: string;
  /** What the statement rests on (data, rule, model, heuristic). */
  basis?: string;
}

export interface AlertAnalysis {
  observed: Statement[];
  inferred: Statement[];
  unknown: Statement[];
}

export interface AnalysisInput {
  type: AttackClass;
  srcIp: string | null;
  dstIp: string | null;
  dstPort: number | null;
  count: number;
  firstSeen: Date;
  lastSeen: Date;
  maxConfidence: number;
  modelVersions: string[];
  rules: { key: string; name: string; version: number; window: string; gte: number; distinct?: string | undefined }[];
  ruleHits: { ruleKey: string; value: number; flowCount: number }[];
  severity: string;
  status: string;
  evidenceFlows: number;
  sourceKinds: string[];
  datasets: { name: string; sha256: string | null }[];
  /** Dataset labels of the evidence flows, for evaluation only. */
  groundTruth: Record<string, number>;
  targetEstimate: DeviceEstimate | null;
  /** null: the viewer may not read identity data; [] none matched. */
  attribution: { label: string; confidence: string; source: string }[] | null;
  connectedIdentitySources: number;
}

const iso = (d: Date) => d.toISOString().replace(".000Z", "Z");

/**
 * Splits what Sentinel knows about an alert into observations (in the data),
 * inferences (produced by models, rules or heuristics, and possibly wrong) and
 * unknowns (not answerable from the available data). Pure function: the same
 * input always gives the same wording.
 */
export function buildAlertAnalysis(a: AnalysisInput): AlertAnalysis {
  const observed: Statement[] = [];
  const inferred: Statement[] = [];
  const unknown: Statement[] = [];
  const endpoints = `${a.srcIp ?? "several sources"} → ${a.dstIp ?? "several targets"}${a.dstIp && a.dstPort !== null ? `:${a.dstPort}` : ""}`;

  observed.push({
    text: `Network flows ${endpoints} between ${iso(a.firstSeen)} and ${iso(a.lastSeen)} (${a.evidenceFlows} evidence flows kept on this alert).`,
    basis: a.datasets.length
      ? `Imported from ${a.datasets.map((d) => `${d.name}${d.sha256 ? ` (sha256 ${d.sha256.slice(0, 12)}…)` : ""}`).join(", ")}; source kind ${a.sourceKinds.join(", ") || "unknown"}`
      : `Source kind ${a.sourceKinds.join(", ") || "unknown"}`,
  });
  for (const hit of a.ruleHits) {
    const rule = a.rules.find((r) => r.key === hit.ruleKey);
    if (!rule) continue;
    observed.push({
      text: `Rule ${rule.name} (${rule.key} v${rule.version}) counted ${hit.value} ${rule.distinct ? `distinct ${rule.distinct} values` : "flows"} within ${rule.window} (threshold ${rule.gte}).`,
      basis: "Deterministic threshold over the stored flows",
    });
  }
  if (a.modelVersions.length) {
    observed.push({
      text: `Model ${a.modelVersions.join(", ")} output ${a.type} for flows on this alert; highest confidence ${(a.maxConfidence * 100).toFixed(0)}%.`,
      basis: "Model output recorded at scoring time",
    });
  }
  const labelled = Object.entries(a.groundTruth);
  if (labelled.length) {
    observed.push({
      text: `The source file labelled the evidence flows ${labelled.map(([k, v]) => `${k} ×${v}`).join(", ")}.`,
      basis: "Dataset labels: used for evaluation only, never for the verdict",
    });
  }

  inferred.push({
    text: `The activity resembles ${a.type}.`,
    basis: [a.modelVersions.length ? "model classification" : null, a.rules.length ? "rule match" : null].filter(Boolean).join(" and ") || "detection output",
  });
  if (a.modelVersions.length && a.maxConfidence < 0.6 && !a.rules.length) {
    inferred.push({ text: "The model is not confident: treat this as a lead to check, not a verdict.", basis: "Confidence below the review threshold" });
  }
  const mitre = MITRE_BY_CLASS[a.type];
  if (mitre) {
    inferred.push({
      text: `Suggested MITRE ATT&CK context: ${mitre.techniqueId ? `${mitre.techniqueId} ${mitre.techniqueName}` : mitre.tactics.map((t) => t.name).join(", ")}.`,
      basis: "Mapping from the detected class; context only, not proof of technique, actor or attribution",
    });
  }
  inferred.push({ text: `Severity ${a.severity}.`, basis: "Default severity of the class, raised to the most severe rule that fired" });
  if (a.targetEstimate) {
    inferred.push({ text: `The target looks like: ${a.targetEstimate.label}.`, basis: `${a.targetEstimate.basis} (port heuristic, low confidence)` });
  }

  unknown.push({ text: "Whether the attempt succeeded: flow records show connections and volumes, not outcomes or payloads." });
  if (a.srcIp) {
    if (a.attribution === null) {
      unknown.push({ text: `Who operated ${a.srcIp}: identity data is restricted for your role.` });
    } else if (!a.attribution.length) {
      unknown.push({
        text: `Who operated ${a.srcIp}: no identity record covers this time window${a.connectedIdentitySources ? "" : " (no identity source is connected)"}.`,
        basis: "Import VPN, DHCP, authentication or EDR records to answer this",
      });
    } else {
      for (const c of a.attribution) {
        inferred.push({ text: `${a.srcIp} was associated with ${c.label} during this window (${c.confidence} confidence).`, basis: `${c.source} record; an address can be shared, so this names an account or device, not a person` });
      }
    }
    if (addressScope(a.srcIp) === "external") {
      unknown.push({ text: `The real origin behind ${a.srcIp}: VPNs, proxies and compromised relays are common; geolocation or reputation would not prove it either.` });
    }
  }
  if (a.status === "needs_review") unknown.push({ text: "Whether this is a true positive: no rule fired and model confidence is low." });
  return { observed, inferred, unknown };
}
