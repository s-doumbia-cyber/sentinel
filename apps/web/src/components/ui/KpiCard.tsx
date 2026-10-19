import { TrendingUp, TrendingDown } from "lucide-react";
import { Area, AreaChart, ResponsiveContainer } from "recharts";
import { GlassCard } from "./GlassCard";
import { useCountUp } from "@/hooks/useCountUp";
import type { KpiDefinition } from "@/types";

const ACCENT_MAP = {
  violet: { stroke: "#A855F7", glow: "shadow-glow" },
  pink: { stroke: "#EC4899", glow: "shadow-glowPink" },
  cyan: { stroke: "#22D3EE", glow: "shadow-glowCyan" },
} as const;

function formatValue(value: number, format: KpiDefinition["format"]): string {
  switch (format) {
    case "percent":
      return `${value.toFixed(1)}%`;
    case "bytes":
      return `${Math.round(value)} B`;
    case "ms":
      return `${Math.round(value)} ms`;
    default:
      return Math.round(value).toLocaleString("en-US");
  }
}

export function KpiCard({ kpi, delay = 0 }: { kpi: KpiDefinition; delay?: number }) {
  const animated = useCountUp(kpi.value);
  const accent = ACCENT_MAP[kpi.accent];
  const isUp = kpi.trend >= 0;

  return (
    <GlassCard delay={delay} className="overflow-hidden">
      <div className="flex items-start justify-between mb-3">
        <p className="text-xs font-medium text-slate-400 tracking-wide uppercase">{kpi.label}</p>
        <span
          className={`flex items-center gap-1 text-xs font-semibold ${
            isUp ? "text-emerald-400" : "text-rose-400"
          }`}
        >
          {isUp ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
          {Math.abs(kpi.trend)}%
        </span>
      </div>

      <p className="text-3xl font-display font-bold text-white mb-3 tabular-nums">
        {formatValue(animated, kpi.format)}
      </p>

      <div className="h-10 -mx-1">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={kpi.sparkline.map((v, i) => ({ i, v }))}>
            <defs>
              <linearGradient id={`spark-${kpi.id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={accent.stroke} stopOpacity={0.5} />
                <stop offset="100%" stopColor={accent.stroke} stopOpacity={0} />
              </linearGradient>
            </defs>
            <Area type="monotone" dataKey="v" stroke={accent.stroke} strokeWidth={2} fill={`url(#spark-${kpi.id})`} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </GlassCard>
  );
}
