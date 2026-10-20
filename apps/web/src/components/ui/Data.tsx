import { Check, Copy } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { cn, formatCount, formatExact } from "@/lib/format";
import type { TopFeature } from "@/lib/types";
import { Skeleton } from "./States";

/** Monospace IP / identifier with a copy button; `href` links the value (e.g. to the asset page). */
export function EntityChip({ value, href, className }: { value: string; href?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className={cn("group inline-flex items-center gap-1 font-mono text-small text-fg-1", className)}>
      {href ? (
        <Link to={href} className="underline decoration-[color:var(--border-strong)] underline-offset-2 hover:text-accent-fg">
          {value}
        </Link>
      ) : (
        value
      )}
      <button
        type="button"
        aria-label={`Copy ${value}`}
        className="rounded p-0.5 text-fg-3 opacity-60 hover:text-fg-1 group-hover:opacity-100 focus-visible:opacity-100"
        onClick={(e) => {
          e.stopPropagation();
          void navigator.clipboard?.writeText(value).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1200);
          });
        }}
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </span>
  );
}

/** KPI card; the whole card links to the list that produced the number (§F8). */
export function KpiCard({
  label,
  value,
  hint,
  to,
  loading,
  tone = "default",
}: {
  label: string;
  value: number | null | undefined;
  hint?: ReactNode;
  to?: string;
  loading?: boolean;
  tone?: "default" | "alert";
}) {
  const body = (
    <>
      <p className="text-caption font-medium uppercase tracking-[0.04em] text-fg-3">{label}</p>
      {loading ? (
        <Skeleton className="mt-2 h-8 w-24" />
      ) : (
        <p className={cn("tnum mt-1 text-kpi font-semibold tracking-[-0.01em]", tone === "alert" && value ? "text-accent-fg" : "text-fg-1")} title={formatExact(value)}>
          {formatCount(value)}
        </p>
      )}
      {hint && <p className="mt-1 text-small text-fg-3">{hint}</p>}
    </>
  );
  const cls = "block rounded-lg border bg-surface-1 p-4 shadow-e1 transition-colors duration-fast";
  return to ? (
    <Link to={to} className={cn(cls, "hover:border-strong hover:bg-surface-2")}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/**
 * Diverging bars: positive contributions push towards the predicted class,
 * negative ones away from it. Values are in the model's output space.
 */
export function FeatureContributionChart({ features, space }: { features: TopFeature[]; space?: string }) {
  if (!features.length) {
    return <p className="text-small text-fg-3">No explanation was computed for this verdict (only non-benign or low-confidence verdicts are explained).</p>;
  }
  const max = Math.max(...features.map((f) => Math.abs(f.contribution)), 1e-9);
  return (
    <figure>
      <ul className="space-y-2">
        {features.map((f) => {
          const pct = (Math.abs(f.contribution) / max) * 50;
          const positive = f.contribution >= 0;
          return (
            <li key={f.name} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] items-center gap-3">
              <div className="min-w-0">
                <p className="truncate text-small text-fg-1" title={f.name}>
                  {f.name}
                </p>
                <p className="tnum text-caption text-fg-3">value {f.value === null ? "missing (imputed)" : formatExact(f.value)}</p>
              </div>
              <div className="relative h-5" aria-hidden>
                <span className="absolute inset-y-0 left-1/2 w-px" style={{ backgroundColor: "var(--border-strong)" }} />
                <span
                  className={cn("absolute inset-y-1 rounded-sm", positive ? "bg-accent" : "bg-sev-low")}
                  style={positive ? { left: "50%", width: `${pct}%` } : { right: "50%", width: `${pct}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
      <figcaption className="mt-3 text-caption text-fg-3">
        {features
          .map((f) => `${f.name} ${f.contribution >= 0 ? "increased" : "decreased"} the score by ${Math.abs(f.contribution).toFixed(3)}`)
          .join("; ")}
        . Contributions{space ? ` (${space})` : ""} describe the model’s behaviour, not the cause of an attack.
      </figcaption>
    </figure>
  );
}

export function DefinitionList({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-6 gap-y-2 text-small">
      {items.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-fg-3">{k}</dt>
          <dd className="min-w-0 break-words text-fg-1">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
