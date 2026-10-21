import { Eye, EyeOff, ShieldCheck } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { loginBodySchema, recoveryCodeSchema, registerBodySchema, totpCodeSchema } from "@sentinel/shared";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Form";
import { useToast } from "@/components/ui/Toast";
import { ApiError, errorMessage } from "@/lib/api";
import { setUiLanguage, UI_LANGUAGES } from "@/i18n";
import { cn } from "@/lib/format";
import { useAuth } from "./AuthContext";

/** Before sign-in there is no account preference; this choice is remembered on this browser only. */
function LanguageSwitch() {
  const { t, i18n } = useTranslation();
  return (
    <div role="group" aria-label={t("language.label")} className="flex gap-1 text-small">
      {UI_LANGUAGES.map((l) => (
        <button
          key={l}
          type="button"
          lang={l}
          aria-pressed={i18n.language === l}
          onClick={() => setUiLanguage(l)}
          className={cn("rounded-sm px-2 py-1", i18n.language === l ? "bg-surface-3 font-medium text-fg-1" : "text-fg-2 hover:text-fg-1")}
        >
          {t(`language.${l}`)}
        </button>
      ))}
    </div>
  );
}

function AuthLayout({ title, subtitle, children }: { title: string; subtitle: ReactNode; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="grid min-h-full lg:grid-cols-2">
      <aside className="relative hidden overflow-hidden border-r border-subtle bg-bg-0 p-12 lg:flex lg:flex-col lg:justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck aria-hidden className="h-6 w-6 text-accent-fg" strokeWidth={1.75} />
          <span className="text-h2 font-semibold tracking-[-0.01em]">Sentinel</span>
        </div>
        <div className="max-w-md">
          <p className="text-[32px] font-semibold leading-10 tracking-[-0.01em] text-fg-1">{t("auth.tagline")}</p>
          <ul className="mt-6 space-y-3 text-body text-fg-2">
            {(["p1", "p2", "p3"] as const).map((k) => (
              <li key={k}>{t(`auth.points.${k}`)}</li>
            ))}
          </ul>
        </div>
        <p className="text-caption text-fg-3">{t("auth.scope")}</p>
      </aside>
      <main className="flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 lg:invisible">
              <ShieldCheck aria-hidden className="h-6 w-6 text-accent-fg" />
              <span className="text-h2 font-semibold">Sentinel</span>
            </div>
            <LanguageSwitch />
          </div>
          <h1 className="text-h1 font-semibold tracking-[-0.01em]">{title}</h1>
          <p className="mt-1 text-body text-fg-2">{subtitle}</p>
          <div className="mt-8">{children}</div>
        </div>
      </main>
    </div>
  );
}

