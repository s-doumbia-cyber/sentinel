import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Select } from "@/components/ui/Form";
import { useAuth } from "@/features/auth/AuthContext";
import { api } from "@/lib/api";
import { GraphView } from "./GraphView";
import type { GraphData } from "./model";

const WINDOWS = { all: { label: "All stored flows", ms: null }, "24h": { label: "Last 24 hours of its activity", ms: 86_400_000 }, "1h": { label: "Last hour of its activity", ms: 3_600_000 } } as const;
type WindowKey = keyof typeof WINDOWS;

function useGraph(path: string, query: Record<string, string | number | undefined>) {
  const org = useAuth().activeOrg?.id ?? "none";
  return useQuery({ queryKey: [org, "graph", path, query], queryFn: () => api<GraphData>(path, { query }) });
}

function DepthSelect({ value, onChange }: { value: 1 | 2; onChange: (d: 1 | 2) => void }) {
  return (
    <label className="min-w-0 text-caption text-fg-3">
      Reach
      <Select className="mt-1 w-full sm:w-56" value={value} onChange={(e) => onChange(e.target.value === "2" ? 2 : 1)}>
        <option value="1">Direct peers</option>
        <option value="2">Peers of the busiest peers</option>
      </Select>
    </label>
  );
}

/** Asset page: the address and who it talked to. Range and reach live in the URL so a link reproduces the view. */
export function EntityGraphCard({ ip, lastSeen }: { ip: string; lastSeen: string }) {
  const [params, setParams] = useSearchParams();
  const win = (Object.keys(WINDOWS) as WindowKey[]).find((k) => k === params.get("graphRange")) ?? "all";
  const depth = params.get("graphDepth") === "2" ? 2 : 1;
  const range = useMemo(() => {
    const ms = WINDOWS[win].ms;
    return ms === null ? {} : { from: new Date(new Date(lastSeen).getTime() - ms).toISOString(), to: new Date(lastSeen).toISOString() };
  }, [win, lastSeen]);
  const graph = useGraph(`/entities/ip/${encodeURIComponent(ip)}/graph`, { depth, ...range });
  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };
  return (
    <Card className="lg:col-span-2">
      <CardHeader
        title="Connections"
        subtitle="Who this address exchanged flows with, from stored flows. Line width is the flow count; alert markers come from this organisation’s alerts."
      />
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-0 text-caption text-fg-3">
            Time range
            <Select className="mt-1 w-full sm:w-56" value={win} onChange={(e) => set("graphRange", e.target.value === "all" ? null : e.target.value)}>
              {(Object.keys(WINDOWS) as WindowKey[]).map((k) => (
                <option key={k} value={k}>
                  {WINDOWS[k].label}
                </option>
              ))}
            </Select>
          </label>
          <DepthSelect value={depth} onChange={(d) => set("graphDepth", d === 1 ? null : "2")} />
        </div>
        <GraphView data={graph.data} isLoading={graph.isLoading} error={graph.error} onRetry={() => void graph.refetch()} />
      </CardBody>
    </Card>
  );
}

/** Incident page: every address on the incident, over the incident's own activity window. */
export function IncidentGraphCard({ id }: { id: string }) {
  const [params, setParams] = useSearchParams();
  const depth = params.get("graphDepth") === "2" ? 2 : 1;
  const graph = useGraph(`/incidents/${id}/graph`, { depth });
  return (
    <Card>
      <CardHeader
        title="Entities and connections"
        subtitle="The addresses on this incident and the traffic between them and their peers, over the incident’s activity window."
      />
      <CardBody className="space-y-4">
        <DepthSelect
          value={depth}
          onChange={(d) => {
            const next = new URLSearchParams(params);
            if (d === 1) next.delete("graphDepth");
            else next.set("graphDepth", "2");
            setParams(next, { replace: true });
          }}
        />
        <GraphView data={graph.data} isLoading={graph.isLoading} error={graph.error} onRetry={() => void graph.refetch()} />
      </CardBody>
    </Card>
  );
}
