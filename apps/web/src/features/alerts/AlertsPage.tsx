import { Bot, FilterX, FolderPlus, ListChecks, Play, ScrollText } from "lucide-react";
import { useMemo, useState, type KeyboardEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ALERT_STATUSES, ATTACK_CLASSES, SEVERITIES, type AlertStatus, type AlertVerdict, type AttackClass } from "@sentinel/shared";
import { ConfidenceMeter, MitreChip, NeutralBadge, SeverityBadge } from "@/components/ui/Badges";
import { Button } from "@/components/ui/Button";
import { Card, PageHeader } from "@/components/ui/Card";
import { AnalysisPanel, AssetLink, AttributionPanel, ProvenancePanel } from "@/components/evidence/Evidence";
import { DefinitionList, FeatureContributionChart } from "@/components/ui/Data";
import { Select } from "@/components/ui/Form";
import { Drawer } from "@/components/ui/Overlays";
import { EmptyState, ErrorState, Skeleton, SkeletonRows } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { useAuth } from "@/features/auth/AuthContext";
import { describeRule } from "@/features/rules/describe";
import { api, errorMessage } from "@/lib/api";
import { cn, formatDateTime, formatExact, formatWhen, utcTitle } from "@/lib/format";
import { useAlert, useAlerts, useOrgMutation, type AlertFilters } from "@/lib/queries";
import type { Alert, Incident } from "@/lib/types";

export const STATUS_LABEL: Record<AlertStatus, string> = {
  open: "Open",
  needs_review: "Needs review",
  acknowledged: "Acknowledged",
  dismissed: "Dismissed",
  resolved: "Resolved",
};
const VERDICT_LABEL: Record<AlertVerdict, string> = { true_positive: "True positive", false_positive: "False positive", benign: "Benign" };

/**
 * Clicking the current verdict clears it. A false positive or benign verdict
 * dismisses an active alert; a true positive acknowledges it.
 */
function verdictChange(a: Pick<Alert, "verdict" | "status">, v: AlertVerdict): { verdict: AlertVerdict | null; status?: AlertStatus } {
  if (a.verdict === v) return { verdict: null };
  const active = a.status === "open" || a.status === "needs_review";
  if (!active) return { verdict: v };
  return { verdict: v, status: v === "true_positive" ? "acknowledged" : "dismissed" };
}

function StatusBadge({ status }: { status: AlertStatus }) {
  const cls = status === "open" ? "bg-accent-soft text-accent-fg" : status === "needs_review" ? "bg-sev-medium/15 text-sevfg-medium" : "bg-surface-3 text-fg-2";
  return <NeutralBadge className={cls}>{STATUS_LABEL[status]}</NeutralBadge>;
}

function DetectedBy({ alert }: { alert: Pick<Alert, "modelVersions" | "ruleIds"> }) {
  return (
    <span className="flex flex-wrap gap-1">
      {alert.modelVersions.length > 0 && (
        <NeutralBadge title={`Model ${alert.modelVersions.join(", ")}`}>
          <Bot aria-hidden className="h-3.5 w-3.5" /> Model
        </NeutralBadge>
      )}
      {alert.ruleIds.map((r) => (
        <NeutralBadge key={r} title={`Rule ${r}`}>
          <ListChecks aria-hidden className="h-3.5 w-3.5" /> <span className="font-mono">{r}</span>
        </NeutralBadge>
      ))}
    </span>
  );
}

function Endpoints({ alert }: { alert: Pick<Alert, "srcIp" | "dstIp" | "dstPort"> }) {
  return (
    <span className="whitespace-nowrap font-mono text-fg-1">
      {alert.srcIp ?? "many sources"}
      <span className="px-1.5 font-sans text-fg-3">→</span>
      {alert.dstIp ?? "many targets"}
      {alert.dstIp && alert.dstPort !== null ? `:${alert.dstPort}` : ""}
    </span>
  );
}

function AlertDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const alert = useAlert(id);
  const patch = useOrgMutation(
    (body: { status?: AlertStatus; verdict?: AlertVerdict | null }) => api<Alert>(`/alerts/${id}`, { method: "PATCH", body }),
    ["alerts", "alert", "alertSummary"],
  );
  const a = alert.data;
  const writable = can("alerts:write");
  const update = (body: { status?: AlertStatus; verdict?: AlertVerdict | null }) =>
    patch.mutate(body, { onSuccess: () => toast.success("Alert updated"), onError: (e) => toast.error(errorMessage(e)) });
  const top = a?.explanationFlow?.scored;
  const navigate = useNavigate();
  const createIncident = useOrgMutation((alertIds: string[]) => api<Incident>("/incidents/from-alerts", { method: "POST", body: { alertIds } }), ["alerts", "alert", "incidents"]);

  return (
    <Drawer open={Boolean(id)} onOpenChange={(o) => !o && onClose()} title={a ? `${a.type} alert` : "Alert"} subtitle={a ? `Last seen ${formatWhen(a.lastSeen)}` : undefined}>
      {alert.isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-40" />
        </div>
      ) : alert.isError ? (
        <ErrorState error={alert.error} onRetry={() => void alert.refetch()} />
      ) : a ? (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            <SeverityBadge severity={a.severity} />
            <StatusBadge status={a.status} />
            <MitreChip cls={a.type as AttackClass} />
            <DetectedBy alert={a} />
          </div>
          <p className="text-body text-fg-1">
            <Endpoints alert={a} /> · <span className="tnum">{formatExact(a.count)}</span> {a.count === 1 ? "piece" : "pieces"} of evidence between{" "}
            <span title={utcTitle(a.firstSeen)}>{formatDateTime(a.firstSeen)}</span> and <span title={utcTitle(a.lastSeen)}>{formatDateTime(a.lastSeen)}</span>.
          </p>

          <section>
            <h3 className="mb-3 text-caption font-medium uppercase tracking-[0.04em] text-fg-3">Triage</h3>
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-caption text-fg-3">
                Status
                <Select className="mt-1 w-44" disabled={!writable || patch.isPending} value={a.status} onChange={(e) => update({ status: e.target.value as AlertStatus })}>
                  {ALERT_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </option>
                  ))}
                </Select>
              </label>
              <div role="group" aria-label="Analyst verdict" className="flex flex-wrap gap-1.5">
                {(Object.keys(VERDICT_LABEL) as AlertVerdict[]).map((v) => (
                  <Button
                    key={v}
                    size="sm"
                    variant={a.verdict === v ? "primary" : "secondary"}
                    aria-pressed={a.verdict === v}
                    disabled={!writable || patch.isPending}
                    onClick={() => update(verdictChange(a, v))}
                  >
                    {VERDICT_LABEL[v]}
                  </Button>
                ))}
              </div>
            </div>
            {a.verdict && (
              <p className="mt-2 text-caption text-fg-3">
                Marked {VERDICT_LABEL[a.verdict].toLowerCase()} by {a.verdictBy?.name ?? "a former member"} {a.verdictAt ? formatWhen(a.verdictAt) : ""}. Verdicts feed future retraining (roadmap 1.9).
              </p>
            )}
          </section>

          <section>
            <h3 className="mb-3 text-caption font-medium uppercase tracking-[0.04em] text-fg-3">Incident</h3>
            {a.incident ? (
              <p className="text-small text-fg-2">
                Part of{" "}
                <Link to={`/incidents/${a.incident.id}`} className="font-medium text-accent-fg hover:underline">
                  {a.incident.title}
                </Link>{" "}
                ({a.incident.status}).
              </p>
            ) : can("incidents:write") ? (
              <Button
                size="sm"
                loading={createIncident.isPending}
                onClick={() =>
                  createIncident.mutate([a.id], {
                    onSuccess: (inc) => navigate(`/incidents/${inc.id}`),
                    onError: (e) => toast.error(errorMessage(e)),
                  })
                }
              >
                <FolderPlus aria-hidden className="h-4 w-4" /> Open an incident from this alert
              </Button>
            ) : (
              <p className="text-small text-fg-3">Not part of an incident.</p>
            )}
          </section>

          <section>
            <h3 className="mb-3 text-caption font-medium uppercase tracking-[0.04em] text-fg-3">What we know</h3>
            <AnalysisPanel analysis={a.analysis} />
          </section>

          <section>
            <h3 className="mb-3 text-caption font-medium uppercase tracking-[0.04em] text-fg-3">Why this fired</h3>
            {a.rules.length > 0 && (
              <ul className="mb-4 space-y-3">
                {a.rules.map((r) => {
                  const hits = a.ruleHits.filter((h) => h.ruleKey === r.key);
                  return (
                    <li key={r.key} className="rounded-md border border-subtle p-3 text-small">
                      <p className="font-medium text-fg-1">
                        Rule {r.name} <span className="font-mono text-caption text-fg-3">{r.key} v{r.version}</span>
                      </p>
                      <p className="mt-1 text-fg-2">{describeRule(r)}</p>
                      {hits.map((h, i) => (
                        <p key={i} className="tnum mt-1 text-caption text-fg-3">
                          Reached {formatExact(h.value)} ({formatExact(h.flowCount)} flows) between {formatDateTime(h.windowStart)} and {formatDateTime(h.windowEnd)}.
                        </p>
                      ))}
                    </li>
                  );
                })}
              </ul>
            )}
            {top ? (
              <div className="rounded-md border border-subtle p-3">
                <p className="mb-3 flex flex-wrap items-center gap-2 text-small text-fg-2">
                  Model <span className="font-mono text-fg-1">{top.modelVersion}</span> on its most confident flow:
                  <ConfidenceMeter value={top.confidence} needsReview={top.needsReview} />
                </p>
                <FeatureContributionChart features={top.topFeatures} />
              </div>
            ) : (
              a.modelVersions.length === 0 && <p className="text-small text-fg-3">No model verdict contributed to this alert.</p>
            )}
            {a.status === "needs_review" && <p className="mt-3 text-small text-sevfg-medium">Only low-confidence model evidence so far: treat as a lead, not a verdict.</p>}
          </section>

          <section>
            <h3 className="mb-3 text-caption font-medium uppercase tracking-[0.04em] text-fg-3">Evidence flows {a.evidenceTruncated && "(latest 20)"}</h3>
            {a.evidence.length === 0 ? (
              <p className="text-small text-fg-3">No evidence flows recorded.</p>
            ) : (
              <ul className="divide-y divide-[color:var(--border-subtle)] rounded-md border border-subtle">
                {a.evidence.map((f) => (
                  <li key={f.id}>
                    <Link to={`/flows?flow=${f.id}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-small hover:bg-surface-3">
                      <span className="font-mono text-fg-1">
                        {f.sourceIp}:{f.sourcePort} → {f.destinationIp}:{f.destinationPort}
                      </span>
                      <span className="text-caption text-fg-3" title={utcTitle(f.timestamp)}>
                        {formatDateTime(f.timestamp)} · {f.scored ? `${f.scored.label} ${Math.round(f.scored.confidence * 100)}%` : "not scored"}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h3 className="mb-3 text-caption font-medium uppercase tracking-[0.04em] text-fg-3">Who is involved</h3>
            <DefinitionList
              items={[
                ["Source", a.srcIp ? <AssetLink ip={a.srcIp} /> : "Many sources"],
                ["Target", a.dstIp ? <AssetLink ip={a.dstIp} /> : "Many targets"],
                ["All flows from source", a.srcIp ? <Link className="text-accent-fg hover:underline" to={`/flows?sourceIp=${encodeURIComponent(a.srcIp)}`}>Open in Flows</Link> : "—"],
              ]}
            />
            <div className="mt-3">
              <AttributionPanel attribution={a.attribution} restricted={a.identityRestricted} ip={a.srcIp} />
            </div>
          </section>

          <section>
            <h3 className="mb-3 text-caption font-medium uppercase tracking-[0.04em] text-fg-3">Provenance</h3>
            <ProvenancePanel provenance={a.provenance} />
          </section>

          <section>
            <h3 className="mb-3 text-caption font-medium uppercase tracking-[0.04em] text-fg-3">Change history</h3>
            {a.history.length ? (
              <ol className="space-y-1.5 text-small">
                {a.history.map((h, i) => {
                  const changes = (h.meta as { changes?: Record<string, { from: unknown; to: unknown }> }).changes ?? {};
                  return (
                    <li key={i} className="text-fg-2">
                      <span className="text-fg-1">{h.actor}</span> ·{" "}
                      {Object.entries(changes)
                        .map(([k, v]) => `${k}: ${String(v.from ?? "none")} → ${String(v.to ?? "none")}`)
                        .join(", ") || h.action}
                      <span className="block text-caption text-fg-3" title={utcTitle(h.ts)}>
                        {formatDateTime(h.ts)}
                      </span>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="text-small text-fg-3">No analyst change yet. Created by Sentinel {formatDateTime(a.provenance.createdAt)}.</p>
            )}
          </section>
        </div>
      ) : null}
    </Drawer>
  );
}

const FILTERS = ["status", "severity", "type", "source"] as const;

export function AlertsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => {
    const f: AlertFilters = { status: params.get("status") ?? "active" };
    for (const k of FILTERS) {
      const v = params.get(k);
      if (v) f[k] = v;
    }
    if (f.status === "all") delete f.status;
    return f;
  }, [params]);
  const query = useAlerts(filters);
  const rows = query.data?.pages.flatMap((p) => p.items) ?? [];
  const selected = params.get("alert");
  const run = useOrgMutation(() => api("/detections/run", { method: "POST", body: {} }), ["alerts", "alertSummary"]);
  const navigate = useNavigate();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const bulkIncident = useOrgMutation((alertIds: string[]) => api<Incident>("/incidents/from-alerts", { method: "POST", body: { alertIds } }), ["alerts", "incidents"]);

  const set = (key: string, value: string | null, keepAlert = false) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (!keepAlert) next.delete("alert");
    setParams(next, { replace: key !== "alert" });
  };
  const onRowKey = (e: KeyboardEvent<HTMLTableRowElement>, id: string) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      set("alert", id, true);
    } else if (e.key === "j" || e.key === "ArrowDown") (e.currentTarget.nextElementSibling as HTMLElement | null)?.focus();
    else if (e.key === "k" || e.key === "ArrowUp") (e.currentTarget.previousElementSibling as HTMLElement | null)?.focus();
  };

  return (
    <>
      <PageHeader
        title="Alerts"
        description="Raised by the active model and by detection rules. Repeated evidence for the same source, target and type within 10 minutes joins one alert."
        actions={
          <>
            <Link to="/rules" className="inline-flex h-9 items-center gap-2 rounded-md border bg-surface-2 px-4 text-body text-fg-1 hover:bg-surface-3">
              <ScrollText aria-hidden className="h-4 w-4" /> Rules
            </Link>
            {can("detections:run") && (
              <Button
                loading={run.isPending}
                onClick={() => run.mutate(undefined, { onSuccess: () => toast.success("Detection started over all flows; alerts appear as rules fire"), onError: (e) => toast.error(errorMessage(e)) })}
              >
                <Play aria-hidden className="h-4 w-4" /> Run detections
              </Button>
            )}
          </>
        }
      />
      <Card className="mb-4 p-4">
        <form className="grid grid-cols-2 gap-3 md:grid-cols-5" aria-label="Alert filters" onSubmit={(e) => e.preventDefault()}>
          <label className="text-caption text-fg-3">
            Status
            <Select className="mt-1" value={params.get("status") ?? "active"} onChange={(e) => set("status", e.target.value === "active" ? null : e.target.value)}>
              <option value="active">Active (open, review, ack.)</option>
              <option value="all">All</option>
              {ALERT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </Select>
          </label>
          <label className="text-caption text-fg-3">
            Severity
            <Select className="mt-1" value={filters.severity ?? ""} onChange={(e) => set("severity", e.target.value)}>
              <option value="">Any</option>
              {SEVERITIES.filter((s) => s !== "info").map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </label>
          <label className="text-caption text-fg-3">
            Type
            <Select className="mt-1" value={filters.type ?? ""} onChange={(e) => set("type", e.target.value)}>
              <option value="">Any</option>
              {ATTACK_CLASSES.filter((c) => c !== "Normal").map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </label>
          <label className="text-caption text-fg-3">
            Detected by
            <Select className="mt-1" value={filters.source ?? ""} onChange={(e) => set("source", e.target.value)}>
              <option value="">Model or rule</option>
              <option value="model">Model</option>
              <option value="rule">Rule</option>
            </Select>
          </label>
          <div className="flex items-end">
            <Button variant="ghost" className="w-full" disabled={!["status", ...FILTERS].some((k) => params.get(k))} onClick={() => setParams(new URLSearchParams(), { replace: true })}>
              <FilterX aria-hidden className="h-4 w-4" /> Reset filters
            </Button>
          </div>
        </form>
      </Card>
      <Card className="overflow-hidden">
        {query.isLoading ? (
          <SkeletonRows />
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            title={["status", ...FILTERS].some((k) => params.get(k)) ? "No alerts match these filters" : "No active alerts"}
            description="Alerts appear when the active model flags a flow or a detection rule fires. Import data and activate a model to start."
          />
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-small">
                <caption className="sr-only">Alerts, most recent first. Press Enter on a row to open it; J and K move between rows.</caption>
                <thead className="text-left text-caption uppercase tracking-[0.04em] text-fg-3">
                  <tr className="border-b border-subtle">
                    <th scope="col" className="w-10 px-4 py-2.5">
                      <span className="sr-only">Select</span>
                    </th>
                    {["Severity", "Type", "Source → target", "Evidence", "Confidence", "Detected by", "Status", "Last seen"].map((h) => (
                      <th key={h} scope="col" className="px-4 py-2.5 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((a) => (
                    <tr
                      key={a.id}
                      tabIndex={0}
                      aria-selected={selected === a.id}
                      onClick={() => set("alert", a.id, true)}
                      onKeyDown={(e) => onRowKey(e, a.id)}
                      className="cursor-pointer border-b border-subtle last:border-0 hover:bg-surface-3/60 focus-visible:bg-surface-3 aria-selected:bg-accent-soft"
                    >
                      <td className="px-4 py-row" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label={`Select ${a.type} alert from ${a.srcIp ?? "several sources"}`}
                          className="h-4 w-4 accent-[rgb(var(--accent))]"
                          checked={picked.has(a.id)}
                          onChange={() => toggle(a.id)}
                          onKeyDown={(e) => e.stopPropagation()}
                        />
                      </td>
                      <td className="px-4 py-row">
                        <SeverityBadge severity={a.severity} />
                      </td>
                      <td className="px-4 py-row font-medium text-fg-1">{a.type}</td>
                      <td className="px-4 py-row">
                        <Endpoints alert={a} />
                      </td>
                      <td className="tnum px-4 py-row text-fg-2">{formatExact(a.count)}</td>
                      <td className="px-4 py-row">{a.maxConfidence !== null ? <ConfidenceMeter value={a.maxConfidence} needsReview={a.status === "needs_review"} /> : <span className="text-fg-3">rule</span>}</td>
                      <td className="px-4 py-row">
                        <DetectedBy alert={a} />
                      </td>
                      <td className="px-4 py-row">
                        <StatusBadge status={a.status} />
                      </td>
                      <td className="whitespace-nowrap px-4 py-row text-fg-3" title={utcTitle(a.lastSeen)}>
                        {formatWhen(a.lastSeen)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="divide-y divide-[color:var(--border-subtle)] md:hidden">
              {rows.map((a) => (
                <li key={a.id}>
                  <button type="button" onClick={() => set("alert", a.id, true)} className={cn("flex w-full flex-col gap-1.5 px-4 py-3 text-left hover:bg-surface-3/60", selected === a.id && "bg-accent-soft")}>
                    <span className="flex flex-wrap items-center gap-2">
                      <SeverityBadge severity={a.severity} />
                      <span className="font-medium text-fg-1">{a.type}</span>
                      <StatusBadge status={a.status} />
                    </span>
                    <Endpoints alert={a} />
                    <span className="text-caption text-fg-3">
                      {formatExact(a.count)} evidence · {formatWhen(a.lastSeen)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {picked.size > 0 && can("incidents:write") && (
              <div role="region" aria-label="Bulk actions" className="flex animate-rise-in flex-wrap items-center justify-between gap-3 border-t border-subtle bg-accent-soft px-4 py-3 text-small">
                <span className="text-fg-1">{picked.size} selected</span>
                <span className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>
                    Clear
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    loading={bulkIncident.isPending}
                    onClick={() =>
                      bulkIncident.mutate([...picked], {
                        onSuccess: (inc) => navigate(`/incidents/${inc.id}`),
                        onError: (e) => toast.error(errorMessage(e)),
                      })
                    }
                  >
                    <FolderPlus aria-hidden className="h-4 w-4" /> Open an incident with these alerts
                  </Button>
                </span>
              </div>
            )}
            <div className="flex items-center justify-between border-t border-subtle px-4 py-3 text-small text-fg-3">
              <span>{rows.length} alerts loaded</span>
              {query.hasNextPage && (
                <Button size="sm" loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
                  Load more
                </Button>
              )}
            </div>
          </>
        )}
      </Card>
      <AlertDrawer id={selected} onClose={() => set("alert", null, true)} />
    </>
  );
}
