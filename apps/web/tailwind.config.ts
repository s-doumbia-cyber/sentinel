import type { Config } from "tailwindcss";

// Centralized design tokens. Every color/spacing/radius decision in the app
// should reference these values instead of hardcoding magic numbers/hex codes.
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        base: {
          950: "#05060A", // deepest background
          900: "#0B0F19", // panel background
          800: "#10141F",
          700: "#161B29",
        },
        glass: {
          border: "rgba(255,255,255,0.08)",
          borderStrong: "rgba(255,255,255,0.14)",
          fill: "rgba(255,255,255,0.04)",
        },
        neon: {
          violet: "#8B5CF6",
          violetStrong: "#A855F7",
          pink: "#EC4899",
          pinkStrong: "#F0399B",
          blue: "#3B82F6",
          cyan: "#22D3EE",
        },
        severity: {
          critical: "#F0399B",
          high: "#EC4899",
          medium: "#A855F7",
          low: "#22D3EE",
          info: "#3B82F6",
          safe: "#34D399",
        },
      },
      fontFamily: {
        display: ["Sora", "system-ui", "sans-serif"],
        body: ["Inter", "system-ui", "sans-serif"],
        mono: ["Space Grotesk", "monospace"],
      },
      spacing: {
        px8: "8px",
      },
      borderRadius: {
        "2xl": "1rem",
        "3xl": "1.5rem",
      },
      boxShadow: {
        glow: "0 0 24px var(--accent-glow, rgba(139, 92, 246, 0.35))",
        glowPink: "0 0 24px rgba(236, 72, 153, 0.35)",
        glowCyan: "0 0 24px rgba(34, 211, 238, 0.35)",
        panel: "0 8px 32px rgba(0,0,0,0.45)",
      },
      backgroundImage: {
        // Reads from --accent-1/--accent-2, set at runtime by ThemeEffect
        // based on the user's saved accentColor preference (defaults match
        // the original violet->pink look — see index.css for the presets).
        "grad-violet-pink": "linear-gradient(135deg, var(--accent-1, #8B5CF6) 0%, var(--accent-2, #EC4899) 100%)",
        "grad-blue-violet": "linear-gradient(135deg, #22D3EE 0%, #8B5CF6 100%)",
        "grad-radial-glow": "radial-gradient(circle at 50% 0%, rgba(139,92,246,0.18), transparent 60%)",
      },
      keyframes: {
        "fade-slide-up": {
          "0%": { opacity: "0", transform: "translateY(12px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "pulse-glow": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.55" },
        },
      },
      animation: {
        "fade-slide-up": "fade-slide-up 0.5s ease-out both",
        "pulse-glow": "pulse-glow 2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
} satisfies Config;
