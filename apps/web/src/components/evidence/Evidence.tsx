import { Eye, FileCheck2, HelpCircle, Lightbulb, Lock, ShieldQuestion, type LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { IDENTITY_SOURCE_LABEL } from "@sentinel/shared";
import { NeutralBadge } from "@/components/ui/Badges";
import { cn, formatDateTime, utcTitle } from "@/lib/format";
import type { Attribution, Statement } from "@/lib/types";

function StatementList({ icon: Icon, title, hint, items, tone }: { icon: LucideIcon; title: string; hint: string; items: Statement[]; tone: "observed" | "inferred" | "unknown" }) {
  return (
    <section aria-label={title} className={cn("rounded-md border p-3", tone === "observed" ? "border-subtle bg-surface-1" : tone === "inferred" ? "border-subtle bg-surface-2" : "border-dashed bg-transparent")}>
      <h4 className="flex items-center gap-1.5 text-small font-semibold text-fg-1">
        <Icon aria-hidden className="h-4 w-4 text-fg-2" strokeWidth={1.75} /> {title}
      </h4>
      <p className="mb-2 text-caption text-fg-3">{hint}</p>
      {items.length ? (
        <ul className="space-y-2">
          {items.map((s, i) => (
            <li key={i} className="text-small text-fg-1">
              {s.text}
              {s.basis && <span className="mt-0.5 block text-caption text-fg-3">Basis: {s.basis}</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-small text-fg-3">Nothing to list.</p>
      )}
    </section>
  );
}

/** Observations, inferences and unknowns are never mixed (axis 1). */
export function AnalysisPanel({ analysis }: { analysis: { observed: Statement[]; inferred: Statement[]; unknown: Statement[] } }) {
  return (
    <div className="grid gap-3">
      <StatementList icon={Eye} title="Observed" hint="Present in the stored data, with its source." items={analysis.observed} tone="observed" />
      <StatementList icon={Lightbulb} title="Inferred" hint="Produced by a model, a rule or a heuristic. It can be wrong." items={analysis.inferred} tone="inferred" />
      <StatementList icon={HelpCircle} title="Unknown" hint="Not answerable from the available data." items={analysis.unknown} tone="unknown" />
    </div>
  );
}

const CONFIDENCE_STYLE: Record<string, string> = {
  high: "bg-accent-soft text-accent-fg",
  medium: "bg-surface-3 text-fg-1",
  low: "border border-dashed text-fg-2",
};

/** Who or what held an address, only from imported identity records, always with caveats (axis 2). */
export function AttributionPanel({ attribution, restricted, ip }: { attribution: Attribution | null; restricted: boolean; ip: string | null }) {
  if (!ip) return <p className="text-small text-fg-3">No single source address: attribution does not apply.</p>;
  if (restricted || !attribution) {
    return (
      <p className="flex items-start gap-2 text-small text-fg-2">
        <Lock aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-fg-3" /> Identity data (account and device names) is personal data and is restricted to Analysts and above.
      </p>
    );
  }
  return (
    <div className="space-y-3 text-small">
      <p className="text-fg-2">
        Observed address <span className="font-mono text-fg-1">{attribution.ip}</span> ({attribution.scope}) between{" "}
        <span title={utcTitle(attribution.window.from)}>{formatDateTime(attribution.window.from)}</span> and{" "}
        <span title={utcTitle(attribution.window.to)}>{formatDateTime(attribution.window.to)}</span>.
      </p>
      {attribution.candidates.length ? (
        <ul className="space-y-2">
          {attribution.candidates.map((c, i) => (
            <li key={i} className="rounded-md border border-subtle p-3">
              <p className="flex flex-wrap items-center gap-2 font-medium text-fg-1">
                {c.username ?? c.hostname ?? c.mac}
                {c.username && c.hostname && <span className="font-normal text-fg-2">on {c.hostname}</span>}
                <NeutralBadge className={CONFIDENCE_STYLE[c.confidence]}>{c.confidence} confidence</NeutralBadge>
                <Link to={`/identity?lookup=${encodeURIComponent(c.username ?? c.hostname ?? c.mac ?? "")}`} className="ml-auto text-caption font-normal text-accent-fg underline underline-offset-2">
                  Other addresses it held
                </Link>
              </p>
              <p className="mt-1 text-caption text-fg-3">
                {IDENTITY_SOURCE_LABEL[c.source]} · valid {formatDateTime(c.validFrom)}
                {c.validTo ? ` → ${formatDateTime(c.validTo)}` : " (single event)"}
              </p>
              <ul className="mt-1 list-disc pl-5 text-caption text-fg-2">
                {c.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-md border border-dashed p-3">
          <p className="flex items-center gap-1.5 font-medium text-fg-1">
            <ShieldQuestion aria-hidden className="h-4 w-4 text-fg-2" /> Unknown
          </p>
          <p className="mt-1 text-fg-2">
            No identity record covers this address and time.{" "}
            {attribution.connectedSources.length ? `Connected sources: ${attribution.connectedSources.map((s) => s.label).join(", ")}.` : "No identity source is connected."}
          </p>
          {attribution.help.length > 0 && (
            <>
              <p className="mt-2 text-caption font-medium text-fg-2">What would help:</p>
              <ul className="list-disc pl-5 text-caption text-fg-2">
                {attribution.help.map((h) => (
                  <li key={h}>{h}</li>
                ))}
              </ul>
              <Link to="/identity" className="mt-2 inline-block text-caption text-accent-fg hover:underline">
                Import identity records
              </Link>
            </>
          )}
        </div>
      )}
      {attribution.ambiguous && <p className="rounded-md bg-surface-2 px-3 py-2 text-fg-1">Several identities held this address in the window: shared host, NAT or VPN concentrator. Do not pick one.</p>}
      <ul className="space-y-0.5 text-caption text-fg-3">
        {attribution.caveats.map((c) => (
          <li key={c}>• {c}</li>
        ))}
      </ul>
    </div>
  );
}

export function ProvenancePanel({ provenance }: { provenance: { datasets: { id: string; name: string; sha256: string | null; sourceKind: string; importedAt: string | null; importedBy: string | null }[]; models: string[]; rules: { key: string; version: number }[]; createdAt: string } }) {
  return (
    <ul className="space-y-2 text-small">
      {provenance.datasets.map((d) => (
        <li key={d.id} className="flex items-start gap-2">
          <FileCheck2 aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-fg-3" />
          <span>
            <span className="text-fg-1">{d.name}</span> <NeutralBadge>{d.sourceKind}</NeutralBadge>
            <span className="block text-caption text-fg-3">
              imported {d.importedAt ? formatDateTime(d.importedAt) : "at an unknown time"} by {d.importedBy ?? "the CLI"} · sha256{" "}
              <span className="font-mono">{d.sha256 ? `${d.sha256.slice(0, 16)}…` : "not recorded"}</span>
            </span>
          </span>
        </li>
      ))}
      {provenance.models.length > 0 && <li className="text-fg-2">Model versions: <span className="font-mono">{provenance.models.join(", ")}</span></li>}
      {provenance.rules.length > 0 && <li className="text-fg-2">Rules: <span className="font-mono">{provenance.rules.map((r) => `${r.key} v${r.version}`).join(", ")}</span></li>}
      <li className="text-caption text-fg-3">Alert created by Sentinel {formatDateTime(provenance.createdAt)}</li>
    </ul>
  );
}

export function AssetLink({ ip, className }: { ip: string; className?: string }) {
  return (
    <Link to={`/assets/${encodeURIComponent(ip)}`} className={cn("font-mono text-fg-1 underline decoration-[color:var(--border-strong)] underline-offset-2 hover:text-accent-fg", className)}>
      {ip}
    </Link>
  );
}
