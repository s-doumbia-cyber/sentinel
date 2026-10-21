import { AlertTriangle, List, Network } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { SeverityBadge } from "@/components/ui/Badges";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/States";
import { cn, formatDateTime, formatExact, utcTitle } from "@/lib/format";
import { describeGraph, edgeId, sortNodes, truncationNotice, type GraphData } from "./model";

// cytoscape is large and only needed where a graph is shown.
const GraphCanvas = lazy(() => import("./GraphCanvas"));

export interface GraphViewProps {
  data: GraphData | undefined;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  /** Called with an address when the analyst opens a node; defaults to the asset page. */
  onOpenNode?: (ip: string) => void;
}

function GraphSkeleton() {
  return (
    <div role="status" aria-label="Loading graph">
      <Skeleton className="h-[360px]" />
    </div>
  );
}

function Legend() {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-fg-2" aria-label="Legend">
      <li className="flex items-center gap-1.5">
        <span aria-hidden className="h-3 w-3 rounded-full bg-accent" /> Address under investigation
      </li>
      <li className="flex items-center gap-1.5">
        <span aria-hidden className="h-3 w-3 rounded-full border-[1.5px] border-[color:rgb(var(--text-3))] bg-surface-3" /> Internal address
      </li>
      <li className="flex items-center gap-1.5">
        <span aria-hidden className="h-3 w-3 rounded-[3px] border-[1.5px] border-[color:rgb(var(--text-3))] bg-surface-3" /> External address
      </li>
      <li className="flex items-center gap-1.5">
        <span aria-hidden className="h-3 w-3 rotate-45 border-[3px] border-sev-high bg-surface-1" /> Diamond with a coloured ring: at least one alert (severity in the list)
      </li>
      <li className="flex items-center gap-1.5">
        <span aria-hidden className="h-0 w-5 border-t-[3px] border-[color:rgb(var(--text-3))]" /> Line width: flows between the two addresses
      </li>
    </ul>
  );
}

/** The keyboard- and screen-reader-friendly view of the same data: every address is a link. */
export function GraphList({ data, onOpenNode }: { data: GraphData; onOpenNode?: (ip: string) => void }) {
  const nodes = sortNodes(data.nodes);
  const edgesOf = (ip: string) => data.edges.filter((e) => e.source === ip || e.target === ip).length;
  return (
    <div role="region" aria-label="Addresses in the graph" tabIndex={0} className="overflow-x-auto rounded-md border">
      <table className="w-full text-small">
        <caption className="sr-only">Addresses in the graph, the address under investigation first, then busiest first</caption>
        <thead className="text-left text-caption uppercase tracking-[0.04em] text-fg-3">
          <tr className="border-b border-subtle">
            {["Address", "Scope", "Flows in view", "Connections", "Alerts", "Last seen"].map((h) => (
              <th key={h} scope="col" className="px-4 py-2.5 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {nodes.map((n) => (
            <tr key={n.id} className="border-b border-subtle last:border-0">
              <th scope="row" className="px-4 py-row text-left font-normal">
                {onOpenNode ? (
                  <button type="button" className="font-mono text-accent-fg underline-offset-2 hover:underline" onClick={() => onOpenNode(n.id)}>
                    {n.id}
                  </button>
                ) : (
                  <Link to={`/assets/${encodeURIComponent(n.id)}`} className="font-mono text-accent-fg underline-offset-2 hover:underline">
                    {n.id}
                  </Link>
                )}
                {n.seed && <span className="ml-2 rounded-sm bg-accent-soft px-1.5 py-0.5 text-caption text-accent-fg">under investigation</span>}
              </th>
              <td className="px-4 py-row text-fg-2">{n.scope}</td>
              <td className="tnum px-4 py-row text-fg-2">{formatExact(n.flows)}</td>
              <td className="tnum px-4 py-row text-fg-2">{edgesOf(n.id)}</td>
              <td className="px-4 py-row">
                {n.alerts ? (
                  <span className="flex flex-wrap items-center gap-2">
                    <SeverityBadge severity={n.alerts.maxSeverity} />
                    <span className="tnum text-fg-2">{n.alerts.count}</span>
                  </span>
                ) : (
                  <span className="text-fg-3">none</span>
                )}
              </td>
              <td className="whitespace-nowrap px-4 py-row text-fg-3" title={utcTitle(n.lastSeen)}>
                {formatDateTime(n.lastSeen)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <details className="border-t border-subtle px-4 py-3 text-small">
        <summary className="cursor-pointer text-fg-2">Connections ({data.edges.length})</summary>
        <ul className="mt-2 space-y-1 font-mono text-caption text-fg-2">
          {data.edges.map((e) => (
            <li key={edgeId(e)}>
              {e.source} → {e.target} · {formatExact(e.flows)} flows
              {e.maliciousFlows > 0 && ` · ${formatExact(e.maliciousFlows)} flagged by the model`}
              {e.alerts && ` · ${e.alerts.count} alert(s), worst ${e.alerts.maxSeverity.toUpperCase()}`}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

/**
 * Entity graph with a list alternative. Presentational: the page owns the query, the range and the depth.
 * It only draws what the API returned and says when the API cut the neighbourhood short.
 */
export function GraphView({ data, isLoading, error, onRetry, onOpenNode }: GraphViewProps) {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"graph" | "list">("graph");
  const open = onOpenNode ?? ((ip: string) => navigate(`/assets/${encodeURIComponent(ip)}`));

  if (isLoading) return <GraphSkeleton />;
  if (error) return <ErrorState error={error} title="Couldn’t load the graph" onRetry={onRetry} />;
  if (!data) return null;
  if (data.edges.length === 0) {
    return (
      <EmptyState
        icon={<Network className="h-7 w-7" strokeWidth={1.75} />}
        title="No traffic between these addresses in this range"
        description="The graph is built from stored flows. Widen the time range or import more data."
      />
    );
  }
  const notice = truncationNotice(data);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-small text-fg-2">{describeGraph(data)}</p>
        <div role="group" aria-label="Graph view" className="flex rounded-md border p-0.5">
          {(["graph", "list"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              className={cn("flex h-8 items-center gap-1.5 rounded-sm px-2.5 text-small", mode === m ? "bg-surface-3 text-fg-1" : "text-fg-2 hover:text-fg-1")}
            >
              {m === "graph" ? <Network aria-hidden className="h-4 w-4" /> : <List aria-hidden className="h-4 w-4" />}
              {m === "graph" ? "Graph" : "List"}
            </button>
          ))}
        </div>
      </div>
      {notice && (
        <p role="note" className="flex items-start gap-2 rounded-md border border-dashed px-3 py-2 text-small text-fg-1">
          <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-sevfg-medium" /> {notice}
        </p>
      )}
      {mode === "graph" ? (
        <Suspense fallback={<GraphSkeleton />}>
          <GraphCanvas data={data} onOpenNode={open} />
        </Suspense>
      ) : (
        <GraphList data={data} onOpenNode={onOpenNode} />
      )}
      <Legend />
    </div>
  );
}
