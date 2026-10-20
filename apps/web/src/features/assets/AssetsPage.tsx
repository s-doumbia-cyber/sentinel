import { ArrowLeft, RefreshCw, Server, Monitor, HelpCircle } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AssetLink, AttributionPanel } from "@/components/evidence/Evidence";
import { NeutralBadge, SeverityBadge, SourceKindBadge } from "@/components/ui/Badges";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/Card";
import { DefinitionList } from "@/components/ui/Data";
import { Input, Select, Textarea } from "@/components/ui/Form";
import { EmptyState, ErrorState, Skeleton, SkeletonRows } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { useAuth } from "@/features/auth/AuthContext";
import { api, errorMessage } from "@/lib/api";
import { formatCount, formatDateTime, formatExact, formatWhen, utcTitle } from "@/lib/format";
import { useAsset, useAssets, useOrgMutation, type AssetFilters } from "@/lib/queries";
import type { Asset } from "@/lib/types";
import { MIN_SERVICE_FLOWS } from "@sentinel/shared";

function ServiceList({ services }: { services: Asset["services"] }) {
  return (
    <ul className="mt-1 space-y-1 font-mono text-caption text-fg-2">
      {services.map((s) => (
        <li key={`${s.protocol}-${s.port}`}>
          {s.protocol}/{s.port} · {formatExact(s.flows)} {s.flows === 1 ? "flow" : "flows"} · {formatDateTime(s.firstSeen)} → {formatDateTime(s.lastSeen)}
        </li>
      ))}
    </ul>
  );
}

/** The device type is always shown as an estimate with its basis (axis 3). */
function Estimate({ asset, compact = false }: { asset: Pick<Asset, "deviceEstimate">; compact?: boolean }) {
  const e = asset.deviceEstimate;
  if (!e) return <span className="text-fg-3">{compact ? "unknown" : "Unknown: not enough observed services to estimate."}</span>;
  const Icon = e.label.startsWith("Client") ? Monitor : Server;
  return (
    <span className="inline-flex items-start gap-1.5" title={`${e.basis}. Port heuristic, low confidence.`}>
      <Icon aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-fg-3" />
      <span>
        <span className="text-fg-1">{e.label}</span> <span className="text-caption text-fg-3">(estimate)</span>
        {!compact && <span className="block text-caption text-fg-3">{e.basis}. Port heuristic, low confidence: ports are conventions, not proof.</span>}
      </span>
    </span>
  );
}

