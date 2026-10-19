import { useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";

const ACCENT_PRESETS: Record<string, { accent1: string; accent2: string; glow: string }> = {
  violet: { accent1: "#8B5CF6", accent2: "#EC4899", glow: "rgba(139, 92, 246, 0.35)" },
  cyan: { accent1: "#22D3EE", accent2: "#8B5CF6", glow: "rgba(34, 211, 238, 0.35)" },
  pink: { accent1: "#EC4899", accent2: "#F0399B", glow: "rgba(236, 72, 153, 0.35)" },
};

/** Applies the signed-in user's accentColor preference to the app's CSS
 * custom properties, which tailwind.config.ts's gradient/glow utilities
 * read from — this is what makes the Settings accent picker a real,
 * app-wide visual change rather than a decorative select. Renders nothing. */
export function ThemeEffect() {
  const { user } = useAuth();

  useEffect(() => {
    const preset = ACCENT_PRESETS[user?.preferences?.accentColor ?? "violet"] ?? ACCENT_PRESETS.violet;
    const root = document.documentElement;
    root.style.setProperty("--accent-1", preset.accent1);
    root.style.setProperty("--accent-2", preset.accent2);
    root.style.setProperty("--accent-glow", preset.glow);
  }, [user?.preferences?.accentColor]);

  return null;
}
