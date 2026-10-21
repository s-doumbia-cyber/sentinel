import mongoose, { Schema, type InferSchemaType, type Types } from "mongoose";
import {
  ALERT_STATUSES,
  ALERT_VERDICTS,
  ATTACK_CLASSES,
  FEATURE_SCHEMA_IDS,
  INCIDENT_STATUSES,
  PRIORITIES,
  SEVERITIES,
  SOURCE_KINDS,
} from "@sentinel/shared";
import { tenantGuard } from "./tenantGuard.js";

const orgRef = { type: Schema.Types.ObjectId, ref: "Org", required: true } as const;

// ---- Flows --------------------------------------------------------------------

export const SCORE_STATUSES = ["pending", "scored", "error"] as const;
export type ScoreStatus = (typeof SCORE_STATUSES)[number];

const scoredSchema = new Schema(
  {
    modelVersion: { type: String, required: true },
    label: { type: String, enum: ATTACK_CLASSES, required: true },
    confidence: { type: Number, required: true, min: 0, max: 1 },
    probabilities: { type: Map, of: Number },
    severity: { type: String, enum: SEVERITIES, required: true },
    needsReview: { type: Boolean, required: true },
    topFeatures: [{ _id: false, name: String, contribution: Number, value: Number }],
    scoredAt: { type: Date, required: true },
  },
  { _id: false },
);

const flowSchema = new Schema(
  {
    orgId: orgRef,
    datasetId: { type: Schema.Types.ObjectId, ref: "Dataset", default: null },
    sourceKind: { type: String, enum: SOURCE_KINDS, required: true },
    timestamp: { type: Date, required: true },
    sourceIp: { type: String, required: true },
    destinationIp: { type: String, required: true },
    sourcePort: { type: Number, required: true },
    destinationPort: { type: Number, required: true },
    protocol: { type: String, enum: ["TCP", "UDP", "ICMP", "OTHER"], required: true },
    protocolNumber: { type: Number, default: null },
    flowDurationMs: { type: Number, default: null },
    packetLength: { type: Number, default: null },
    totalPackets: { type: Number, default: null },
    totalBytes: { type: Number, default: null },
    featureSchema: { type: String, enum: FEATURE_SCHEMA_IDS, required: true },
    /** Model inputs for `featureSchema`; null means missing/non-finite in the source (imputed by the model). */
    features: { type: Map, of: Schema.Types.Mixed, default: undefined },
    /**
     * Dataset label, for evaluation only. It is never copied into `scored`
     * (CLAUDE.md §3.2). Null when the source had no label or an unknown one.
     */
    groundTruthLabel: { type: String, enum: ATTACK_CLASSES, default: null },
    rawLabel: { type: String, default: null },
    scoreStatus: { type: String, enum: SCORE_STATUSES, required: true, default: "pending" },
    scoreError: { type: String, default: null },
    scored: { type: scoredSchema, default: null },
    /** Set once a malicious verdict has been folded into an alert (keeps alerting idempotent). */
    alertedAt: { type: Date, default: null },
    alertClaim: { type: String, default: null },
    /** Why a malicious verdict did not become an alert (the verdict itself is kept). */
    alertSuppressed: { type: String, enum: ["below_min_confidence", "allowlisted", null], default: null },
  },
  { timestamps: true },
);
// Only flows whose verdict was kept out of alerts: the Settings page counts them by reason.
flowSchema.index({ orgId: 1, alertSuppressed: 1 }, { partialFilterExpression: { alertSuppressed: { $type: "string" } } });
flowSchema.index({ orgId: 1, timestamp: -1, _id: -1 });
flowSchema.index({ orgId: 1, sourceIp: 1, timestamp: -1 });
flowSchema.index({ orgId: 1, destinationIp: 1, timestamp: -1 });
flowSchema.index({ orgId: 1, "scored.label": 1, timestamp: -1 });
flowSchema.index({ orgId: 1, scoreStatus: 1, featureSchema: 1, _id: 1 });
flowSchema.index({ orgId: 1, datasetId: 1 });
// Drift checks sample the flows one model version scored recently.
flowSchema.index({ orgId: 1, "scored.modelVersion": 1, "scored.scoredAt": -1 }, { partialFilterExpression: { scoreStatus: "scored" } });
tenantGuard(flowSchema, "Flow");

export type FlowDoc = InferSchemaType<typeof flowSchema> & { _id: Types.ObjectId };
// The legacy collection name is kept so existing imports can be migrated in place.
export const Flow = mongoose.model("Flow", flowSchema, "networkflows");

// ---- Datasets (import records) ------------------------------------------------

