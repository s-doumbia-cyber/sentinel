import { AlertTriangle, CheckCircle2, Play, Power } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { NeutralBadge } from "@/components/ui/Badges";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/Card";
import { DefinitionList } from "@/components/ui/Data";
import { EmptyState, ErrorState, Skeleton, SkeletonRows } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { useAuth } from "@/features/auth/AuthContext";
import { ApiError, api, errorMessage } from "@/lib/api";
import { cn, formatDateTime, formatExact, formatScore } from "@/lib/format";
import { useEvaluation, useModel, useModels, useOrgMutation, useScoringStatus } from "@/lib/queries";
import type { ClassMetric, Evaluation, ModelDetail } from "@/lib/types";
import { MonitoringPanel } from "./MonitoringPanel";

/** Per-class table: always with support, small supports flagged (docs/ML_AND_DETECTION.md §12). */
export function PerClassTable({ rows, caption }: { rows: ClassMetric[]; caption: string }) {
  return (
    <div role="region" aria-label={caption} tabIndex={0} className="overflow-x-auto">
      <table className="w-full text-small">
        <caption className="sr-only">{caption}</caption>
        <thead className="text-left text-caption uppercase tracking-[0.04em] text-fg-3">
          <tr className="border-b border-subtle">
            <th scope="col" className="py-2 pr-4 font-medium">Class</th>
            <th scope="col" className="py-2 pr-4 text-right font-medium">Precision</th>
            <th scope="col" className="py-2 pr-4 text-right font-medium">Recall</th>
            <th scope="col" className="py-2 pr-4 text-right font-medium">F1</th>
            <th scope="col" className="py-2 pr-4 text-right font-medium">Support</th>
            <th scope="col" className="py-2 font-medium">Note</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.label} className="border-b border-subtle last:border-0">
              <th scope="row" className="py-2 pr-4 text-left font-medium text-fg-1">{c.label}</th>
              <td className="tnum py-2 pr-4 text-right">{formatScore(c.precision)}</td>
              <td className="tnum py-2 pr-4 text-right">{formatScore(c.recall)}</td>
              <td className="tnum py-2 pr-4 text-right">{formatScore(c.f1)}</td>
              <td className="tnum py-2 pr-4 text-right">{formatExact(c.support)}</td>
              <td className="py-2 text-caption text-fg-3">{c.support === 0 ? "not in test data" : c.unstable ? "unstable estimate (< 30)" : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ConfusionMatrix({ ev }: { ev: Evaluation }) {
  const max = Math.max(1, ...ev.confusionMatrix.flat());
  return (
    <div role="region" aria-label="Confusion matrix" tabIndex={0} className="overflow-x-auto">
      <table className="text-small">
        <caption className="mb-2 text-left text-caption text-fg-3">Rows: dataset label · columns: model verdict</caption>
        <thead>
          <tr>
            <th scope="col" className="sr-only">Dataset label</th>
            {ev.labels.map((l) => (
              <th key={l} scope="col" className="px-2 py-1 text-caption font-medium text-fg-3">{l}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ev.labels.map((row, i) => (
            <tr key={row}>
              <th scope="row" className="pr-3 text-right text-caption font-medium text-fg-3">{row}</th>
              {ev.labels.map((col, j) => {
                const v = ev.confusionMatrix[i]?.[j] ?? 0;
                return (
                  <td key={col} className={cn("tnum min-w-[64px] border border-subtle px-2 py-1.5 text-center", i === j ? "text-fg-1" : "text-fg-2")} style={{ backgroundColor: v ? `rgb(var(${i === j ? "--accent" : "--sev-high"}) / ${0.08 + 0.5 * (v / max)})` : undefined }}>
                    {formatExact(v)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ScoringPanel() {
  const { can } = useAuth();
  const toast = useToast();
  const status = useScoringStatus();
  const run = useOrgMutation(() => api("/scoring/run", { method: "POST" }), ["scoring"]);
  const deactivate = useOrgMutation((schema: string) => api(`/models/active/${schema}`, { method: "DELETE" }), ["models", "scoring", "model"]);
  if (status.isLoading) return <Skeleton className="h-24" />;
  if (status.isError) return <ErrorState error={status.error} onRetry={() => void status.refetch()} />;
  const s = status.data;
  if (!s) return null;
  return (
    <Card className="mb-6">
      <CardHeader
        title="Scoring"
        subtitle={s.mlConfigured ? "Flows are scored only by the active model of their own feature schema." : "ML_SERVICE_URL is not configured on the API: flows cannot be scored."}
        actions={
          can("scoring:run") && (
            <Button size="sm" loading={run.isPending || s.running} disabled={!s.mlConfigured} onClick={() => run.mutate(undefined, { onSuccess: () => toast.success("Scoring started"), onError: (e) => toast.error(errorMessage(e)) })}>
              <Play aria-hidden className="h-4 w-4" /> Score pending flows
            </Button>
          )
        }
      />
      <CardBody className="grid gap-4 md:grid-cols-2">
        {s.schemas.map((x) => (
          <div key={x.schema} className="rounded-md border border-subtle p-4 text-small">
            <p className="font-mono text-fg-1">{x.schema}</p>
            <p className="mt-1 text-fg-2">
              Active model: {x.activeModel ? <span className="font-mono text-fg-1">{x.activeModel}</span> : <span className="text-fg-3">none</span>}
            </p>
            <p className="tnum mt-1 text-fg-3">
              {formatExact(x.pending)} pending · {formatExact(x.scored)} scored · {formatExact(x.error)} errors
            </p>
            {x.activeModel && can("models:manage") && (
              <Button size="sm" variant="ghost" className="mt-2 -ml-2" loading={deactivate.isPending} onClick={() => deactivate.mutate(x.schema, { onSuccess: () => toast.success("Model deactivated; new flows will stay unscored") })}>
                <Power aria-hidden className="h-4 w-4" /> Deactivate
              </Button>
            )}
            {x.schema === "sentinel-native-v1" && <p className="mt-2 text-caption text-fg-3">Live collector schema, defined in roadmap Phase 2. No model yet.</p>}
          </div>
        ))}
      </CardBody>
    </Card>
  );
}

function OrgEvaluation({ model }: { model: ModelDetail }) {
  const ev = useEvaluation();
  return (
    <Card>
      <CardHeader title="Verdicts vs dataset labels in this organisation" subtitle="Computed live from scored, labelled flows (all model versions that scored them)." />
      <CardBody className="space-y-4">
        {ev.isLoading ? (
          <Skeleton className="h-40" />
        ) : ev.isError ? (
          <ErrorState error={ev.error} />
        ) : !ev.data || ev.data.evaluatedFlows === 0 ? (
          <EmptyState title="Nothing to evaluate yet" description="Evaluation needs flows that are both scored and labelled by their source file." />
        ) : (
          <>
            {model.trainingOverlap.length > 0 && (
              <p role="note" className="flex gap-2 rounded-md border border-sev-high/40 bg-sev-high/10 px-3 py-2 text-small text-sevfg-high">
                <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
                Not an independent evaluation: {model.trainingOverlap.map((d) => d.name).join(", ")} was also used to train {model.version}.
              </p>
            )}
            <p className="text-body">
              Macro-F1 <span className="tnum font-semibold">{formatScore(ev.data.macroF1)}</span> on <span className="tnum">{formatExact(ev.data.evaluatedFlows)}</span> flows · model versions: <span className="font-mono text-small">{ev.data.modelVersions.join(", ")}</span>
            </p>
            <PerClassTable rows={ev.data.perClass} caption="Per-class results on this organisation's labelled flows" />
            <ConfusionMatrix ev={ev.data} />
          </>
        )}
      </CardBody>
    </Card>
  );
}

function ModelView({ version }: { version: string }) {
  const { can } = useAuth();
  const toast = useToast();
  const model = useModel(version);
  const activate = useOrgMutation(() => api(`/models/${encodeURIComponent(version)}/activate`, { method: "POST" }), [
    "models",
    "model",
    "scoring",
    "evaluation",
    "overview",
    "flows",
    "breakdown",
    "top",
    "timeseries",
  ]);
  if (model.isLoading) return <Skeleton className="h-96" />;
  if (model.isError) return <ErrorState error={model.error} onRetry={() => void model.refetch()} />;
  const m = model.data;
  if (!m) return null;
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title={m.name}
          subtitle={<span className="font-mono">{m.version}</span>}
          actions={
            m.active ? (
              <NeutralBadge className="bg-sev-ok/15 text-sevfg-ok">
                <CheckCircle2 aria-hidden className="h-3.5 w-3.5" /> Active for {m.schema}
              </NeutralBadge>
            ) : (
              can("models:manage") && (
                <Button
                  variant="primary"
                  size="sm"
                  disabled={m.loadBlocked}
                  loading={activate.isPending}
                  onClick={() =>
                    activate.mutate(undefined, {
                      onSuccess: () => toast.success("Model activated. New and pending flows of this schema will be scored with it."),
                      onError: (e) => toast.error(errorMessage(e)),
                    })
                  }
                >
                  Activate
                </Button>
              )
            )
          }
        />
        <CardBody className="space-y-5">
          {m.kind === "benchmark" && (
            <p className="rounded-md border border-subtle bg-surface-2 px-3 py-2 text-small text-fg-2">
              <span className="font-medium text-fg-1">Benchmark model.</span> Trained on a 2017 testbed dataset: its scores are not production performance on your network.
            </p>
          )}
          {(m.versionWarnings.length > 0 || m.loadBlocked) && (
            <p role="alert" className="rounded-md border border-sev-high/40 bg-sev-high/10 px-3 py-2 text-small text-sevfg-high">
              Library version mismatch: {m.versionWarnings.join("; ")}. {m.loadBlocked ? "The ML service refuses to load this model; retrain it." : "Predictions may differ from the evaluation."}
            </p>
          )}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {[
              ["Macro-F1 (test)", formatScore(m.metrics.macroF1)],
              ["Weighted-F1", formatScore(m.metrics.weightedF1)],
              ["MCC", formatScore(m.metrics.mcc)],
              ["Test rows", formatExact(m.metrics.testRows)],
            ].map(([k, v]) => (
              <div key={k} className="rounded-md border border-subtle p-3">
                <p className="text-caption uppercase tracking-[0.04em] text-fg-3">{k}</p>
                <p className="tnum mt-1 text-h2 font-semibold">{v}</p>
              </div>
            ))}
          </div>
          {(m.metrics.macroF1 ?? 0) >= 0.99 && (
            <p role="note" className="flex gap-2 rounded-md border border-sev-medium/40 bg-sev-medium/10 px-3 py-2 text-small text-sevfg-medium">
              <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
              Near-perfect scores on a random split usually mean an easy or leaky benchmark, not a strong detector. Compare with the holdout on unseen source IPs below.
            </p>
          )}
          <PerClassTable rows={m.metrics.perClass} caption="Per-class results on the untouched test set" />
          {m.groupAware && (
            <div className="rounded-md border border-subtle p-4">
              <h3 className="text-h3 font-semibold">Holdout on unseen source IPs</h3>
              {m.groupAware.status === "ok" ? (
                <>
                  <p className="mt-1 text-small text-fg-2">
                    Macro-F1 <span className="tnum font-semibold text-fg-1">{formatScore(m.groupAware.macroF1)}</span> on {formatExact(m.groupAware.testRows)} rows from {formatExact(m.groupAware.groups)} source-IP groups never seen in training.
                    {m.groupAware.classesMissingFromTest?.length ? ` No estimate for: ${m.groupAware.classesMissingFromTest.join(", ")} (absent from this side).` : ""}
                  </p>
                  {m.groupAware.perClass && <div className="mt-3"><PerClassTable rows={m.groupAware.perClass} caption="Per-class results on unseen source IPs" /></div>}
                </>
              ) : (
                <p className="mt-1 text-small text-fg-2">Not possible: {m.groupAware.reason}.</p>
              )}
            </div>
          )}
          <DefinitionList
            items={[
              ["Feature schema", <span className="font-mono">{m.schema}</span>],
              ["Algorithm", `${m.algorithm}${m.classWeight ? ` (class_weight=${m.classWeight})` : ""}`],
              ["Trained", formatDateTime(m.trainedAt)],
              ["Training data", m.trainedOn.description || "—"],
              ["Training rows", formatExact(m.trainedOn.rows)],
              ["Class counts", Object.entries(m.trainedOn.classCounts ?? {}).map(([k, v]) => `${k} ${formatExact(v)}`).join(" · ") || "—"],
              ["Files", m.trainedOn.files.map((f) => `${f.name} (sha256 ${f.sha256.slice(0, 12)}…)`).join(", ") || "—"],
              ["Libraries", Object.entries(m.libVersions).filter(([k]) => k !== "platform").map(([k, v]) => `${k} ${v}`).join(", ")],
            ]}
          />
          {m.modelCard && (
            <details className="rounded-md border border-subtle">
              <summary className="cursor-pointer px-4 py-2.5 text-small text-fg-2">Full model card (Markdown)</summary>
              <pre tabIndex={0} aria-label="Model card" className="max-h-[480px] overflow-auto whitespace-pre-wrap px-4 pb-4 font-mono text-caption text-fg-2">{m.modelCard}</pre>
            </details>
          )}
        </CardBody>
      </Card>
      <MonitoringPanel version={m.version} active={m.active} />
      <OrgEvaluation model={m} />
    </div>
  );
}

export function ModelsPage() {
  const models = useModels();
  const [params, setParams] = useSearchParams();
  const list = models.data?.items ?? [];
  const selected = params.get("version") ?? list.find((m) => m.active)?.version ?? list[0]?.version ?? null;
  const mlDown = models.error instanceof ApiError && models.error.code === "ML_UNAVAILABLE";

  return (
    <>
      <PageHeader title="Models" description="Trained detection models, their honest results, and which one this organisation uses." />
      <ScoringPanel />
      {models.isLoading ? (
        <SkeletonRows rows={4} cols={3} />
      ) : models.isError ? (
        <Card>
          <ErrorState
            error={models.error}
            title={mlDown ? "The ML service is not reachable" : "Couldn’t load models"}
            onRetry={() => void models.refetch()}
          />
          {mlDown && <p className="px-6 pb-6 text-center text-small text-fg-3">Start it with: npm run ml:serve (see README). Flows keep being stored unscored meanwhile.</p>}
        </Card>
      ) : list.length === 0 ? (
        <Card>
          <EmptyState title="No trained models" description="Train one with: npm run ml:train:sample (writes services/ml/artifacts/). It is never activated automatically." />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
          <Card className="h-fit">
            <CardHeader title="Versions" as="h2" />
            <ul className="p-2">
              {list.map((m) => (
                <li key={m.version}>
                  <button
                    type="button"
                    aria-current={m.version === selected ? "true" : undefined}
                    onClick={() => setParams({ version: m.version }, { replace: true })}
                    className={cn("w-full rounded-md px-3 py-2 text-left hover:bg-surface-3", m.version === selected && "bg-accent-soft")}
                  >
                    <span className="block truncate font-mono text-small text-fg-1">{m.version}</span>
                    <span className="mt-1 flex flex-wrap gap-1">
                      {m.active && <NeutralBadge className="bg-sev-ok/15 text-sevfg-ok">active</NeutralBadge>}
                      <NeutralBadge>{m.kind}</NeutralBadge>
                      <NeutralBadge>F1 {formatScore(m.metrics.macroF1, 2)}</NeutralBadge>
                      {m.versionWarnings.length > 0 && <NeutralBadge className="bg-sev-high/15 text-sevfg-high">version warning</NeutralBadge>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
          {selected && <ModelView version={selected} />}
        </div>
      )}
    </>
  );
}
