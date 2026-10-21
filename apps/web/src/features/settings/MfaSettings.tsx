import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, KeyRound, ShieldCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { totpCodeSchema } from "@sentinel/shared";
import { NeutralBadge } from "@/components/ui/Badges";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Field, Input } from "@/components/ui/Form";
import { Dialog } from "@/components/ui/Overlays";
import { ErrorState, Skeleton } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { useAuth } from "@/features/auth/AuthContext";
import { api, errorMessage } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import type { MeResponse } from "@/lib/types";

interface MfaStatus {
  enabled: boolean;
  enabledAt: string | null;
  recoveryCodesLeft: number;
}

interface MfaSetup {
  secret: string;
  otpauthUri: string;
  qrDataUrl: string;
}

type PasswordAction = "setup" | "disable" | "regenerate";

const PASSWORD_ACTION: Record<PasswordAction, { title: string; description: string; label: string; danger?: boolean }> = {
  setup: { title: "Turn on two-factor authentication", description: "Confirm your password to start.", label: "Continue" },
  disable: {
    title: "Turn off two-factor authentication?",
    description: "Your account will be protected by the password alone. Confirm your password.",
    label: "Turn off",
    danger: true,
  },
  regenerate: { title: "Generate new recovery codes?", description: "The current codes stop working. Confirm your password.", label: "Generate new codes" },
};

