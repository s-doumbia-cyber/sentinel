import { useMutation } from "@tanstack/react-query";
import { ArrowLeft, Printer } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { ErrorState, Skeleton } from "@/components/ui/States";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import type { IncidentReport } from "@/lib/types";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="break-inside-avoid-page border-t border-subtle pt-5">
      <h2 className="mb-3 text-h2 font-semibold text-fg-1">{title}</h2>
      {children}
    </section>
  );
}

const iso = (s: string | null | undefined) => (s ? new Date(s).toISOString().replace(".000Z", "Z") : "—");

/**
 * Printable incident report. Generating it records an event in the
 * investigation log; "Save as PDF" uses the browser's print dialog.
 */
export function IncidentReportPage() {
  const { id = "" } = useParams();
  const gen = useMutation({ mutationFn: () => api<IncidentReport>(`/incidents/${id}/report`, { method: "POST" }) });
  const { mutate } = gen;
  const started = useRef(false);
  useEffect(() => {
    // Generating writes an investigation-log event: do it once even under StrictMode's double effects.
    if (started.current) return;
    started.current = true;
    mutate();
  }, [mutate]);
  const r = gen.data;

  return (
    <div className="min-h-full bg-bg-1 print:bg-white">
      <div className="mx-auto max-w-4xl px-4 py-8 print:max-w-none print:p-0">
        <div className="mb-6 flex items-center justify-between gap-3 print:hidden">
          <Link to={`/incidents/${id}`} className="inline-flex items-center gap-1 text-small text-fg-2 hover:text-fg-1">
            <ArrowLeft aria-hidden className="h-4 w-4" /> Back to the incident
          </Link>
          <Button variant="primary" onClick={() => window.print()} disabled={!r}>
            <Printer aria-hidden className="h-4 w-4" /> Print or save as PDF
          </Button>
        </div>
        {gen.isPending || gen.isIdle ? (
          <div className="space-y-4">
            <Skeleton className="h-10 w-2/3" />
            <Skeleton className="h-64" />
          </div>
        ) : gen.isError ? (
          <ErrorState error={gen.error} onRetry={() => gen.mutate()} />
        ) : r ? (
          <article className="space-y-6 rounded-lg border bg-surface-1 p-8 shadow-e1 print:border-0 print:p-0 print:shadow-none">
            <header>
              <p className="text-caption uppercase tracking-[0.04em] text-fg-3">Sentinel incident report · {r.meta.organisation}</p>
              <h1 className="mt-1 text-[28px] font-semibold leading-9 tracking-[-0.01em] text-fg-1">{r.incident.title}</h1>
              <p className="mt-2 text-small text-fg-2">
                Status {r.incident.status} · priority {r.incident.priority} · severity {r.incident.severity} · {r.incident.alertCount} alert(s) · activity {iso(r.incident.firstSeen)} → {iso(r.incident.lastSeen)}
              </p>
              {r.incident.correlation && <p className="mt-2 text-small text-fg-2">Grouping basis: {r.incident.correlation.basis} (a heuristic, not proof of a single actor).</p>}
            </header>

            <Section title="Observed activity (event time, UTC)">
              <ol className="space-y-2 text-small">
                {r.attack.steps.map((s) => (
                  <li key={s.alertId}>
                    <span className="font-mono text-fg-2">{iso(s.at)}</span> {s.stage && <span className="text-fg-3">[{s.stage}]</span>} {s.fact}
                    {s.mitre && <span className="text-fg-3"> MITRE ATT&CK (suggested): {s.mitre}.</span>}
                    {s.analystVerdict && <span className="text-fg-3"> Analyst verdict: {s.analystVerdict.replace("_", " ")}.</span>}
                  </li>
                ))}
              </ol>
            </Section>

            <Section title="Hypotheses">
              {r.attack.hypotheses.length ? (
                <ul className="space-y-3 text-small">
                  {r.attack.hypotheses.map((h, i) => (
                    <li key={i}>
                      <p className="font-medium text-fg-1">{h.statement}</p>
                      <p className="text-fg-2">Basis: {h.basis.join("; ") || "—"}.</p>
                      {h.limits.length > 0 && <p className="text-fg-3">Limits: {h.limits.join(" ")}</p>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-small text-fg-2">No hypothesis: a single alert does not support one.</p>
              )}
            </Section>

            <Section title="Entities">
              <ul className="space-y-3 text-small">
                {r.entities.map((e) => (
                  <li key={`${e.role}-${e.ip}`}>
                    <p className="text-fg-1">
                      <span className="font-mono">{e.ip}</span> · {e.role} · {e.scope}
                      {e.deviceEstimate && <span className="text-fg-2"> · estimated: {e.deviceEstimate.label} (low confidence; {e.deviceEstimate.basis})</span>}
                    </p>
                    <p className="text-fg-2">
                      Identity:{" "}
                      {e.identity === "restricted"
                        ? "restricted for the role that generated this report."
                        : e.identity.candidates.length
                          ? e.identity.candidates.map((c) => `${c.username ?? c.hostname ?? c.mac} (${c.sourceLabel}, ${c.confidence} confidence)`).join("; ") + (e.identity.ambiguous ? " — ambiguous: several identities." : "")
                          : "unknown (no identity record covers this window)."}
                    </p>
                  </li>
                ))}
              </ul>
            </Section>

            <Section title="Response">
              <p className="mb-3 text-small font-medium text-fg-1">{r.response.enforcement}</p>
              {r.response.recommendations.map((rec) => (
                <div key={rec.type} className="mb-3 text-small">
                  <p className="font-medium text-fg-1">{rec.type}: recommended checks</p>
                  <ul className="list-disc pl-5 text-fg-2">
                    {rec.confirm.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                  <p className="mt-1 font-medium text-fg-1">Containment ideas</p>
                  <ul className="list-disc pl-5 text-fg-2">
                    {rec.contain.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                </div>
              ))}
              <p className="text-small font-medium text-fg-1">Actions recorded by analysts (not verified by Sentinel)</p>
              {r.response.recordedActions.length ? (
                <ul className="list-disc pl-5 text-small text-fg-2">
                  {r.response.recordedActions.map((a) => (
                    <li key={a.id}>
                      {iso(a.ts)} · {a.actor}: {String((a.payload as { description?: string }).description ?? "")}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-small text-fg-2">None.</p>
              )}
              {r.response.simulations.length > 0 && <p className="mt-2 text-small text-fg-2">{r.response.simulations.length} blocklist simulation(s) generated; none applied by Sentinel.</p>}
            </Section>

            <Section title="Investigation log">
              <ol className="space-y-1 text-small text-fg-2">
                {r.investigationLog.map((e) => (
                  <li key={e.id}>
                    <span className="font-mono">{iso(e.ts)}</span> · {e.actor} · {e.kind.replace(/_/g, " ")}
                  </li>
                ))}
              </ol>
            </Section>

            <Section title="Provenance">
              <ul className="space-y-1 text-small text-fg-2">
                {r.provenance.datasets.map((d) => (
                  <li key={d.name}>
                    Data: {d.name} ({d.sourceKind}), sha256 <span className="font-mono">{d.sha256 ?? "not recorded"}</span>, imported {iso(d.importedAt)}
                  </li>
                ))}
                <li>Model versions: {r.provenance.models.join(", ") || "none"}</li>
                <li>Rules: {r.provenance.rules.join(", ") || "none"}</li>
                <li>Knowledge base version {r.meta.knowledgeBaseVersion}</li>
              </ul>
            </Section>

            <Section title="Limitations">
              <ul className="list-disc space-y-1 pl-5 text-small text-fg-2">
                {r.limitations.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </Section>

            <footer className="border-t border-subtle pt-4 text-caption text-fg-3">
              Generated {iso(r.meta.generatedAt)} ({formatDateTime(r.meta.generatedAt)} local) by Sentinel, report format v{r.meta.reportVersion}. All times {r.meta.timezone}.
            </footer>
          </article>
        ) : null}
      </div>
    </div>
  );
}
