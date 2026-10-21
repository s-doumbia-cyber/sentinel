import * as Tabs from "@radix-ui/react-tabs";
import { Download, LogOut } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Trans, useTranslation } from "react-i18next";
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
import { DetectionTuning } from "./DetectionTuning";
import { MfaSettings } from "./MfaSettings";

function useSavePrefs() {
  const { setUser } = useAuth();
  const toast = useToast();
  const { t } = useTranslation();
  return async (body: { name?: string; preferences?: Partial<UserPreferences> }) => {
    try {
      const res = await api<{ user: User }>("/me", { method: "PATCH", body });
      setUser(res.user);
      toast.success(t("common.saved"));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
}

function Profile() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const save = useSavePrefs();
  const [name, setName] = useState(user?.name ?? "");
  const [busy, setBusy] = useState(false);
  if (!user) return null;
  const p = user.preferences;
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title={t("settings.profile")} />
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
            <Field label={t("settings.name")}>{({ id }) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
            <Field label={t("settings.email")} hint={t("settings.emailHint")}>
              {({ id, describedBy }) => <Input id={id} value={user.email} readOnly aria-describedby={describedBy} />}
            </Field>
            <Button type="submit" className="self-start" loading={busy} disabled={!name.trim() || name.trim() === user.name}>
              {t("settings.saveProfile")}
            </Button>
          </form>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={t("settings.preferences")} subtitle={t("settings.preferencesSubtitle")} />
        <CardBody className="grid max-w-2xl gap-4 sm:grid-cols-2">
          <Field label={t("settings.theme")}>
            {({ id }) => (
              <Select id={id} value={p.theme} onChange={(e) => void save({ preferences: { theme: e.target.value as UserPreferences["theme"] } })}>
                <option value="light">{t("settings.themeLight")}</option>
                <option value="dark">{t("settings.themeDark")}</option>
                <option value="system">{t("settings.themeSystem")}</option>
              </Select>
            )}
          </Field>
          <Field label={t("settings.accent")}>
            {({ id }) => (
              <Select id={id} value={p.accentColor} onChange={(e) => void save({ preferences: { accentColor: e.target.value as UserPreferences["accentColor"] } })}>
                <option value="pine">{t("settings.accentPine")}</option>
                <option value="ocean">{t("settings.accentOcean")}</option>
                <option value="plum">{t("settings.accentPlum")}</option>
              </Select>
            )}
          </Field>
          <Field label={t("settings.density")}>
            {({ id }) => (
              <Select id={id} value={p.density} onChange={(e) => void save({ preferences: { density: e.target.value as UserPreferences["density"] } })}>
                <option value="comfortable">{t("settings.densityComfortable")}</option>
                <option value="compact">{t("settings.densityCompact")}</option>
              </Select>
            )}
          </Field>
          <Field label={t("language.label")} hint={t("language.coverage")}>
            {({ id, describedBy }) => (
              <Select id={id} aria-describedby={describedBy} value={p.language} onChange={(e) => void save({ preferences: { language: e.target.value as UserPreferences["language"] } })}>
                <option value="en" lang="en">
                  {t("language.en")}
                </option>
                <option value="fr" lang="fr">
                  {t("language.fr")}
                </option>
                <option value="hi" lang="hi">
                  {t("language.hi")}
                </option>
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
  const { t } = useTranslation();
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
      toast.success(t("settings.sessionSignedOut"));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title={t("settings.changePassword")} subtitle={t("settings.changePasswordSubtitle")} />
        <CardBody>
          <form className="flex max-w-md flex-col gap-4" onSubmit={submit} noValidate>
            <Field label={t("settings.currentPassword")} error={errors.currentPassword}>
              {({ id, describedBy, invalid }) => <Input id={id} type="password" autoComplete="current-password" value={form.currentPassword} onChange={(e) => setForm((f) => ({ ...f, currentPassword: e.target.value }))} aria-describedby={describedBy} aria-invalid={invalid} />}
            </Field>
            <Field label={t("settings.newPassword")} error={errors.newPassword} hint={t("settings.atLeast12")}>
              {({ id, describedBy, invalid }) => <Input id={id} type="password" autoComplete="new-password" value={form.newPassword} onChange={(e) => setForm((f) => ({ ...f, newPassword: e.target.value }))} aria-describedby={describedBy} aria-invalid={invalid} />}
            </Field>
            <Button type="submit" className="self-start" loading={busy}>
              {t("settings.changePassword")}
            </Button>
          </form>
        </CardBody>
      </Card>
      <Card>
        <CardHeader
          title={t("settings.activeSessions")}
          actions={
            <Button size="sm" variant="danger" onClick={() => setConfirmAll(true)}>
              <LogOut aria-hidden className="h-4 w-4" /> {t("settings.signOutEverywhere")}
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
                    {s.userAgent || t("settings.unknownDevice")} {s.current && <NeutralBadge className="ml-1 bg-sev-ok/15 text-sevfg-ok">{t("settings.thisDevice")}</NeutralBadge>}
                  </p>
                  <p className="text-caption text-fg-3" title={utcTitle(s.lastSeenAt)}>
                    <span className="font-mono">{s.ip || t("settings.unknownIp")}</span> · {t("settings.lastActive", { when: formatWhen(s.lastSeenAt) })}
                  </p>
                </div>
                {!s.current && (
                  <Button size="sm" variant="ghost" onClick={() => void revoke(s.id)}>
                    {t("settings.signOut")}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <MfaSettings />
      <ConfirmDialog
        open={confirmAll}
        onOpenChange={setConfirmAll}
        title={t("settings.signOutAllTitle")}
        consequence={t("settings.signOutAllConsequence")}
        confirmLabel={t("settings.signOutEverywhere")}
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
  const { t } = useTranslation();
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
        <CardHeader title={t("settings.exportTitle")} subtitle={t("settings.exportSubtitle")} />
        <CardBody>
          <Button onClick={() => void exportData()}>
            <Download aria-hidden className="h-4 w-4" /> {t("settings.downloadJson")}
          </Button>
        </CardBody>
      </Card>
      <Card className="border-sev-critical/40">
        <CardHeader title={t("settings.deleteTitle")} subtitle={t("settings.deleteSubtitle")} />
        <CardBody>
          <Button variant="danger" onClick={() => setConfirm(true)}>
            {t("settings.deleteButton")}
          </Button>
        </CardBody>
      </Card>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t("settings.deleteConfirmTitle")}
        consequence={t("settings.deleteConsequence", { count: orgs.length })}
        confirmLabel={t("settings.deleteButton")}
        typedConfirmation={t("settings.deleteTyped")}
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
  { value: "profile", el: <Profile /> },
  { value: "security", el: <Security /> },
  { value: "data", el: <Data /> },
  { value: "detection", el: <DetectionTuning /> },
] as const;

export function SettingsPage() {
  const { activeOrg } = useAuth();
  const { t } = useTranslation();
  return (
    <>
      <PageHeader
        title={t("settings.title")}
        description={activeOrg ? <Trans i18nKey="settings.slug" values={{ slug: activeOrg.slug }} components={{ mono: <span className="font-mono" /> }} /> : undefined}
      />
      <Tabs.Root defaultValue="profile">
        <Tabs.List aria-label={t("settings.sections")} className="mb-6 flex gap-1 overflow-x-auto border-b border-subtle">
          {TABS.map((tab) => (
            <Tabs.Trigger
              key={tab.value}
              value={tab.value}
              className={cn("-mb-px whitespace-nowrap border-b-2 border-transparent px-3 py-2 text-small text-fg-2 hover:text-fg-1 data-[state=active]:border-[color:rgb(var(--accent))] data-[state=active]:text-fg-1")}
            >
              {t(`settings.tabs.${tab.value}`)}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        {TABS.map((tab) => (
          <Tabs.Content key={tab.value} value={tab.value}>
            {tab.el}
          </Tabs.Content>
        ))}
      </Tabs.Root>
    </>
  );
}
