import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { CheckCircle2, CircleSlash, RotateCcw, XCircle } from "lucide-react";
import { useState, type FormEvent } from "react";
import { RETENTION_MAX_DAYS, RETENTION_MIN_DAYS } from "@sentinel/shared";
import { NeutralBadge } from "@/components/ui/Badges";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/Card";
import { DefinitionList } from "@/components/ui/Data";
import { Field, Input } from "@/components/ui/Form";
import { ConfirmDialog } from "@/components/ui/Overlays";
import { EmptyState, ErrorState, Skeleton, SkeletonRows } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { useAuth } from "@/features/auth/AuthContext";
import { api, errorMessage } from "@/lib/api";
import { formatDateTime, formatExact, formatWhen, utcTitle } from "@/lib/format";
import { useOrgMutation } from "@/lib/queries";
import type { Page } from "@/lib/types";

interface Readiness {
  status: "ok" | "degraded";
  mongo: "ok" | "down";
  redis: "ok" | "down" | "not_configured";
  queue: "redis" | "in-process";
  ml: "ok" | "unreachable" | "not_configured";
}

interface JobStatus {
  mode: "redis" | "in-process";
  durable: boolean;
  retry: { attempts: number; backoffMs: number };
  busy: Record<string, boolean>;
  failedNotRetried: number;
}

interface FailedJob {
  id: string;
  kind: string;
  jobId: string;
  payload: Record<string, unknown>;
  error: string;
  attempts: number;
  permanent: boolean;
  failedAt: string;
  retriedAt: string | null;
  retryJobId: string | null;
}

interface RetentionStatus {
  retentionDays: number | null;
  basis: string;
  sweepHours: number;
  running: boolean;
  lastRun: { at: string; cutoff: string; flowsDeleted: number; alertsDeleted: number; alertsKept: number } | null;
  neverPurged: string[];
}

interface RetentionPreview {
  retentionDays: number;
  cutoff: string;
  flows: number;
  alerts: number;
  alertsKept: number;
}

function useOrg() {
  return useAuth().activeOrg?.id ?? "none";
}

/** Icon + word, never colour alone. */
function Health({ state, label }: { state: "ok" | "down" | "off"; label: string }) {
  const Icon = state === "ok" ? CheckCircle2 : state === "down" ? XCircle : CircleSlash;
  const cls = state === "ok" ? "text-sevfg-ok" : state === "down" ? "text-sevfg-critical" : "text-fg-3";
  return (
    <span className={`inline-flex items-center gap-1.5 ${cls}`}>
      <Icon aria-hidden className="h-4 w-4" />
      {label}
    </span>
  );
}

function HealthCard() {
  const ready = useQuery({ queryKey: ["readyz"], queryFn: () => fetch("/api/v1/readyz").then((r) => r.json() as Promise<Readiness>), refetchInterval: 30_000 });
  return (
    <Card>
      <CardHeader title="Service health" subtitle="What this API process can reach right now (refreshed every 30 s)." />
      <CardBody>
        {ready.isLoading ? (
          <Skeleton className="h-20" />
        ) : ready.isError || !ready.data ? (
          <ErrorState error={ready.error} onRetry={() => void ready.refetch()} />
        ) : (
          <DefinitionList
            items={[
              ["MongoDB", <Health key="m" state={ready.data.mongo === "ok" ? "ok" : "down"} label={ready.data.mongo === "ok" ? "Reachable" : "Down"} />],
              [
                "Job queue",
                ready.data.queue === "redis" ? (
                  <Health key="q" state={ready.data.redis === "ok" ? "ok" : "down"} label={ready.data.redis === "ok" ? "Redis (durable)" : "Redis unreachable"} />
                ) : (
                  <Health key="q" state="off" label="In-process (jobs do not survive a restart)" />
                ),
              ],
              [
                "ML service",
                <Health
                  key="ml"
                  state={ready.data.ml === "ok" ? "ok" : ready.data.ml === "unreachable" ? "down" : "off"}
                  label={ready.data.ml === "ok" ? "Reachable" : ready.data.ml === "unreachable" ? "Unreachable" : "Not configured (flows stay unscored)"}
                />,
              ],
            ]}
          />
        )}
      </CardBody>
    </Card>
  );
}

