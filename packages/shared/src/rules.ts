import { z } from "zod";
import { SEVERITIES } from "./severity.js";
import { ATTACK_CLASSES } from "./taxonomy.js";

/** Flow fields a rule may group by or count distinct values of. */
export const RULE_FIELDS = ["sourceIp", "destinationIp", "destinationPort", "sourcePort", "protocol"] as const;
export type RuleField = (typeof RULE_FIELDS)[number];

const MAX_WINDOW_MS = 60 * 60 * 1000;

/** "60s", "5m", "1h" → milliseconds; null when invalid or above one hour. */
export function parseWindow(window: string): number | null {
  const m = /^(\d{1,4})(s|m|h)$/.exec(window);
  if (!m) return null;
  const ms = Number(m[1]) * (m[2] === "s" ? 1000 : m[2] === "m" ? 60_000 : 3_600_000);
  return ms > 0 && ms <= MAX_WINDOW_MS ? ms : null;
}

const featureName = z.string().min(1).max(64);

/**
 * Threshold rule (docs/ML_AND_DETECTION.md §7). Within any `window` of event
 * time, for each `groupBy` group of flows that pass `filter`, the rule fires
 * when the number of flows (or of distinct `condition.distinct` values)
 * reaches `condition.gte`.
 */
export const ruleDefinitionSchema = z
  .object({
    key: z.string().regex(/^R-[A-Z0-9-]{2,40}$/, "Key must look like R-PORTSCAN-01"),
    name: z.string().trim().min(3).max(120),
    description: z.string().trim().max(1000).default(""),
    type: z.literal("threshold"),
    window: z.string().refine((w) => parseWindow(w) !== null, "Window must be like 60s, 5m or 1h (at most 1h)"),
    groupBy: z.array(z.enum(RULE_FIELDS)).min(1).max(3),
    condition: z
      .object({
        distinct: z.enum(RULE_FIELDS).optional(),
        gte: z.number().int().min(1).max(1_000_000),
      })
      .strict(),
    filter: z
      .object({
        protocol: z.enum(["TCP", "UDP", "ICMP", "OTHER"]).optional(),
        destinationPorts: z.array(z.number().int().min(0).max(65535)).min(1).max(64).optional(),
        maxPacketsPerFlow: z.number().min(0).optional(),
        minPacketsPerFlow: z.number().min(0).optional(),
        minDurationMs: z.number().min(0).optional(),
        maxDurationMs: z.number().min(0).optional(),
        /** Feature thresholds by schema feature name, e.g. {"SYN Flag Count": 1}. Flows lacking the feature do not match. */
        featureGte: z.record(featureName, z.number()).optional(),
        featureLte: z.record(featureName, z.number()).optional(),
      })
      .strict()
      .default({}),
    severity: z.enum(SEVERITIES).refine((s) => s !== "info", "A rule must have a severity above info"),
    alertType: z.enum(ATTACK_CLASSES).refine((c) => c !== "Normal", "alertType cannot be Normal"),
    enabled: z.boolean().default(true),
  })
  .strict()
  .refine((r) => !r.condition.distinct || !r.groupBy.includes(r.condition.distinct), {
    message: "condition.distinct cannot also be a groupBy field",
    path: ["condition", "distinct"],
  });

export type RuleDefinition = z.infer<typeof ruleDefinitionSchema>;
export type RuleDefinitionInput = z.input<typeof ruleDefinitionSchema>;

