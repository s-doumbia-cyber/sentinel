import { AlertCircle, AlertTriangle, CheckCircle2, CircleDot, Clock, Info, ShieldAlert, type LucideIcon } from "lucide-react";
import { MITRE_BY_CLASS, type AttackClass, type Severity, type SourceKind } from "@sentinel/shared";
import { cn } from "@/lib/format";
import type { Flow } from "@/lib/types";

const base = "inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-caption font-medium whitespace-nowrap";

const SEVERITY: Record<Severity, { icon: LucideIcon; label: string; cls: string }> = {
  critical: { icon: ShieldAlert, label: "CRITICAL", cls: "bg-sev-critical/15 text-sevfg-critical" },
  high: { icon: AlertTriangle, label: "HIGH", cls: "bg-sev-high/15 text-sevfg-high" },
  medium: { icon: AlertCircle, label: "MEDIUM", cls: "bg-sev-medium/15 text-sevfg-medium" },
  low: { icon: Info, label: "LOW", cls: "bg-sev-low/15 text-sevfg-low" },
  info: { icon: CircleDot, label: "INFO", cls: "bg-sev-info/15 text-sevfg-info" },
};

/** Severity is never colour alone: icon + label + colour (§2.4). */
export function SeverityBadge({ severity }: { severity: Severity }) {
  const s = SEVERITY[severity];
  const Icon = s.icon;
  return (
    <span className={cn(base, "uppercase tracking-[0.04em]", s.cls)}>
      <Icon aria-hidden className="h-3.5 w-3.5" strokeWidth={1.75} />
      {s.label}
    </span>
  );
}

const KIND: Record<SourceKind, { label: string; cls: string; title: string }> = {
  LIVE: { label: "LIVE", cls: "bg-kind-live/15 text-sevfg-ok", title: "Captured live by a collector" },
  REPLAY: { label: "REPLAY", cls: "bg-kind-replay/15 text-sevfg-low", title: "Replayed data, not live traffic" },
  IMPORTED: { label: "IMPORTED", cls: "bg-kind-imported/15 text-sevfg-info", title: "Imported from a file" },
  DEMO: { label: "DEMO", cls: "border border-dashed border-kind-demo/70 text-sevfg-medium", title: "Demonstration data" },
};

/** Provenance is shown wherever data is shown (CLAUDE.md §3.1). */
export function SourceKindBadge({ kind }: { kind: SourceKind }) {
  const k = KIND[kind];
  return (
    <span className={cn(base, "tracking-[0.04em]", k.cls)} title={k.title}>
      {kind === "LIVE" && <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-kind-live" />}
      {k.label}
    </span>
  );
}

/** The model's verdict. Distinct from the dataset label, which is shown separately. */
export function VerdictBadge({ flow }: { flow: Pick<Flow, "scoreStatus" | "scored" | "scoreError"> }) {
  if (flow.scoreStatus === "pending") {
    return (
      <span className={cn(base, "bg-surface-3 text-fg-2")} title="No active model has scored this flow yet">
        <Clock aria-hidden className="h-3.5 w-3.5" /> Not scored
      </span>
    );
  }
  if (flow.scoreStatus === "error" || !flow.scored) {
    return (
      <span className={cn(base, "bg-sev-high/15 text-sevfg-high")} title={flow.scoreError ?? "Scoring failed"}>
        <AlertTriangle aria-hidden className="h-3.5 w-3.5" /> Scoring error
      </span>
    );
  }
  const malicious = flow.scored.label !== "Normal";
  return (
    <span className={cn(base, malicious ? "bg-accent-soft text-accent-fg" : "bg-sev-ok/15 text-sevfg-ok")}>
      {malicious ? <ShieldAlert aria-hidden className="h-3.5 w-3.5" /> : <CheckCircle2 aria-hidden className="h-3.5 w-3.5" />}
      {flow.scored.label}
      {flow.scored.needsReview && <span className="font-normal opacity-80">· review</span>}
    </span>
  );
}

export function NeutralBadge({ children, className, title }: { children: React.ReactNode; className?: string; title?: string }) {
  return (
    <span className={cn(base, "bg-surface-3 text-fg-2", className)} title={title}>
      {children}
    </span>
  );
}

/** MITRE mapping, always flagged as suggested. */
export function MitreChip({ cls }: { cls: AttackClass }) {
  const m = MITRE_BY_CLASS[cls];
  if (!m) return null;
  const tactics = m.tactics.map((t) => `${t.id} ${t.name}`).join(", ");
  return (
    <span className={cn(base, "border border-subtle bg-surface-2 text-fg-2")} title={`Tactics: ${tactics}${m.note ? `. ${m.note}` : ""}`}>
      <span className="font-mono">{m.techniqueId ?? m.tactics.map((t) => t.id).join("/")}</span>
      {m.techniqueName && <span>{m.techniqueName}</span>}
      <span className="text-fg-3">· suggested</span>
    </span>
  );
}

export function ConfidenceMeter({ value, needsReview }: { value: number; needsReview?: boolean }) {
  const pct = Math.round(value * 100);
  return (
    <span className="inline-flex items-center gap-2" title={`Model confidence ${pct}%${needsReview ? " (below the review threshold)" : ""}`}>
      <span
        className="relative h-1.5 w-14 overflow-hidden rounded-full bg-surface-3"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label="Model confidence"
      >
        <span className={cn("absolute inset-y-0 left-0 rounded-full", needsReview ? "bg-sev-medium" : "bg-accent")} style={{ width: `${pct}%` }} />
      </span>
      <span className="tnum text-caption text-fg-2">{pct}%</span>
    </span>
  );
}
