import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { useState } from "react";
import { featureGlossaryEntry } from "@sentinel/shared";
import { NeutralBadge } from "@/components/ui/Badges";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Select } from "@/components/ui/Form";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { useAuth } from "@/features/auth/AuthContext";
import { api, errorMessage } from "@/lib/api";
import { formatDateTime, formatExact, formatPercent } from "@/lib/format";
import { useDrift, useModelFeedback, useOrgMutation } from "@/lib/queries";
import type { DriftLevel, DriftReport, DriftRunResult } from "@/lib/types";

const LEVEL: Record<DriftLevel, { label: string; cls: string; Icon: typeof CheckCircle2; meaning: string }> = {
  stable: { label: "Stable", cls: "bg-sev-ok/15 text-sevfg-ok", Icon: CheckCircle2, meaning: "recent inputs look like the training data" },
  moderate: { label: "Moderate change", cls: "bg-sev-medium/15 text-sevfg-medium", Icon: Info, meaning: "some inputs have shifted; keep an eye on it" },
  significant: { label: "Significant change", cls: "bg-sev-high/15 text-sevfg-high", Icon: AlertTriangle, meaning: "inputs differ clearly from the training data" },
};

export function DriftLevelBadge({ level }: { level: DriftLevel }) {
  const l = LEVEL[level];
  return (
    <NeutralBadge className={l.cls}>
      <l.Icon aria-hidden className="h-3.5 w-3.5" />
      {l.label}
    </NeutralBadge>
  );
}

