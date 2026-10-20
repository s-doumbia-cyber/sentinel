import { z } from "zod";

// ---- Network scope (an observation computed from the address itself) -----------

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p) || Number(p) > 255) return null;
    n = n * 256 + Number(p);
  }
  return n;
}

const PRIVATE_V4: [string, number][] = [
  ["10.0.0.0", 8],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["100.64.0.0", 10],
];

/** RFC 1918 / loopback / link-local / CGNAT for IPv4; ULA and link-local for IPv6. */
export function addressScope(ip: string): "internal" | "external" | "unknown" {
  const v4 = ipv4ToInt(ip);
  if (v4 !== null) {
    const inRange = PRIVATE_V4.some(([base, bits]) => {
      const b = ipv4ToInt(base) ?? 0;
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      return ((v4 & mask) >>> 0) === ((b & mask) >>> 0);
    });
    return inRange ? "internal" : "external";
  }
  const lower = ip.toLowerCase();
  if (lower.includes(":")) return /^(fc|fd|fe8|fe9|fea|feb|::1$)/.test(lower) ? "internal" : "external";
  return "unknown";
}

// ---- Device type estimate (never a fact) ---------------------------------------------

export interface ObservedService {
  port: number;
  protocol: string;
  flows: number;
}

export interface DeviceEstimate {
  label: string;
  basis: string;
  confidence: "low";
  source: "port-heuristic";
}

const SERVICE_HINTS: { ports: number[]; label: string }[] = [
  { ports: [389, 636, 88, 3268], label: "Directory / Kerberos server (possibly a domain controller)" },
  { ports: [3389], label: "Remote desktop host (often Windows)" },
  { ports: [445, 139], label: "File-sharing host (SMB)" },
  { ports: [53], label: "DNS server" },
  { ports: [25, 465, 587, 143, 993, 110, 995], label: "Mail server" },
  { ports: [3306, 5432, 1433, 1521, 27017, 6379], label: "Database server" },
  { ports: [21], label: "FTP server" },
  { ports: [22], label: "SSH server" },
  { ports: [80, 443, 8080, 8443], label: "Web server" },
  { ports: [123], label: "NTP server" },
];

/** A port accepting this few flows is not treated as a service (could be a single probe). */
export const MIN_SERVICE_FLOWS = 3;

/**
 * Estimates what kind of device an address is from the services it accepted in
 * observed flows. Always low confidence: ports are conventions, not proof, and
 * NAT or port forwarding can make one address look like several devices.
 */
export function estimateDeviceType(services: ObservedService[], flowsAsSource: number): DeviceEstimate | null {
  const accepted = services.filter((s) => s.flows >= MIN_SERVICE_FLOWS);
  for (const hint of SERVICE_HINTS) {
    const matched = accepted.filter((s) => hint.ports.includes(s.port));
    if (matched.length) {
      return {
        label: hint.label,
        basis: `Accepted connections on ${matched.map((m) => `${m.protocol}/${m.port}`).join(", ")} in observed flows`,
        confidence: "low",
        source: "port-heuristic",
      };
    }
  }
  if (!accepted.length && flowsAsSource > 0) {
    return {
      label: "Client (only initiated connections)",
      basis: "Seen only as the source of flows; no accepted service observed",
      confidence: "low",
      source: "port-heuristic",
    };
  }
  return null;
}

// ---- Identity sources and attribution ------------------------------------------------

/** Where an IP ↔ identity association comes from. Flows alone are never one of them. */
export const IDENTITY_SOURCES = ["vpn", "dhcp", "auth", "edr", "directory", "manual"] as const;
export type IdentitySource = (typeof IDENTITY_SOURCES)[number];

export const IDENTITY_SOURCE_LABEL: Record<IdentitySource, string> = {
  vpn: "VPN gateway log",
  dhcp: "DHCP lease log",
  auth: "Authentication log",
  edr: "EDR / endpoint agent",
  directory: "Directory (AD/LDAP) export",
  manual: "Manual entry",
};

/** Integrations that would make attribution possible, shown when nothing is connected. */
export const ATTRIBUTION_HELP = [
  "DHCP lease logs map internal addresses to device names and MAC addresses over time.",
  "VPN gateway logs map tunnel addresses to the account that authenticated.",
  "Authentication logs (AD, RADIUS, SSO) show which account signed in from an address.",
  "EDR or endpoint agents report the logged-in user of a device directly.",
] as const;

/** One row of an identity CSV import. Headers: ip,start,end,source,username,hostname,mac. */
export const identityRowSchema = z
  .object({
    ip: z.string().trim().ip(),
    start: z.string().trim().datetime({ offset: true }),
    end: z
      .string()
      .trim()
      .transform((v) => (v === "" ? null : v))
      .pipe(z.string().datetime({ offset: true }).nullable())
      .optional(),
    source: z.enum(IDENTITY_SOURCES),
    username: z.string().trim().max(256).optional().transform((v) => v || null),
    hostname: z.string().trim().max(256).optional().transform((v) => v || null),
    mac: z
      .string()
      .trim()
      .optional()
      .transform((v) => v || null)
      .pipe(z.string().regex(/^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i, "Invalid MAC address").nullable()),
  })
  .refine((r) => r.username || r.hostname || r.mac, "Each row needs a username, hostname or MAC address")
  .refine((r) => !r.end || r.end >= r.start, "end must not be before start");
export type IdentityRow = z.infer<typeof identityRowSchema>;

export type AttributionConfidence = "high" | "medium" | "low";

export interface AttributionCandidate {
  username: string | null;
  hostname: string | null;
  mac: string | null;
  source: IdentitySource;
  validFrom: string;
  validTo: string | null;
  confidence: AttributionConfidence;
  reasons: string[];
}

/**
 * Grades one identity record against the time window of the activity being
 * explained. The grade describes the record, never the person: an address can
 * be shared (NAT, VPN concentrator, multi-user host).
 */
export function gradeAttribution(
  rec: { source: IdentitySource; validFrom: Date; validTo: Date | null },
  window: { from: Date; to: Date },
): { confidence: AttributionConfidence; reasons: string[] } {
  const reasons: string[] = [];
  const end = rec.validTo ?? rec.validFrom;
  const covers = rec.validFrom <= window.from && end >= window.to;
  const overlaps = rec.validFrom <= window.to && end >= window.from;
  if (!overlaps) return { confidence: "low", reasons: ["The record does not overlap the activity window"] };
  reasons.push(covers ? "The record covers the whole activity window" : "The record only partly overlaps the activity window");
  if (rec.source === "manual") {
    reasons.push("Manual entry: not produced by a system log");
    return { confidence: "low", reasons };
  }
  const strong = rec.source === "vpn" || rec.source === "auth" || rec.source === "edr";
  reasons.push(strong ? "Session-level source (who authenticated or was logged in)" : "Device-level source (which device held the address)");
  return { confidence: covers && strong ? "high" : "medium", reasons };
}