/** Codes are shown once, in this dialog only. */
function RecoveryCodesDialog({ codes, onClose }: { codes: string[] | null; onClose: () => void }) {
  const toast = useToast();
  return (
    <Dialog
      open={codes !== null}
      onOpenChange={(o) => !o && onClose()}
      title="Save your recovery codes"
      description="Each code signs you in once if you lose your phone. Sentinel stores only their hashes and cannot show them again."
      footer={<Button onClick={onClose}>I saved them</Button>}
    >
      {codes && (
        <>
          <ul aria-label="Recovery codes" className="grid grid-cols-2 gap-2 rounded-md border bg-surface-2 p-4 font-mono text-body text-fg-1">
            {codes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <Button
            className="mt-3"
            size="sm"
            onClick={() =>
              void navigator.clipboard.writeText(codes.join("\n")).then(
                () => toast.success("Codes copied"),
                () => toast.error("Copy failed; write the codes down instead"),
              )
            }
          >
            <Copy aria-hidden className="h-4 w-4" /> Copy all
          </Button>
        </>
      )}
    </Dialog>
  );
}

export function MfaSettings() {
  const toast = useToast();
  const qc = useQueryClient();
  const { setUser } = useAuth();
  const status = useQuery({ queryKey: ["me", "mfa"], queryFn: () => api<MfaStatus>("/auth/mfa") });
  const [action, setAction] = useState<PasswordAction | null>(null);
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | undefined>();
  const [setup, setSetup] = useState<MfaSetup | null>(null);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | undefined>();
  const [codes, setCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["me"] });
    const me = await api<MeResponse>("/me");
    setUser(me.user);
  };

  const closePassword = () => {
    setAction(null);
    setPassword("");
    setPasswordError(undefined);
  };

  const submitPassword = async (e: FormEvent) => {
    e.preventDefault();
    if (!action || !password) return setPasswordError("Password is required");
    setBusy(true);
    try {
      if (action === "setup") setSetup(await api<MfaSetup>("/auth/mfa/setup", { method: "POST", body: { password } }));
      if (action === "disable") {
        await api("/auth/mfa/disable", { method: "POST", body: { password } });
        toast.success("Two-factor authentication is off");
        await refresh();
      }
      if (action === "regenerate") {
        setCodes((await api<{ recoveryCodes: string[] }>("/auth/mfa/recovery-codes", { method: "POST", body: { password } })).recoveryCodes);
        await refresh();
      }
      closePassword();
    } catch (err) {
      setPasswordError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = totpCodeSchema.safeParse(code);
    if (!parsed.success) return setCodeError(parsed.error.issues[0]?.message);
    setBusy(true);
    try {
      const res = await api<{ recoveryCodes: string[] }>("/auth/mfa/enable", { method: "POST", body: { code: parsed.data } });
      setSetup(null);
      setCode("");
      setCodeError(undefined);
      setCodes(res.recoveryCodes);
      toast.success("Two-factor authentication is on. Other devices were signed out.");
      await refresh();
    } catch (err) {
      setCodeError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const meta = action ? PASSWORD_ACTION[action] : null;
  const s = status.data;

  return (
    <Card>
      <CardHeader
        title="Two-factor authentication"
        subtitle="A 6-digit code from an authenticator app (TOTP), asked after your password at every sign-in."
        actions={
          s && (
            <NeutralBadge className={s.enabled ? "bg-sev-ok/15 text-sevfg-ok" : undefined}>
              {s.enabled ? <ShieldCheck aria-hidden className="h-3.5 w-3.5" /> : null}
              {s.enabled ? "On" : "Off"}
            </NeutralBadge>
          )
        }
      />
      <CardBody>
        {status.isLoading ? (
          <Skeleton className="h-16" />
        ) : status.isError ? (
          <ErrorState error={status.error} onRetry={() => void status.refetch()} />
        ) : s?.enabled ? (
          <div className="space-y-3">
            <p className="text-small text-fg-2">
              On since {formatDateTime(s.enabledAt)}. Recovery codes left: <span className={s.recoveryCodesLeft <= 3 ? "font-medium text-sevfg-high" : "font-medium text-fg-1"}>{s.recoveryCodesLeft}</span>
              {s.recoveryCodesLeft <= 3 && " (generate new ones soon)"}.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setAction("regenerate")}>
                <KeyRound aria-hidden className="h-4 w-4" /> New recovery codes
              </Button>
              <Button variant="danger" onClick={() => setAction("disable")}>
                Turn off
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-small text-fg-2">Recommended for Owners and Admins. Turning it on signs out your other devices.</p>
            <Button variant="primary" onClick={() => setAction("setup")}>
              Turn on
            </Button>
          </div>
        )}
      </CardBody>

      <Dialog open={action !== null} onOpenChange={(o) => !o && closePassword()} title={meta?.title ?? ""} description={meta?.description}>
        <form onSubmit={submitPassword} noValidate className="space-y-4">
          <Field label="Password" error={passwordError}>
            {({ id, describedBy, invalid }) => (
              <Input id={id} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} aria-describedby={describedBy} aria-invalid={invalid} autoFocus />
            )}
          </Field>
          <div className="flex justify-end gap-2">
            <Button onClick={closePassword}>Cancel</Button>
            <Button type="submit" variant={meta?.danger ? "danger" : "primary"} loading={busy}>
              {meta?.label}
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={setup !== null}
        onOpenChange={(o) => {
          if (!o) {
            setSetup(null);
            setCode("");
            setCodeError(undefined);
          }
        }}
        title="Scan with your authenticator app"
        description="Then enter the 6-digit code it shows. This QR code expires in 15 minutes."
      >
        {setup && (
          <form onSubmit={submitCode} noValidate className="space-y-4">
            <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
              {/* White quiet zone: scanners need contrast whatever the theme. */}
              <img src={setup.qrDataUrl} alt="QR code to add Sentinel to an authenticator app" width={180} height={180} className="rounded-md bg-white p-2" />
              <div className="min-w-0 text-small text-fg-2">
                <p>Can’t scan? Enter this key manually (time-based, 6 digits, 30 s):</p>
                <code className="mt-2 block break-all rounded-sm bg-surface-2 px-2 py-1 font-mono text-caption text-fg-1">{setup.secret}</code>
              </div>
            </div>
            <Field label="Code from the app" error={codeError}>
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  className="font-mono tracking-[0.2em]"
                  aria-describedby={describedBy}
                  aria-invalid={invalid}
                />
              )}
            </Field>
            <div className="flex justify-end">
              <Button type="submit" variant="primary" loading={busy}>
                Turn on
              </Button>
            </div>
          </form>
        )}
      </Dialog>

      <RecoveryCodesDialog codes={codes} onClose={() => setCodes(null)} />
    </Card>
  );
}
