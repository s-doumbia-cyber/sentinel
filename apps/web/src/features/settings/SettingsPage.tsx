import * as Tabs from "@radix-ui/react-tabs";
import { Download, LogOut } from "lucide-react";
import { useState, type FormEvent } from "react";
import { changePasswordBodySchema } from "@sentinel/shared";
import { NeutralBadge } from "@/components/ui/Badges";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/Card";
import { Field, Input, Select } from "@/components/ui/Form";
import { ConfirmDialog } from "@/components/ui/Overlays";
import { ErrorState, SkeletonRows } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { useAuth } from "@/features/auth/AuthContext";
import { api, errorMessage } from "@/lib/api";
import { cn, formatWhen, utcTitle } from "@/lib/format";
import { useSessions } from "@/lib/queries";
import type { User, UserPreferences } from "@/lib/types";
import { useQueryClient } from "@tanstack/react-query";

function useSavePrefs() {
  const { setUser } = useAuth();
  const toast = useToast();
  return async (body: { name?: string; preferences?: Partial<UserPreferences> }) => {
    try {
      const res = await api<{ user: User }>("/me", { method: "PATCH", body });
      setUser(res.user);
      toast.success("Saved");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
}

function Profile() {
  const { user } = useAuth();
  const save = useSavePrefs();
  const [name, setName] = useState(user?.name ?? "");
  const [busy, setBusy] = useState(false);
  if (!user) return null;
  const p = user.preferences;
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Profile" />
        <CardBody>
          <form
            className="flex max-w-md flex-col gap-4"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              await save({ name: name.trim() });
              setBusy(false);
            }}
          >
            <Field label="Name">{({ id }) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
            <Field label="Email" hint="Email changes are not supported yet.">
              {({ id, describedBy }) => <Input id={id} value={user.email} readOnly aria-describedby={describedBy} />}
            </Field>
            <Button type="submit" className="self-start" loading={busy} disabled={!name.trim() || name.trim() === user.name}>
              Save profile
            </Button>
          </form>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Preferences" subtitle="Saved to your account and applied on every device." />
        <CardBody className="grid max-w-2xl gap-4 sm:grid-cols-2">
          <Field label="Theme">
            {({ id }) => (
              <Select id={id} value={p.theme} onChange={(e) => void save({ preferences: { theme: e.target.value as UserPreferences["theme"] } })}>
                <option value="dark">Dark</option>
                <option value="light">Light</option>
                <option value="system">Match system</option>
              </Select>
            )}
          </Field>
          <Field label="Accent">
            {({ id }) => (
              <Select id={id} value={p.accentColor} onChange={(e) => void save({ preferences: { accentColor: e.target.value as UserPreferences["accentColor"] } })}>
                <option value="violet">Violet</option>
                <option value="cyan">Cyan</option>
                <option value="emerald">Emerald</option>
              </Select>
            )}
          </Field>
          <Field label="Density">
            {({ id }) => (
              <Select id={id} value={p.density} onChange={(e) => void save({ preferences: { density: e.target.value as UserPreferences["density"] } })}>
                <option value="comfortable">Comfortable</option>
                <option value="compact">Compact</option>
              </Select>
            )}
          </Field>
          <Field label="Language" hint="Interface translation (FR, HI) is not built yet; this only records your preference.">
            {({ id, describedBy }) => (
              <Select id={id} aria-describedby={describedBy} value={p.language} onChange={(e) => void save({ preferences: { language: e.target.value as UserPreferences["language"] } })}>
                <option value="en">English</option>
                <option value="fr">Français</option>
                <option value="hi">हिन्दी</option>
              </Select>
            )}
          </Field>
        </CardBody>
      </Card>
    </div>
  );
}