function PasswordInput(props: { id: string; value: string; onChange: (v: string) => void; describedBy?: string | undefined; invalid: boolean; autoComplete: string }) {
  const [shown, setShown] = useState(false);
  const { t } = useTranslation();
  return (
    <div className="relative">
      <Input
        id={props.id}
        type={shown ? "text" : "password"}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        aria-describedby={props.describedBy}
        aria-invalid={props.invalid}
        autoComplete={props.autoComplete}
        className="pr-10"
        required
      />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-label={shown ? t("auth.hidePassword") : t("auth.showPassword")}
        aria-pressed={shown}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-fg-3 hover:text-fg-1"
      >
        {shown ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

/** Rough guidance only; the server enforces the length rule. `score` indexes `auth.strength`. */
function strength(pw: string): { score: 0 | 1 | 2 | 3 } {
  let score = 0;
  if (pw.length >= 12) score++;
  if (pw.length >= 16) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw) && /\d|[^A-Za-z0-9]/.test(pw)) score++;
  const s = Math.min(score, 3) as 0 | 1 | 2 | 3;
  return { score: s };
}

function fieldErrors(err: unknown): Record<string, string> {
  if (!(err instanceof ApiError) || !err.details) return {};
  return Object.fromEntries(err.details.filter((d) => d.path).map((d) => [d.path as string, d.message]));
}

export function LoginPage() {
  const { status, login, verifyMfa } = useAuth();
  const { t } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [challenge, setChallenge] = useState<string | null>(null);
  const [useRecovery, setUseRecovery] = useState(false);
  const [code, setCode] = useState("");
  if (status === "authenticated") return <Navigate to="/" replace />;

  const goOn = () => {
    const from = (location.state as { from?: string } | null)?.from;
    navigate(from && from !== "/login" ? from : "/", { replace: true });
  };
  const failure = (err: unknown) =>
    setError(err instanceof ApiError && err.code === "RATE_LIMITED" ? t("auth.rateLimited") : errorMessage(err));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = loginBodySchema.safeParse({ email, password });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? t("auth.checkForm"));
    setBusy(true);
    try {
      const result = await login(parsed.data.email, parsed.data.password);
      if (result) {
        setChallenge(result.mfaToken);
        setPassword("");
      } else goOn();
    } catch (err) {
      failure(err);
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = (useRecovery ? recoveryCodeSchema : totpCodeSchema).safeParse(code);
    if (!parsed.success || !challenge) return setError(parsed.error?.issues[0]?.message ?? t("auth.checkCode"));
    setBusy(true);
    try {
      const { recoveryCodesLeft } = await verifyMfa(challenge, useRecovery ? { recoveryCode: parsed.data } : { code: parsed.data });
      if (useRecovery) toast.success(t("auth.recoveryUsed", { count: recoveryCodesLeft }));
      goOn();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401 && /expired/i.test(err.message)) setChallenge(null);
      failure(err);
    } finally {
      setBusy(false);
    }
  };

  if (challenge) {
    return (
      <AuthLayout title={t("auth.mfaTitle")} subtitle={useRecovery ? t("auth.mfaSubtitleRecovery") : t("auth.mfaSubtitleCode")}>
        <form onSubmit={submitCode} className="space-y-4" noValidate>
          {error && (
            <p role="alert" className="rounded-md border border-sev-critical/40 bg-sev-critical/10 px-3 py-2 text-small text-sevfg-critical">
              {error}
            </p>
          )}
          <Field label={useRecovery ? t("auth.recoveryCode") : t("auth.authCode")}>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoComplete="one-time-code"
                inputMode={useRecovery ? "text" : "numeric"}
                autoFocus
                className="font-mono tracking-[0.2em]"
                aria-describedby={describedBy}
                aria-invalid={invalid}
              />
            )}
          </Field>
          <Button type="submit" variant="primary" className="w-full" loading={busy}>
            {t("auth.verify")}
          </Button>
        </form>
        <div className="mt-6 flex flex-wrap justify-between gap-2 text-small">
          <button
            type="button"
            className="font-medium text-accent-fg hover:underline"
            onClick={() => {
              setUseRecovery((v) => !v);
              setCode("");
              setError(null);
            }}
          >
            {useRecovery ? t("auth.useApp") : t("auth.useRecovery")}
          </button>
          <button type="button" className="text-fg-2 hover:text-fg-1" onClick={() => setChallenge(null)}>
            {t("auth.startOver")}
          </button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={t("auth.signIn")} subtitle={t("auth.signInSubtitle")}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && (
          <p role="alert" className="rounded-md border border-sev-critical/40 bg-sev-critical/10 px-3 py-2 text-small text-sevfg-critical">
            {error}
          </p>
        )}
        <Field label={t("auth.email")}>
          {({ id, describedBy, invalid }) => (
            <Input id={id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" aria-describedby={describedBy} aria-invalid={invalid} required />
          )}
        </Field>
        <Field label={t("auth.password")}>
          {({ id, describedBy, invalid }) => <PasswordInput id={id} value={password} onChange={setPassword} describedBy={describedBy} invalid={invalid} autoComplete="current-password" />}
        </Field>
        <Button type="submit" variant="primary" className="w-full" loading={busy}>
          {t("auth.signIn")}
        </Button>
      </form>
      <p className="mt-6 text-small text-fg-2">
        {t("auth.noAccount")}{" "}
        <Link to="/register" className="font-medium text-accent-fg hover:underline">
          {t("auth.createOne")}
        </Link>
      </p>
    </AuthLayout>
  );
}

export function RegisterPage() {
  const { status, register } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", email: "", password: "", orgName: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (status === "authenticated") return <Navigate to="/" replace />;
  const pw = strength(form.password);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = registerBodySchema.safeParse({ ...form, orgName: form.orgName.trim() || undefined });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await register(parsed.data);
      navigate("/", { replace: true });
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <AuthLayout title={t("auth.registerTitle")} subtitle={t("auth.registerSubtitle")}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && (
          <p role="alert" className="rounded-md border border-sev-critical/40 bg-sev-critical/10 px-3 py-2 text-small text-sevfg-critical">
            {error}
          </p>
        )}
        <Field label={t("auth.fullName")} error={errors.name}>
          {({ id, describedBy, invalid }) => <Input id={id} value={form.name} onChange={(e) => set("name")(e.target.value)} autoComplete="name" aria-describedby={describedBy} aria-invalid={invalid} required />}
        </Field>
        <Field label={t("auth.workEmail")} error={errors.email}>
          {({ id, describedBy, invalid }) => (
            <Input id={id} type="email" value={form.email} onChange={(e) => set("email")(e.target.value)} autoComplete="email" aria-describedby={describedBy} aria-invalid={invalid} required />
          )}
        </Field>
        <Field label={t("auth.orgName")} error={errors.orgName}>
          {({ id, describedBy, invalid }) => <Input id={id} value={form.orgName} onChange={(e) => set("orgName")(e.target.value)} aria-describedby={describedBy} aria-invalid={invalid} />}
        </Field>
        <Field
          label={t("auth.password")}
          error={errors.password}
          hint={
            <span className="flex items-center gap-2">
              <span className="flex gap-1" aria-hidden>
                {[1, 2, 3].map((i) => (
                  <span key={i} className={cn("h-1 w-8 rounded-full", pw.score >= i ? "bg-accent" : "bg-surface-3")} />
                ))}
              </span>
              {form.password ? t(`auth.strength.s${pw.score}`) : t("auth.atLeast12")}
            </span>
          }
        >
          {({ id, describedBy, invalid }) => <PasswordInput id={id} value={form.password} onChange={set("password")} describedBy={describedBy} invalid={invalid} autoComplete="new-password" />}
        </Field>
        <Button type="submit" variant="primary" className="w-full" loading={busy}>
          {t("auth.createWorkspace")}
        </Button>
      </form>
      <p className="mt-6 text-small text-fg-2">
        {t("auth.haveAccount")}{" "}
        <Link to="/login" className="font-medium text-accent-fg hover:underline">
          {t("auth.signIn")}
        </Link>
      </p>
    </AuthLayout>
  );
}
