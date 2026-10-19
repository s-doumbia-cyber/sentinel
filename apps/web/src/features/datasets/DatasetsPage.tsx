import { FileUp, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { NeutralBadge, SourceKindBadge } from "@/components/ui/Badges";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/Overlays";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { useAuth } from "@/features/auth/AuthContext";
import { ApiError, api, errorMessage, uploadWithProgress } from "@/lib/api";
import { formatBytes, formatDateTime, formatExact, formatWhen, utcTitle } from "@/lib/format";
import { useDatasets, useOrgMutation } from "@/lib/queries";
import type { Dataset } from "@/lib/types";
import { useQueryClient } from "@tanstack/react-query";

function StatusBadge({ status }: { status: Dataset["status"] }) {
  const cls = status === "Processed" ? "bg-sev-ok/15 text-sevfg-ok" : status === "Failed" ? "bg-sev-critical/15 text-sevfg-critical" : "bg-sev-low/15 text-sevfg-low";
  return <NeutralBadge className={cls}>{status === "Processing" ? "Importing…" : status}</NeutralBadge>;
}

function UploadCard() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<{ message: string; details: string[] } | null>(null);
  const toast = useToast();
  const qc = useQueryClient();
  const { activeOrg } = useAuth();

  const upload = async () => {
    if (!file) return;
    setError(null);
    setProgress(0);
    const form = new FormData();
    form.append("sourceType", "CICIDS2017");
    form.append("file", file);
    try {
      await uploadWithProgress<Dataset>("/imports/csv", form, setProgress);
      toast.success(`${file.name} uploaded; import started`);
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      await qc.invalidateQueries({ queryKey: [activeOrg?.id ?? "none", "datasets"] });
    } catch (err) {
      setError({ message: errorMessage(err), details: err instanceof ApiError ? (err.details ?? []).map((d) => d.message) : [] });
    } finally {
      setProgress(null);
    }
  };

  return (
    <Card className="mb-6">
      <CardHeader title="Import a CSV" subtitle="CICFlowMeter / CICIDS2017 exports. Flows are stored as IMPORTED and scored by the active model; their labels are kept for evaluation only." />
      <CardBody>
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            aria-label="CSV file"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="max-w-full text-small text-fg-2 file:mr-3 file:h-9 file:rounded-md file:border file:border-solid file:bg-surface-2 file:px-3 file:text-small file:text-fg-1"
          />
          <Button variant="primary" onClick={() => void upload()} disabled={!file} loading={progress !== null}>
            <FileUp aria-hidden className="h-4 w-4" /> Upload
          </Button>
          {file && <span className="text-small text-fg-3">{formatBytes(file.size)}</span>}
        </div>
        {progress !== null && (
          <div className="mt-3" role="progressbar" aria-label="Upload progress" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
              <div className="h-full bg-accent transition-[width] duration-base" style={{ width: `${progress}%` }} />
            </div>
            <p className="mt-1 text-caption text-fg-3">Uploading {progress}%</p>
          </div>
        )}
        {error && (
          <div role="alert" className="mt-3 rounded-md border border-sev-critical/40 bg-sev-critical/10 px-3 py-2 text-small text-sevfg-critical">
            <p>{error.message}</p>
            {error.details.length > 0 && (
              <ul className="mt-1 list-disc pl-5 text-caption">
                {error.details.slice(0, 8).map((d) => (
                  <li key={d}>{d}</li>
                ))}
                {error.details.length > 8 && <li>…and {error.details.length - 8} more</li>}
              </ul>
            )}
          </div>
        )}
        <p className="mt-3 text-caption text-fg-3">Large day files (hundreds of MB) are easier from the command line: npm run import:csv -w @sentinel/api -- --org &lt;slug&gt; "file.csv".</p>
      </CardBody>
    </Card>
  );
}

function Composition({ counts }: { counts: Record<string, number> }) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return <span className="text-fg-3">no labels</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {entries.map(([k, v]) => (
        <NeutralBadge key={k}>
          {k} <span className="tnum text-fg-3">{formatExact(v)}</span>
        </NeutralBadge>
      ))}
    </span>
  );
}

