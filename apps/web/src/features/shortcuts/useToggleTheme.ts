import { useToast } from "@/components/ui/Toast";
import { applyPreferences, useAuth } from "@/features/auth/AuthContext";
import { api } from "@/lib/api";
import type { User } from "@/lib/types";

/** Light/dark switch shared by the user menu and the command palette; saved to the user's preferences. */
export function useToggleTheme(): () => void {
  const { user, setUser } = useAuth();
  const toast = useToast();
  return () => {
    if (!user) return;
    const theme = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
    applyPreferences({ ...user.preferences, theme });
    api<{ user: User }>("/me", { method: "PATCH", body: { preferences: { theme } } })
      .then((res) => setUser(res.user))
      .catch(() => toast.error("Theme changed for this session but could not be saved"));
  };
}
