import { useState } from "react";
import { ROLES, type Role } from "@sentinel/shared";
import { NeutralBadge } from "@/components/ui/Badges";
import { Button } from "@/components/ui/Button";
import { Card, PageHeader } from "@/components/ui/Card";
import { Select } from "@/components/ui/Form";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { useAuth } from "@/features/auth/AuthContext";
import { api, errorMessage } from "@/lib/api";
import { formatDateTime, formatWhen, utcTitle } from "@/lib/format";
import { useAudit, useMembers, useOrgMutation } from "@/lib/queries";

export function TeamPage() {
  const { can, user, role } = useAuth();
  const toast = useToast();
  const members = useMembers();
  const change = useOrgMutation(({ userId, role: r }: { userId: string; role: Role }) => api(`/members/${userId}`, { method: "PATCH", body: { role: r } }), ["members"]);
  const manage = can("members:manage");

  return (
    <>
      <PageHeader title="Team" description="Members of this organisation and their roles. Roles are enforced by the API; hiding a control here is cosmetic." />
      <Card className="overflow-x-auto">
        {members.isLoading ? (
          <SkeletonRows rows={4} cols={4} />
        ) : members.isError ? (
          <ErrorState error={members.error} onRetry={() => void members.refetch()} />
        ) : !members.data?.items.length ? (
          <EmptyState title="No members" />
        ) : (
          <table className="w-full text-small">
            <caption className="sr-only">Organisation members</caption>
            <thead className="text-left text-caption uppercase tracking-[0.04em] text-fg-3">
              <tr className="border-b border-subtle">
                <th scope="col" className="px-4 py-2.5 font-medium">Name</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Email</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Role</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Joined</th>
              </tr>
            </thead>
            <tbody>
              {members.data.items.map((m) => {
                // Only an Owner may grant or remove Owner (mirrors the API rule).
                const editable = manage && (role === "Owner" || m.role !== "Owner");
                return (
                  <tr key={m.userId} className="border-b border-subtle last:border-0">
                    <td className="px-4 py-row text-fg-1">
                      {m.name} {m.userId === user?.id && <NeutralBadge>you</NeutralBadge>}
                    </td>
                    <td className="px-4 py-row text-fg-2">{m.email}</td>
                    <td className="px-4 py-row">
                      {editable ? (
                        <Select
                          aria-label={`Role of ${m.name}`}
                          className="h-8 w-36"
                          value={m.role}
                          disabled={change.isPending}
                          onChange={(e) =>
                            change.mutate(
                              { userId: m.userId, role: e.target.value as Role },
                              { onSuccess: () => toast.success(`${m.name} is now ${e.target.value}`), onError: (err) => toast.error(errorMessage(err)) },
                            )
                          }
                        >
                          {ROLES.filter((r) => role === "Owner" || r !== "Owner").map((r) => (
                            <option key={r}>{r}</option>
                          ))}
                        </Select>
                      ) : (
                        <NeutralBadge>{m.role}</NeutralBadge>
                      )}
                    </td>
                    <td className="px-4 py-row text-fg-3" title={utcTitle(m.joinedAt)}>
                      {formatDateTime(m.joinedAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
      <p className="mt-4 text-small text-fg-3">Invitations by email are not built yet (roadmap 5.1). New members currently join by registering their own workspace.</p>
    </>
  );
}

const ACTIONS = [
  "auth.register",
  "auth.login",
  "auth.change_password",
  "auth.logout_all",
  "auth.session_revoke",
  "user.update_profile",
  "member.role_change",
  "member.account_deleted",
  "dataset.import",
  "dataset.delete",
  "incident.create",
  "incident.update",
  "incident.note",
  "incident.delete",
  "model.activate",
  "model.deactivate",
  "scoring.run",
  "detections.run",
  "rule.create",
  "rule.update",
  "rule.delete",
  "alert.update",
  "incident.correlated",
  "incident.alerts_linked",
  "incident.action_recorded",
  "incident.simulation_generated",
  "incident.report_generated",
  "response.simulate_blocklist",
  "asset.update",
  "assets.refresh",
  "identity.import",
  "identity.import_delete",
  "validation.run",
];

export function AuditPage() {
  const [action, setAction] = useState("");
  const audit = useAudit(action || undefined);
  const rows = audit.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <>
      <PageHeader title="Audit log" description="Append-only record of every change in this organisation." />
      <Card className="mb-4 p-4">
        <label className="text-caption text-fg-3">
          Action
          <Select className="mt-1 max-w-xs" value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="">All actions</option>
            {ACTIONS.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </Select>
        </label>
      </Card>
      <Card className="overflow-x-auto">
        {audit.isLoading ? (
          <SkeletonRows />
        ) : audit.isError ? (
          <ErrorState error={audit.error} onRetry={() => void audit.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState title="No entries" />
        ) : (
          <>
            <table className="w-full text-small">
              <caption className="sr-only">Audit entries, newest first</caption>
              <thead className="text-left text-caption uppercase tracking-[0.04em] text-fg-3">
                <tr className="border-b border-subtle">
                  {["When", "Actor", "Action", "Target", "Details", "IP"].map((h) => (
                    <th key={h} scope="col" className="px-4 py-2.5 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id} className="border-b border-subtle align-top last:border-0">
                    <td className="whitespace-nowrap px-4 py-row text-fg-2" title={utcTitle(e.ts)}>
                      {formatWhen(e.ts)}
                    </td>
                    <td className="px-4 py-row text-fg-1">{e.actor?.name ?? "System"}</td>
                    <td className="px-4 py-row font-mono text-caption text-fg-1">{e.action}</td>
                    <td className="px-4 py-row font-mono text-caption text-fg-2">
                      {e.target.type}
                      {e.target.id ? `:${e.target.id}` : ""}
                    </td>
                    <td className="max-w-[320px] px-4 py-row">
                      {Object.keys(e.meta ?? {}).length > 0 && <code className="block truncate font-mono text-caption text-fg-3" title={JSON.stringify(e.meta)}>{JSON.stringify(e.meta)}</code>}
                    </td>
                    <td className="px-4 py-row font-mono text-caption text-fg-3">{e.ip}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {audit.hasNextPage && (
              <div className="border-t border-subtle p-3 text-right">
                <Button size="sm" loading={audit.isFetchingNextPage} onClick={() => void audit.fetchNextPage()}>
                  Load more
                </Button>
              </div>
            )}
          </>
        )}
      </Card>
    </>
  );
}
