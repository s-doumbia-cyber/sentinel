import { SEVERITIES } from "@sentinel/shared";
import type { buildIncidentReport } from "../incidents/report.service.js";
import type { ExecutiveReport } from "./executive.service.js";
import type { PdfBlock, PdfDocumentSpec } from "./pdf.js";

type IncidentReport = Awaited<ReturnType<typeof buildIncidentReport>>;

const n = (v: number | null | undefined) => (v === null || v === undefined ? "n/a" : v.toLocaleString("en-US"));
const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString().replace(/\.\d{3}Z$/, "Z") : "-");
const pct = (v: number | null | undefined) => (v === null || v === undefined ? "n/a" : `${(v * 100).toFixed(1)}%`);
const score = (v: number | null | undefined) => (v === null || v === undefined ? "n/a" : v.toFixed(3));
const entries = (r: Record<string, number>) => Object.entries(r).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

export function periodLabel(range: { from: string | null; to: string | null }): string {
  if (!range.from && !range.to) return "All stored data";
  return `${range.from ? iso(range.from) : "the start"} to ${range.to ? iso(range.to) : "now"} (UTC)`;
}

/** The executive report as PDF blocks. Pure: the same report always gives the same blocks. */
export function executiveDocument(r: ExecutiveReport): PdfDocumentSpec {
  const sources = Object.entries(r.flows.bySourceKind).map(([k, c]) => `${k} ${n(c)}`).join(", ") || "none";
  const blocks: PdfBlock[] = [
    {
      kind: "facts",
      rows: [
        ["Organisation", r.meta.organisation || "-"],
        ["Period", periodLabel(r.meta.range)],
        ["Generated", `${iso(r.meta.generatedAt)} (UTC)`],
        ["Data sources", sources],
      ],
    },
    { kind: "heading", level: 2, text: "Summary" },
    { kind: "list", items: r.headline },

    { kind: "heading", level: 2, text: "Alerts" },
    {
      kind: "table",
      headers: ["Severity", "Alerts", "Of which active"],
      widths: [2, 1, 1],
      rows: SEVERITIES.map((s) => [s.toUpperCase(), n(r.alerts.bySeverity[s] ?? 0), n(r.alerts.activeBySeverity[s] ?? 0)]),
    },
    { kind: "table", headers: ["Attack type", "Alerts"], widths: [3, 1], rows: entries(r.alerts.byType).map(([k, c]) => [k, n(c)]) },
    { kind: "paragraph", muted: true, text: `By status: ${entries(r.alerts.byStatus).map(([k, c]) => `${k.replace("_", " ")} ${n(c)}`).join(", ") || "none"}. Total ${n(r.alerts.total)}.` },

    { kind: "heading", level: 2, text: "Incidents" },
    {
      kind: "table",
      headers: ["Status", "Incidents", "Severity", "Incidents"],
      widths: [2, 1, 2, 1],
      rows: Array.from({ length: Math.max(entries(r.incidents.byStatus).length, entries(r.incidents.bySeverity).length, 1) }, (_, i) => {
        const st = entries(r.incidents.byStatus)[i];
        const sv = entries(r.incidents.bySeverity)[i];
        return [st?.[0] ?? "", st ? n(st[1]) : "", sv?.[0]?.toUpperCase() ?? "", sv ? n(sv[1]) : ""];
      }),
    },
    { kind: "paragraph", muted: true, text: `${n(r.incidents.total)} incident(s) overlapped the period; ${n(r.incidents.openNow)} open now (any period).` },

    { kind: "heading", level: 2, text: "Time to triage" },
    {
      kind: "facts",
      rows: [
        ["Alerts considered", n(r.triage.alertsConsidered)],
        ["Touched by an analyst", n(r.triage.triaged)],
        ["Not touched", n(r.triage.untriaged)],
        ["Mean to first triage", r.triage.meanMinutes === null ? "n/a" : `${r.triage.meanMinutes.toFixed(1)} min`],
        ["Median to first triage", r.triage.medianMinutes === null ? "n/a" : `${r.triage.medianMinutes.toFixed(1)} min`],
      ],
    },
    { kind: "paragraph", muted: true, text: r.triage.basis },

    { kind: "heading", level: 2, text: "Traffic and verdicts" },
    {
      kind: "facts",
      rows: [
        ["Flows", n(r.flows.totalFlows)],
        ["Scored by a model", n(r.flows.scoredFlows)],
        ["Not scored", n(r.flows.pendingFlows)],
        ["Malicious verdicts", n(r.flows.maliciousFlows)],
        ["Malicious source addresses", n(r.flows.maliciousSourceIps)],
        ["Needs review (low confidence)", n(r.flows.needsReviewFlows)],
      ],
    },
    { kind: "table", headers: ["Model verdict", "Flows"], widths: [3, 1], rows: r.verdicts.map((v) => [v.key ?? "unknown", n(v.count)]) },
    {
      kind: "table",
      headers: ["Top malicious sources", "Malicious verdicts", "Classes", "Last seen"],
      widths: [2, 1.3, 3, 2],
      rows: r.topSources.map((s) => [s.key, n(s.count), s.classes.join(", "), iso(s.lastSeen)]),
    },
    { kind: "table", headers: ["Top targeted ports", "Malicious verdicts"], widths: [2, 2], rows: r.topPorts.map((p) => [p.key, n(p.count)]) },

    { kind: "heading", level: 2, text: "Detection quality on labelled data" },
    ...(r.evaluation
      ? ([
          {
            kind: "paragraph",
            text: `Macro-F1 ${score(r.evaluation.macroF1)} over ${n(r.evaluation.evaluatedFlows)} labelled flow(s) scored by ${r.evaluation.modelVersions.join(", ") || "unknown model"}. Per-class figures below; accuracy alone would hide weak classes.`,
          },
          {
            kind: "table",
            headers: ["Class", "Precision", "Recall", "F1", "Support"],
            widths: [3, 1.2, 1.2, 1.2, 1.2],
            rows: r.evaluation.perClass.filter((c) => c.support > 0 || c.predicted > 0).map((c) => [c.label + (c.unstable ? " *" : ""), pct(c.precision), pct(c.recall), pct(c.f1), n(c.support)]),
          },
          { kind: "note", text: "* fewer than 30 labelled examples: an unstable estimate. These are benchmark figures on labelled imports and do not describe performance on your live traffic." },
        ] satisfies PdfBlock[])
      : ([{ kind: "paragraph", text: "No flow in this period carries a ground-truth label, so no detection-quality figure is shown. Unlabelled traffic cannot be scored against the truth." }] satisfies PdfBlock[])),

    { kind: "heading", level: 2, text: "Provenance" },
    {
      kind: "table",
      headers: ["Dataset", "Kind", "Flows in period", "SHA-256"],
      widths: [3, 1.2, 1.4, 4],
      rows: [...r.provenance.datasets.map((d) => [d.name, d.sourceKind, n(d.flows), d.sha256 ?? "not recorded"]), ...(r.provenance.flowsWithoutDataset ? [["(no dataset: live or replay source)", "", n(r.provenance.flowsWithoutDataset), ""]] : [])],
    },
    {
      kind: "list",
      items: [`Model versions behind the alerts: ${r.provenance.models.join(", ") || "none"}`, `Rules behind the alerts: ${r.provenance.rules.map((x) => `${x.key}${x.version ? ` v${x.version}` : ""}`).join(", ") || "none"}`],
    },

    { kind: "heading", level: 2, text: "Limitations" },
    { kind: "list", items: r.limitations },
  ];
  return {
    title: "Executive report",
    subtitle: `${r.meta.organisation || "Organisation"} - ${periodLabel(r.meta.range)}`,
    footer: `Sentinel executive report v${r.meta.reportVersion} - generated ${iso(r.meta.generatedAt)} UTC - all times UTC`,
    blocks,
  };
}

