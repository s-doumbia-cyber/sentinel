/**
 * Single source of truth for raw color values needed outside Tailwind classes
 * (e.g. Recharts stroke/fill props, canvas drawing). Keep this in sync with
 * tailwind.config.ts — never hardcode a hex value in a component directly.
 */
export const colors = {
  background: {
    deep: "#05060A",
    panel: "#0B0F19",
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
} as const;

export const chartPalette = [
  colors.neon.violet,
  colors.neon.violetStrong,
  colors.neon.pink,
  colors.neon.pinkStrong,
  colors.neon.blue,
  colors.neon.cyan,
];

export const fonts = {
  display: "Sora, system-ui, sans-serif",
  body: "Inter, system-ui, sans-serif",
  mono: "'Space Grotesk', monospace",
};
