import { CheckCircle2, XCircle } from "lucide-react";
import { Link } from "react-router-dom";
import type { AttackClass } from "@sentinel/shared";
import { ConfidenceMeter, MitreChip, SeverityBadge, SourceKindBadge, VerdictBadge } from "@/components/ui/Badges";
import { DefinitionList, EntityChip, FeatureContributionChart } from "@/components/ui/Data";
import { Drawer } from "@/components/ui/Overlays";
import { ErrorState, Skeleton } from "@/components/ui/States";
import { formatBytes, formatDateTime, formatExact, formatPercent, utcTitle } from "@/lib/format";
import { useFlow } from "@/lib/queries";
import type { Flow } from "@/lib/types";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h3 className="mb-3 text-caption font-medium uppercase tracking-[0.04em] text-fg-3">{title}</h3>
      {children}
    </section>
  );
}

function Probabilities({ probs }: { probs: Record<string, number> }) {
  const entries = Object.entries(probs).sort((a, b) => b[1] - a[1]);
  return (
    <ul className="space-y-1.5">
      {entries.map(([label, p]) => (
        <li key={label} className="grid grid-cols-[120px_1fr_56px] items-center gap-3 text-small">
          <span className="truncate text-fg-2">{label}</span>
          <span className="h-1.5 overflow-hidden rounded-full bg-surface-3" aria-hidden>
            <span className="block h-full rounded-full bg-accent/70" style={{ width: `${p * 100}%` }} />
          </span>
          <span className="tnum text-right text-fg-1">{formatPercent(p)}</span>
        </li>
      ))}
    </ul>
  );
}

function Body({ flow }: { flow: Flow }) {
  const s = flow.scored;
  const agrees = s && flow.groundTruthLabel ? s.label === flow.groundTruthLabel : null;
  return (
    <>
      <Section title="Verdict">
        <div className="flex flex-wrap items-center gap-2">
          <VerdictBadge flow={flow} />
          {s && s.label !== "Normal" && <SeverityBadge severity={s.severity} />}
          {s && <ConfidenceMeter value={s.confidence} needsReview={s.needsReview} />}
          {s && s.label !== "Normal" && <MitreChip cls={s.label as AttackClass} />}
        </div>
        {s?.needsReview && <p className="mt-2 text-small text-sevfg-medium">Confidence is below this organisation’s threshold: treat as “needs review”, not a hard verdict.</p>}
        {flow.scoreStatus === "pending" && <p className="mt-2 text-small text-fg-2">Not scored yet. A flow is scored only by an active model of its own feature schema ({flow.featureSchema}).</p>}
        {flow.scoreStatus === "error" && <p className="mt-2 text-small text-sevfg-high">{flow.scoreError}</p>}
      </Section>

      {s && (
        <Section title="Why the model decided this">
          <FeatureContributionChart features={s.topFeatures} />
        </Section>
      )}

      {s?.probabilities && (
        <Section title="Class probabilities">
          <Probabilities probs={s.probabilities} />
        </Section>
      )}

      <Section title="Flow">
        <DefinitionList
          items={[
            ["Time", <span title={utcTitle(flow.timestamp)}>{formatDateTime(flow.timestamp)}</span>],
            ["Source", <EntityChip value={`${flow.sourceIp}:${flow.sourcePort}`} />],
            ["Destination", <EntityChip value={`${flow.destinationIp}:${flow.destinationPort}`} />],
            ["Protocol", flow.protocol],
            ["Duration", flow.flowDurationMs === null ? "—" : `${formatExact(Math.round(flow.flowDurationMs))} ms`],
            ["Packets / bytes", `${formatExact(flow.totalPackets)} / ${formatBytes(flow.totalBytes)}`],
          ]}
        />
      </Section>

      <Section title="Provenance">
        <DefinitionList
          items={[
            ["Source kind", <SourceKindBadge kind={flow.sourceKind} />],
            ["Feature schema", <span className="font-mono">{flow.featureSchema}</span>],
            ["Model version", s ? <Link className="font-mono text-accent-fg hover:underline" to={`/models?version=${encodeURIComponent(s.modelVersion)}`}>{s.modelVersion}</Link> : "—"],
            ["Scored at", s ? formatDateTime(s.scoredAt) : "—"],
            ["Dataset", flow.datasetId ? <Link className="text-accent-fg hover:underline" to={`/flows?datasetId=${flow.datasetId}`}>All flows from this dataset</Link> : "—"],
          ]}
        />
      </Section>

      <Section title="Dataset label (evaluation only)">
        <p className="text-small text-fg-2">
          {flow.groundTruthLabel ? (
            <>
              The source file labelled this flow <span className="font-medium text-fg-1">{flow.groundTruthLabel}</span>
              {flow.rawLabel && flow.rawLabel !== flow.groundTruthLabel && <> (raw “{flow.rawLabel}”)</>}.
            </>
          ) : flow.rawLabel ? (
            <>The source label “{flow.rawLabel}” is not in the taxonomy, so it is excluded from evaluation.</>
          ) : (
            "The source file had no label for this flow."
          )}
        </p>
        {agrees !== null && (
          <p className="mt-2 inline-flex items-center gap-1.5 text-small text-fg-2">
            {agrees ? <CheckCircle2 aria-hidden className="h-4 w-4 text-sevfg-ok" /> : <XCircle aria-hidden className="h-4 w-4 text-sevfg-high" />}
            {agrees ? "The model verdict matches the dataset label." : "The model verdict differs from the dataset label."}
          </p>
        )}
      </Section>

      {flow.features && (
        <details className="rounded-md border border-subtle">
          <summary className="cursor-pointer px-4 py-2.5 text-small text-fg-2">Model input features ({Object.keys(flow.features).length})</summary>
          <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 px-4 pb-3 font-mono text-caption">
            {Object.entries(flow.features).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="truncate text-fg-3">{k}</dt>
                <dd className="tnum text-right text-fg-1">{v === null ? "null" : formatExact(v)}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </>
  );
}

export function FlowDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const flow = useFlow(id);
  return (
    <Drawer
      open={Boolean(id)}
      onOpenChange={(o) => !o && onClose()}
      title={flow.data ? `${flow.data.sourceIp} → ${flow.data.destinationIp}:${flow.data.destinationPort}` : "Flow"}
      subtitle={flow.data ? `Flow ${flow.data.id}` : undefined}
    >
      {flow.isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-40" />
          <Skeleton className="h-24" />
        </div>
      ) : flow.isError ? (
        <ErrorState error={flow.error} onRetry={() => void flow.refetch()} />
      ) : flow.data ? (
        <Body flow={flow.data} />
      ) : null}
    </Drawer>
  );
}
