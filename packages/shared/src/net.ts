/** Browser-safe IP check (node:net is not available in the web app). */
export function isIP(value: string): boolean {
  if (/^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(value)) return true;
  if (!value.includes(":") || !/^[0-9a-fA-F:.]+$/.test(value)) return false;
  // IPv6: at most one "::", at most eight groups of up to four hex digits.
  const parts = value.split("::");
  if (parts.length > 2) return false;
  const groups = parts.flatMap((p) => (p ? p.split(":") : []));
  if (groups.some((g) => !/^[0-9a-fA-F]{1,4}$/.test(g))) return false;
  return parts.length === 2 ? groups.length < 8 : groups.length === 8;
}

export interface Cidr {
  version: 4 | 6;
  network: bigint;
  prefix: number;
}

function ipToBigInt(ip: string): { version: 4 | 6; value: bigint } | null {
  if (!isIP(ip)) return null;
  if (!ip.includes(":")) {
    return { version: 4, value: ip.split(".").reduce((acc, o) => (acc << 8n) + BigInt(Number(o)), 0n) };
  }
  const [head = "", tail] = ip.split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const groups = tail === undefined ? h : [...h, ...Array<string>(8 - h.length - t.length).fill("0"), ...t];
  return { version: 6, value: groups.reduce((acc, g) => (acc << 16n) + BigInt(parseInt(g, 16)), 0n) };
}

/**
 * Parses "203.0.113.0/24", "2001:db8::/32" or a single address (as /32 or /128).
 * Returns null for anything else, including host bits set outside the prefix
 * ("10.0.0.5/24"), so an allowlist entry always means exactly what it says.
 */
export function parseCidr(value: string): Cidr | null {
  const [addr = "", bits, extra] = value.trim().split("/");
  if (extra !== undefined) return null;
  const ip = ipToBigInt(addr);
  if (!ip) return null;
  const max = ip.version === 4 ? 32 : 128;
  if (bits !== undefined && !/^\d{1,3}$/.test(bits)) return null;
  const prefix = bits === undefined ? max : Number(bits);
  if (prefix > max) return null;
  const hostMask = (1n << BigInt(max - prefix)) - 1n;
  if ((ip.value & hostMask) !== 0n) return null;
  return { version: ip.version, network: ip.value, prefix };
}

export function cidrContains(cidr: Cidr, ip: string): boolean {
  const addr = ipToBigInt(ip);
  if (!addr || addr.version !== cidr.version) return false;
  const max = cidr.version === 4 ? 32 : 128;
  return addr.value >> BigInt(max - cidr.prefix) === cidr.network >> BigInt(max - cidr.prefix);
}

/** Canonical text of a valid CIDR or address, for display and deduplication. */
export function normalizeCidr(value: string): string | null {
  const c = parseCidr(value);
  if (!c) return null;
  const [addr = ""] = value.trim().split("/");
  return `${addr.toLowerCase()}/${c.prefix}`;
}