export function AssetsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const filters: AssetFilters = {};
  for (const k of ["q", "scope", "role", "includeInactive"] as const) {
    const v = params.get(k);
    if (v) filters[k] = v;
  }
  const query = useAssets(filters);
  const rows = query.data?.pages.flatMap((p) => p.items) ?? [];
  const refreshedAt = query.data?.pages[0]?.lastRefreshedAt ?? null;
  const refresh = useOrgMutation(() => api("/assets/refresh", { method: "POST" }), ["assets"]);
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };

  return (
    <>
      <PageHeader
        title="Assets"
        description="Addresses observed in your flows, with what they were seen doing. Device types are estimates; identities come only from imported records."
        actions={
          can("assets:write") && (
            <Button loading={refresh.isPending} onClick={() => refresh.mutate(undefined, { onSuccess: () => toast.success("Inventory refresh started"), onError: (e) => toast.error(errorMessage(e)) })}>
              <RefreshCw aria-hidden className="h-4 w-4" /> Rebuild inventory
            </Button>
          )
        }
      />
      <Card className="mb-4 p-4">
        <form className="grid grid-cols-2 gap-3 md:grid-cols-4" onSubmit={(e) => e.preventDefault()} aria-label="Asset filters" key={params.toString()}>
          <label className="text-caption text-fg-3">
            Address starts with
            <Input className="mt-1 font-mono" defaultValue={filters.q ?? ""} placeholder="10.0." onBlur={(e) => set("q", e.target.value.trim())} onKeyDown={(e) => e.key === "Enter" && set("q", e.currentTarget.value.trim())} />
          </label>
          <label className="text-caption text-fg-3">
            Scope
            <Select className="mt-1" value={filters.scope ?? ""} onChange={(e) => set("scope", e.target.value)}>
              <option value="">Any</option>
              <option value="internal">Internal (private ranges)</option>
              <option value="external">External</option>
            </Select>
          </label>
          <label className="text-caption text-fg-3">
            Observed role
            <Select className="mt-1" value={filters.role ?? ""} onChange={(e) => set("role", e.target.value)}>
              <option value="">Any</option>
              <option value="server">Accepted connections</option>
              <option value="client">Only initiated connections</option>
            </Select>
          </label>
          <label className="flex items-end gap-2 pb-2 text-small text-fg-2">
            <input type="checkbox" className="h-4 w-4 accent-[rgb(var(--accent))]" checked={Boolean(filters.includeInactive)} onChange={(e) => set("includeInactive", e.target.checked ? "true" : "")} />
            Include inactive
          </label>
        </form>
        {refreshedAt && <p className="mt-3 text-caption text-fg-3">Inventory built {formatWhen(refreshedAt)} from stored flows. It is rebuilt after each import.</p>}
      </Card>
      <Card className="overflow-hidden">
        {query.isLoading ? (
          <SkeletonRows />
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState title={Object.keys(filters).length ? "No assets match these filters" : "No assets yet"} description="Assets appear once flows are imported. Live discovery arrives with the collector (roadmap Phase 2)." />
        ) : (
          <>
            <div role="region" aria-label="Assets table" tabIndex={0} className="hidden overflow-x-auto md:block">
              <table className="w-full text-small">
                <caption className="sr-only">Observed assets, most recently active first</caption>
                <thead className="text-left text-caption uppercase tracking-[0.04em] text-fg-3">
                  <tr className="border-b border-subtle">
                    {["Address", "Scope", "Estimated type", "Services", "Flows out / in", "Active alerts", "Last seen"].map((h) => (
                      <th key={h} scope="col" className="px-4 py-2.5 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((a) => (
                    <tr key={a.ip} tabIndex={0} onClick={() => navigate(`/assets/${encodeURIComponent(a.ip)}`)} onKeyDown={(e) => e.key === "Enter" && navigate(`/assets/${encodeURIComponent(a.ip)}`)} className="cursor-pointer border-b border-subtle last:border-0 hover:bg-surface-3/60 focus-visible:bg-surface-3">
                      <td className="px-4 py-row font-mono text-fg-1">
                        {a.ip} {!a.active && <NeutralBadge>inactive</NeutralBadge>}
                      </td>
                      <td className="px-4 py-row text-fg-2">{a.scope}</td>
                      <td className="px-4 py-row">
                        <Estimate asset={a} compact />
                      </td>
                      <td className="px-4 py-row font-mono text-caption text-fg-2">{a.services.slice(0, 3).map((s) => `${s.protocol}/${s.port}`).join(", ") || "—"}</td>
                      <td className="tnum px-4 py-row text-fg-2" title={`${formatExact(a.flowsAsSource)} out / ${formatExact(a.flowsAsDestination)} in`}>
                        {formatCount(a.flowsAsSource)} / {formatCount(a.flowsAsDestination)}
                      </td>
                      <td className="tnum px-4 py-row">{a.activeAlerts ? <span className="font-medium text-fg-1">{a.activeAlerts}</span> : <span className="text-fg-3">0</span>}</td>
                      <td className="whitespace-nowrap px-4 py-row text-fg-3" title={utcTitle(a.lastSeen)}>
                        {formatDateTime(a.lastSeen)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="divide-y divide-[color:var(--border-subtle)] md:hidden">
              {rows.map((a) => (
                <li key={a.ip}>
                  <Link to={`/assets/${encodeURIComponent(a.ip)}`} className="block px-4 py-3 hover:bg-surface-3/60">
                    <span className="font-mono text-fg-1">{a.ip}</span> <span className="text-caption text-fg-3">{a.scope}</span>
                    <span className="mt-1 block text-small">
                      <Estimate asset={a} compact />
                    </span>
                    <span className="mt-1 block text-caption text-fg-3">
                      {a.activeAlerts ?? 0} active alerts · last seen {formatDateTime(a.lastSeen)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between border-t border-subtle px-4 py-3 text-small text-fg-3">
              <span>{rows.length} assets loaded</span>
              {query.hasNextPage && (
                <Button size="sm" loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
                  Load more
                </Button>
              )}
            </div>
          </>
        )}
      </Card>
    </>
  );
}

function Notes({ ip, notes, tags }: { ip: string; notes: string; tags: string[] }) {
  const { can } = useAuth();
  const toast = useToast();
  const [text, setText] = useState(notes);
  const [tagText, setTagText] = useState(tags.join(", "));
  const save = useOrgMutation((body: { notes: string; tags: string[] }) => api(`/assets/${encodeURIComponent(ip)}`, { method: "PATCH", body }), ["asset", "assets"]);
  if (!can("assets:write")) return notes ? <p className="whitespace-pre-wrap text-small text-fg-1">{notes}</p> : <p className="text-small text-fg-3">No analyst notes.</p>;
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(
          { notes: text, tags: tagText.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 20) },
          { onSuccess: () => toast.success("Notes saved"), onError: (err) => toast.error(errorMessage(err)) },
        );
      }}
    >
      <label className="block text-small text-fg-2">
        Notes (analyst knowledge, e.g. "intranet web server, owned by IT")
        <Textarea className="mt-1" value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <label className="block text-small text-fg-2">
        Tags (comma separated)
        <Input className="mt-1" value={tagText} onChange={(e) => setTagText(e.target.value)} />
      </label>
      <Button type="submit" size="sm" loading={save.isPending}>
        Save
      </Button>
    </form>
  );
}

export function AssetDetailPage() {
  const { ip = "" } = useParams();
  const q = useAsset(ip);
  if (q.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-48" />
      </div>
    );
  }
  if (q.isError) {
    return (
      <>
        <Link to="/assets" className="mb-3 inline-flex items-center gap-1 text-small text-fg-2 hover:text-fg-1">
          <ArrowLeft aria-hidden className="h-4 w-4" /> Assets
        </Link>
        <ErrorState error={q.error} title="This address is not in the inventory" onRetry={() => void q.refetch()} />
      </>
    );
  }
  const d = q.data;
  if (!d) return null;
  const a = d.asset;
  return (
    <>
      <Link to="/assets" className="mb-3 inline-flex items-center gap-1 text-small text-fg-2 hover:text-fg-1">
        <ArrowLeft aria-hidden className="h-4 w-4" /> Assets
      </Link>
      <PageHeader
        title={a.ip}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {a.scope} address · seen {formatDateTime(a.firstSeen)} → {formatDateTime(a.lastSeen)}
            {a.sourceKinds.map((k) => (
              <SourceKindBadge key={k} kind={k} />
            ))}
            {a.tags.map((t) => (
              <NeutralBadge key={t}>{t}</NeutralBadge>
            ))}
          </span>
        }
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <CardHeader title="What Sentinel observed" subtitle="From stored flows only." />
          <CardBody className="space-y-4 text-small">
            <DefinitionList
              items={[
                ["Estimated type", <Estimate asset={a} />],
                ["Flows as source", formatExact(a.flowsAsSource)],
                ["Flows as destination", formatExact(a.flowsAsDestination)],
                ["Distinct peers", formatExact(a.distinctPeers)],
              ]}
            />
            <div>
              <p className="mb-1 font-medium text-fg-1">Services accepted</p>
              {a.distinctServices > a.services.length && (
                <p className="text-caption text-fg-3">
                  The {formatExact(a.services.length)} busiest of {formatExact(a.distinctServices)} ports that accepted flows.
                </p>
              )}
              {a.services.length ? (
                <>
                  <ServiceList services={a.services.filter((s) => s.flows >= MIN_SERVICE_FLOWS)} />
                  {a.services.some((s) => s.flows < MIN_SERVICE_FLOWS) && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-caption text-fg-2">
                        {formatExact(a.services.filter((s) => s.flows < MIN_SERVICE_FLOWS).length)} more port(s) with fewer than {MIN_SERVICE_FLOWS} flows (often a scan, not a service)
                      </summary>
                      <ServiceList services={a.services.filter((s) => s.flows < MIN_SERVICE_FLOWS)} />
                    </details>
                  )}
                </>
              ) : (
                <p className="text-fg-3">None observed.</p>
              )}
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Identity" subtitle="Who or what held this address, from imported records only." />
          <CardBody>
            <AttributionPanel attribution={d.identity} restricted={d.identityRestricted} ip={a.ip} />
          </CardBody>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Activity over time" subtitle="Flows per bucket, event time (UTC)." />
          <CardBody>
            {d.activity.length ? (
              <figure>
                <div className="h-56" aria-hidden>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={d.activity.map((b) => ({ t: new Date(b.bucket).toISOString().slice(0, 16).replace("T", " "), out: b.asSource, in: b.asDestination }))}>
                      <CartesianGrid stroke="var(--border-subtle)" vertical={false} />
                      <XAxis dataKey="t" tick={{ fontSize: 12, fill: "rgb(var(--text-3))" }} tickLine={false} axisLine={false} minTickGap={24} />
                      <YAxis tick={{ fontSize: 12, fill: "rgb(var(--text-3))" }} tickLine={false} axisLine={false} width={40} />
                      <Tooltip contentStyle={{ background: "rgb(var(--surface-1))", border: "1px solid var(--border)", borderRadius: 8, color: "rgb(var(--text-1))" }} />
                      <Bar dataKey="out" name="As source" stackId="a" fill="rgb(var(--accent))" isAnimationActive={false} />
                      <Bar dataKey="in" name="As destination" stackId="a" fill="rgb(var(--text-3))" fillOpacity={0.5} isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <figcaption className="mt-2 text-caption text-fg-2">
                  {formatExact(d.activity.reduce((s, b) => s + b.asSource, 0))} flows as source and {formatExact(d.activity.reduce((s, b) => s + b.asDestination, 0))} as destination across {d.activity.length} time buckets.
                </figcaption>
              </figure>
            ) : (
              <EmptyState title="No activity in stored flows" />
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Relations" subtitle="Busiest peers in stored flows." />
          <CardBody className="grid gap-4 text-small sm:grid-cols-2">
            {(["outbound", "inbound"] as const).map((dir) => (
              <div key={dir}>
                <p className="mb-1 font-medium text-fg-1">{dir === "outbound" ? "It contacted" : "Contacted it"}</p>
                {d.peers[dir].length ? (
                  <ul className="space-y-1">
                    {d.peers[dir].map((p) => (
                      <li key={p.ip} className="flex justify-between gap-2">
                        <AssetLink ip={p.ip} />
                        <span className="tnum text-fg-3">{formatCount(p.flows)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-fg-3">None.</p>
                )}
              </div>
            ))}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Alerts and incidents" />
          <CardBody className="space-y-3 text-small">
            {d.alerts.length ? (
              <ul className="space-y-1.5">
                {d.alerts.map((al) => (
                  <li key={al.id} className="flex flex-wrap items-center gap-2">
                    <SeverityBadge severity={al.severity} />
                    <Link to={`/alerts?alert=${al.id}&status=all`} className="text-accent-fg hover:underline">
                      {al.type}
                    </Link>
                    <span className="text-fg-3">
                      as {al.role} · {al.status.replace("_", " ")} · {formatWhen(al.lastSeen)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="flex items-center gap-1.5 text-fg-3">
                <HelpCircle aria-hidden className="h-4 w-4" /> No alert involves this address.
              </p>
            )}
            {d.incidents.length > 0 && (
              <ul className="space-y-1 border-t border-subtle pt-3">
                {d.incidents.map((i) => (
                  <li key={i.id}>
                    <Link to={`/incidents/${i.id}`} className="text-accent-fg hover:underline">
                      {i.title}
                    </Link>{" "}
                    <span className="text-fg-3">({i.status})</span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Analyst notes" subtitle="Kept when the inventory is rebuilt. Audited." />
          <CardBody>
            <Notes key={`${a.notes}|${a.tags.join(",")}`} ip={a.ip} notes={a.notes} tags={a.tags} />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
