import { useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { GlassCard } from "@/components/ui/GlassCard";
import { KpiCard } from "@/components/ui/KpiCard";
import { AttackTrendChart } from "@/components/charts/AttackTrendChart";
import { AttackTypeDonut } from "@/components/charts/AttackTypeDonut";
import { SeverityBadge } from "@/components/ui/SeverityBadge";
import { GlowButton } from "@/components/ui/GlowButton";
import { ErrorBlock } from "@/components/ui/AsyncStates";
import { Skeleton, SkeletonChartCard, SkeletonKpiGrid } from "@/components/ui/Skeleton";
import { Download, BrainCircuit, CalendarRange } from "lucide-react";
import { useAsyncData } from "@/hooks/useAsyncData";
import { flowsApi, mlApi, buildKpiCards, transformTimeline } from "@/services/flows";
import { Link } from "react-router-dom";

function downloadSnapshot(kpiCards: ReturnType<typeof buildKpiCards>, breakdown: { name: string; value: number }[]) {
  const snapshot = {
    generatedAt: new Date().toISOString(),
    kpis: Object.fromEntries(kpiCards.map((k) => [k.id, k.value])),
    attackBreakdown: breakdown,
  };
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `sentinel-snapshot-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function Dashboard() {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const dateFilter = { from: dateFrom || undefined, to: dateTo || undefined };
  const hasDateFilter = Boolean(dateFrom || dateTo);

  const { data, loading, error } = useAsyncData(
    async () => {
      const [kpis, timelineRaw, breakdown, recent] = await Promise.all([
        flowsApi.kpis(dateFilter),
        flowsApi.timeline(dateFilter),
        flowsApi.attackBreakdown(dateFilter),
        flowsApi.list({ page: 1, limit: 6, sortBy: "timestamp", sortDir: "desc", onlyAttacks: true, ...dateFilter }),
      ]);
      const timeline = transformTimeline(timelineRaw);
      return {
        kpiCards: buildKpiCards(kpis, timeline),
        timeline,
        breakdown: breakdown.slice(0, 7),
        recentFlows: recent.rows,
      };
    },
    [dateFrom, dateTo],
    `dashboard:${dateFrom}:${dateTo}`
  );

  // Best-effort — the widget just doesn't render if no model has been trained yet.
  const { data: mlMetrics } = useAsyncData(() => mlApi.metrics(), [], "ml-metrics");

  return (
    <div>
      <PageHeader
        title="Threat Overview"
        subtitle="Live snapshot computed directly from MongoDB — real imported dataset"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/[0.04] border border-white/[0.08]">
              <CalendarRange className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="bg-transparent text-xs text-slate-300 focus:outline-none w-[110px]"
              />
              <span className="text-slate-600 text-xs">–</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="bg-transparent text-xs text-slate-300 focus:outline-none w-[110px]"
              />
              {hasDateFilter && (
                <button
                  onClick={() => {
                    setDateFrom("");
                    setDateTo("");
                  }}
                  className="focus-ring text-slate-500 hover:text-white text-xs ml-1"
                >
                  ✕
                </button>
              )}
            </div>
            <GlowButton variant="ghost" disabled={!data} onClick={() => data && downloadSnapshot(data.kpiCards, data.breakdown)}>
              <Download className="w-4 h-4" /> Export snapshot
            </GlowButton>
          </div>
        }
      />

      {loading && (
        <div className="space-y-5">
          <SkeletonKpiGrid />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div className="lg:col-span-2">
              <SkeletonChartCard />
            </div>
            <SkeletonChartCard />
          </div>
          <div className="glass-panel p-5">
            <Skeleton className="h-4 w-40 mb-3" />
            <Skeleton className="h-10 w-full mb-2" />
            <Skeleton className="h-10 w-full mb-2" />
            <Skeleton className="h-10 w-full" />
          </div>
        </div>
      )}
      {error && <ErrorBlock message={error} />}

      {data && (
        <>
          {hasDateFilter && data.kpiCards[0]?.value === 0 && (
            <p className="text-xs text-slate-500 mb-3">No flows fall within this date range — try widening it.</p>
          )}

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {data.kpiCards.map((kpi, i) => (
              <KpiCard key={kpi.id} kpi={kpi} delay={i * 0.04} />
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-6">
            <GlassCard className="lg:col-span-2" delay={0.1}>
              <p className="text-sm font-semibold text-slate-200 mb-1">Attack vs Normal Traffic</p>
              <p className="text-xs text-slate-500 mb-2">Real daily volume from the imported dataset</p>
              {data.timeline.length > 0 ? (
                <AttackTrendChart data={data.timeline} />
              ) : (
                <p className="text-sm text-slate-500 py-16 text-center">No timestamped data in range yet.</p>
              )}
            </GlassCard>

            <GlassCard delay={0.15}>
              <p className="text-sm font-semibold text-slate-200 mb-1">Attack Type Distribution</p>
              <p className="text-xs text-slate-500 mb-2">Share of total detected attacks</p>
              {data.breakdown.length > 0 ? (
                <AttackTypeDonut data={data.breakdown} />
              ) : (
                <p className="text-sm text-slate-500 py-16 text-center">No attacks found in this dataset.</p>
              )}
            </GlassCard>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <GlassCard delay={0.2} className="lg:col-span-2">
              <p className="text-sm font-semibold text-slate-200 mb-3">Latest Detected Attacks</p>
              <div className="space-y-2">
                {data.recentFlows.map((f) => (
                  <div
                    key={f.id}
                    className="flex items-center justify-between gap-3 py-2.5 px-3 rounded-xl bg-white/[0.02] border border-white/[0.05] hover:border-white/[0.12] transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="text-sm text-slate-200 font-medium truncate">{f.label}</p>
                      <p className="text-xs text-slate-500 font-mono truncate">
                        {f.sourceIp} → {f.destinationIp}:{f.destinationPort}
                      </p>
                    </div>
                    <SeverityBadge severity={f.severity} />
                  </div>
                ))}
                {data.recentFlows.length === 0 && (
                  <p className="text-sm text-slate-500 py-6 text-center">No recent attacks in the current dataset.</p>
                )}
              </div>
            </GlassCard>

            <GlassCard delay={0.25}>
              <div className="flex items-center gap-2 mb-1">
                <BrainCircuit className="w-4 h-4 text-neon-cyan" />
                <p className="text-sm font-semibold text-slate-200">Model Performance</p>
              </div>
              {mlMetrics ? (
                <>
                  <p className="text-xs text-slate-500 mb-4">Best model: {mlMetrics.bestModel}</p>
                  <p className="text-4xl font-display font-bold neon-text-cyan tabular-nums mb-1">
                    {(mlMetrics.modelsCompared[mlMetrics.bestModel].f1 * 100).toFixed(1)}%
                  </p>
                  <p className="text-xs text-slate-500 mb-4">F1 score across {mlMetrics.classes.length} attack classes</p>
                  <Link to="/machine-learning" className="text-xs text-neon-violetStrong hover:underline">
                    View full comparison →
                  </Link>
                </>
              ) : (
                <>
                  <p className="text-xs text-slate-500 mb-3">No model trained yet.</p>
                  <Link to="/machine-learning" className="text-xs text-neon-violetStrong hover:underline">
                    See setup instructions →
                  </Link>
                </>
              )}
            </GlassCard>
          </div>
        </>
      )}
    </div>
  );
}
