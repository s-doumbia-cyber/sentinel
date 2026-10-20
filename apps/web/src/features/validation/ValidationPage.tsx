import { AlertTriangle, Beaker } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { NeutralBadge } from "@/components/ui/Badges";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/Card";
import { FeatureContributionChart } from "@/components/ui/Data";
import { Select } from "@/components/ui/Form";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { useAuth } from "@/features/auth/AuthContext";
import { PerClassTable } from "@/features/models/ModelsPage";
import { api, errorMessage } from "@/lib/api";
import { cn, formatDateTime, formatExact, formatScore } from "@/lib/format";
import { useDatasets, useModels, useOrgMutation, useRules, useValidationRun, useValidationRuns } from "@/lib/queries";
import type { ErrorSample, ValidationRun } from "@/lib/types";

function NewRun({ onCreated }: { onCreated: (id: string) => void }) {
  const toast = useToast();
  const datasets = useDatasets();
  const models = useModels();
  const rules = useRules();
  const [kind, setKind] = useState<"model" | "rule">("rule");
  const [target, setTarget] = useState("");
  const [datasetId, setDatasetId] = useState("");
  const run = useOrgMutation(
    () => api<ValidationRun>("/validation/runs", { method: "POST", body: kind === "model" ? { kind, modelVersion: target, datasetId } : { kind, ruleId: target, datasetId } }),
    ["validationRuns"],
  );
  const processed = datasets.data?.items.filter((d) => d.status === "Processed") ?? [];
  return (
    <Card className="mb-6">
      <CardHeader title="New validation run" subtitle="Tests one model or rule version on one labelled dataset. Stored verdicts are not changed." />
      <CardBody>
        <form
          className="grid gap-3 md:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            run.mutate(undefined, { onSuccess: (r) => onCreated(r.id), onError: (err) => toast.error(errorMessage(err)) });
          }}
        >
          <label className="text-caption text-fg-3">
            Test a
            <Select className="mt-1" value={kind} onChange={(e) => { setKind(e.target.value as "model" | "rule"); setTarget(""); }}>
              <option value="rule">Rule</option>
              <option value="model">Model</option>
            </Select>
          </label>
          <label className="text-caption text-fg-3">
            {kind === "model" ? "Model version" : "Rule"}
            <Select className="mt-1" value={target} onChange={(e) => setTarget(e.target.value)} required>
              <option value="">Choose…</option>
              {kind === "model"
                ? models.data?.items.map((m) => (
                    <option key={m.version} value={m.version}>
                      {m.version}
                    </option>
                  ))
                : rules.data?.items.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.key} v{r.version}
                    </option>
                  ))}
            </Select>
          </label>
          <label className="text-caption text-fg-3">
            Labelled dataset
            <Select className="mt-1" value={datasetId} onChange={(e) => setDatasetId(e.target.value)} required>
              <option value="">Choose…</option>
              {processed.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </label>
          <div className="flex items-end">
            <Button type="submit" variant="primary" className="w-full" loading={run.isPending} disabled={!target || !datasetId}>
              <Beaker aria-hidden className="h-4 w-4" /> Run
            </Button>
          </div>
        </form>
        {kind === "model" && models.isError && <p className="mt-3 text-small text-fg-3">The ML service is not reachable: model runs are unavailable.</p>}
        <p className="mt-3 text-caption text-fg-3">For an honest estimate, use a dataset that was not used for training, ideally another capture or day. Labels are compared with outputs; they never become verdicts.</p>
      </CardBody>
    </Card>
  );
}

