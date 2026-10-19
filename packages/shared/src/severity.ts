import type { AttackClass } from "./taxonomy.js";

export const SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;
export type Severity = (typeof SEVERITIES)[number];

const RANK: Record<Severity, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };

/** Default severity per class (docs/ML_AND_DETECTION.md §3); orgs may override later. */
export const DEFAULT_SEVERITY_BY_CLASS: Record<AttackClass, Severity> = {
  Normal: "info",
  DDoS: "critical",
  Botnet: "critical",
  Heartbleed: "critical",
  DoSHulk: "high",
  DoSGoldenEye: "high",
  SQLInjection: "high",
  WebAttack: "high",
  XSS: "high",
  Infiltration: "high",
  DoSSlowloris: "medium",
  FTPPatator: "medium",
  SSHPatator: "medium",
  PortScan: "low",
};

export function severityRank(s: Severity): number {
  return RANK[s];
}

/** Hybrid decision rule: the more severe of model and rule wins. */
export function maxSeverity(...values: Severity[]): Severity {
  return values.reduce<Severity>((acc, s) => (RANK[s] > RANK[acc] ? s : acc), "info");
}