const datasetSchema = new Schema(
  {
    orgId: orgRef,
    name: { type: String, required: true, maxlength: 255 },
    sourceType: { type: String, enum: ["CICIDS2017"], required: true },
    sourceKind: { type: String, enum: SOURCE_KINDS, required: true, default: "IMPORTED" },
    featureSchema: { type: String, enum: FEATURE_SCHEMA_IDS, required: true },
    status: { type: String, enum: ["Processing", "Processed", "Failed"], default: "Processing" },
    fileSha256: { type: String, default: null },
    fileBytes: { type: Number, default: 0 },
    rowsRead: { type: Number, default: 0 },
    rowsInserted: { type: Number, default: 0 },
    skipped: {
      invalidRow: { type: Number, default: 0 },
      insertFailed: { type: Number, default: 0 },
    },
    /** Rows imported with an unrecognised label: kept for detection, excluded from evaluation. */
    unknownLabelRows: { type: Number, default: 0 },
    unlabelledRows: { type: Number, default: 0 },
    unknownLabels: { type: [String], default: [] },
    invalidSamples: { type: [String], default: [] },
    groundTruthCounts: { type: Map, of: Number, default: () => new Map() },
    timeRange: { from: { type: Date, default: null }, to: { type: Date, default: null } },
    error: { type: String, default: null },
    uploadedBy: { type: Schema.Types.ObjectId, ref: "User" },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
datasetSchema.index({ orgId: 1, createdAt: -1 });
tenantGuard(datasetSchema, "Dataset");

export type DatasetDoc = InferSchemaType<typeof datasetSchema> & { _id: Types.ObjectId };
export const Dataset = mongoose.model("Dataset", datasetSchema);

// ---- Incidents ------------------------------------------------------------------

const incidentSchema = new Schema(
  {
    orgId: orgRef,
    title: { type: String, required: true, maxlength: 200 },
    description: { type: String, default: "", maxlength: 5000 },
    attackType: { type: String, enum: ATTACK_CLASSES, required: true },
    status: { type: String, enum: INCIDENT_STATUSES, default: "Open" },
    priority: { type: String, enum: PRIORITIES, default: "P3" },
    severity: { type: String, enum: SEVERITIES, required: true },
    assigneeId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    sourceIp: { type: String, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    /** Set by the legacy migration on incidents the old backend auto-generated with invented assignees. */
    legacyAutoGenerated: { type: Boolean, default: false },
    /** manual: created by an analyst; from_alerts: created from selected alerts; correlated: grouped by Sentinel. */
    origin: { type: String, enum: ["manual", "from_alerts", "correlated"], default: "manual" },
    alertIds: [{ type: Schema.Types.ObjectId, ref: "Alert" }],
    entities: [{ _id: false, type: { type: String, enum: ["ip"] }, value: String, role: { type: String, enum: ["source", "target"] } }],
    /** Why Sentinel grouped the alerts (correlated incidents only). */
    correlation: { key: { type: String, default: null }, windowMinutes: { type: Number, default: null }, basis: { type: String, default: null } },
    firstSeen: { type: Date, default: null },
    lastSeen: { type: Date, default: null },
    notes: [
      {
        authorId: { type: Schema.Types.ObjectId, ref: "User" },
        text: { type: String, maxlength: 5000 },
        createdAt: { type: Date, default: () => new Date() },
      },
    ],
  },
  { timestamps: true },
);
incidentSchema.index({ orgId: 1, status: 1, updatedAt: -1 });
incidentSchema.index({ orgId: 1, "entities.value": 1 });
tenantGuard(incidentSchema, "Incident");

export type IncidentDoc = InferSchemaType<typeof incidentSchema> & { _id: Types.ObjectId };
export const Incident = mongoose.model("Incident", incidentSchema);

// ---- Audit log (append-only) ----------------------------------------------------

const auditSchema = new Schema(
  {
    orgId: orgRef,
    ts: { type: Date, required: true, default: () => new Date() },
    actorId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    action: { type: String, required: true },
    target: { type: { type: String, required: true }, id: { type: String, default: null } },
    meta: { type: Schema.Types.Mixed, default: {} },
    ip: { type: String, default: "" },
    requestId: { type: String, default: "" },
  },
  { versionKey: false },
);
auditSchema.index({ orgId: 1, ts: -1, _id: -1 });
tenantGuard(auditSchema, "AuditLog");
for (const op of ["updateOne", "updateMany", "findOneAndUpdate", "deleteOne", "deleteMany", "findOneAndDelete", "replaceOne"] as const) {
  auditSchema.pre(op, () => {
    throw new Error("audit_log is append-only");
  });
}

export type AuditDoc = InferSchemaType<typeof auditSchema> & { _id: Types.ObjectId };
export const AuditLog = mongoose.model("AuditLog", auditSchema, "audit_log");

// ---- Detection rules ---------------------------------------------------------------

const ruleSchema = new Schema(
  {
    orgId: orgRef,
    key: { type: String, required: true },
    /** The full validated definition (packages/shared ruleDefinitionSchema). */
    definition: { type: Schema.Types.Mixed, required: true },
    enabled: { type: Boolean, default: true },
    starter: { type: Boolean, default: false },
    version: { type: Number, default: 1 },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true },
);
ruleSchema.index({ orgId: 1, key: 1 }, { unique: true });
tenantGuard(ruleSchema, "Rule");

export type RuleDoc = InferSchemaType<typeof ruleSchema> & { _id: Types.ObjectId };
export const Rule = mongoose.model("Rule", ruleSchema);

// ---- Alerts -------------------------------------------------------------------------

const alertSchema = new Schema(
  {
    orgId: orgRef,
    /** sha256(orgId, src, dst, type, 10-minute bucket): repeated evidence increments `count`. */
    dedupeKey: { type: String, required: true },
    type: { type: String, enum: ATTACK_CLASSES, required: true },
    srcIp: { type: String, default: null },
    dstIp: { type: String, default: null },
    dstPort: { type: Number, default: null },
    /** Hybrid severity = max(model, rules), stored as a rank (see severityRank in packages/shared). */
    severityRank: { type: Number, required: true },
    status: { type: String, enum: ALERT_STATUSES, default: "needs_review" },
    verdict: { type: String, enum: ALERT_VERDICTS, default: null },
    verdictBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    verdictAt: { type: Date, default: null },
    count: { type: Number, default: 0 },
    firstSeen: { type: Date, required: true },
    lastSeen: { type: Date, required: true },
    maxConfidence: { type: Number, default: 0 },
    sources: { type: [String], default: [] },
    ruleIds: { type: [String], default: [] },
    modelVersions: { type: [String], default: [] },
    hitKeys: { type: [String], default: [] },
    ruleHits: [
      {
        _id: false,
        ruleKey: String,
        value: Number,
        flowCount: Number,
        windowStart: Date,
        windowEnd: Date,
      },
    ],
    flowIds: [{ type: Schema.Types.ObjectId, ref: "Flow" }],
    topFlowId: { type: Schema.Types.ObjectId, ref: "Flow", default: null },
    topConfidence: { type: Number, default: null },
    incidentId: { type: Schema.Types.ObjectId, ref: "Incident", default: null },
  },
  { timestamps: true },
);
alertSchema.index({ orgId: 1, dedupeKey: 1 }, { unique: true });
alertSchema.index({ orgId: 1, status: 1, lastSeen: -1 });
alertSchema.index({ orgId: 1, lastSeen: -1, _id: -1 });
alertSchema.index({ orgId: 1, srcIp: 1 });
alertSchema.index({ orgId: 1, incidentId: 1, firstSeen: 1 });
tenantGuard(alertSchema, "Alert");

export type AlertDoc = InferSchemaType<typeof alertSchema> & { _id: Types.ObjectId };
export const Alert = mongoose.model("Alert", alertSchema);

// ---- Incident events (the investigation log) -------------------------------------------

export const INCIDENT_EVENT_KINDS = [
  "created",
  "correlated",
  "alerts_linked",
  "status_changed",
  "priority_changed",
  "severity_changed",
  "assignee_changed",
  "title_changed",
  "note",
  "action_recorded",
  "simulation_generated",
  "report_generated",
] as const;

const incidentEventSchema = new Schema(
  {
    orgId: orgRef,
    incidentId: { type: Schema.Types.ObjectId, ref: "Incident", required: true },
    ts: { type: Date, required: true, default: () => new Date() },
    /** Null when Sentinel itself acted (correlation). */
    actorId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    kind: { type: String, enum: INCIDENT_EVENT_KINDS, required: true },
    payload: { type: Schema.Types.Mixed, default: {} },
  },
  { versionKey: false },
);
incidentEventSchema.index({ orgId: 1, incidentId: 1, ts: 1 });
tenantGuard(incidentEventSchema, "IncidentEvent");
for (const op of ["updateOne", "updateMany", "findOneAndUpdate", "replaceOne"] as const) {
  incidentEventSchema.pre(op, () => {
    throw new Error("incident_events is append-only");
  });
}
export type IncidentEventDoc = InferSchemaType<typeof incidentEventSchema> & { _id: Types.ObjectId };
export const IncidentEvent = mongoose.model("IncidentEvent", incidentEventSchema, "incident_events");

// ---- Drift reports (PSI against a model's training reference) ----------------------------

const driftReportSchema = new Schema(
  {
    orgId: orgRef,
    modelVersion: { type: String, required: true },
    schema: { type: String, enum: FEATURE_SCHEMA_IDS, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    windowHours: { type: Number, required: true },
    referenceRows: { type: Number, required: true },
    sampleSize: { type: Number, required: true },
    maxPsi: { type: Number, required: true },
    level: { type: String, enum: ["stable", "moderate", "significant"], required: true },
    driftedFeatureCount: { type: Number, required: true },
    features: [{ _id: false, name: String, psi: Number, level: String, missingCurrent: Number, missingReference: Number, values: Number }],
    predictedClassShare: { type: Map, of: Number, default: () => new Map() },
    trainingClassShare: { type: Map, of: Number, default: () => new Map() },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
driftReportSchema.index({ orgId: 1, modelVersion: 1, createdAt: -1 });
tenantGuard(driftReportSchema, "DriftReport");
for (const op of ["updateOne", "updateMany", "findOneAndUpdate", "replaceOne"] as const) {
  driftReportSchema.pre(op, () => {
    throw new Error("drift_reports is append-only");
  });
}
export const DriftReport = mongoose.model("DriftReport", driftReportSchema, "drift_reports");

/** Collections holding tenant data, used when an org is deleted. */
export const TENANT_MODELS = [Flow, Dataset, Incident, AuditLog, Rule, Alert, IncidentEvent, DriftReport] as const;
