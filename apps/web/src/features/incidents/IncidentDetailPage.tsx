import * as Tabs from "@radix-ui/react-tabs";
import { ArrowLeft, ClipboardList, FileText, FlaskConical, Lightbulb, ShieldOff } from "lucide-react";
import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { BLOCKLIST_FORMATS, INCIDENT_STATUSES, PRIORITIES, type BlocklistFormat } from "@sentinel/shared";
import { AssetLink } from "@/components/evidence/Evidence";
import { NeutralBadge, SeverityBadge } from "@/components/ui/Badges";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Field, Select, Textarea } from "@/components/ui/Form";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { useAuth } from "@/features/auth/AuthContext";
import { api, errorMessage } from "@/lib/api";
import { cn, formatDateTime, formatWhen, utcTitle } from "@/lib/format";
import { useIncident, useIncidentGuidance, useIncidentTimeline, useMembers, useOrgMutation } from "@/lib/queries";
import { IncidentTrace } from "./IncidentTrace";
import type { Incident, IncidentLogEntry, IncidentStatus, Priority } from "@/lib/types";

const ORIGIN_LABEL: Record<Incident["origin"], string> = {
  manual: "Created by an analyst",
  from_alerts: "Created from selected alerts",
  correlated: "Grouped by Sentinel (hypothesis)",
};

const LOG_LABEL: Record<string, string> = {
  created: "created the incident",
  correlated: "grouped alerts into this incident",
  alerts_linked: "linked alerts",
  status_changed: "changed the status",
  priority_changed: "changed the priority",
  severity_changed: "changed the severity",
  assignee_changed: "changed the assignee",
  title_changed: "renamed the incident",
  note: "added a note",
  action_recorded: "recorded an action",
  simulation_generated: "generated a blocklist simulation",
  report_generated: "generated a report",
};

function describePayload(e: IncidentLogEntry): string | null {
  const p = e.payload as Record<string, unknown>;
  if (e.kind.endsWith("_changed") && "to" in p) return `${String(p.from ?? "none")} → ${String(p.to ?? "none")}`;
  if (e.kind === "note") return String(p.text ?? "");
  if (e.kind === "action_recorded") return `${String(p.description ?? "")} · ${String(p.verification ?? "")}`;
  if (e.kind === "alerts_linked" || e.kind === "correlated") return String(p.basis ?? "");
  if (e.kind === "simulation_generated") return `${String(p.format ?? "")} for ${Array.isArray(p.ips) ? p.ips.join(", ") : ""} · not applied`;
  return null;
}

function Header({ incident }: { incident: Incident }) {
  const { can } = useAuth();
  const toast = useToast();
  const members = useMembers();
  const patch = useOrgMutation((body: Record<string, unknown>) => api<Incident>(`/incidents/${incident.id}`, { method: "PATCH", body }), ["incident", "incidents", "incidentTimeline"]);
  const writable = can("incidents:write");
  const change = (body: Record<string, unknown>) => patch.mutate(body, { onSuccess: () => toast.success("Incident updated"), onError: (e) => toast.error(errorMessage(e)) });
  return (
    <div className="mb-6">
      <Link to="/incidents" className="mb-3 inline-flex items-center gap-1 text-small text-fg-2 hover:text-fg-1">
        <ArrowLeft aria-hidden className="h-4 w-4" /> Incidents
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-h1 font-semibold tracking-[-0.01em] text-fg-1">{incident.title}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-small text-fg-2">
            <SeverityBadge severity={incident.severity} />
            <NeutralBadge>{incident.priority}</NeutralBadge>
            <NeutralBadge className={incident.origin === "correlated" ? "border border-dashed" : undefined}>{ORIGIN_LABEL[incident.origin]}</NeutralBadge>
            <span>{incident.alertCount} alert(s)</span>
            {incident.firstSeen && (
              <span title={utcTitle(incident.firstSeen)}>
                activity {formatDateTime(incident.firstSeen)} → {formatDateTime(incident.lastSeen)}
              </span>
            )}
          </p>
        </div>
        <Link to={`/incidents/${incident.id}/report`} className="inline-flex h-9 items-center gap-2 rounded-md border bg-surface-1 px-4 text-body text-fg-1 hover:bg-surface-3">
          <FileText aria-hidden className="h-4 w-4" /> Report
        </Link>
      </div>
      <div className="mt-4 grid max-w-2xl grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="text-caption text-fg-3">
          Status
          <Select className="mt-1" disabled={!writable || patch.isPending} value={incident.status} onChange={(e) => change({ status: e.target.value as IncidentStatus })}>
            {INCIDENT_STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
        </label>
        <label className="text-caption text-fg-3">
          Priority
          <Select className="mt-1" disabled={!writable || patch.isPending} value={incident.priority} onChange={(e) => change({ priority: e.target.value as Priority })}>
            {PRIORITIES.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </Select>
        </label>
        <label className="text-caption text-fg-3">
          Assignee
          <Select className="mt-1" disabled={!writable || patch.isPending} value={incident.assignee?.id ?? ""} onChange={(e) => change({ assigneeId: e.target.value || null })}>
            <option value="">Unassigned</option>
            {members.data?.items.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name}
              </option>
            ))}
          </Select>
        </label>
      </div>
    </div>
  );
}

