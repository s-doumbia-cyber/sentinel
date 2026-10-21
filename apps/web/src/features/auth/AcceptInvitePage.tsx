import { ShieldCheck } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { acceptInviteNewAccountBodySchema, inviteTokenSchema } from "@sentinel/shared";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Form";
import { Skeleton } from "@/components/ui/States";
import { api, ApiError, errorMessage } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import type { InviteLookup } from "@/features/team/teamApi";
import { useAuth } from "./AuthContext";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-full items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center gap-2">
          <ShieldCheck aria-hidden className="h-6 w-6 text-accent-fg" />
          <span className="text-h2 font-semibold">Sentinel</span>
        </div>
        {children}
      </div>
    </main>
  );
}

function Alert({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="rounded-md border border-sev-critical/40 bg-sev-critical/10 px-3 py-2 text-small text-sevfg-critical">
      {children}
    </p>
  );
}

/**
 * Invitation links look like /accept-invite#<token>. The fragment never reaches a
 * server log or a Referer header; the token is sent only in POST bodies.
 */
export function AcceptInvitePage() {
  const { status, user, acceptInvite, reloadSession, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const token = location.hash.replace(/^#/, "");
  const validToken = inviteTokenSchema.safeParse(token).success;
  const [invite, setInvite] = useState<InviteLookup | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", password: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!validToken) return;
    let cancelled = false;
    api<InviteLookup>("/invites/lookup", { method: "POST", body: { token } })
      .then((r) => !cancelled && setInvite(r))
      .catch((e: unknown) => {
        if (cancelled) return;
        setLoadError(
          e instanceof ApiError && e.status === 404
            ? "This invitation is invalid, was already used, was revoked or has expired. Ask the person who invited you for a new link."
            : errorMessage(e),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [token, validToken]);

  if (!validToken) {
    return (
      <Shell>
        <h1 className="text-h1 font-semibold">Invitation link incomplete</h1>
        <p className="mt-2 text-body text-fg-2">Open the full link you were sent; it ends with a long code after “#”.</p>
      </Shell>
    );
  }
  if (loadError) {
    return (
      <Shell>
        <h1 className="mb-4 text-h1 font-semibold">Invitation unavailable</h1>
        <Alert>{loadError}</Alert>
      </Shell>
    );
  }
  if (!invite || status === "loading") {
    return (
      <Shell>
        <div role="status" aria-label="Checking the invitation" className="space-y-3">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-24" />
        </div>
      </Shell>
    );
  }

  const intro = (
    <>
      <h1 className="text-h1 font-semibold tracking-[-0.01em]">Join {invite.orgName}</h1>
      <p className="mt-1 text-body text-fg-2">
        You are invited as <span className="font-medium text-fg-1">{invite.role}</span> with the address{" "}
        <span className="font-medium text-fg-1">{invite.email}</span>. The link works once, until {formatDateTime(invite.expiresAt)}.
      </p>
    </>
  );

  const joinExisting = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ joinedOrgId: string }>("/invites/accept-existing", { method: "POST", body: { token } });
      await reloadSession(res.joinedOrgId);
      navigate("/", { replace: true });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (status === "authenticated") {
    const matches = user?.email === invite.email;
    return (
      <Shell>
        {intro}
        <div className="mt-6 space-y-4">
          {error && <Alert>{error}</Alert>}
          {matches ? (
            <Button variant="primary" className="w-full" loading={busy} onClick={() => void joinExisting()}>
              Join {invite.orgName}
            </Button>
          ) : (
            <>
              <p className="text-small text-fg-2">
                You are signed in as <span className="font-medium text-fg-1">{user?.email}</span>, but this invitation is for {invite.email}. Sign out, then open the link
                again.
              </p>
              <Button className="w-full" onClick={() => void logout()}>
                Sign out
              </Button>
            </>
          )}
        </div>
      </Shell>
    );
  }

  if (invite.accountExists) {
    return (
      <Shell>
        {intro}
        <p className="mt-6 text-small text-fg-2">An account already exists for {invite.email}. Sign in with it to accept.</p>
        <Button variant="primary" className="mt-4 w-full" onClick={() => navigate("/login", { state: { from: `/accept-invite#${token}` } })}>
          Sign in to accept
        </Button>
      </Shell>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = acceptInviteNewAccountBodySchema.safeParse({ token, ...form });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await acceptInvite(parsed.data);
      navigate("/", { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell>
      {intro}
      <form onSubmit={submit} noValidate className="mt-6 space-y-4">
        {error && <Alert>{error}</Alert>}
        <Field label="Email">{({ id }) => <Input id={id} value={invite.email} readOnly />}</Field>
        <Field label="Full name" error={errors.name}>
          {({ id, describedBy, invalid }) => (
            <Input id={id} autoComplete="name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} aria-describedby={describedBy} aria-invalid={invalid} />
          )}
        </Field>
        <Field label="Password" error={errors.password} hint="At least 12 characters.">
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              type="password"
              autoComplete="new-password"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              aria-describedby={describedBy}
              aria-invalid={invalid}
            />
          )}
        </Field>
        <Button type="submit" variant="primary" className="w-full" loading={busy}>
          Create account and join
        </Button>
      </form>
      <p className="mt-6 text-small text-fg-2">
        Already have an account with this email?{" "}
        <Link to="/login" state={{ from: `/accept-invite#${token}` }} className="font-medium text-accent-fg hover:underline">
          Sign in
        </Link>
      </p>
    </Shell>
  );
}
