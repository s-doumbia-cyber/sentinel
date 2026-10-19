import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merges class names; later Tailwind utilities win regardless of CSS order (lesson 8). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

const numberFmt = new Intl.NumberFormat(undefined);
const compactFmt = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });

/** Abbreviates above 10k (12.4k); callers show the exact value in a title. */
export function formatCount(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return Math.abs(n) >= 10_000 ? compactFmt.format(n) : numberFmt.format(n);
}

export function formatExact(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : numberFmt.format(n);
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

const dateTimeFmt = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const relFmt = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return dateTimeFmt.format(new Date(iso));
}

/** Relative under 24 h, absolute otherwise; pair with `utcTitle` for the UTC tooltip. */
export function formatWhen(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const diff = new Date(iso).getTime() - now;
  const abs = Math.abs(diff);
  if (abs < 60_000) return relFmt.format(Math.round(diff / 1000), "second");
  if (abs < 3_600_000) return relFmt.format(Math.round(diff / 60_000), "minute");
  if (abs < 86_400_000) return relFmt.format(Math.round(diff / 3_600_000), "hour");
  return formatDateTime(iso);
}

export function utcTitle(iso: string | null | undefined): string | undefined {
  return iso ? `${new Date(iso).toISOString().replace("T", " ").slice(0, 19)} UTC` : undefined;
}
