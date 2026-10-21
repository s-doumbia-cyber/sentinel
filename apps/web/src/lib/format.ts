import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";
import i18n from "@/i18n";

// tailwind-merge only knows Tailwind's default scale. Without this, custom sizes such as
// `text-small` were read as colours, so `cn("text-accent-contrast", "text-small")` silently
// dropped the colour (dark text on filled buttons, found by the e2e accessibility check).
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["caption", "small", "body", "h3", "h2", "h1", "kpi"] }],
      shadow: [{ shadow: ["e1", "e2", "e3"] }],
    },
  },
});

/** Merges class names; later Tailwind utilities win regardless of CSS order (lesson 8). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

// Formatters follow the interface language (a French UI with US dates reads as broken); one set per language.
const formatters = new Map<string, ReturnType<typeof makeFormatters>>();
function makeFormatters(locale: string | undefined) {
  return {
    number: new Intl.NumberFormat(locale),
    compact: new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }),
    dateTime: new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }),
    rel: new Intl.RelativeTimeFormat(locale, { numeric: "auto" }),
  };
}
function fmt() {
  // English keeps the browser's own conventions (12 / 24 h, day order).
  const locale = i18n.language === "fr" ? "fr-FR" : undefined;
  let f = formatters.get(locale ?? "browser");
  if (!f) formatters.set(locale ?? "browser", (f = makeFormatters(locale)));
  return f;
}

/** Abbreviates above 10k (12.4k); callers show the exact value in a title. */
export function formatCount(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return Math.abs(n) >= 10_000 ? fmt().compact.format(n) : fmt().number.format(n);
}

export function formatExact(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : fmt().number.format(n);
}

export function formatPercent(v: number | null | undefined, digits = 1): string {
  return v === null || v === undefined ? "—" : `${(v * 100).toFixed(digits)}%`;
}

export function formatScore(v: number | null | undefined, digits = 3): string {
  return v === null || v === undefined ? "n/a" : v.toFixed(digits);
}

export function formatBytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}


export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return fmt().dateTime.format(new Date(iso));
}

/** Relative under 24 h, absolute otherwise; pair with `utcTitle` for the UTC tooltip. */
export function formatWhen(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const diff = new Date(iso).getTime() - now;
  const abs = Math.abs(diff);
  if (abs < 60_000) return fmt().rel.format(Math.round(diff / 1000), "second");
  if (abs < 3_600_000) return fmt().rel.format(Math.round(diff / 60_000), "minute");
  if (abs < 86_400_000) return fmt().rel.format(Math.round(diff / 3_600_000), "hour");
  return formatDateTime(iso);
}

export function utcTitle(iso: string | null | undefined): string | undefined {
  return iso ? `${new Date(iso).toISOString().replace("T", " ").slice(0, 19)} UTC` : undefined;
}