function Overview({ incident }: { incident: Incident }) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 [&>*]:min-w-0">
      <Card>
        <CardHeader title="Summary" />
        <CardBody className="space-y-3 text-small">
          {incident.description ? <p className="whitespace-pre-wrap text-fg-1">{incident.description}</p> : <p className="text-fg-3">No description.</p>}
          {incident.correlation && (
            <p className="rounded-md border border-dashed p-3 text-fg-2">
              <span className="font-medium text-fg-1">Why these alerts are grouped: </span>
              {incident.correlation.basis}. This is a grouping heuristic, not proof of a single actor.
            </p>
          )}
          {incident.legacyAutoGenerated && <p className="text-sevfg-medium">Created by the legacy backend from dataset labels with an invented assignee: review before relying on it.</p>}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Entities" subtitle="Addresses seen in the linked alerts. Open one for its activity and identity context." />
        <CardBody>
          {incident.entities.length ? (
            <ul className="space-y-2 text-small">
              {incident.entities.map((e) => (
                <li key={`${e.role}-${e.value}`} className="flex items-center justify-between gap-3">
                  <AssetLink ip={e.value} />
                  <NeutralBadge>{e.role}</NeutralBadge>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No linked entities" description="Link alerts to this incident to see the addresses involved." />
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function AttackTimeline({ id }: { id: string }) {
  const t = useIncidentTimeline(id);
  if (t.isLoading) return <Skeleton className="h-64" />;
  if (t.isError) return <ErrorState error={t.error} onRetry={() => void t.refetch()} />;
  if (!t.data?.attack.steps.length) return <EmptyState title="No linked alerts yet" description="The attack timeline is built from the alerts linked to this incident." />;
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <Card>
        <CardHeader title="What was observed" subtitle="Alerts in event time (when the traffic happened), in your local time; hover a time for UTC." />
        <CardBody>
          <ol className="relative space-y-5 border-l border-[color:var(--border)] pl-5">
            {t.data.attack.steps.map((s) => (
              <li key={s.alertId} className="relative">
                <span aria-hidden className="absolute -left-[26px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-[color:rgb(var(--accent))] bg-surface-1" />
                <p className="text-caption text-fg-3" title={utcTitle(s.at)}>
                  {formatDateTime(s.at)} {s.stage && <span className="ml-1 rounded-sm bg-surface-3 px-1.5 py-0.5 text-fg-2">{s.stage}</span>}
                </p>
                <p className="mt-1 text-small text-fg-1">{s.fact}</p>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-caption text-fg-3">
                  <SeverityBadge severity={s.severity} /> {s.detectedBy.join(", ")}
                  {s.mitre && <span>· {s.mitre} (suggested)</span>}
                  {s.analystVerdict && <span>· analyst: {s.analystVerdict.replace("_", " ")}</span>}
                  <Link to={`/alerts?alert=${s.alertId}&status=all`} className="text-accent-fg hover:underline">
                    open alert
                  </Link>
                </p>
              </li>
            ))}
          </ol>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="What it might mean" subtitle="Hypotheses, each with its basis and limits." />
        <CardBody>
          {t.data.attack.hypotheses.length ? (
            <ul className="space-y-4 text-small">
              {t.data.attack.hypotheses.map((h, i) => (
                <li key={i} className="rounded-md border border-dashed p-3">
                  <p className="flex items-start gap-2 font-medium text-fg-1">
                    <Lightbulb aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-fg-2" /> {h.statement}
                  </p>
                  {h.basis.length > 0 && <p className="mt-2 text-caption text-fg-2">Basis: {h.basis.map((b) => b.replace(/\.$/, "")).join(". ")}.</p>}
                  {h.limits.length > 0 && (
                    <ul className="mt-1 list-disc pl-5 text-caption text-fg-3">
                      {h.limits.map((l) => (
                        <li key={l}>{l}</li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-small text-fg-3">A single alert does not support a hypothesis about a sequence.</p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function InvestigationLog({ id }: { id: string }) {
  const { can } = useAuth();
  const toast = useToast();
  const t = useIncidentTimeline(id);
  const [note, setNote] = useState("");
  const addNote = useOrgMutation((text: string) => api(`/incidents/${id}/notes`, { method: "POST", body: { text } }), ["incidentTimeline", "incident"]);
  if (t.isLoading) return <Skeleton className="h-48" />;
  if (t.isError) return <ErrorState error={t.error} onRetry={() => void t.refetch()} />;
  return (
    <Card>
      <CardHeader title="Investigation log" subtitle="Append-only: who did what and when (wall-clock time). Also written to the audit log." />
      <CardBody>
        <ol className="space-y-3">
          {t.data?.log.map((e) => (
            <li key={e.id} className="text-small">
              <p className="text-fg-1">
                <span className="font-medium">{e.actor}</span> {LOG_LABEL[e.kind] ?? e.kind}
              </p>
              {describePayload(e) && <p className="whitespace-pre-wrap text-fg-2">{describePayload(e)}</p>}
              <p className="text-caption text-fg-3" title={utcTitle(e.ts)}>
                {formatWhen(e.ts)}
              </p>
            </li>
          ))}
        </ol>
        {can("incidents:write") && (
          <form
            className="mt-5 space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (note.trim()) addNote.mutate(note.trim(), { onSuccess: () => setNote(""), onError: (err) => toast.error(errorMessage(err)) });
            }}
          >
            <label htmlFor="incident-note" className="text-small font-medium text-fg-2">
              Add a note
            </label>
            <Textarea id="incident-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What you checked and what you found" />
            <Button type="submit" size="sm" loading={addNote.isPending} disabled={!note.trim()}>
              Add note
            </Button>
          </form>
        )}
      </CardBody>
    </Card>
  );
}

function Response({ id }: { id: string }) {
  const { can } = useAuth();
  const toast = useToast();
  const g = useIncidentGuidance(id);
  const [format, setFormat] = useState<BlocklistFormat>("iptables");
  const [selected, setSelected] = useState<string[]>([]);
  const [sim, setSim] = useState<{ content: string; warnings: string[] } | null>(null);
  const [action, setAction] = useState("");
  const simulate = useOrgMutation(
    () => api<{ content: string; warnings: string[] }>("/response/blocklist", { method: "POST", body: { ips: selected, format, comment: `incident ${id.slice(-6)}`, incidentId: id } }),
    ["incidentTimeline"],
  );
  const record = useOrgMutation((description: string) => api(`/incidents/${id}/actions`, { method: "POST", body: { description } }), ["incidentTimeline"]);
  if (g.isLoading) return <Skeleton className="h-64" />;
  if (g.isError) return <ErrorState error={g.error} onRetry={() => void g.refetch()} />;
  const data = g.data;
  if (!data) return null;
  const writable = can("incidents:write");
  return (
    <div className="space-y-6">
      <p role="note" className="flex items-start gap-2 rounded-md border bg-surface-2 px-4 py-3 text-small text-fg-1">
        <ShieldOff aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-fg-2" /> {data.notice}
      </p>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        {data.entries.map((k) => (
          <Card key={k.type}>
            <CardHeader title={`${k.type}: recommendations`} subtitle={k.summary} />
            <CardBody className="space-y-3 text-small">
              <p className="text-fg-2">{k.whyItMatters}</p>
              <div>
                <p className="flex items-center gap-1.5 font-medium text-fg-1">
                  <ClipboardList aria-hidden className="h-4 w-4" /> To confirm
                </p>
                <ul className="mt-1 list-disc pl-5 text-fg-2">
                  {k.confirm.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="font-medium text-fg-1">Containment ideas (for a human to decide)</p>
                <ul className="mt-1 list-disc pl-5 text-fg-2">
                  {k.contain.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </div>
              <p className="text-caption text-fg-3">
                {k.references.map((r) => (
                  <a key={r.url} href={r.url} target="_blank" rel="noreferrer noopener" className="mr-3 text-accent-fg underline underline-offset-2 hover:decoration-2">
                    {r.label}
                  </a>
                ))}
                · knowledge base {data.knowledgeBaseVersion}
              </p>
            </CardBody>
          </Card>
        ))}
      </div>
      {writable && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 [&>*]:min-w-0">
          <Card>
            <CardHeader title="Blocklist simulation" subtitle="Generates firewall rules for you to review. Nothing is applied." />
            <CardBody className="space-y-3 text-small">
              {data.blocklistCandidates.length ? (
                <fieldset>
                  <legend className="text-caption text-fg-3">Addresses</legend>
                  {data.blocklistCandidates.map((c) => (
                    <label key={c.ip} className="mt-1 flex items-center gap-2">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-[rgb(var(--accent))]"
                        checked={selected.includes(c.ip)}
                        onChange={(e) => setSelected((s) => (e.target.checked ? [...s, c.ip] : s.filter((x) => x !== c.ip)))}
                      />
                      <span className="font-mono">{c.ip}</span> <NeutralBadge>{c.scope}</NeutralBadge>
                    </label>
                  ))}
                </fieldset>
              ) : (
                <p className="text-fg-3">No source address on this incident.</p>
              )}
              <label className="block text-caption text-fg-3">
                Format
                <Select className="mt-1 w-48" value={format} onChange={(e) => setFormat(e.target.value as BlocklistFormat)}>
                  {BLOCKLIST_FORMATS.map((f) => (
                    <option key={f}>{f}</option>
                  ))}
                </Select>
              </label>
              <Button
                size="sm"
                disabled={!selected.length}
                loading={simulate.isPending}
                onClick={() => simulate.mutate(undefined, { onSuccess: (r) => setSim(r), onError: (e) => toast.error(errorMessage(e)) })}
              >
                <FlaskConical aria-hidden className="h-4 w-4" /> Generate simulation
              </Button>
              {sim && (
                <div className="space-y-2">
                  {sim.warnings.map((w) => (
                    <p key={w} className="text-sevfg-medium">
                      {w}
                    </p>
                  ))}
                  <p className="text-caption text-fg-3">Simulation only: review and apply it yourself through your change process if appropriate.</p>
                  <pre tabIndex={0} aria-label="Generated blocklist (not applied)" className="overflow-x-auto rounded-md border bg-surface-2 p-3 font-mono text-caption text-fg-1">{sim.content}</pre>
                </div>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Record an action you took" subtitle="Logged as reported by you; Sentinel cannot verify it." />
            <CardBody>
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (action.trim().length >= 3)
                    record.mutate(action.trim(), {
                      onSuccess: () => {
                        setAction("");
                        toast.success("Action recorded in the investigation log");
                      },
                      onError: (err) => toast.error(errorMessage(err)),
                    });
                }}
              >
                <Field label="What did you do?" hint="e.g. Blocked 203.0.113.9 on the edge firewall, change CHG-118">
                  {({ id: fid, describedBy }) => <Textarea id={fid} aria-describedby={describedBy} value={action} onChange={(e) => setAction(e.target.value)} />}
                </Field>
                <Button type="submit" size="sm" loading={record.isPending} disabled={action.trim().length < 3}>
                  Record action
                </Button>
              </form>
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  );
}

const TABS = ["overview", "timeline", "log", "response", "trace"] as const;
const TAB_LABEL: Record<(typeof TABS)[number], string> = { overview: "Overview", timeline: "Attack timeline", log: "Investigation log", response: "Response", trace: "Trace" };

export function IncidentDetailPage() {
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = (TABS as readonly string[]).includes(params.get("tab") ?? "") ? (params.get("tab") as (typeof TABS)[number]) : "overview";
  const incident = useIncident(id);
  if (incident.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-40" />
      </div>
    );
  }
  if (incident.isError) return <ErrorState error={incident.error} onRetry={() => void incident.refetch()} />;
  if (!incident.data) return null;
  return (
    <>
      <Header incident={incident.data} />
      <Tabs.Root value={tab} onValueChange={(v) => setParams(v === "overview" ? {} : { tab: v }, { replace: true })}>
        <Tabs.List aria-label="Incident sections" className="mb-6 flex gap-1 overflow-x-auto overflow-y-hidden border-b border-subtle">
          {TABS.map((t) => (
            <Tabs.Trigger
              key={t}
              value={t}
              className={cn("-mb-px whitespace-nowrap border-b-2 border-transparent px-3 py-2 text-small text-fg-2 transition-colors duration-fast hover:text-fg-1 data-[state=active]:border-[color:rgb(var(--accent))] data-[state=active]:text-fg-1")}
            >
              {TAB_LABEL[t]}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <Tabs.Content value="overview" className="animate-page-in">
          <Overview incident={incident.data} />
        </Tabs.Content>
        <Tabs.Content value="timeline" className="animate-page-in">
          <AttackTimeline id={id} />
        </Tabs.Content>
        <Tabs.Content value="log" className="animate-page-in">
          <InvestigationLog id={id} />
        </Tabs.Content>
        <Tabs.Content value="response" className="animate-page-in">
          <Response id={id} />
        </Tabs.Content>
        <Tabs.Content value="trace" className="animate-page-in">
          <IncidentTrace id={id} />
        </Tabs.Content>
      </Tabs.Root>
    </>
  );
}
