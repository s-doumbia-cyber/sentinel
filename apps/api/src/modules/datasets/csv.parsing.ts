import { isIP } from "node:net";

/** Lowercase alphanumerics only, so "Source IP", " Src IP" and "source_ip" compare equal. */
export function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export const IDENTIFIER_ALIASES = {
  sourceIp: ["sourceip", "srcip"],
  sourcePort: ["sourceport", "srcport"],
  destinationIp: ["destinationip", "dstip"],
  destinationPort: ["destinationport", "dstport"],
  protocol: ["protocol"],
  timestamp: ["timestamp"],
  label: ["label"],
} as const;
export type IdentifierField = keyof typeof IDENTIFIER_ALIASES;

/**
 * Trims headers and suffixes repeats (CICIDS2017 repeats "Fwd Header Length").
 * The field map is built from these same trimmed names that become record
 * keys; building it from untrimmed headers once made every lookup miss.
 */
export function dedupeHeaders(headerRow: string[]): string[] {
  const seen = new Map<string, number>();
  return headerRow.map((h) => {
    const trimmed = h.trim();
    const count = seen.get(trimmed) ?? 0;
    seen.set(trimmed, count + 1);
    return count === 0 ? trimmed : `${trimmed}__dup${count}`;
  });
}

export function buildFieldMap(headers: string[]): Partial<Record<IdentifierField, string>> {
  const normalized = headers.map(normalizeKey);
  const map: Partial<Record<IdentifierField, string>> = {};
  for (const [field, aliases] of Object.entries(IDENTIFIER_ALIASES) as [IdentifierField, readonly string[]][]) {
    const idx = normalized.findIndex((h) => aliases.includes(h));
    const header = headers[idx];
    if (idx !== -1 && header !== undefined) map[field] = header;
  }
  return map;
}

export type Protocol = "TCP" | "UDP" | "ICMP" | "OTHER";

/** IANA protocol numbers. Anything else is explicitly OTHER, never guessed as a known protocol. */
export function parseProtocol(raw: unknown): { protocol: Protocol; protocolNumber: number | null } | null {
  const s = String(raw ?? "").trim().toUpperCase();
  if (s === "") return null;
  if (s === "TCP" || s === "6") return { protocol: "TCP", protocolNumber: 6 };
  if (s === "UDP" || s === "17") return { protocol: "UDP", protocolNumber: 17 };
  if (s === "ICMP" || s === "1") return { protocol: "ICMP", protocolNumber: 1 };
  const n = Number(s);
  if (Number.isInteger(n) && n >= 0 && n <= 255) return { protocol: "OTHER", protocolNumber: n };
  return null;
}

export function parsePort(raw: unknown): number | null {
  const s = String(raw ?? "").trim();
  if (!/^\d{1,5}$/.test(s)) return null;
  const n = Number(s);
  return n <= 65535 ? n : null;
}

export function parseIp(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  return isIP(s) ? s : null;
}

const DMY = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(AM|PM))?$/i;

/**
 * CICIDS2017 writes day/month/year (the capture ran 3–7 July 2017), without a
 * timezone and, in afternoon files, on a 12-hour clock without AM/PM. Values
 * are stored as UTC "as recorded"; the 12-hour ambiguity is a documented
 * dataset limitation, not corrected by guessing. ISO-8601 is also accepted.
 * Returns null when unparsable: the row is rejected, never stamped "now".
 */
export function parseTimestamp(raw: unknown): Date | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const m = DMY.exec(s);
  if (m) {
    const [, d, mo, y, h, mi, sec, ampm] = m;
    let hour = Number(h);
    if (ampm) {
      if (hour < 1 || hour > 12) return null;
      hour = (hour % 12) + (ampm.toUpperCase() === "PM" ? 12 : 0);
    }
    const day = Number(d);
    const month = Number(mo);
    if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || Number(mi) > 59 || Number(sec ?? 0) > 59) return null;
    const date = new Date(Date.UTC(Number(y), month - 1, day, hour, Number(mi), Number(sec ?? 0)));
    return date.getUTCDate() === day ? date : null;
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const date = new Date(s);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}