export function DatasetsPage() {
  const { can } = useAuth();
  const datasets = useDatasets();
  const toast = useToast();
  const [toDelete, setToDelete] = useState<Dataset | null>(null);
  const del = useOrgMutation((id: string) => api<{ flowsDeleted: number }>(`/datasets/${id}`, { method: "DELETE" }), ["datasets", "overview", "flows", "timeseries", "breakdown", "top", "evaluation", "scoring"]);

  return (
    <>
      <PageHeader title="Datasets" description="Imported files and exactly what happened to every row." />
      {can("datasets:import") && <UploadCard />}
      <Card className="overflow-hidden">
        {datasets.isLoading ? (
          <SkeletonRows />
        ) : datasets.isError ? (
          <ErrorState error={datasets.error} onRetry={() => void datasets.refetch()} />
        ) : !datasets.data?.items.length ? (
          <EmptyState title="No datasets yet" description="Import a CICIDS2017-style CSV to get flows into this organisation. A sample ships in data/samples/." />
        ) : (
          <ul className="divide-y divide-[color:var(--border-subtle)]">
            {datasets.data.items.map((d) => (
              <li key={d.id} className="px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 font-medium text-fg-1">
                      <span className="truncate">{d.name}</span>
                      <StatusBadge status={d.status} />
                      <SourceKindBadge kind={d.sourceKind} />
                    </p>
                    <p className="mt-1 text-small text-fg-3" title={utcTitle(d.createdAt)}>
                      {formatBytes(d.fileBytes)} · {d.sourceType} · schema <span className="font-mono">{d.featureSchema}</span> · uploaded {formatWhen(d.createdAt)}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {d.status === "Processed" && (
                      <Link to={`/flows?datasetId=${d.id}`} className="inline-flex h-8 items-center rounded-md border bg-surface-2 px-3 text-small text-fg-1 hover:bg-surface-3">
                        View flows
                      </Link>
                    )}
                    {can("datasets:delete") && d.status !== "Processing" && (
                      <Button size="sm" variant="ghost" aria-label={`Delete ${d.name}`} onClick={() => setToDelete(d)}>
                        <Trash2 aria-hidden className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
                {d.status === "Failed" && <p className="mt-2 text-small text-sevfg-critical">{d.error}</p>}
                {d.status !== "Processing" && (
                  <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-small md:grid-cols-4">
                    <div>
                      <dt className="text-fg-3">Rows imported</dt>
                      <dd className="tnum text-fg-1">
                        {formatExact(d.rowsInserted)} / {formatExact(d.rowsRead)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-fg-3">Rejected rows</dt>
                      <dd className="tnum text-fg-1">{formatExact(d.skipped.invalidRow + d.skipped.insertFailed)}</dd>
                    </div>
                    <div>
                      <dt className="text-fg-3">Unknown labels</dt>
                      <dd className="tnum text-fg-1" title="Imported and scored, but excluded from evaluation">
                        {formatExact(d.unknownLabelRows)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-fg-3">Time range (as recorded)</dt>
                      <dd className="text-fg-1">{d.timeRange.from ? `${formatDateTime(d.timeRange.from)} → ${formatDateTime(d.timeRange.to)}` : "—"}</dd>
                    </div>
                    <div className="col-span-2 md:col-span-4">
                      <dt className="text-fg-3">Dataset labels (ground truth, evaluation only)</dt>
                      <dd className="mt-1">
                        <Composition counts={d.groundTruthCounts} />
                      </dd>
                    </div>
                  </dl>
                )}
                {(d.invalidSamples.length > 0 || d.unknownLabels.length > 0) && (
                  <details className="mt-3 text-small">
                    <summary className="cursor-pointer text-fg-2">Rejected rows and unknown labels</summary>
                    <ul className="mt-2 list-disc space-y-0.5 pl-5 font-mono text-caption text-fg-2">
                      {d.unknownLabels.map((l) => (
                        <li key={`l-${l}`}>unknown label “{l}”</li>
                      ))}
                      {d.invalidSamples.map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <ConfirmDialog
        open={Boolean(toDelete)}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={`Delete ${toDelete?.name ?? "dataset"}?`}
        consequence={`This permanently deletes the import record and its ${formatExact(toDelete?.rowsInserted)} flows from this organisation. The original file on your computer is not affected.`}
        confirmLabel="Delete dataset and flows"
        loading={del.isPending}
        typedConfirmation="delete"
        onConfirm={() =>
          toDelete &&
          del.mutate(toDelete.id, {
            onSuccess: (r) => {
              toast.success(`Deleted ${formatExact(r.flowsDeleted)} flows`);
              setToDelete(null);
            },
            onError: (e) => toast.error(errorMessage(e)),
          })
        }
      />
    </>
  );
}
