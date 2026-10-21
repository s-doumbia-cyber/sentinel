import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { can, type Action, type Role } from "@sentinel/shared";
import { api, onSessionExpired, refreshSession, setAccessToken, setActiveOrg } from "@/lib/api";
import type { AuthResponse, MeResponse, OrgMembership, User, UserPreferences } from "@/lib/types";

type Status = "loading" | "authenticated" | "anonymous";

interface AuthValue {
  status: Status;
  user: User | null;
  orgs: OrgMembership[];
  activeOrg: OrgMembership | null;
  role: Role | null;
  login: (email: string, password: string) => Promise<void>;
  register: (input: { name: string; email: string; password: string; orgName?: string }) => Promise<void>;
  logout: () => Promise<void>;
  switchOrg: (orgId: string) => Promise<void>;
  /** Creates the account from an invitation and signs in, landing in the invited org. */
  acceptInvite: (input: { token: string; name: string; password: string }) => Promise<void>;
  /** Re-reads the account and memberships (after joining or leaving an org). */
  reloadSession: (preferredOrgId?: string) => Promise<void>;
  setUser: (user: User) => void;
  /** Cosmetic only: the API enforces every permission. */
  can: (action: Action) => boolean;
}

const AuthContext = createContext<AuthValue | null>(null);
const ORG_KEY = "sentinel.org";

/** Applies theme, accent and density, and caches them for the pre-paint script. */
export function applyPreferences(p: Pick<UserPreferences, "theme" | "accentColor" | "density">) {
  const root = document.documentElement;
  const theme = p.theme === "system" ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : p.theme;
  root.setAttribute("data-theme", theme);
  root.setAttribute("data-accent", p.accentColor);
  if (p.density === "compact") root.setAttribute("data-density", "compact");
  else root.removeAttribute("data-density");
  try {
    localStorage.setItem("sentinel.theme", p.theme);
    localStorage.setItem("sentinel.accent", p.accentColor);
    localStorage.setItem("sentinel.density", p.density);
  } catch {
    // Storage can be unavailable (private mode); the attributes above still apply.
  }
}

function storedOrg(): string | null {
  try {
    return localStorage.getItem(ORG_KEY);
  } catch {
    return null;
  }
}

function rememberOrg(id: string | null) {
  try {
    if (id) localStorage.setItem(ORG_KEY, id);
    else localStorage.removeItem(ORG_KEY);
  } catch {
    // Non-essential convenience.
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUserState] = useState<User | null>(null);
  const [orgs, setOrgs] = useState<OrgMembership[]>([]);
  const [activeOrgId, setActiveOrgId] = useState<string | null>(null);

  const adopt = useCallback((u: User, memberships: OrgMembership[]) => {
    const preferred = storedOrg();
    const org = memberships.find((o) => o.id === preferred) ?? memberships[0] ?? null;
    setActiveOrg(org?.id ?? null);
    setActiveOrgId(org?.id ?? null);
    setUserState(u);
    setOrgs(memberships);
    applyPreferences(u.preferences);
    setStatus("authenticated");
  }, []);

  const reset = useCallback(() => {
    setAccessToken(null);
    setActiveOrg(null);
    setUserState(null);
    setOrgs([]);
    setActiveOrgId(null);
    queryClient.clear();
    setStatus("anonymous");
  }, [queryClient]);

  useEffect(() => {
    onSessionExpired(reset);
    let cancelled = false;
    (async () => {
      // A valid refresh cookie restores the session after a reload; nothing is read from storage.
      if (!(await refreshSession())) {
        if (!cancelled) setStatus("anonymous");
        return;
      }
      try {
        const me = await api<MeResponse>("/me");
        if (!cancelled) adopt(me.user, me.orgs);
      } catch {
        if (!cancelled) reset();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [adopt, reset]);

  const value = useMemo<AuthValue>(() => {
    const activeOrg = orgs.find((o) => o.id === activeOrgId) ?? null;
    const role = activeOrg?.role ?? null;
    return {
      status,
      user,
      orgs,
      activeOrg,
      role,
      async login(email, password) {
        const res = await api<AuthResponse>("/auth/login", { method: "POST", body: { email, password } });
        setAccessToken(res.accessToken);
        adopt(res.user, res.orgs);
      },
      async register(input) {
        const res = await api<AuthResponse>("/auth/register", { method: "POST", body: input });
        setAccessToken(res.accessToken);
        rememberOrg(res.orgs[0]?.id ?? null);
        adopt(res.user, res.orgs);
      },
      async logout() {
        try {
          await api("/auth/logout", { method: "POST", csrf: true });
        } finally {
          reset();
        }
      },
      async acceptInvite(input) {
        const res = await api<AuthResponse & { joinedOrgId: string }>("/invites/accept", { method: "POST", body: input });
        setAccessToken(res.accessToken);
        rememberOrg(res.joinedOrgId);
        adopt(res.user, res.orgs);
      },
      async reloadSession(preferredOrgId) {
        // Without X-Org-Id the API answers for the oldest remaining membership.
        setActiveOrg(null);
        rememberOrg(preferredOrgId ?? null);
        queryClient.clear();
        try {
          const me = await api<MeResponse>("/me");
          adopt(me.user, me.orgs);
        } catch {
          // No membership left anywhere: nothing in the app is reachable, so sign out.
          try {
            await api("/auth/logout", { method: "POST", csrf: true });
          } finally {
            reset();
          }
        }
      },
      async switchOrg(orgId) {
        if (!orgs.some((o) => o.id === orgId)) return;
        setActiveOrg(orgId);
        rememberOrg(orgId);
        setActiveOrgId(orgId);
        // Never show one org's cached data under another.
        queryClient.clear();
      },
      setUser(u) {
        setUserState(u);
        applyPreferences(u.preferences);
      },
      can: (action) => (role ? can(role, action) : false),
    };
  }, [status, user, orgs, activeOrgId, adopt, reset, queryClient]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
