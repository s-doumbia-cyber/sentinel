import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import i18n from "@/i18n";
import { cn, formatCount, formatExact } from "@/lib/format";
import type { Timeseries } from "@/lib/types";

const axis = { stroke: "rgb(var(--text-3))", fontSize: 12 };

function bucketLabel(iso: string, interval: Timeseries["interval"]) {
  const d = new Date(iso);
  const locale = i18n.language === "fr" ? "fr-FR" : undefined;
  return interval === "day"
    ? d.toLocaleDateString(locale, { month: "short", day: "numeric", timeZone: "UTC" })
    : d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
}

/** Text summary for screen readers and for anyone skimming (§6). */
export function timeseriesSummary(ts: Timeseries): string {
  if (!ts.buckets.length) return i18n.t("chart.empty");
  const peak = ts.buckets.reduce((a, b) => (b.malicious > a.malicious ? b : a));
  const total = ts.buckets.reduce((a, b) => a + b.total, 0);
  const malicious = ts.buckets.reduce((a, b) => a + b.malicious, 0);
  return peak.malicious
    ? i18n.t("chart.summaryPeak", { total: formatExact(total), malicious: formatExact(malicious), peak: formatExact(peak.malicious), at: bucketLabel(peak.bucket, ts.interval) })
    : i18n.t("chart.summaryNone", { total: formatExact(total) });
}

export function FlowVolumeChart({ data }: { data: Timeseries }) {
  const { t } = useTranslation();
  const rows = data.buckets.map((b) => ({ t: bucketLabel(b.bucket, data.interval), malicious: b.malicious, other: b.total - b.malicious }));
  return (
    <figure>
      <div className="h-64" aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
            <CartesianGrid stroke="var(--border-subtle)" vertical={false} />
            <XAxis dataKey="t" tick={axis} tickLine={false} axisLine={false} minTickGap={24} />
            <YAxis tick={axis} tickLine={false} axisLine={false} tickFormatter={(v: number) => formatCount(v)} width={48} />
            <Tooltip
              contentStyle={{ background: "rgb(var(--surface-2))", border: "1px solid var(--border)", borderRadius: 8, color: "rgb(var(--text-1))" }}
              formatter={(v: number, name: string) => [formatExact(v), name === "malicious" ? t("chart.maliciousShort") : t("chart.otherShort")]}
            />
            <Area type="monotone" dataKey="other" stackId="1" stroke="rgb(var(--text-3))" fill="rgb(var(--text-3))" fillOpacity={0.15} isAnimationActive={false} />
            <Area type="monotone" dataKey="malicious" stackId="1" stroke="rgb(var(--accent))" fill="rgb(var(--accent))" fillOpacity={0.35} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-fg-3">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-2 w-3 rounded-sm bg-accent" /> {t("chart.malicious")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-2 w-3 rounded-sm bg-fg-3/40" /> {t("chart.other")}
        </span>
        <span className="w-full text-fg-2">{timeseriesSummary(data)}</span>
      </figcaption>
    </figure>
  );
}

/** Horizontal bars (no pies above 6 slices, §6). Each bar can link to its filtered list. */
export function BarList({
  items,
  render,
  emptyText,
  barClass = "bg-accent/60",
}: {
  items: { key: string; count: number; href?: string | undefined }[];
  render?: (key: string) => React.ReactNode;
  emptyText: string;
  barClass?: string;
}) {
  if (!items.length) return <p className="py-6 text-center text-small text-fg-3">{emptyText}</p>;
  const max = Math.max(...items.map((i) => i.count));
  return (
    <ul className="space-y-2">
      {items.map((i) => {
        const content = (
          <>
            <span aria-hidden className={cn("absolute inset-y-0 left-0 rounded-sm", barClass)} style={{ width: `${(i.count / max) * 100}%`, opacity: 0.35 }} />
            <span className="relative min-w-0 truncate text-small text-fg-1">{render ? render(i.key) : i.key}</span>
            <span className="tnum relative text-small text-fg-2" title={formatExact(i.count)}>
              {formatCount(i.count)}
            </span>
          </>
        );
        const cls = "relative flex items-center justify-between gap-3 overflow-hidden rounded-sm px-2 py-1.5";
        return (
          <li key={i.key}>
            {i.href ? (
              <Link to={i.href} className={cn(cls, "hover:bg-surface-3")}>
                {content}
              </Link>
            ) : (
              <div className={cls}>{content}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
