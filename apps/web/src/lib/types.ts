import type { AlertStatus, AlertVerdict, AttackClass, AttributionCandidate, DeviceEstimate, IdentitySource, KnowledgeEntry, MitreMapping, Role, RuleDefinition, RuleField, Severity, SourceKind, Stage } from "@sentinel/shared";

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
  /** Second factor (TOTP) is on for this account. */
  mfaEnabled?: boolean;
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
  origin: "manual" | "from_alerts" | "correlated";
  correlation: { basis: string; windowMinutes: number | null } | null;
  alertCount: number;
  entities: { type: "ip"; value: string; role: "source" | "target" }[];
  firstSeen: string | null;
  lastSeen: string | null;
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
  mfaEnabled?: boolean;
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

export interface Statement {
  text: string;
  basis?: string;
}

export interface Attribution {
  ip: string;
  scope: "internal" | "external" | "unknown";
  window: { from: string; to: string };
  connectedSources: { source: IdentitySource; label: string }[];
  candidates: AttributionCandidate[];
  ambiguous: boolean;
  caveats: string[];
  help: string[];
}

export interface AlertDetail extends Alert {
  analysis: { observed: Statement[]; inferred: Statement[]; unknown: Statement[] };
  attribution: Attribution | null;
  identityRestricted: boolean;
  incident: { id: string; title: string; status: IncidentStatus } | null;
  provenance: {
    datasets: { id: string; name: string; sha256: string | null; sourceKind: SourceKind; importedAt: string | null; importedBy: string | null }[];
    models: string[];
    rules: { key: string; version: number }[];
    createdAt: string;
  };
  history: { ts: string; actor: string; action: string; meta: Record<string, unknown> }[];
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

export interface AttackStep {
  at: string;
  until: string;
  stage: Stage | null;
  mitre: string | null;
  fact: string;
  alertId: string;
  severity: Severity;
  detectedBy: string[];
  analystVerdict: AlertVerdict | null;
}

export interface Hypothesis {
  statement: string;
  basis: string[];
  limits: string[];
}

export interface IncidentLogEntry {
  id: string;
  ts: string;
  kind: string;
  actor: string;
  payload: Record<string, unknown>;
}

export interface TimelineAlert {
  id: string;
  type: AttackClass;
  severity: Severity;
  srcIp: string | null;
  dstIp: string | null;
  dstPort: number | null;
  count: number;
  firstSeen: string;
  lastSeen: string;
  sources: string[];
  status: AlertStatus;
  verdict: AlertVerdict | null;
}

export interface IncidentTimeline {
  attack: { steps: AttackStep[]; hypotheses: Hypothesis[] };
  alerts: TimelineAlert[];
  log: IncidentLogEntry[];
}

export interface IncidentGuidance {
  knowledgeBaseVersion: string;
  entries: (KnowledgeEntry & { type: AttackClass })[];
  blocklistCandidates: { ip: string; scope: string }[];
  enforcement: "none";
  notice: string;
}

export interface IncidentReport {
  meta: { reportVersion: number; generatedAt: string; organisation: string; knowledgeBaseVersion: string; timezone: string };
  incident: Incident;
  attack: IncidentTimeline["attack"];
  alerts: TimelineAlert[];
  entities: {
    ip: string;
    role: "source" | "target";
    scope: string;
    deviceEstimate: DeviceEstimate | null;
    identity: { candidates: (AttributionCandidate & { sourceLabel: string })[]; ambiguous: boolean; caveats: string[] } | "restricted";
  }[];
  response: { recommendations: { type: AttackClass; confirm: string[]; contain: string[] }[]; recordedActions: IncidentLogEntry[]; simulations: IncidentLogEntry[]; enforcement: string };
  investigationLog: IncidentLogEntry[];
  trace: IncidentTrace["entries"];
  provenance: { datasets: { name: string; sha256: string | null; sourceKind: SourceKind; importedAt: string | null }[]; models: string[]; rules: string[] };
  limitations: string[];
}

export interface Asset {
  ip: string;
  scope: "internal" | "external" | "unknown";
  firstSeen: string;
  lastSeen: string;
  flowsAsSource: number;
  flowsAsDestination: number;
  distinctPeers: number;
  distinctServices: number;
  services: { port: number; protocol: string; flows: number; firstSeen: string; lastSeen: string }[];
  sourceKinds: SourceKind[];
  deviceEstimate: DeviceEstimate | null;
  notes: string;
  tags: string[];
  active: boolean;
  refreshedAt: string;
  activeAlerts?: number;
}

export type TraceStage = "ingest" | "context" | "detect" | "triage" | "investigate" | "respond" | "report";

export interface IncidentTrace {
  entries: { ts: string; stage: TraceStage; actor: string | null; summary: string; ref: { type: "dataset" | "alert" | "incident" | "identity_import"; id: string } }[];
  coverage: { datasets: number; alerts: number; triageChanges: number; incidentEvents: number; identityImports: number | null };
  notes: string[];
}

export interface IdentityRecord {
  id: string;
  ip: string;
  username: string | null;
  hostname: string | null;
  mac: string | null;
  source: IdentitySource;
  sourceLabel: string;
  validFrom: string;
  validTo: string | null;
  importName: string | null;
}

export interface IdentityLookup {
  query: string;
  matchedOn: ("username" | "hostname" | "mac")[];
  records: IdentityRecord[];
  addresses: {
    ip: string;
    scope: "internal" | "external" | "unknown";
    records: number;
    from: string;
    to: string;
    alerts: { id: string; type: AttackClass; severity: Severity; status: AlertStatus; role: "source" | "target"; firstSeen: string; lastSeen: string; duringRecords: string[] }[];
  }[];
  truncated: boolean;
  caveats: string[];
}

export type AssetEventKind = "first_observed" | "service_observed" | "service_gone" | "estimate_changed" | "became_inactive" | "reactivated" | "notes_updated";

export interface AssetEvent {
  id: string;
  kind: AssetEventKind;
  /** When Sentinel recorded the change. */
  ts: string;
  /** When it happened in the flows, if known. */
  eventTime: string | null;
  /** Null when Sentinel recorded it during an inventory refresh. */
  actor: string | null;
  detail: Record<string, unknown>;
}

export interface AssetDetail {
  asset: Asset;
  alerts: { id: string; type: AttackClass; severity: Severity; status: AlertStatus; role: "source" | "target"; count: number; lastSeen: string }[];
  incidents: { id: string; title: string; status: IncidentStatus; severity: Severity; updatedAt: string }[];
  peers: { outbound: { ip: string; flows: number; lastSeen: string }[]; inbound: { ip: string; flows: number; lastSeen: string }[] };
  activity: { bucket: string; asSource: number; asDestination: number }[];
  identity: Attribution | null;
  identityRestricted: boolean;
}

export interface IdentityImport {
  id: string;
  name: string;
  fileSha256: string;
  rowsRead: number;
  rowsInserted: number;
  invalidRows: number;
  invalidSamples: string[];
  sources: IdentitySource[];
  createdAt: string;
}

export interface ErrorSample {
  flowId: string;
  truth: string;
  predicted: string;
  confidence?: number;
  topFeatures?: TopFeature[];
}

export interface ValidationRun {
  id: string;
  kind: "model" | "rule";
  target: string;
  targetVersion: number | null;
  dataset: { id: string; name: string; sha256: string | null };
  trainingOverlap: boolean | null;
  createdBy: string | null;
  createdAt: string;
  flowsScanned: number;
  metrics: { labels: string[]; matrix: number[][]; perClass: ClassMetric[]; macroF1: number | null; evaluated: number };
  falsePositives: ErrorSample[];
  falseNegatives: ErrorSample[];
  notes: string[];
}

export interface DetectionSettings {
  /** 0–1; model verdicts below it never become alerts. 0 = off. */
  modelAlertMinConfidence: number;
  /** Read-only here: below it, model-only alerts are marked "needs review". */
  needsReviewThreshold: number;
  allowlist: { cidr: string; note: string; addedBy: string | null; addedAt: string }[];
  suppressedVerdicts: { belowMinConfidence: number; allowlisted: number };
}