function FeatureTable({ report }: { report: DriftReport }) {
  const top = report.features.slice(0, 8);
  return (
    <div role="region" aria-label="Features with the largest change" tabIndex={0} className="overflow-x-auto">
      <table className="w-full text-small">
        <caption className="sr-only">Features with the largest population stability index</caption>
        <thead className="text-left text-caption uppercase tracking-[0.04em] text-fg-3">
          <tr className="border-b border-subtle">
            <th scope="col" className="py-2 pr-4 font-medium">Feature</th>
            <th scope="col" className="py-2 pr-4 text-right font-medium">PSI</th>
            <th scope="col" className="py-2 pr-4 font-medium">Change</th>
            <th scope="col" className="py-2 text-right font-medium">Missing now / at training</th>
          </tr>
        </thead>
        <tbody>
          {top.map((f) => {
            const entry = featureGlossaryEntry(f.name);
            return (
              <tr key={f.name} className="border-b border-subtle last:border-0">
                <th scope="row" className="py-2 pr-4 text-left font-medium text-fg-1" title={entry?.meaning}>
                  {entry?.label ?? f.name}
                  {entry && <span className="block font-mono text-caption font-normal text-fg-3">{f.name}</span>}
                </th>
                <td className="tnum py-2 pr-4 text-right">{f.psi.toFixed(3)}</td>
                <td className="py-2 pr-4"><DriftLevelBadge level={f.level} /></td>
                <td className="tnum py-2 text-right text-fg-2">
                  {formatPercent(f.missingCurrent)} / {formatPercent(f.missingReference)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ClassMix({ report }: { report: DriftReport }) {
  const labels = [...new Set([...Object.keys(report.predictedClassShare), ...Object.keys(report.trainingClassShare)])].sort();
  return (
    <details className="rounded-md border border-subtle">
      <summary className="cursor-pointer px-4 py-2.5 text-small text-fg-2">Predicted class mix versus the training class mix</summary>
      <div className="px-4 pb-4">
        <table className="w-full text-small">
          <caption className="sr-only">Predicted and training class shares</caption>
          <thead className="text-left text-caption uppercase tracking-[0.04em] text-fg-3">
            <tr className="border-b border-subtle">
              <th scope="col" className="py-2 pr-4 font-medium">Class</th>
              <th scope="col" className="py-2 pr-4 text-right font-medium">Predicted recently</th>
              <th scope="col" className="py-2 text-right font-medium">Training rows</th>
            </tr>
          </thead>
          <tbody>
            {labels.map((l) => (
              <tr key={l} className="border-b border-subtle last:border-0">
                <th scope="row" className="py-2 pr-4 text-left font-medium text-fg-1">{l}</th>
                <td className="tnum py-2 pr-4 text-right">{l in report.predictedClassShare ? formatPercent(report.predictedClassShare[l] ?? 0) : "—"}</td>
                <td className="tnum py-2 text-right">{l in report.trainingClassShare ? formatPercent(report.trainingClassShare[l] ?? 0) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-caption text-fg-3">Informational only: training class counts are often capped or balanced, so a different mix is not by itself a sign of drift.</p>
      </div>
    </details>
  );
}

function DriftSection({ version, active }: { version: string; active: boolean }) {
  const { can } = useAuth();
  const toast = useToast();
  const drift = useDrift(version);
  const [hours, setHours] = useState("24");
  const [notice, setNotice] = useState<string | null>(null);
  const run = useOrgMutation((h: number) => api<DriftRunResult>(`/models/${encodeURIComponent(version)}/drift`, { method: "POST", body: { hours: h } }), ["drift"]);
  const start = () => {
    setNotice(null);
    run.mutate(Number(hours), {
      onSuccess: (r) => {
        if (r.status === "insufficient_data") setNotice(`Only ${formatExact(r.sampleSize)} flow(s) scored by this model in that window; at least ${formatExact(r.minimum)} are needed for a meaningful comparison. Nothing was recorded.`);
        else toast.success("Drift check finished");
      },
      onError: (e) => toast.error(errorMessage(e)),
    });
  };
  const report = drift.data?.latest ?? null;
  return (
    <section aria-labelledby="drift-heading" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 id="drift-heading" className="text-h3 font-semibold">Input drift</h3>
          <p className="mt-0.5 max-w-3xl text-small text-fg-3">
            Compares the features of flows this model scored recently with the training data (population stability index, per feature). It shows that inputs changed, not that detection got worse.
            Not run automatically: checks run when you start one.
          </p>
        </div>
        {can("scoring:run") && (
          <div className="flex items-center gap-2">
            <Select aria-label="Window of scored flows" value={hours} onChange={(e) => setHours(e.target.value)} className="w-36">
              <option value="24">Last 24 hours</option>
              <option value="168">Last 7 days</option>
              <option value="720">Last 30 days</option>
            </Select>
            <Button size="sm" loading={run.isPending} onClick={start}>Check drift now</Button>
          </div>
        )}
      </div>
      {!active && <p className="text-small text-fg-3">This version is not the active model, so it may have scored nothing recently.</p>}
      {notice && <p role="status" className="rounded-md border border-subtle bg-surface-2 px-3 py-2 text-small text-fg-2">{notice}</p>}
      {drift.isLoading ? (
        <Skeleton className="h-32" />
      ) : drift.isError ? (
        <ErrorState error={drift.error} onRetry={() => void drift.refetch()} />
      ) : !report ? (
        <EmptyState title="No drift check yet" description="Run one to compare recent flows with this model’s training data. Models trained before this feature existed have no reference and must be retrained." />
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3 text-small">
            <DriftLevelBadge level={report.level} />
            <span className="text-fg-2">{LEVEL[report.level].meaning}.</span>
            <span className="tnum text-fg-3">
              Largest PSI {report.maxPsi.toFixed(3)} · {formatExact(report.driftedFeatureCount)} feature(s) at 0.2 or more · {formatExact(report.sampleSize)} flows from the last {report.windowHours >= 48 ? `${Math.round(report.windowHours / 24)} days` : `${report.windowHours} hours`} ·
              checked {formatDateTime(report.createdAt)}
            </span>
          </div>
          <FeatureTable report={report} />
          <ClassMix report={report} />
        </div>
      )}
    </section>
  );
}

function FeedbackSection({ version }: { version: string }) {
  const fb = useModelFeedback(version);
  return (
    <section aria-labelledby="feedback-heading" className="space-y-3">
      <div>
        <h3 id="feedback-heading" className="text-h3 font-semibold">Analyst feedback</h3>
        <p className="mt-0.5 max-w-3xl text-small text-fg-3">
          What analysts decided about alerts this model contributed to. Analysts do not review every alert, so these counts describe reviewed alerts only and are not the model’s precision.
        </p>
      </div>
      {fb.isLoading ? (
        <Skeleton className="h-24" />
      ) : fb.isError ? (
        <ErrorState error={fb.error} onRetry={() => void fb.refetch()} />
      ) : !fb.data || fb.data.totals.alerts === 0 ? (
        <EmptyState title="No alerts from this model yet" description="Verdicts appear here once alerts raised with this model version are marked true positive, false positive or benign." />
      ) : (
        <>
          <p className="tnum text-small text-fg-2">
            {formatExact(fb.data.totals.alerts)} alert(s): {formatExact(fb.data.totals.reviewed)} reviewed ({formatExact(fb.data.totals.truePositive)} true positive, {formatExact(fb.data.totals.falsePositive)} false positive,{" "}
            {formatExact(fb.data.totals.benign)} benign), {formatExact(fb.data.totals.unreviewed)} not reviewed.
            {fb.data.confirmedShareOfReviewed !== null && <> Confirmed share of the reviewed ones: {formatPercent(fb.data.confirmedShareOfReviewed)}.</>}
            {fb.data.totals.withRuleEvidence > 0 && <> {formatExact(fb.data.totals.withRuleEvidence)} of these alerts also have rule evidence.</>}
          </p>
          <div role="region" aria-label="Analyst verdicts by alert type" tabIndex={0} className="overflow-x-auto">
            <table className="w-full text-small">
              <caption className="sr-only">Analyst verdicts per alert type</caption>
              <thead className="text-left text-caption uppercase tracking-[0.04em] text-fg-3">
                <tr className="border-b border-subtle">
                  <th scope="col" className="py-2 pr-4 font-medium">Alert type</th>
                  <th scope="col" className="py-2 pr-4 text-right font-medium">True positive</th>
                  <th scope="col" className="py-2 pr-4 text-right font-medium">False positive</th>
                  <th scope="col" className="py-2 pr-4 text-right font-medium">Benign</th>
                  <th scope="col" className="py-2 text-right font-medium">Not reviewed</th>
                </tr>
              </thead>
              <tbody>
                {fb.data.byType.map((r) => (
                  <tr key={r.type} className="border-b border-subtle last:border-0">
                    <th scope="row" className="py-2 pr-4 text-left font-medium text-fg-1">{r.type}</th>
                    <td className="tnum py-2 pr-4 text-right">{formatExact(r.truePositive)}</td>
                    <td className="tnum py-2 pr-4 text-right">{formatExact(r.falsePositive)}</td>
                    <td className="tnum py-2 pr-4 text-right">{formatExact(r.benign)}</td>
                    <td className="tnum py-2 text-right text-fg-2">{formatExact(r.unreviewed)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

/** Drift against the training data, and what analysts decided about this model's alerts. */
export function MonitoringPanel({ version, active }: { version: string; active: boolean }) {
  return (
    <Card>
      <CardHeader title="Monitoring" subtitle="Is the model still seeing the kind of traffic it was trained on, and do analysts agree with it?" />
      <CardBody className="space-y-8">
        <DriftSection version={version} active={active} />
        <FeedbackSection version={version} />
      </CardBody>
    </Card>
  );
}
