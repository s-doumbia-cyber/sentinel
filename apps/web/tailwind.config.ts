import type { Config } from "tailwindcss";

// Every colour is a CSS variable defined in src/index.css (docs/DESIGN_SYSTEM.md §2).
const rgb = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: { 0: rgb("bg-0"), 1: rgb("bg-1") },
        surface: { 1: rgb("surface-1"), 2: rgb("surface-2"), 3: rgb("surface-3") },
        fg: { 1: rgb("text-1"), 2: rgb("text-2"), 3: rgb("text-3") },
        accent: { DEFAULT: rgb("accent"), fg: rgb("accent-fg"), contrast: rgb("accent-contrast") },
        sev: {
          critical: rgb("sev-critical"),
          high: rgb("sev-high"),
          medium: rgb("sev-medium"),
          low: rgb("sev-low"),
          info: rgb("sev-info"),
          ok: rgb("sev-ok"),
        },
        kind: { live: rgb("kind-live"), replay: rgb("kind-replay"), imported: rgb("kind-imported"), demo: rgb("kind-demo") },
      },
      borderColor: { subtle: "var(--border-subtle)", DEFAULT: "var(--border)", strong: "var(--border-strong)" },
      backgroundColor: { "accent-soft": "var(--accent-soft)" },
      fontFamily: {
        sans: ['"Inter Variable"', "Inter", "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
      },
      fontSize: {
        caption: ["12px", "16px"],
        small: ["13px", "20px"],
        body: ["14px", "22px"],
        h3: ["16px", "24px"],
        h2: ["20px", "28px"],
        h1: ["24px", "32px"],
        kpi: ["28px", "36px"],
      },
      borderRadius: { sm: "6px", md: "8px", lg: "12px", xl: "16px" },
      boxShadow: { e1: "var(--shadow-e1)", e2: "var(--shadow-e2)", e3: "var(--shadow-e3)" },
      transitionTimingFunction: { enter: "cubic-bezier(0.2, 0, 0, 1)", exit: "cubic-bezier(0.4, 0, 1, 1)" },
      transitionDuration: { fast: "120ms", base: "200ms", slow: "320ms" },
      maxWidth: { content: "1440px" },
    },
  },
  plugins: [],
} satisfies Config;
