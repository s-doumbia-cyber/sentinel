import { Copy, LogOut, UserMinus, UserPlus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ROLES, createInviteBodySchema, type Role } from "@sentinel/shared";
import { NeutralBadge } from "@/components/ui/Badges";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/Card";
import { Field, Input, Select } from "@/components/ui/Form";
import { ConfirmDialog, Dialog } from "@/components/ui/Overlays";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { useAuth } from "@/features/auth/AuthContext";
import { api, errorMessage } from "@/lib/api";
import { formatDateTime, formatWhen, utcTitle } from "@/lib/format";
import { useAudit, useMembers, useOrgMutation } from "@/lib/queries";
import type { Member } from "@/lib/types";
import { inviteLink, useCreateInvite, useInvites, useRemoveMember, useRevokeInvite, type CreatedInvite, type Invite } from "./teamApi";

const th = "px-4 py-2.5 font-medium";

const INVITE_STATUS: Record<Invite["status"], string> = {
  pending: "bg-sev-low/15 text-sevfg-low",
  accepted: "bg-sev-ok/15 text-sevfg-ok",
  revoked: "bg-surface-3 text-fg-3",
  expired: "bg-surface-3 text-fg-3",
};

function InviteForm({ onCreated }: { onCreated: (invite: CreatedInvite) => void }) {
  const { role } = useAuth();
  const toast = useToast();
  const create = useCreateInvite();
  const [form, setForm] = useState({ email: "", role: "Analyst" as Role, expiresInDays: 7 });
  const [error, setError] = useState<string | undefined>();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const parsed = createInviteBodySchema.safeParse(form);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message);
    setError(undefined);
    create.mutate(parsed.data, {
      onSuccess: (invite) => {
        setForm((f) => ({ ...f, email: "" }));
        onCreated(invite);
      },
      onError: (err) => toast.error(errorMessage(err)),
    });
  };

  return (
    <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
      <Field label="Email" error={error}>
        {({ id, describedBy, invalid }) => (
          <Input id={id} type="email" autoComplete="off" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} aria-describedby={describedBy} aria-invalid={invalid} />
        )}
      </Field>
      <Field label="Role">
        {({ id }) => (
          <Select id={id} value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as Role }))}>
            {ROLES.filter((r) => role === "Owner" || r !== "Owner").map((r) => (
              <option key={r}>{r}</option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Link valid for">
        {({ id }) => (
          <Select id={id} value={form.expiresInDays} onChange={(e) => setForm((f) => ({ ...f, expiresInDays: Number(e.target.value) }))}>
            {[1, 3, 7, 14].map((d) => (
              <option key={d} value={d}>
                {d} {d === 1 ? "day" : "days"}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Button type="submit" variant="primary" loading={create.isPending}>
        <UserPlus aria-hidden className="h-4 w-4" /> Create link
      </Button>
    </form>
  );
}

/** The link exists only in this dialog: the server keeps a hash and cannot show it again. */
function InviteLinkDialog({ invite, onClose }: { invite: CreatedInvite | null; onClose: () => void }) {
  const toast = useToast();
  const link = invite ? inviteLink(invite.token) : "";
  return (
    <Dialog
      open={invite !== null}
      onOpenChange={(o) => !o && onClose()}
      title="Invitation link created"
      description={
        invite ? (
          <>
            Send this link to <span className="font-medium text-fg-1">{invite.email}</span> yourself (Sentinel sends no email).
          </>
        ) : undefined
      }
      footer={<Button onClick={onClose}>Done</Button>}
    >
      {invite && (
        <div className="space-y-3">
          <div className="flex gap-2">
            <Input readOnly value={link} aria-label="Invitation link" className="font-mono text-caption" onFocus={(e) => e.currentTarget.select()} />
            <Button
              onClick={() =>
                void navigator.clipboard.writeText(link).then(
                  () => toast.success("Link copied"),
                  () => toast.error("Copy failed; select the link and copy it manually"),
                )
              }
            >
              <Copy aria-hidden className="h-4 w-4" /> Copy
            </Button>
          </div>
          <ul className="list-disc space-y-1 pl-5 text-small text-fg-2">
            <li>Shown once: Sentinel stores only a hash of it.</li>
            <li>
              Works once, until {formatDateTime(invite.expiresAt)}, and only for an account with the address {invite.email}. The person joins as{" "}
              <span className="font-medium text-fg-1">{invite.role}</span>.
            </li>
            <li>Lost it? Revoke it below and create a new one.</li>
          </ul>
        </div>
      )}
    </Dialog>
  );
}

function PendingInvites() {
  const { role } = useAuth();
  const toast = useToast();
  const invites = useInvites(true);
  const revoke = useRevokeInvite();
  return (
    <Card aria-label="Invitations" className="mt-6 overflow-x-auto">
      <CardHeader title="Invitations" subtitle="Accepted, revoked and expired links stay listed until 30 days after expiry." />
      {invites.isLoading ? (
        <SkeletonRows rows={2} cols={5} />
      ) : invites.isError ? (
        <ErrorState error={invites.error} onRetry={() => void invites.refetch()} />
      ) : !invites.data?.items.length ? (
        <EmptyState title="No invitations yet" description="Create a link above to add someone to this organisation." />
      ) : (
        <table className="w-full text-small">
          <caption className="sr-only">Invitations, newest first</caption>
          <thead className="text-left text-caption uppercase tracking-[0.04em] text-fg-3">
            <tr className="border-b border-subtle">
              {["Email", "Role", "Status", "Expires", "Created by"].map((h) => (
                <th key={h} scope="col" className={th}>
                  {h}
                </th>
              ))}
              <th scope="col" className={th}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {invites.data.items.map((i) => (
              <tr key={i.id} className="border-b border-subtle last:border-0">
                <td className="px-4 py-row text-fg-1">{i.email}</td>
                <td className="px-4 py-row">
                  <NeutralBadge>{i.role}</NeutralBadge>
                </td>
                <td className="px-4 py-row">
                  <NeutralBadge className={INVITE_STATUS[i.status]}>{i.status}</NeutralBadge>
                </td>
                <td className="px-4 py-row text-fg-2" title={utcTitle(i.expiresAt)}>
                  {formatWhen(i.expiresAt)}
                </td>
                <td className="px-4 py-row text-fg-2">{i.createdBy}</td>
                <td className="px-4 py-row text-right">
                  {i.status === "pending" && (role === "Owner" || i.role !== "Owner") && (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Revoke the invitation for ${i.email}`}
                      loading={revoke.isPending && revoke.variables === i.id}
                      onClick={() => revoke.mutate(i.id, { onSuccess: () => toast.success(`Invitation for ${i.email} revoked`), onError: (e) => toast.error(errorMessage(e)) })}
                    >
                      Revoke
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

export function TeamPage() {
  const { can, user, role, reloadSession } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const members = useMembers();
  const change = useOrgMutation(({ userId, role: r }: { userId: string; role: Role }) => api(`/members/${userId}`, { method: "PATCH", body: { role: r } }), ["members"]);
  const remove = useRemoveMember();
  const manage = can("members:manage");
  const [created, setCreated] = useState<CreatedInvite | null>(null);
  const [removing, setRemoving] = useState<Member | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [leaveBusy, setLeaveBusy] = useState(false);

  return (
    <>
      <PageHeader title="Team" description="Members of this organisation and their roles. Roles are enforced by the API; hiding a control here is cosmetic." />
      <Card aria-label="Team members" tabIndex={0} className="overflow-x-auto">
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
                <th scope="col" className={th}>
                  Name
                </th>
                <th scope="col" className={th}>
                  Email
                </th>
                <th scope="col" className={th}>
                  Role
                </th>
                <th scope="col" className={th}>
                  Joined
                </th>
                <th scope="col" className={th}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {members.data.items.map((m) => {
                const self = m.userId === user?.id;
                // Only an Owner may grant or remove Owner (mirrors the API rule).
                const editable = manage && (role === "Owner" || m.role !== "Owner");
                return (
                  <tr key={m.userId} className="border-b border-subtle last:border-0">
                    <td className="px-4 py-row text-fg-1">
                      {m.name} {self && <NeutralBadge>you</NeutralBadge>}{" "}
                      {m.mfaEnabled && (
                        <NeutralBadge className="bg-sev-ok/15 text-sevfg-ok" title="Two-factor authentication is on">
                          2FA
                        </NeutralBadge>
                      )}
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
                    <td className="px-4 py-row text-right">
                      {self ? (
                        <Button size="sm" variant="ghost" onClick={() => setLeaving(true)}>
                          <LogOut aria-hidden className="h-4 w-4" /> Leave
                        </Button>
                      ) : (
                        editable && (
                          <Button size="sm" variant="ghost" aria-label={`Remove ${m.name}`} onClick={() => setRemoving(m)}>
                            <UserMinus aria-hidden className="h-4 w-4" /> Remove
                          </Button>
                        )
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      {manage ? (
        <>
          <Card className="mt-6">
            <CardHeader title="Invite someone" subtitle="Creates a single-use link for one email address. Sentinel sends no email: you share the link." />
            <CardBody>
              <InviteForm onCreated={setCreated} />
            </CardBody>
          </Card>
          <PendingInvites />
        </>
      ) : (
        <p className="mt-4 text-small text-fg-3">Owners and Admins can invite people to this organisation.</p>
      )}

      <InviteLinkDialog invite={created} onClose={() => setCreated(null)} />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Remove ${removing?.name ?? "member"}?`}
        consequence="They lose access to this organisation on their next request. Their account, and what they did here (audit log, notes), stay."
        confirmLabel="Remove member"
        loading={remove.isPending}
        onConfirm={() => {
          if (!removing) return;
          remove.mutate(removing.userId, {
            onSuccess: () => {
              toast.success(`${removing.name} was removed`);
              setRemoving(null);
            },
            onError: (e) => toast.error(errorMessage(e)),
          });
        }}
      />
      <ConfirmDialog
        open={leaving}
        onOpenChange={setLeaving}
        title="Leave this organisation?"
        consequence="You lose access immediately. To come back, an Owner or Admin must invite you again."
        confirmLabel="Leave organisation"
        loading={leaveBusy}
        onConfirm={async () => {
          setLeaveBusy(true);
          try {
            await api("/members/leave", { method: "POST" });
            setLeaving(false);
            await reloadSession();
            navigate("/", { replace: true });
          } catch (e) {
            toast.error(errorMessage(e));
          } finally {
            setLeaveBusy(false);
          }
        }}
      />
    </>
  );
}

const ACTIONS = [
  "auth.register",
  "auth.login",
  "auth.change_password",
  "auth.logout_all",
  "auth.session_revoke",
  "auth.mfa_setup",
  "auth.mfa_enabled",
  "auth.mfa_disabled",
  "auth.mfa_recovery_used",
  "auth.mfa_recovery_regenerated",
  "user.update_profile",
  "member.role_change",
  "member.remove",
  "member.leave",
  "member.account_deleted",
  "invite.create",
  "invite.revoke",
  "invite.accept",
  "job.retry",
  "retention.settings_update",
  "retention.run",
  "retention.purge",
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
  "identity.lookup",
  "detection.settings_update",
  "rule.upgrade",
  "demo.seed",
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
      <Card aria-label="Audit entries" tabIndex={0} className="overflow-x-auto">
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
