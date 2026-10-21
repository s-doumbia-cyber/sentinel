import type { ReactNode } from "react";
import { SEVERITIES, type Severity } from "@sentinel/shared";
import { SeverityBadge, SourceKindBadge } from "@/components/ui/Badges";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { formatDateTime, formatExact, formatPercent, formatScore } from "@/lib/format";
import type { ExecutiveReport } from "@/lib/types";
import { describeRange } from "./range";

const sorted = (r: Record<string, number>) => Object.entries(r).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

function DataTable({ caption, headers, rows, empty }: { caption: string; headers: string[]; rows: ReactNode[][]; empty: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-small">
        <caption className="sr-only">{caption}</caption>
        <thead className="text-left text-caption uppercase tracking-[0.04em] text-fg-3">
          <tr className="border-b border-subtle">
            {headers.map((h) => (
              <th key={h} scope="col" className="px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={headers.length} className="px-3 py-3 text-fg-3">
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((cells, i) => (
              <tr key={i} className="border-b border-subtle last:border-0">
                {cells.map((c, j) => (
                  <td key={j} className="tnum px-3 py-row text-fg-1">
                    {c}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-1.5 text-small sm:grid-cols-[minmax(0,14rem)_1fr]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-fg-3">{k}</dt>
          <dd className="tnum text-fg-1">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** HTML twin of the PDF: same sections, same numbers, so what you read is what you download. */
export function ExecutivePreview({ report: r }: { report: ExecutiveReport }) {
  const range = { from: r.meta.range.from?.slice(0, 10) ?? null, to: r.meta.range.to?.slice(0, 10) ?? null };
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Summary" subtitle={`${r.meta.organisation} · ${describeRange(range)} · generated ${formatDateTime(r.meta.generatedAt)}`} />
        <CardBody className="space-y-3">
          <ul className="list-disc space-y-1.5 pl-5 text-small text-fg-1">
            {r.headline.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
          <p className="flex flex-wrap items-center gap-2 text-caption text-fg-3">
            Data sources:{" "}
            {Object.keys(r.flows.bySourceKind).length ? Object.entries(r.flows.bySourceKind).map(([k, n]) => (
              <span key={k} className="inline-flex items-center gap-1">
                <SourceKindBadge kind={k as ExecutiveReport["provenance"]["datasets"][number]["sourceKind"]} /> <span className="tnum">{formatExact(n)}</span>
              </span>
            )) : "none"}
          </p>
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <CardHeader title="Alerts" subtitle={`${formatExact(r.alerts.total)} overlapping the period`} />
          <CardBody className="space-y-4">
            <DataTable
              caption="Alerts by severity"
              headers={["Severity", "Alerts", "Active"]}
              empty="No alerts."
              rows={SEVERITIES.map((s: Severity) => [<SeverityBadge key={s} severity={s} />, formatExact(r.alerts.bySeverity[s] ?? 0), formatExact(r.alerts.activeBySeverity[s] ?? 0)])}
            />
            <DataTable caption="Alerts by attack type" headers={["Attack type", "Alerts"]} empty="No alerts." rows={sorted(r.alerts.byType).map(([k, n]) => [k, formatExact(n)])} />
            <p className="text-caption text-fg-3">By status: {sorted(r.alerts.byStatus).map(([k, n]) => `${k.replace("_", " ")} ${formatExact(n)}`).join(", ") || "none"}.</p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Incidents" subtitle={`${formatExact(r.incidents.total)} overlapping the period · ${formatExact(r.incidents.openNow)} open now`} />
          <CardBody className="space-y-4">
            <DataTable caption="Incidents by status" headers={["Status", "Incidents"]} empty="No incidents." rows={sorted(r.incidents.byStatus).map(([k, n]) => [k, formatExact(n)])} />
            <DataTable
              caption="Incidents by severity"
              headers={["Severity", "Incidents"]}
              empty="No incidents."
              rows={sorted(r.incidents.bySeverity).map(([k, n]) => [<SeverityBadge key={k} severity={k as Severity} />, formatExact(n)])}
            />
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="Time to triage" subtitle="From Sentinel raising an alert to an analyst’s first change to it" />
        <CardBody className="space-y-3">
          <Facts
            rows={[
              ["Alerts considered", formatExact(r.triage.alertsConsidered)],
              ["Touched by an analyst", formatExact(r.triage.triaged)],
              ["Not touched", formatExact(r.triage.untriaged)],
              ["Mean to first triage", r.triage.meanMinutes === null ? "n/a" : `${r.triage.meanMinutes.toFixed(1)} min`],
              ["Median to first triage", r.triage.medianMinutes === null ? "n/a" : `${r.triage.medianMinutes.toFixed(1)} min`],
            ]}
          />
          <p className="text-caption text-fg-3">{r.triage.basis}</p>
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <CardHeader title="Traffic and verdicts" subtitle="Model verdicts on stored flows" />
          <CardBody className="space-y-4">
            <Facts
              rows={[
                ["Flows", formatExact(r.flows.totalFlows)],
                ["Scored by a model", formatExact(r.flows.scoredFlows)],
                ["Not scored", formatExact(r.flows.pendingFlows)],
                ["Malicious verdicts", formatExact(r.flows.maliciousFlows)],
                ["Malicious source addresses", formatExact(r.flows.maliciousSourceIps)],
                ["Needs review (low confidence)", formatExact(r.flows.needsReviewFlows)],
              ]}
            />
            <DataTable caption="Model verdict mix" headers={["Verdict", "Flows"]} empty="No scored flows." rows={r.verdicts.map((v) => [v.key ?? "unknown", formatExact(v.count)])} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Top sources and ports" subtitle="By malicious verdicts" />
          <CardBody className="space-y-4">
            <DataTable
              caption="Top malicious sources"
              headers={["Source", "Verdicts", "Classes"]}
              empty="No malicious verdicts."
              rows={r.topSources.map((s) => [<span key={s.key} className="font-mono">{s.key}</span>, formatExact(s.count), s.classes.join(", ")])}
            />
            <DataTable caption="Top targeted ports" headers={["Port", "Verdicts"]} empty="No malicious verdicts." rows={r.topPorts.map((p) => [<span key={p.key} className="font-mono">{p.key}</span>, formatExact(p.count)])} />
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="Detection quality on labelled data" subtitle="Only flows that carry a ground-truth label can be scored against the truth" />
        <CardBody className="space-y-3">
          {r.evaluation ? (
            <>
              <p className="text-small text-fg-1">
                Macro-F1 <span className="tnum font-medium">{formatScore(r.evaluation.macroF1)}</span> over {formatExact(r.evaluation.evaluatedFlows)} labelled flow(s) scored by{" "}
                <span className="font-mono">{r.evaluation.modelVersions.join(", ") || "unknown model"}</span>.
              </p>
              <DataTable
                caption="Per-class precision, recall, F1 and support"
                headers={["Class", "Precision", "Recall", "F1", "Support"]}
                empty="No classes."
                rows={r.evaluation.perClass.filter((c) => c.support > 0 || c.predicted > 0).map((c) => [c.label + (c.unstable ? " *" : ""), formatPercent(c.precision), formatPercent(c.recall), formatPercent(c.f1), formatExact(c.support)])}
              />
              <p className="text-caption text-fg-3">* fewer than 30 labelled examples: an unstable estimate. Benchmark figures on labelled imports do not describe performance on your live traffic.</p>
            </>
          ) : (
            <p className="text-small text-fg-2">No flow in this period carries a ground-truth label, so no detection-quality figure is shown. Unlabelled traffic cannot be scored against the truth.</p>
          )}
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <CardHeader title="Provenance" subtitle="Where the numbers come from" />
          <CardBody className="space-y-3">
            <DataTable
              caption="Datasets behind the flows"
              headers={["Dataset", "Kind", "Flows"]}
              empty="No dataset in this period."
              rows={[
                ...r.provenance.datasets.map((d) => [<span key={d.name} title={`sha256 ${d.sha256 ?? "not recorded"}`}>{d.name}</span>, <SourceKindBadge key="k" kind={d.sourceKind} />, formatExact(d.flows)]),
                ...(r.provenance.flowsWithoutDataset ? [["No dataset (live or replay source)", "", formatExact(r.provenance.flowsWithoutDataset)]] : []),
              ]}
            />
            <p className="text-small text-fg-2">Model versions behind the alerts: {r.provenance.models.join(", ") || "none"}.</p>
            <p className="text-small text-fg-2">Rules behind the alerts: {r.provenance.rules.map((x) => `${x.key}${x.version ? ` v${x.version}` : ""}`).join(", ") || "none"}.</p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Limitations" subtitle="Read these before quoting a number" />
          <CardBody>
            <ul className="list-disc space-y-1.5 pl-5 text-small text-fg-2">
              {r.limitations.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
