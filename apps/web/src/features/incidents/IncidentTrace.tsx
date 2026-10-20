import { Bell, ClipboardCheck, Database, FileText, Fingerprint, Search, ShieldCheck, type LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/States";
import { formatDateTime, utcTitle } from "@/lib/format";
import { useIncidentTrace } from "@/lib/queries";
import type { IncidentTrace as Trace, TraceStage } from "@/lib/types";

const STAGE: Record<TraceStage, { icon: LucideIcon; label: string }> = {
  ingest: { icon: Database, label: "Ingestion" },
  context: { icon: Fingerprint, label: "Context" },
  detect: { icon: Bell, label: "Detection" },
  triage: { icon: ClipboardCheck, label: "Triage" },
  investigate: { icon: Search, label: "Investigation" },
  respond: { icon: ShieldCheck, label: "Response" },
  report: { icon: FileText, label: "Report" },
};

function RefLink({ entry }: { entry: Trace["entries"][number] }) {
  if (entry.ref.type === "alert") {
    return (
      <Link to={`/alerts?alert=${entry.ref.id}&status=all`} className="text-caption text-accent-fg underline underline-offset-2">
        open alert
      </Link>
    );
  }
  if (entry.ref.type === "dataset") {
    return (
      <Link to="/datasets" className="text-caption text-accent-fg underline underline-offset-2">
        datasets
      </Link>
    );
  }
  if (entry.ref.type === "identity_import") {
    return (
      <Link to="/identity" className="text-caption text-accent-fg underline underline-offset-2">
        identity sources
      </Link>
    );
  }
  return null;
}

/** Chain of custody (axis 10): every stored step behind this incident, in the order it was recorded. */
export function IncidentTrace({ id }: { id: string }) {
  const q = useIncidentTrace(id);
  if (q.isLoading) {
    return (
      <Card>
        <SkeletonRows rows={5} cols={3} />
      </Card>
    );
  }
  if (q.isError) {
    return (
      <Card>
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      </Card>
    );
  }
  const t = q.data;
  if (!t || !t.entries.length) {
    return (
      <Card>
        <EmptyState title="Nothing recorded yet" description="Steps appear here as data is imported, alerts are raised and the team works on the incident." />
      </Card>
    );
  }
  const c = t.coverage;
  return (
    <Card>
      <CardHeader
        title="Trace"
        subtitle={`${c.datasets} dataset(s), ${c.alerts} alert(s), ${c.triageChanges} triage change(s), ${c.incidentEvents} incident event(s)${c.identityImports === null ? "" : `, ${c.identityImports} identity import(s)`}.`}
      />
      <CardBody>
        <ol className="relative space-y-4 border-l border-[color:var(--border)] pl-5">
          {t.entries.map((e, i) => {
            const { icon: Icon, label } = STAGE[e.stage];
            return (
              <li key={`${e.ts}-${i}`} className="relative text-small">
                <span aria-hidden className="absolute -left-[31px] top-0 flex h-5 w-5 items-center justify-center rounded-full border bg-surface-1">
                  <Icon className="h-3 w-3 text-fg-2" strokeWidth={2} />
                </span>
                <p className="flex flex-wrap items-center gap-2 text-caption text-fg-3">
                  <span className="rounded-sm bg-surface-3 px-1.5 py-0.5 font-medium text-fg-2">{label}</span>
                  <span title={utcTitle(e.ts)}>{formatDateTime(e.ts)}</span>
                  <span>· {e.actor ?? "no user recorded"}</span>
                  <RefLink entry={e} />
                </p>
                <p className="mt-1 text-fg-1">{e.summary}</p>
              </li>
            );
          })}
        </ol>
        <ul className="mt-5 space-y-0.5 text-caption text-fg-3">
          {t.notes.map((n) => (
            <li key={n}>• {n}</li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}
