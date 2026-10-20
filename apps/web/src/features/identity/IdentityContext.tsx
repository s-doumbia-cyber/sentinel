import { Search } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AssetLink } from "@/components/evidence/Evidence";
import { NeutralBadge, SeverityBadge } from "@/components/ui/Badges";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Input } from "@/components/ui/Form";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/States";
import { formatDateTime, utcTitle } from "@/lib/format";
import { useIdentityHistory, useIdentityLookup } from "@/lib/queries";
import type { IdentityRecord } from "@/lib/types";

function Window({ r }: { r: IdentityRecord }) {
  return (
    <span className="text-fg-2">
      <span title={utcTitle(r.validFrom)}>{formatDateTime(r.validFrom)}</span>
      {r.validTo ? (
        <>
          {" "}
          → <span title={utcTitle(r.validTo)}>{formatDateTime(r.validTo)}</span>
        </>
      ) : (
        " (single event)"
      )}
    </span>
  );
}

function RecordList({ records, showIp }: { records: IdentityRecord[]; showIp: boolean }) {
  return (
    <ul className="space-y-2">
      {records.map((r) => (
        <li key={r.id} className="rounded-md border border-subtle p-3 text-small">
          <p className="flex flex-wrap items-center gap-2 font-medium text-fg-1">
            {r.username ?? r.hostname ?? r.mac}
            {r.username && r.hostname && <span className="font-normal text-fg-2">on {r.hostname}</span>}
            {showIp && (
              <>
                <span className="font-normal text-fg-3">held</span> <AssetLink ip={r.ip} />
              </>
            )}
            <NeutralBadge>{r.sourceLabel}</NeutralBadge>
          </p>
          <p className="mt-1 text-caption">
            <Window r={r} />
            {r.mac && <span className="text-fg-3"> · MAC <span className="font-mono">{r.mac}</span></span>}
            <span className="text-fg-3"> · from {r.importName ?? "a deleted import"}</span>
          </p>
        </li>
      ))}
    </ul>
  );
}

/** Every imported record for one address over time; loaded only when the analyst opens it. */
export function AddressIdentityHistory({ ip }: { ip: string }) {
  const [open, setOpen] = useState(false);
  const q = useIdentityHistory(ip, open);
  return (
    <details className="mt-4" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer text-small font-medium text-fg-1">All identity records for this address</summary>
      <div className="mt-3">
        {q.isLoading ? (
          <SkeletonRows rows={2} cols={2} />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : q.data && q.data.records.length ? (
          <>
            <RecordList records={q.data.records} showIp={false} />
            {q.data.truncated && <p className="mt-2 text-caption text-fg-3">Showing the 200 most recent records.</p>}
          </>
        ) : (
          <p className="text-small text-fg-3">No imported record mentions this address at any time.</p>
        )}
      </div>
    </details>
  );
}

/** Account or device lookup (axis 3). The query lives in the URL; each search is audited by the API. */
export function IdentityLookupCard() {
  const [params, setParams] = useSearchParams();
  const current = params.get("lookup") ?? "";
  const [draft, setDraft] = useState(current);
  const q = useIdentityLookup(current);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next = new URLSearchParams(params);
    if (draft.trim()) next.set("lookup", draft.trim());
    else next.delete("lookup");
    setParams(next);
  };
  return (
    <Card className="mb-6">
      <CardHeader title="Look up an account or device" subtitle="Exact username, hostname or MAC address. Each search is recorded in the audit log." />
      <CardBody className="space-y-4">
        <form onSubmit={submit} className="flex flex-wrap gap-2" role="search" aria-label="Identity lookup">
          <label htmlFor="identity-lookup" className="sr-only">
            Username, hostname or MAC address
          </label>
          <Input id="identity-lookup" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="e.g. alice, WS-031, aa:bb:cc:dd:ee:ff" maxLength={128} className="max-w-sm" />
          <Button type="submit" variant="primary" disabled={!draft.trim()}>
            <Search aria-hidden className="h-4 w-4" /> Look up
          </Button>
        </form>
        {!current ? null : q.isLoading ? (
          <SkeletonRows rows={3} cols={3} />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : q.data && q.data.records.length === 0 ? (
          <EmptyState title={`No record for “${q.data.query}”`} description="No imported identity record uses this exact username, hostname or MAC. Sentinel does not guess from traffic." />
        ) : q.data ? (
          <div className="space-y-5">
            <p className="text-small text-fg-2">
              {q.data.records.length} record(s) matched on {q.data.matchedOn.join(" and ")}, across {q.data.addresses.length} address(es).
            </p>
            <section aria-label="Addresses held">
              <h3 className="mb-2 text-small font-semibold text-fg-1">Addresses held and alerts during those windows</h3>
              <ul className="space-y-3">
                {q.data.addresses.map((a) => (
                  <li key={a.ip} className="rounded-md border border-subtle p-3 text-small">
                    <p className="flex flex-wrap items-center gap-2">
                      <AssetLink ip={a.ip} /> <NeutralBadge>{a.scope}</NeutralBadge>
                      <span className="text-caption text-fg-3">
                        {a.records} record(s) · {formatDateTime(a.from)} → {formatDateTime(a.to)}
                      </span>
                    </p>
                    {a.alerts.length ? (
                      <ul className="mt-2 space-y-1">
                        {a.alerts.map((al) => (
                          <li key={al.id} className="flex flex-wrap items-center gap-2">
                            <SeverityBadge severity={al.severity} />
                            <Link to={`/alerts?alert=${al.id}&status=all`} className="text-accent-fg underline underline-offset-2">
                              {al.type}
                            </Link>
                            <span className="text-caption text-fg-3">
                              address as {al.role} · {formatDateTime(al.firstSeen)} · {al.status}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-1 text-caption text-fg-3">No alert involved this address during these windows.</p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
            <section aria-label="Matching records">
              <h3 className="mb-2 text-small font-semibold text-fg-1">Matching records</h3>
              <RecordList records={q.data.records} showIp />
              {q.data.truncated && <p className="mt-2 text-caption text-fg-3">Showing the 200 most recent records.</p>}
            </section>
            <ul className="space-y-0.5 text-caption text-fg-3">
              {q.data.caveats.map((c) => (
                <li key={c}>• {c}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
