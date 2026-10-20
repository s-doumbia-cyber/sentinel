import { FileUp, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { ATTRIBUTION_HELP, IDENTITY_SOURCE_LABEL } from "@sentinel/shared";
import { NeutralBadge } from "@/components/ui/Badges";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/Overlays";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { useAuth } from "@/features/auth/AuthContext";
import { ApiError, api, errorMessage, uploadWithProgress } from "@/lib/api";
import { formatExact, formatWhen, utcTitle } from "@/lib/format";
import { useIdentityImports, useOrgMutation } from "@/lib/queries";
import type { IdentityImport } from "@/lib/types";
import { useQueryClient } from "@tanstack/react-query";

const TEMPLATE = `ip,start,end,source,username,hostname,mac
10.0.0.21,2026-10-20T08:00:00Z,2026-10-20T18:00:00Z,dhcp,,LAPTOP-21,aa:bb:cc:dd:ee:21
10.8.0.14,2026-10-20T09:12:00Z,2026-10-20T11:40:00Z,vpn,alice,,`;

export function IdentitySourcesPage() {
  const { can, activeOrg } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const readable = can("identity:read");
  const imports = useIdentityImports(readable);
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string[] | null>(null);
  const [toDelete, setToDelete] = useState<IdentityImport | null>(null);
  const del = useOrgMutation((id: string) => api<{ recordsDeleted: number }>(`/identity/imports/${id}`, { method: "DELETE" }), ["identityImports"]);

  const upload = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.append("file", file);
    try {
      const r = await uploadWithProgress<IdentityImport>("/identity/imports", form, () => undefined);
      toast.success(`${formatExact(r.rowsInserted)} records imported, ${formatExact(r.invalidRows)} rejected`);
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      await qc.invalidateQueries({ queryKey: [activeOrg?.id ?? "none", "identityImports"] });
    } catch (err) {
      setError([errorMessage(err), ...(err instanceof ApiError ? (err.details ?? []).map((d) => d.message) : [])]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Identity sources"
        description="Records from your own systems that say who or what held an address and when. Sentinel never infers identity from traffic alone."
      />
      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <CardHeader title="Why this matters" />
          <CardBody className="space-y-2 text-small text-fg-2">
            <p>Network flows show addresses, not people. Behind a VPN, NAT or shared host, one address can stand for many users. Sentinel only associates an address with an account or device when one of these sources says so, for that time window:</p>
            <ul className="list-disc pl-5">
              {ATTRIBUTION_HELP.map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ul>
            <p>Each association shows its source, validity window and a confidence level explained in plain words.</p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Import a CSV export" subtitle="Owners and Admins only. Usernames and device names are personal data: only Analysts and above can read them." />
          <CardBody className="space-y-3 text-small">
            <p className="text-fg-2">Columns: ip, start, end (optional), source ({Object.keys(IDENTITY_SOURCE_LABEL).join(", ")}), and at least one of username, hostname, mac. Times in ISO-8601.</p>
            <pre className="overflow-x-auto rounded-md border bg-surface-2 p-3 font-mono text-caption text-fg-1">{TEMPLATE}</pre>
            {can("identity:manage") ? (
              <>
                <div className="flex flex-wrap items-center gap-3">
                  <input ref={inputRef} type="file" accept=".csv,text/csv" aria-label="Identity CSV file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="max-w-full text-small text-fg-2 file:mr-3 file:h-9 file:rounded-md file:border file:border-solid file:bg-surface-2 file:px-3 file:text-small file:text-fg-1" />
                  <Button variant="primary" disabled={!file} loading={busy} onClick={() => void upload()}>
                    <FileUp aria-hidden className="h-4 w-4" /> Import
                  </Button>
                </div>
                {error && (
                  <ul role="alert" className="list-disc rounded-md border border-sev-critical/40 bg-sev-critical/10 py-2 pl-7 pr-3 text-caption text-sevfg-critical">
                    {error.slice(0, 8).map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <p className="text-fg-3">Ask an Owner or Admin to import identity records.</p>
            )}
          </CardBody>
        </Card>
      </div>
      <Card className="overflow-hidden">
        <CardHeader title="Imported sources" />
        {!readable ? (
          <EmptyState title="Restricted" description="Identity records are visible to Analysts, Admins and Owners." />
        ) : imports.isLoading ? (
          <SkeletonRows rows={3} cols={4} />
        ) : imports.isError ? (
          <ErrorState error={imports.error} onRetry={() => void imports.refetch()} />
        ) : !imports.data?.items.length ? (
          <EmptyState title="No identity source connected" description="Attribution will answer “unknown” until you import VPN, DHCP, authentication, EDR or directory records." />
        ) : (
          <ul className="divide-y divide-[color:var(--border-subtle)]">
            {imports.data.items.map((i) => (
              <li key={i.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4 text-small">
                <div>
                  <p className="flex flex-wrap items-center gap-2 font-medium text-fg-1">
                    {i.name}
                    {i.sources.map((s) => (
                      <NeutralBadge key={s}>{IDENTITY_SOURCE_LABEL[s]}</NeutralBadge>
                    ))}
                  </p>
                  <p className="mt-1 text-fg-3" title={utcTitle(i.createdAt)}>
                    {formatExact(i.rowsInserted)} records · {formatExact(i.invalidRows)} rejected · imported {formatWhen(i.createdAt)} · sha256 <span className="font-mono">{i.fileSha256.slice(0, 12)}…</span>
                  </p>
                  {i.invalidSamples.length > 0 && (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-fg-2">Rejected rows</summary>
                      <ul className="mt-1 list-disc pl-5 font-mono text-caption text-fg-2">
                        {i.invalidSamples.map((s) => (
                          <li key={s}>{s}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
                {can("identity:manage") && (
                  <Button size="sm" variant="ghost" aria-label={`Delete ${i.name}`} onClick={() => setToDelete(i)}>
                    <Trash2 aria-hidden className="h-4 w-4" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <ConfirmDialog
        open={Boolean(toDelete)}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={`Delete ${toDelete?.name ?? "import"}?`}
        consequence={`Its ${formatExact(toDelete?.rowsInserted)} identity records are removed from Sentinel. Attributions based on them will answer "unknown". The audit log keeps a record.`}
        confirmLabel="Delete records"
        loading={del.isPending}
        onConfirm={() =>
          toDelete &&
          del.mutate(toDelete.id, {
            onSuccess: () => {
              setToDelete(null);
              toast.success("Identity records deleted");
            },
            onError: (e) => toast.error(errorMessage(e)),
          })
        }
      />
    </>
  );
}