/** Editable fields (the key is immutable). */
export const ruleUpdateSchema = z
  .object({
    name: z.string().trim().min(3).max(120).optional(),
    description: z.string().trim().max(1000).optional(),
    window: z.string().optional(),
    groupBy: z.array(z.enum(RULE_FIELDS)).min(1).max(3).optional(),
    condition: z.object({ distinct: z.enum(RULE_FIELDS).optional(), gte: z.number().int().min(1).max(1_000_000) }).strict().optional(),
    filter: z.record(z.unknown()).optional(),
    severity: z.enum(SEVERITIES).optional(),
    alertType: z.enum(ATTACK_CLASSES).optional(),
    enabled: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "At least one field is required");

/**
 * Starter rules seeded into every organisation. Thresholds are deliberately
 * conservative starting points, not tuned values: each org should test them
 * on its own traffic (POST /rules/:id/test) before relying on them.
 */
export const STARTER_RULES: RuleDefinitionInput[] = [
  {
    key: "R-PORTSCAN-01",
    name: "Horizontal/vertical port scan",
    description: "One source touches many distinct destination ports with tiny flows within a minute.",
    type: "threshold",
    window: "60s",
    groupBy: ["sourceIp"],
    condition: { distinct: "destinationPort", gte: 100 },
    filter: { maxPacketsPerFlow: 3 },
    severity: "low",
    alertType: "PortScan",
  },
  {
    key: "R-BRUTEFORCE-SSH-01",
    name: "SSH brute force",
    description: "Many short TCP flows from one source to one SSH server within a minute.",
    type: "threshold",
    window: "60s",
    groupBy: ["sourceIp", "destinationIp"],
    condition: { gte: 30 },
    filter: { protocol: "TCP", destinationPorts: [22], maxDurationMs: 10_000 },
    severity: "medium",
    alertType: "SSHPatator",
  },
  {
    key: "R-BRUTEFORCE-FTP-01",
    name: "FTP brute force",
    description: "Many short TCP flows from one source to one FTP server within a minute.",
    type: "threshold",
    window: "60s",
    groupBy: ["sourceIp", "destinationIp"],
    condition: { gte: 30 },
    filter: { protocol: "TCP", destinationPorts: [21], maxDurationMs: 10_000 },
    severity: "medium",
    alertType: "FTPPatator",
  },
  {
    key: "R-SYNFLOOD-01",
    name: "SYN flood",
    description: "A burst of SYN-only TCP flows (no ACK) towards one destination.",
    type: "threshold",
    window: "60s",
    groupBy: ["destinationIp"],
    condition: { gte: 500 },
    filter: { protocol: "TCP", featureGte: { "SYN Flag Count": 1 }, featureLte: { "ACK Flag Count": 0 } },
    severity: "high",
    alertType: "DDoS",
  },
  {
    key: "R-SLOWHTTP-01",
    name: "Slow HTTP requests",
    description: "Many long, low-rate flows from one source to one plain-HTTP server that sends almost nothing back (Slowloris-style).",
    type: "threshold",
    window: "5m",
    groupBy: ["sourceIp", "destinationIp"],
    condition: { gte: 20 },
    filter: { protocol: "TCP", destinationPorts: [80, 8080], minDurationMs: 30_000, featureLte: { "Flow Packets/s": 1, "Total Length of Bwd Packets": 10 } },
    severity: "medium",
    alertType: "DoSSlowloris",
  },
];

/**
 * Starter rules whose default changed. An org's copy is upgraded only while it
 * still equals `from` and no analyst edited it; edited rules are left alone.
 */
export const STARTER_RULE_UPGRADES: { key: string; from: RuleDefinitionInput; reason: string }[] = [
  {
    key: "R-SLOWHTTP-01",
    from: {
      key: "R-SLOWHTTP-01",
      name: "Slow HTTP requests",
      description: "Many long, low-rate flows from one source to one web server (Slowloris-style).",
      type: "threshold",
      window: "5m",
      groupBy: ["sourceIp", "destinationIp"],
      condition: { gte: 20 },
      filter: { protocol: "TCP", destinationPorts: [80, 443, 8080], minDurationMs: 30_000, featureLte: { "Flow Packets/s": 1 } },
      severity: "medium",
      alertType: "DoSSlowloris",
    },
    reason:
      "Replayed over the eight CICIDS2017 day files (2.83 million flows), the old filter fired 161 times, 153 of them without slow-HTTP attack flows (long benign HTTPS sessions). Requiring ports 80/8080 and at most 10 bytes from the server kept the 8 attack detections and left 7 other hits, all on the attacker's own pair.",
  },
];

// ---- Alerts -------------------------------------------------------------------

export const ALERT_STATUSES = ["open", "needs_review", "acknowledged", "dismissed", "resolved"] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];
export const ALERT_VERDICTS = ["true_positive", "false_positive", "benign"] as const;
export type AlertVerdict = (typeof ALERT_VERDICTS)[number];

export const updateAlertBodySchema = z
  .object({
    status: z.enum(ALERT_STATUSES).optional(),
    verdict: z.enum(ALERT_VERDICTS).nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "At least one field is required");
