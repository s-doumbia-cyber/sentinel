import { FilterX } from "lucide-react";
import { useMemo, type KeyboardEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { ATTACK_CLASSES, SOURCE_KINDS } from "@sentinel/shared";
import { ConfidenceMeter, SeverityBadge, SourceKindBadge, VerdictBadge } from "@/components/ui/Badges";
import { Button } from "@/components/ui/Button";
import { Card, PageHeader } from "@/components/ui/Card";
import { Input, Select } from "@/components/ui/Form";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/States";
import { formatWhen, utcTitle } from "@/lib/format";
import { useFlows, type FlowFilters } from "@/lib/queries";
import type { Flow } from "@/lib/types";
import { FlowDrawer } from "./FlowDrawer";

const FILTER_KEYS = ["verdict", "sourceKind", "sourceIp", "destinationIp", "protocol", "port", "datasetId", "needsReview", "unusual"] as const;

function GroundTruth({ flow }: { flow: Flow }) {
  if (!flow.groundTruthLabel) return <span className="text-fg-3">{flow.rawLabel ? `unknown (“${flow.rawLabel}”)` : "—"}</span>;
  return <span className="text-fg-2">{flow.groundTruthLabel}</span>;
}

export function FlowsPage() {
  const [params, setParams] = useSearchParams();
  // Filters live in the URL so links from the Command Center and shared URLs work (§4).
  const filters = useMemo(() => {
    const f: FlowFilters = {};
    for (const k of FILTER_KEYS) {
      const v = params.get(k);
      if (v) (f as Record<string, string>)[k] = v;
    }
    return f;
  }, [params]);
  const selected = params.get("flow");
  const query = useFlows(filters);
  const rows = query.data?.pages.flatMap((p) => p.items) ?? [];

  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("flow");
    setParams(next, { replace: true });
  };
  const open = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set("flow", id);
    else next.delete("flow");
    setParams(next);
  };
  const onRowKey = (e: KeyboardEvent<HTMLTableRowElement>, id: string) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      open(id);
    } else if (e.key === "j" || e.key === "ArrowDown") {
      (e.currentTarget.nextElementSibling as HTMLElement | null)?.focus();
    } else if (e.key === "k" || e.key === "ArrowUp") {
      (e.currentTarget.previousElementSibling as HTMLElement | null)?.focus();
    }
  };
  const active = Object.keys(filters).length > 0;

  return (
    <>
      <PageHeader
        title="Flows"
        description="Every flow with the model’s verdict. The dataset label, when a file had one, is shown separately and never used as the verdict."
      />
      <Card className="mb-4 p-4">
        <form
          // Remount when the URL filters change so uncontrolled inputs show the current values.
          key={JSON.stringify(filters)}
          className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7"
          onSubmit={(e) => e.preventDefault()}
          aria-label="Flow filters"
        >
          <label className="text-caption text-fg-3">
            Verdict
            <Select className="mt-1" value={filters.verdict ?? ""} onChange={(e) => update("verdict", e.target.value)}>
              <option value="">Any</option>
              <option value="malicious">Malicious (any class)</option>
              <option value="unscored">Not scored</option>
              <option value="error">Scoring error</option>
              {ATTACK_CLASSES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </label>
          <label className="text-caption text-fg-3">
            Source kind
            <Select className="mt-1" value={filters.sourceKind ?? ""} onChange={(e) => update("sourceKind", e.target.value)}>
              <option value="">Any</option>
              {SOURCE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </Select>
          </label>
          <label className="text-caption text-fg-3">
            Protocol
            <Select className="mt-1" value={filters.protocol ?? ""} onChange={(e) => update("protocol", e.target.value)}>
              <option value="">Any</option>
              {["TCP", "UDP", "ICMP", "OTHER"].map((p) => (
                <option key={p}>{p}</option>
              ))}
            </Select>
          </label>
          <label className="text-caption text-fg-3">
            Source IP
            <Input className="mt-1 font-mono" defaultValue={filters.sourceIp ?? ""} placeholder="10.0.0.1" onBlur={(e) => update("sourceIp", e.target.value.trim())} onKeyDown={(e) => e.key === "Enter" && update("sourceIp", e.currentTarget.value.trim())} />
          </label>
          <label className="text-caption text-fg-3">
            Destination IP
            <Input className="mt-1 font-mono" defaultValue={filters.destinationIp ?? ""} placeholder="192.168.10.50" onBlur={(e) => update("destinationIp", e.target.value.trim())} onKeyDown={(e) => e.key === "Enter" && update("destinationIp", e.currentTarget.value.trim())} />
          </label>
          <label className="text-caption text-fg-3">
            Destination port
            <Input className="mt-1 font-mono" inputMode="numeric" defaultValue={filters.port ?? ""} placeholder="443" onBlur={(e) => update("port", e.target.value.trim())} onKeyDown={(e) => e.key === "Enter" && update("port", e.currentTarget.value.trim())} />
          </label>
          <div className="flex items-end">
            <Button variant="ghost" disabled={!active} onClick={() => setParams(new URLSearchParams(), { replace: true })} className="w-full">
              <FilterX className="h-4 w-4" aria-hidden /> Clear filters
            </Button>
          </div>
        </form>
        {filters.needsReview && <p className="mt-3 text-small text-fg-2">Showing verdicts below the organisation’s confidence threshold (needs review).</p>}
        {filters.unusual && (
          <p className="mt-3 text-small text-fg-2">
            Showing unusual behaviour: flows far from the benign traffic the model was trained on that it did not recognise as a known attack with confidence. This is not an attack verdict.
          </p>
        )}
        {filters.datasetId && <p className="mt-3 text-small text-fg-2">Showing flows from one dataset.</p>}
      </Card>

      <Card className="overflow-hidden">
        {query.isLoading ? (
          <SkeletonRows />
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState title={active ? "No flows match these filters" : "No flows yet"} description={active ? "Clear or change the filters." : "Import a dataset from the Datasets page."} />
        ) : (
          <>
            <div role="region" aria-label="Flows table" tabIndex={0} className="hidden overflow-x-auto md:block">
              <table className="w-full text-small">
                <caption className="sr-only">Flows, newest first. Press Enter on a row to open its details; J and K move between rows.</caption>
                <thead className="sticky top-0 bg-surface-1 text-left text-caption uppercase tracking-[0.04em] text-fg-3">
                  <tr className="border-b border-subtle">
                    <th scope="col" className="px-4 py-2.5 font-medium">Time</th>
                    <th scope="col" className="px-4 py-2.5 font-medium">Source → destination</th>
                    <th scope="col" className="px-4 py-2.5 font-medium">Proto</th>
                    <th scope="col" className="px-4 py-2.5 font-medium">Model verdict</th>
                    <th scope="col" className="px-4 py-2.5 font-medium">Confidence</th>
                    <th scope="col" className="px-4 py-2.5 font-medium">Severity</th>
                    <th scope="col" className="px-4 py-2.5 font-medium" title="Evaluation only: never used as the verdict">Dataset label</th>
                    <th scope="col" className="px-4 py-2.5 font-medium">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((f) => (
                    <tr
                      key={f.id}
                      tabIndex={0}
                      aria-selected={selected === f.id}
                      onClick={() => open(f.id)}
                      onKeyDown={(e) => onRowKey(e, f.id)}
                      className="cursor-pointer border-b border-subtle last:border-0 hover:bg-surface-3/60 focus-visible:bg-surface-3 aria-selected:bg-accent-soft"
                    >
                      <td className="whitespace-nowrap px-4 py-row text-fg-2" title={utcTitle(f.timestamp)}>
                        {formatWhen(f.timestamp)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-row">
                        <span className="font-mono text-fg-1">{f.sourceIp}</span>
                        <span className="px-1.5 text-fg-3">→</span>
                        <span className="font-mono text-fg-1">
                          {f.destinationIp}:{f.destinationPort}
                        </span>
                      </td>
                      <td className="px-4 py-row text-fg-2">{f.protocol}</td>
                      <td className="px-4 py-row">
                        <VerdictBadge flow={f} />
                      </td>
                      <td className="px-4 py-row">{f.scored ? <ConfidenceMeter value={f.scored.confidence} needsReview={f.scored.needsReview} /> : <span className="text-fg-3">—</span>}</td>
                      <td className="px-4 py-row">{f.scored && f.scored.label !== "Normal" ? <SeverityBadge severity={f.scored.severity} /> : <span className="text-fg-3">—</span>}</td>
                      <td className="px-4 py-row">
                        <GroundTruth flow={f} />
                      </td>
                      <td className="px-4 py-row">
                        <SourceKindBadge kind={f.sourceKind} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="divide-y divide-[color:var(--border-subtle)] md:hidden">
              {rows.map((f) => (
                <li key={f.id}>
                  <button type="button" onClick={() => open(f.id)} className="flex w-full flex-col gap-1.5 px-4 py-3 text-left hover:bg-surface-3/60">
                    <span className="flex items-center justify-between gap-2">
                      <VerdictBadge flow={f} />
                      <SourceKindBadge kind={f.sourceKind} />
                    </span>
                    {/* Plain text: a copy button cannot sit inside this row button. */}
                    <span className="font-mono text-small text-fg-1">
                      {f.sourceIp} → {f.destinationIp}:{f.destinationPort}
                    </span>
                    <span className="text-caption text-fg-3" title={utcTitle(f.timestamp)}>
                      {formatWhen(f.timestamp)} · {f.protocol} · dataset label: {f.groundTruthLabel ?? "—"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between border-t border-subtle px-4 py-3 text-small text-fg-3">
              <span>{rows.length} flows loaded</span>
              {query.hasNextPage && (
                <Button size="sm" loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
                  Load more
                </Button>
              )}
            </div>
          </>
        )}
      </Card>
      <FlowDrawer id={selected} onClose={() => open(null)} />
    </>
  );
}
