import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "@/services/api";

export interface UserPreferences {
  emailAlerts: boolean;
  pushAlerts: boolean;
  language: string;
  accentColor: "violet" | "cyan" | "pink";
}

interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: "Analyst" | "Admin" | "Viewer";
  preferences: UserPreferences;
}

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  logoutAll: () => Promise<void>;
  updateProfile: (patch: { name?: string; preferences?: Partial<UserPreferences> }) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<string>;
  deleteAccount: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const TOKEN_KEY = "soc_dashboard_token";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => sessionStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    if (token) {
      api.defaults.headers.common.Authorization = `Bearer ${token}`;
    } else {
      delete api.defaults.headers.common.Authorization;
    }
  }, [token]);

  useEffect(() => {
    if (token && !user) {
      api
        .get("/auth/me")
        .then(({ data }) => setUser(data.user))
        .catch(() => {
          sessionStorage.removeItem(TOKEN_KEY);
          setToken(null);
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  function clearSession() {
    sessionStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
  }

  async function login(email: string, password: string) {
    const { data } = await api.post("/auth/login", { email, password });
    sessionStorage.setItem(TOKEN_KEY, data.token);
    setToken(data.token);
    setUser(data.user);
  }

  async function register(name: string, email: string, password: string) {
    const { data } = await api.post("/auth/register", { name, email, password });
    sessionStorage.setItem(TOKEN_KEY, data.token);
    setToken(data.token);
    setUser(data.user);
  }

  async function logout() {
    try {
      await api.post("/auth/logout");
    } catch {
      // best-effort — even if the server call fails, still clear the local session
    }
    clearSession();
  }

  async function logoutAll() {
    try {
      await api.post("/auth/logout-all");
    } finally {
      clearSession();
    }
  }

  async function updateProfile(patch: { name?: string; preferences?: Partial<UserPreferences> }) {
    const { data } = await api.patch("/auth/me", patch);
    setUser(data.user);
  }

  async function changePassword(currentPassword: string, newPassword: string) {
    const { data } = await api.post("/auth/change-password", { currentPassword, newPassword });
    return data.message as string;
  }

  async function deleteAccount() {
    await api.delete("/auth/me");
    clearSession();
  }

  const value = useMemo(
    () => ({
      user,
      token,
      isAuthenticated: Boolean(token),
      login,
      register,
      logout,
      logoutAll,
      updateProfile,
      changePassword,
      deleteAccount,
    }),
    [user, token]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