/** The incident report as PDF blocks, mirroring the printable web report section by section. */
export function incidentDocument(r: IncidentReport): PdfDocumentSpec {
  const i = r.incident;
  const blocks: PdfBlock[] = [
    {
      kind: "facts",
      rows: [
        ["Status", `${i.status}, priority ${i.priority}, severity ${i.severity}`],
        ["Alerts", `${i.alertCount}`],
        ["Activity (event time, UTC)", `${iso(i.firstSeen)} to ${iso(i.lastSeen)}`],
        ["Organisation", r.meta.organisation || "-"],
        ...(i.correlation ? ([["Grouping basis", `${i.correlation.basis} (a heuristic, not proof of a single actor)`]] as [string, string][]) : []),
      ],
    },
    { kind: "heading", level: 2, text: "Observed activity (event time, UTC)" },
    {
      kind: "list",
      items: r.attack.steps.map((s) => `${iso(s.at)}${s.stage ? ` [${s.stage}]` : ""} ${s.fact}${s.mitre ? ` MITRE ATT&CK (suggested): ${s.mitre}.` : ""}${s.analystVerdict ? ` Analyst verdict: ${s.analystVerdict.replace("_", " ")}.` : ""}`),
    },
    { kind: "heading", level: 2, text: "Hypotheses" },
    ...(r.attack.hypotheses.length
      ? r.attack.hypotheses.flatMap((h): PdfBlock[] => [
          { kind: "paragraph", text: h.statement },
          { kind: "paragraph", muted: true, text: `Basis: ${h.basis.map((b) => b.replace(/\.$/, "")).join(". ") || "-"}.${h.limits.length ? ` Limits: ${h.limits.join(" ")}` : ""}` },
        ])
      : ([{ kind: "paragraph", text: "No hypothesis: a single alert does not support one." }] satisfies PdfBlock[])),
    { kind: "heading", level: 2, text: "Entities" },
    {
      kind: "table",
      headers: ["Address", "Role", "Scope", "Device (estimate)", "Identity"],
      widths: [2, 1, 1, 3, 4],
      rows: r.entities.map((e) => [
        e.ip,
        e.role ?? "",
        e.scope,
        e.deviceEstimate ? `${e.deviceEstimate.label} (low confidence)` : "unknown",
        e.identity === "restricted"
          ? "restricted for the role that generated this report"
          : e.identity.candidates.length
            ? e.identity.candidates.map((c) => `${c.username ?? c.hostname ?? c.mac} (${c.sourceLabel}, ${c.confidence})`).join("; ") + (e.identity.ambiguous ? " - ambiguous" : "")
            : "unknown (no identity record covers this window)",
      ]),
    },
    { kind: "heading", level: 2, text: "Response" },
    { kind: "note", text: r.response.enforcement },
    ...r.response.recommendations.flatMap((rec): PdfBlock[] => [
      { kind: "heading", level: 3, text: `${rec.type}: recommended checks` },
      { kind: "list", items: rec.confirm },
      { kind: "heading", level: 3, text: "Containment ideas (for a human to decide)" },
      { kind: "list", items: rec.contain },
    ]),
    { kind: "heading", level: 3, text: "Actions recorded by analysts (not verified by Sentinel)" },
    r.response.recordedActions.length
      ? { kind: "list", items: r.response.recordedActions.map((a) => `${iso(a.ts)} - ${a.actor}: ${String((a.payload as { description?: string }).description ?? "")}`) }
      : { kind: "paragraph", text: "None." },
    ...(r.response.simulations.length ? ([{ kind: "paragraph", muted: true, text: `${r.response.simulations.length} blocklist simulation(s) generated; none applied by Sentinel.` }] satisfies PdfBlock[]) : []),
    { kind: "heading", level: 2, text: "Investigation log" },
    { kind: "list", items: r.investigationLog.map((e) => `${iso(e.ts)} - ${e.actor} - ${e.kind.replace(/_/g, " ")}`) },
    { kind: "heading", level: 2, text: "Chain of custody (recorded time, UTC)" },
    { kind: "list", items: r.trace.map((e) => `${iso(e.ts)} - ${e.stage} - ${e.actor ?? "no user recorded"}: ${e.summary}`) },
    { kind: "heading", level: 2, text: "Provenance" },
    {
      kind: "list",
      items: [
        ...r.provenance.datasets.map((d) => `Data: ${d.name} (${d.sourceKind}), sha256 ${d.sha256 ?? "not recorded"}, imported ${iso(d.importedAt)}`),
        `Model versions: ${r.provenance.models.join(", ") || "none"}`,
        `Rules: ${r.provenance.rules.join(", ") || "none"}`,
        `Knowledge base version ${r.meta.knowledgeBaseVersion}`,
      ],
    },
    { kind: "heading", level: 2, text: "Limitations" },
    { kind: "list", items: r.limitations },
  ];
  return {
    title: i.title,
    subtitle: `Incident report - ${r.meta.organisation || "Organisation"}`,
    footer: `Sentinel incident report v${r.meta.reportVersion} - generated ${iso(r.meta.generatedAt)} UTC - all times ${r.meta.timezone}`,
    blocks,
  };
}
