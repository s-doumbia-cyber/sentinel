import type { AlertStatus, AlertVerdict, AttackClass, MitreMapping, Role, RuleDefinition, RuleField, Severity, SourceKind } from "@sentinel/shared";

export interface UserPreferences {
  emailAlerts: boolean;
  pushAlerts: boolean;
  language: "en" | "fr" | "hi";
  accentColor: "pine" | "ocean" | "plum";
  theme: "light" | "dark" | "system";
  density: "comfortable" | "compact";
}

export interface User {
  id: string;
  name: string;
  email: string;
  preferences: UserPreferences;
}

export interface OrgMembership {
  id: string;
  name: string;
  slug: string;
  role: Role;
}

export interface MeResponse {
  user: User;
  orgs: OrgMembership[];
  activeOrg: { id: string; role: Role };
}

export interface AuthResponse {
  accessToken: string;
  expiresIn: number;
  user: User;
  orgs: OrgMembership[];
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface TopFeature {
  name: string;
  contribution: number;
  value: number | null;
}

export interface Flow {
  id: string;
  timestamp: string;
  sourceIp: string;
  destinationIp: string;
  sourcePort: number;
  destinationPort: number;
  protocol: "TCP" | "UDP" | "ICMP" | "OTHER";
  flowDurationMs: number | null;
  packetLength: number | null;
  totalPackets: number | null;
  totalBytes: number | null;
  sourceKind: SourceKind;
  featureSchema: string;
  datasetId: string | null;
  groundTruthLabel: AttackClass | null;
  rawLabel: string | null;
  scoreStatus: "pending" | "scored" | "error";
  scoreError: string | null;
  scored: {
    modelVersion: string;
    label: AttackClass;
    confidence: number;
    severity: Severity;
    needsReview: boolean;
    scoredAt: string;
    probabilities: Record<string, number> | null;
    topFeatures: TopFeature[];
  } | null;
  features?: Record<string, number | null> | null;
}

export interface Overview {
  totalFlows: number;
  scoredFlows: number;
  pendingFlows: number;
  errorFlows: number;
  maliciousFlows: number;
  needsReviewFlows: number;
  maliciousSourceIps: number;
  bySourceKind: Partial<Record<SourceKind, number>>;
  dataRange: { from: string; to: string } | null;
}

export interface Timeseries {
  interval: "minute" | "hour" | "day";
  buckets: { bucket: string; total: number; malicious: number; unscored: number }[];
}

export interface TopItem {
  key: string;
  count: number;
  classes: string[];
  lastSeen: string;
}

export interface ClassMetric {
  label: string;
  precision: number | null;
  recall: number | null;
  f1: number | null;
  support: number;
  predicted?: number;
  prAuc?: number | null;
  unstable: boolean;
}

export interface Evaluation {
  evaluatedFlows: number;
  labels: string[];
  confusionMatrix: number[][];
  perClass: ClassMetric[];
  macroF1: number | null;
  accuracy: number | null;
  modelVersions: string[];
}

export interface Dataset {
  id: string;
  name: string;
  sourceType: string;
  sourceKind: SourceKind;
  featureSchema: string;
  status: "Processing" | "Processed" | "Failed";
  fileSha256: string | null;
  fileBytes: number;
  rowsRead: number;
  rowsInserted: number;
  skipped: { invalidRow: number; insertFailed: number };
  unknownLabelRows: number;
  unlabelledRows: number;
  unknownLabels: string[];
  invalidSamples: string[];
  groundTruthCounts: Record<string, number>;
  timeRange: { from: string | null; to: string | null };
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface ModelSummary {
  version: string;
  name: string;
  schema: string;
  kind: string;
  algorithm: string;
  classWeight?: string | null;
  trainedAt: string;
  classes: string[];
  metrics: { macroF1: number | null; weightedF1?: number | null; mcc?: number | null; testRows: number; perClass: ClassMetric[] };
  trainedOn: {
    files: { name: string; sha256: string; rows?: number }[];
    rows?: number;
    classCounts?: Record<string, number>;
    description?: string;
    excludedClasses?: string[];
    rows_unknown_label?: number;
    duplicates_dropped?: number;
  };
  libVersions: Record<string, string>;
  versionWarnings: string[];
  loadBlocked?: boolean;
  active: boolean;
  /** Holdout by source IP: exposes leakage that a random split hides. */
  groupAware?: {
    status: "ok" | "not_possible";
    reason?: string;
    macroF1?: number | null;
    testRows?: number;
    groups?: number;
    perClass?: ClassMetric[];
    classesMissingFromTest?: string[];
  };
}

export interface ModelDetail extends ModelSummary {
  modelCard?: string | null;
  trainingOverlap: { datasetId: string; name: string }[];
}

export interface ScoringStatus {
  running: boolean;
  mlConfigured: boolean;
  schemas: { schema: string; activeModel: string | null; pending: number; scored: number; error: number }[];
}

export type IncidentStatus = "Open" | "Investigating" | "Contained" | "Resolved" | "Closed";
export type Priority = "P1" | "P2" | "P3" | "P4";

export interface Incident {
  id: string;
  title: string;
  description: string;
  attackType: AttackClass;
  status: IncidentStatus;
  priority: Priority;
  severity: Severity;
  sourceIp: string | null;
  assignee: { id: string; name: string } | null;
  legacyAutoGenerated: boolean;
  notes: { authorId: string | null; authorName: string | null; text: string; createdAt: string }[];
  createdAt: string;
  updatedAt: string;
}

export interface Member {
  userId: string;
  name: string;
  email: string;
  role: Role;
  joinedAt: string;
}

export interface AuditEntry {
  id: string;
  ts: string;
  actor: { id: string; name: string } | null;
  action: string;
  target: { type: string; id: string | null };
  meta: Record<string, unknown>;
  ip: string;
  requestId: string;
}

export interface SessionInfo {
  id: string;
  userAgent: string;
  ip: string;
  lastSeenAt: string;
  createdAt: string;
  current: boolean;
}

export interface Alert {
  id: string;
  type: AttackClass;
  severity: Severity;
  status: AlertStatus;
  verdict: AlertVerdict | null;
  srcIp: string | null;
  dstIp: string | null;
  dstPort: number | null;
  count: number;
  firstSeen: string;
  lastSeen: string;
  /** Highest model confidence; null when only rules fired. */
  maxConfidence: number | null;
  sources: string[];
  ruleIds: string[];
  modelVersions: string[];
  mitre: MitreMapping | null;
  createdAt: string;
  updatedAt: string;
}

export interface AlertDetail extends Alert {
  verdictBy: { id: string; name: string } | null;
  verdictAt: string | null;
  ruleHits: { ruleKey: string; value: number; flowCount: number; windowStart: string; windowEnd: string }[];
  rules: (Pick<RuleDefinition, "key" | "name" | "description" | "window" | "groupBy" | "condition" | "filter" | "severity"> & { version: number })[];
  explanationFlow: Flow | null;
  evidence: Flow[];
  evidenceTruncated: boolean;
}

export interface AlertSummary {
  byStatus: Partial<Record<AlertStatus, number>>;
  activeBySeverity: Partial<Record<Severity, number>>;
  total: number;
}

export type Rule = RuleDefinition & { id: string; starter: boolean; version: number; updatedAt: string | null };

export interface RuleTestResult {
  rule: string;
  flowsScanned: number;
  truncated: boolean;
  hitCount: number;
  hits: { group: Partial<Record<RuleField, string | number>>; value: number; flowCount: number; windowStart: string; windowEnd: string; sampleFlowIds: string[] }[];
}