function JobsCard() {
  const org = useOrg();
  const { can } = useAuth();
  const toast = useToast();
  const status = useQuery({ queryKey: [org, "jobs-status"], queryFn: () => api<JobStatus>("/jobs/status"), refetchInterval: 15_000 });
  const failed = useInfiniteQuery({
    queryKey: [org, "jobs-failed"],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api<Page<FailedJob>>("/jobs/failed", { query: { limit: 25, cursor: pageParam } }),
    getNextPageParam: (last) => last.nextCursor,
  });
  const retry = useOrgMutation((id: string) => api<{ retryJobId: string }>(`/jobs/failed/${id}/retry`, { method: "POST" }), ["jobs-failed", "jobs-status"]);
  const rows = failed.data?.pages.flatMap((p) => p.items) ?? [];
  const busy = Object.entries(status.data?.busy ?? {}).filter(([, b]) => b).map(([k]) => k);

  return (
    <Card className="overflow-x-auto">
      <CardHeader
        title="Background jobs"
        subtitle={
          status.data
            ? `${status.data.durable ? "Durable queue on Redis" : "In-process queue"} · ${status.data.retry.attempts} attempts with exponential backoff from ${status.data.retry.backoffMs / 1000} s · running now: ${busy.length ? busy.join(", ") : "nothing"}`
            : "Imports, scoring, detections, asset refresh and retention."
        }
      />
      {failed.isLoading ? (
        <SkeletonRows rows={3} cols={5} />
      ) : failed.isError ? (
        <ErrorState error={failed.error} onRetry={() => void failed.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title="No failed jobs" description="Jobs that run out of attempts are listed here with their error, so they can be retried." />
      ) : (
        <>
          <table className="w-full text-small">
            <caption className="sr-only">Failed jobs (dead letters), newest first</caption>
            <thead className="text-left text-caption uppercase tracking-[0.04em] text-fg-3">
              <tr className="border-b border-subtle">
                {["Failed", "Job", "Error", "Attempts"].map((h) => (
                  <th key={h} scope="col" className="px-4 py-2.5 font-medium">
                    {h}
                  </th>
                ))}
                <th scope="col" className="px-4 py-2.5">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((j) => (
                <tr key={j.id} className="border-b border-subtle align-top last:border-0">
                  <td className="whitespace-nowrap px-4 py-row text-fg-2" title={utcTitle(j.failedAt)}>
                    {formatWhen(j.failedAt)}
                  </td>
                  <td className="px-4 py-row">
                    <span className="font-mono text-caption text-fg-1">{j.kind}</span>
                    {typeof j.payload.name === "string" && <span className="block text-caption text-fg-3">{j.payload.name}</span>}
                  </td>
                  <td className="max-w-[420px] px-4 py-row text-fg-2">
                    {j.error}
                    {j.permanent && <NeutralBadge className="ml-2">not retryable as is</NeutralBadge>}
                  </td>
                  <td className="px-4 py-row text-fg-2">{j.attempts}</td>
                  <td className="whitespace-nowrap px-4 py-row text-right">
                    {j.retriedAt ? (
                      <span className="text-caption text-fg-3" title={utcTitle(j.retriedAt)}>
                        Retried {formatWhen(j.retriedAt)}
                      </span>
                    ) : (
                      can("jobs:manage") && (
                        <Button
                          size="sm"
                          loading={retry.isPending && retry.variables === j.id}
                          onClick={() => retry.mutate(j.id, { onSuccess: () => toast.success(`${j.kind} job queued again`), onError: (e) => toast.error(errorMessage(e)) })}
                        >
                          <RotateCcw aria-hidden className="h-4 w-4" /> Retry
                        </Button>
                      )
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {failed.hasNextPage && (
            <div className="border-t border-subtle p-3 text-right">
              <Button size="sm" loading={failed.isFetchingNextPage} onClick={() => void failed.fetchNextPage()}>
                Load more
              </Button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function RetentionCard() {
  const org = useOrg();
  const { can } = useAuth();
  const toast = useToast();
  const manage = can("retention:manage");
  const status = useQuery({ queryKey: [org, "retention"], queryFn: () => api<RetentionStatus>("/retention") });
  const [days, setDays] = useState("");
  const [preview, setPreview] = useState<RetentionPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | undefined>();
  const [previewing, setPreviewing] = useState(false);
  const [confirmRun, setConfirmRun] = useState(false);
  const save = useOrgMutation((retentionDays: number | null) => api("/retention", { method: "PATCH", body: { retentionDays } }), ["retention"]);
  const run = useOrgMutation(() => api("/retention/run", { method: "POST" }), ["retention"]);

  const current = status.data?.retentionDays ?? null;
  const parsedDays = (): number | null => {
    const n = Number(days);
    return Number.isInteger(n) && n >= RETENTION_MIN_DAYS && n <= RETENTION_MAX_DAYS ? n : null;
  };

  const doPreview = async (e: FormEvent) => {
    e.preventDefault();
    const n = days ? parsedDays() : current;
    if (!n) return setPreviewError(`Enter a whole number of days between ${RETENTION_MIN_DAYS} and ${RETENTION_MAX_DAYS}`);
    setPreviewError(undefined);
    setPreviewing(true);
    try {
      setPreview(await api<RetentionPreview>("/retention/preview", { query: { days: n } }));
    } catch (err) {
      setPreviewError(errorMessage(err));
    } finally {
      setPreviewing(false);
    }
  };

  return (
    <Card>
      <CardHeader title="Data retention" subtitle="Purges flows and alerts by how long Sentinel has stored them, not by when the traffic happened." />
      <CardBody className="space-y-5">
        {status.isLoading ? (
          <Skeleton className="h-24" />
        ) : status.isError || !status.data ? (
          <ErrorState error={status.error} onRetry={() => void status.refetch()} />
        ) : (
          <>
            <DefinitionList
              items={[
                ["Current setting", current ? `Keep ${current} days` : "Keep everything (no automatic purge)"],
                ["Automatic purge", current && status.data.sweepHours > 0 ? `Checked every ${status.data.sweepHours} h` : "Off"],
                [
                  "Last purge",
                  status.data.lastRun
                    ? `${formatDateTime(status.data.lastRun.at)}: ${formatExact(status.data.lastRun.flowsDeleted)} flows and ${formatExact(status.data.lastRun.alertsDeleted)} alerts deleted, ${formatExact(status.data.lastRun.alertsKept)} alerts kept with incidents`
                    : "Never",
                ],
                ["Never purged", status.data.neverPurged.join(", ")],
              ]}
            />
            <form onSubmit={doPreview} noValidate className="flex flex-wrap items-end gap-3">
              <Field label="Retention period (days)" error={previewError} className="w-56">
                {({ id, describedBy, invalid }) => (
                  <Input
                    id={id}
                    inputMode="numeric"
                    placeholder={current ? String(current) : "e.g. 90"}
                    value={days}
                    onChange={(e) => setDays(e.target.value)}
                    aria-describedby={describedBy}
                    aria-invalid={invalid}
                  />
                )}
              </Field>
              <Button type="submit" loading={previewing}>
                Preview (dry run)
              </Button>
              {manage && (
                <Button
                  variant="primary"
                  disabled={!parsedDays() || parsedDays() === current}
                  loading={save.isPending}
                  onClick={() => save.mutate(parsedDays(), { onSuccess: () => toast.success("Retention period saved"), onError: (e) => toast.error(errorMessage(e)) })}
                >
                  Save period
                </Button>
              )}
              {manage && current && (
                <Button
                  variant="ghost"
                  loading={save.isPending}
                  onClick={() => save.mutate(null, { onSuccess: () => toast.success("Automatic purge turned off"), onError: (e) => toast.error(errorMessage(e)) })}
                >
                  Keep everything
                </Button>
              )}
            </form>
            {preview && (
              <p role="status" className="rounded-md border bg-surface-2 px-3 py-2 text-small text-fg-1">
                With {preview.retentionDays} days, data stored before {formatDateTime(preview.cutoff)} would go: {formatExact(preview.flows)} flows and{" "}
                {formatExact(preview.alerts)} alerts. {formatExact(preview.alertsKept)} older alerts stay because incidents reference them. Nothing was deleted.
              </p>
            )}
            {manage ? (
              <div className="flex flex-wrap items-center gap-3 border-t border-subtle pt-4">
                <Button variant="danger" disabled={!current || status.data.running} onClick={() => setConfirmRun(true)}>
                  Purge now
                </Button>
                <span className="text-caption text-fg-3">{status.data.running ? "A purge is running." : "Runs the saved period immediately. Recorded in the audit log."}</span>
              </div>
            ) : (
              <p className="text-caption text-fg-3">Only Owners can change the period or purge.</p>
            )}
          </>
        )}
      </CardBody>
      <ConfirmDialog
        open={confirmRun}
        onOpenChange={setConfirmRun}
        title="Purge old data now?"
        consequence={`Flows stored more than ${current ?? "?"} days ago, and alerts not linked to an incident that were last updated before then, are deleted for good. Preview first to see the numbers.`}
        confirmLabel="Purge"
        typedConfirmation="purge"
        loading={run.isPending}
        onConfirm={() =>
          run.mutate(undefined, {
            onSuccess: () => {
              setConfirmRun(false);
              toast.success("Purge started");
            },
            onError: (e) => toast.error(errorMessage(e)),
          })
        }
      />
    </Card>
  );
}

export function SystemPage() {
  return (
    <>
      <PageHeader title="System" description="Health of the services Sentinel depends on, background jobs that failed, and how long data is kept." />
      <div className="grid gap-6">
        <HealthCard />
        <JobsCard />
        <RetentionCard />
      </div>
    </>
  );
}