function Security() {
  const toast = useToast();
  const qc = useQueryClient();
  const { logout } = useAuth();
  const sessions = useSessions();
  const [form, setForm] = useState({ currentPassword: "", newPassword: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = changePasswordBodySchema.safeParse(form);
    if (!parsed.success) return setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
    setErrors({});
    setBusy(true);
    try {
      const res = await api<{ message: string }>("/auth/change-password", { method: "POST", body: parsed.data });
      toast.success(res.message);
      setForm({ currentPassword: "", newPassword: "" });
      await qc.invalidateQueries({ queryKey: ["me", "sessions"] });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    try {
      await api(`/auth/sessions/${id}`, { method: "DELETE" });
      await qc.invalidateQueries({ queryKey: ["me", "sessions"] });
      toast.success("Session signed out");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Change password" subtitle="Other devices are signed out; this one stays signed in." />
        <CardBody>
          <form className="flex max-w-md flex-col gap-4" onSubmit={submit} noValidate>
            <Field label="Current password" error={errors.currentPassword}>
              {({ id, describedBy, invalid }) => <Input id={id} type="password" autoComplete="current-password" value={form.currentPassword} onChange={(e) => setForm((f) => ({ ...f, currentPassword: e.target.value }))} aria-describedby={describedBy} aria-invalid={invalid} />}
            </Field>
            <Field label="New password" error={errors.newPassword} hint="At least 12 characters.">
              {({ id, describedBy, invalid }) => <Input id={id} type="password" autoComplete="new-password" value={form.newPassword} onChange={(e) => setForm((f) => ({ ...f, newPassword: e.target.value }))} aria-describedby={describedBy} aria-invalid={invalid} />}
            </Field>
            <Button type="submit" className="self-start" loading={busy}>
              Change password
            </Button>
          </form>
        </CardBody>
      </Card>
      <Card>
        <CardHeader
          title="Active sessions"
          actions={
            <Button size="sm" variant="danger" onClick={() => setConfirmAll(true)}>
              <LogOut aria-hidden className="h-4 w-4" /> Sign out everywhere
            </Button>
          }
        />
        {sessions.isLoading ? (
          <SkeletonRows rows={3} cols={3} />
        ) : sessions.isError ? (
          <ErrorState error={sessions.error} onRetry={() => void sessions.refetch()} />
        ) : (
          <ul className="divide-y divide-[color:var(--border-subtle)]">
            {sessions.data?.items.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate text-small text-fg-1" title={s.userAgent}>
                    {s.userAgent || "Unknown device"} {s.current && <NeutralBadge className="ml-1 bg-sev-ok/15 text-sevfg-ok">this device</NeutralBadge>}
                  </p>
                  <p className="text-caption text-fg-3" title={utcTitle(s.lastSeenAt)}>
                    <span className="font-mono">{s.ip || "unknown IP"}</span> · last active {formatWhen(s.lastSeenAt)}
                  </p>
                </div>
                {!s.current && (
                  <Button size="sm" variant="ghost" onClick={() => void revoke(s.id)}>
                    Sign out
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <p className="text-small text-fg-3">Multi-factor authentication is not available yet (roadmap 5.2).</p>
      <ConfirmDialog
        open={confirmAll}
        onOpenChange={setConfirmAll}
        title="Sign out everywhere?"
        consequence="Every session, including this one, ends immediately. You will need to sign in again."
        confirmLabel="Sign out everywhere"
        onConfirm={async () => {
          try {
            await api("/auth/logout-all", { method: "POST" });
          } finally {
            await logout();
          }
        }}
      />
    </div>
  );
}

function Data() {
  const toast = useToast();
  const { logout, orgs } = useAuth();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const exportData = async () => {
    try {
      const data = await api<unknown>("/me/export");
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `sentinel-account-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Export your data" subtitle="Your account, memberships and sessions as JSON (no password hash, no tokens)." />
        <CardBody>
          <Button onClick={() => void exportData()}>
            <Download aria-hidden className="h-4 w-4" /> Download JSON
          </Button>
        </CardBody>
      </Card>
      <Card className="border-sev-critical/40">
        <CardHeader title="Delete account" subtitle="Organisations where you are the only member are deleted with all their data. If you are the only Owner of an organisation with other members, transfer ownership first." />
        <CardBody>
          <Button variant="danger" onClick={() => setConfirm(true)}>
            Delete my account
          </Button>
        </CardBody>
      </Card>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Delete your account?"
        consequence={`This cannot be undone. You are a member of ${orgs.length} organisation(s); those where you are the only member are deleted with their flows, datasets, incidents and audit log.`}
        confirmLabel="Delete my account"
        typedConfirmation="delete my account"
        loading={busy}
        onConfirm={async () => {
          setBusy(true);
          try {
            await api("/me", { method: "DELETE" });
            await logout();
          } catch (e) {
            toast.error(errorMessage(e));
          } finally {
            setBusy(false);
          }
        }}
      />
    </div>
  );
}

const TABS = [
  { value: "profile", label: "Profile & preferences", el: <Profile /> },
  { value: "security", label: "Security", el: <Security /> },
  { value: "data", label: "Data & privacy", el: <Data /> },
];

export function SettingsPage() {
  const { activeOrg } = useAuth();
  return (
    <>
      <PageHeader title="Settings" description={activeOrg ? <>Organisation slug: <span className="font-mono">{activeOrg.slug}</span> (used by the CSV import CLI)</> : undefined} />
      <Tabs.Root defaultValue="profile">
        <Tabs.List aria-label="Settings sections" className="mb-6 flex gap-1 overflow-x-auto border-b border-subtle">
          {TABS.map((t) => (
            <Tabs.Trigger
              key={t.value}
              value={t.value}
              className={cn("-mb-px whitespace-nowrap border-b-2 border-transparent px-3 py-2 text-small text-fg-2 hover:text-fg-1 data-[state=active]:border-[color:rgb(var(--accent))] data-[state=active]:text-fg-1")}
            >
              {t.label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        {TABS.map((t) => (
          <Tabs.Content key={t.value} value={t.value}>
            {t.el}
          </Tabs.Content>
        ))}
      </Tabs.Root>
    </>
  );
}
