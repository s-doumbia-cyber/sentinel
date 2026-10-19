import { PageHeader } from "@/components/ui/PageHeader";
import { GlassCard } from "@/components/ui/GlassCard";
import { AttackTrendChart } from "@/components/charts/AttackTrendChart";
import { TopPortsBar } from "@/components/charts/TopPortsBar";
import { AttackTypeDonut } from "@/components/charts/AttackTypeDonut";
import { FilterDrawer, FilterField, selectClass } from "@/components/ui/FilterDrawer";
import { ErrorBlock } from "@/components/ui/AsyncStates";
import { SkeletonChartCard } from "@/components/ui/Skeleton";
import { ATTACK_TYPES } from "@/data/mockData";
import { useAsyncData } from "@/hooks/useAsyncData";
import { flowsApi, transformTimeline } from "@/services/flows";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const PROTOCOLS = ["TCP", "UDP", "ICMP"];
const SEVERITIES = ["critical", "high", "medium", "low", "info", "safe"];

function AttackTypeBarChart({ data }: { data: { name: string; value: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={320}>
      <BarChart data={data} margin={{ left: -18 }}>
        <defs>
          <linearGradient id="attackBarGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#EC4899" />
            <stop offset="100%" stopColor="#8B5CF6" />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
        <XAxis dataKey="name" tick={{ fill: "#94A3B8", fontSize: 11 }} axisLine={false} tickLine={false} interval={0} angle={-25} textAnchor="end" height={70} />
        <YAxis tick={{ fill: "#64748B", fontSize: 11 }} axisLine={false} tickLine={false} />
        <Tooltip contentStyle={{ background: "rgba(11,15,25,0.92)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, fontSize: 12 }} />
        <Bar dataKey="value" fill="url(#attackBarGrad)" radius={[6, 6, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export default function Analytics() {
  const [attackFilter, setAttackFilter] = useState("All types");
  const [protocolFilter, setProtocolFilter] = useState("All protocols");
  const [severityFilter, setSeverityFilter] = useState("All severities");

  const filters = {
    attackType: attackFilter !== "All types" ? attackFilter : undefined,
    protocol: protocolFilter !== "All protocols" ? protocolFilter : undefined,
    severity: severityFilter !== "All severities" ? severityFilter : undefined,
  };
  const activeFilterCount = Object.values(filters).filter(Boolean).length;

  const { data, loading, error } = useAsyncData(
    async () => {
      const [timelineRaw, topPorts, breakdown] = await Promise.all([
        flowsApi.timeline(filters),
        flowsApi.topPorts(filters),
        flowsApi.attackBreakdown(filters),
      ]);
      return {
        timeline: transformTimeline(timelineRaw),
        topPorts: topPorts.map((p) => ({ port: String(p.port), value: p.value })),
        breakdown,
      };
    },
    [attackFilter, protocolFilter, severityFilter],
    `analytics:${attackFilter}:${protocolFilter}:${severityFilter}`
  );

  return (
    <div>
      <PageHeader
        title="Analytics"
        subtitle="Deep dive into traffic composition, computed live from MongoDB"
        actions={
          <FilterDrawer badge={activeFilterCount || undefined}>
            <FilterField label="Attack Type">
              <select className={selectClass} value={attackFilter} onChange={(e) => setAttackFilter(e.target.value)}>
                <option>All types</option>
                {ATTACK_TYPES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </FilterField>
            <FilterField label="Protocol">
              <select className={selectClass} value={protocolFilter} onChange={(e) => setProtocolFilter(e.target.value)}>
                <option>All protocols</option>
                {PROTOCOLS.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </FilterField>
            <FilterField label="Severity">
              <select className={selectClass} value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)}>
                <option>All severities</option>
                {SEVERITIES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </FilterField>
            {activeFilterCount > 0 && (
              <button
                onClick={() => {
                  setAttackFilter("All types");
                  setProtocolFilter("All protocols");
                  setSeverityFilter("All severities");
                }}
                className="focus-ring w-full mt-2 text-xs text-slate-400 hover:text-white underline underline-offset-2"
              >
                Clear all filters
              </button>
            )}
          </FilterDrawer>
        }
      />

      {loading && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <SkeletonChartCard height={320} />
            <SkeletonChartCard />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <SkeletonChartCard />
            <SkeletonChartCard />
          </div>
        </div>
      )}
      {error && <ErrorBlock message={error} />}

      {data && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
            <GlassCard>
              <p className="text-sm font-semibold text-slate-200 mb-1">Attacks by Category</p>
              <p className="text-xs text-slate-500 mb-2">Volume per attack signature</p>
              {data.breakdown.length > 0 ? (
                <AttackTypeBarChart data={data.breakdown} />
              ) : (
                <p className="text-sm text-slate-500 py-16 text-center">No attacks match these filters.</p>
              )}
            </GlassCard>
            <GlassCard delay={0.05}>
              <p className="text-sm font-semibold text-slate-200 mb-1">Traffic Timeline</p>
              <p className="text-xs text-slate-500 mb-2">Attack vs normal flow volume</p>
              <AttackTrendChart data={data.timeline} />
            </GlassCard>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <GlassCard delay={0.1}>
              <p className="text-sm font-semibold text-slate-200 mb-1">Top Targeted Ports</p>
              <p className="text-xs text-slate-500 mb-2">Destination ports most associated with attacks</p>
              <TopPortsBar data={data.topPorts} />
            </GlassCard>
            <GlassCard delay={0.15}>
              <p className="text-sm font-semibold text-slate-200 mb-1">Category Share</p>
              <p className="text-xs text-slate-500 mb-2">Proportional breakdown</p>
              {data.breakdown.length > 0 ? (
                <AttackTypeDonut data={data.breakdown.slice(0, 6)} />
              ) : (
                <p className="text-sm text-slate-500 py-16 text-center">No attacks match these filters.</p>
              )}
            </GlassCard>
          </div>
        </>
      )}
    </div>
  );
}
