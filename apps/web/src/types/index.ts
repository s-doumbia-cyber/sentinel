export type Severity = "critical" | "high" | "medium" | "low" | "info" | "safe";

export type AttackType =
  | "DDoS"
  | "PortScan"
  | "BruteForce"
  | "Botnet"
  | "SQLInjection"
  | "XSS"
  | "Heartbleed"
  | "DoSHulk"
  | "DoSSlowloris"
  | "FTPPatator"
  | "SSHPatator"
  | "WebAttack"
  | "Infiltration"
  | "Normal";

export interface NetworkFlow {
  id: string;
  timestamp: string; // ISO date string
  sourceIp: string;
  destinationIp: string;
  sourcePort: number;
  destinationPort: number;
  protocol: "TCP" | "UDP" | "ICMP";
  flowDurationMs: number;
  packetLength: number;
  label: AttackType;
  prediction: AttackType;
  severity: Severity;
  country: string;
  isAttack: boolean;
  raw?: Record<string, string | number>; // the original CSV row, kept for the flow detail panel
}

export interface KpiDefinition {
  id: string;
  label: string;
  value: number;
  format: "number" | "percent" | "bytes" | "ms";
  trend: number; // percent change vs previous period
  sparkline: number[];
  accent: "violet" | "pink" | "cyan";
}

export type IncidentStatus = "Open" | "Investigating" | "Resolved" | "Closed";
export type IncidentPriority = "P1" | "P2" | "P3" | "P4";

export interface Incident {
  id: string;
  title: string;
  attackType: AttackType;
  status: IncidentStatus;
  priority: IncidentPriority;
  severity: Severity;
  assignee: string;
  createdAt: string;
  sourceIp: string;
}

export interface ThreatSource {
  country: string;
  countryCode: string;
  attacks: number;
  lat: number;
  lng: number;
}

export interface DatasetSummary {
  id: string;
  name: string;
  rows: number;
  columns: number;
  attackTypes: number;
  uploadedAt: string;
  status: "Processed" | "Processing" | "Failed";
}

export interface ModelMetrics {
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
  confusionMatrix: number[][]; // [[TN, FP], [FN, TP]]
  featureImportance: { feature: string; importance: number }[];
  rocPoints: { fpr: number; tpr: number }[];
}