function Samples({ title, items, empty }: { title: string; items: ErrorSample[]; empty: string }) {
  return (
    <div>
      <h3 className="mb-2 text-small font-semibold text-fg-1">{title}</h3>
      {items.length ? (
        <ul className="space-y-2">
          {items.slice(0, 10).map((s) => (
            <li key={s.flowId} className="rounded-md border border-subtle p-3 text-small">
              <p className="flex flex-wrap items-center gap-2">
                <span className="text-fg-2">label</span> <span className="font-medium text-fg-1">{s.truth}</span>
                <span className="text-fg-2">output</span> <span className="font-medium text-fg-1">{s.predicted}</span>
                {s.confidence !== undefined && <span className="text-fg-3">{Math.round(s.confidence * 100)}%</span>}
                <Link to={`/flows?flow=${s.flowId}`} className="ml-auto text-accent-fg hover:underline">
                  open flow
                </Link>
              </p>
              {s.topFeatures && s.topFeatures.length > 0 && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-caption text-fg-2">Why the model answered this</summary>
                  <div className="mt-2">
                    <FeatureContributionChart features={s.topFeatures} />
                  </div>
                </details>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-small text-fg-3">{empty}</p>
      )}
    </div>
  );
}

function RunDetail({ id }: { id: string }) {
  const q = useValidationRun(id);
  if (q.isLoading) return <Skeleton className="h-96" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const r = q.data;
  if (!r) return null;
  return (
    <Card>
      <CardHeader
        title={`${r.kind === "model" ? "Model" : "Rule"} ${r.target}${r.targetVersion ? ` v${r.targetVersion}` : ""}`}
        subtitle={
          <>
            on {r.dataset.name} (sha256 <span className="font-mono">{r.dataset.sha256?.slice(0, 12) ?? "?"}…</span>) · {formatExact(r.flowsScanned)} flows scanned · by {r.createdBy ?? "unknown"} · {formatDateTime(r.createdAt)}
          </>
        }
      />
      <CardBody className="space-y-5">
        {r.trainingOverlap && (
          <p role="note" className="flex gap-2 rounded-md border border-sev-high/40 bg-sev-high/10 px-3 py-2 text-small text-sevfg-high">
            <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" /> The model was trained on this file: this is not an independent estimate.
          </p>
        )}
        <p className="text-body">
          Macro-F1 <span className="tnum font-semibold">{formatScore(r.metrics.macroF1)}</span> over <span className="tnum">{formatExact(r.metrics.evaluated)}</span> labelled flows.
        </p>
        <PerClassTable rows={r.metrics.perClass} caption="Per-class results of this run" />
        <div className="grid gap-5 lg:grid-cols-2">
          <Samples title={`False positives (${r.falsePositives.length}${r.falsePositives.length === 25 ? "+" : ""})`} items={r.falsePositives} empty="None in this run." />
          <Samples title={`False negatives (${r.falseNegatives.length}${r.falseNegatives.length === 25 ? "+" : ""})`} items={r.falseNegatives} empty="None in this run." />
        </div>
        <ul className="list-disc space-y-1 pl-5 text-small text-fg-2">
          {r.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

export function ValidationPage() {
  const { can } = useAuth();
  const runs = useValidationRuns();
  const [params, setParams] = useSearchParams();
  const selected = params.get("run") ?? runs.data?.items[0]?.id ?? null;
  return (
    <>
      <PageHeader
        title="Validation"
        description="Reproducible tests of rules and models on labelled data: per-class results, false positives and false negatives, and exactly what was tested. Benchmarks are not guarantees on your network."
      />
      {can("rules:test") && <NewRun onCreated={(id) => setParams({ run: id }, { replace: true })} />}
      {runs.isLoading ? (
        <Skeleton className="h-48" />
      ) : runs.isError ? (
        <ErrorState error={runs.error} onRetry={() => void runs.refetch()} />
      ) : !runs.data?.items.length ? (
        <Card>
          <EmptyState title="No validation run yet" description="Import a labelled dataset, then test a rule or a model on it." />
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
          <Card className="h-fit">
            <CardHeader title="Runs" />
            <ul className="p-2">
              {runs.data.items.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    aria-current={r.id === selected ? "true" : undefined}
                    onClick={() => setParams({ run: r.id }, { replace: true })}
                    className={cn("w-full rounded-md px-3 py-2 text-left hover:bg-surface-3", r.id === selected && "bg-accent-soft")}
                  >
                    <span className="block truncate text-small font-medium text-fg-1">
                      {r.target}
                      {r.targetVersion ? ` v${r.targetVersion}` : ""}
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-1 text-caption text-fg-3">
                      <NeutralBadge>{r.kind}</NeutralBadge> F1 {formatScore(r.metrics.macroF1, 2)} · {r.dataset.name}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
          {selected && <RunDetail id={selected} />}
        </div>
      )}
    </>
  );
}
