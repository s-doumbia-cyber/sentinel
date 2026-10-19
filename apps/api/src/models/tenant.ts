import mongoose, { Schema, type InferSchemaType, type Types } from "mongoose";
import {
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
  },
  { timestamps: true },
);
flowSchema.index({ orgId: 1, timestamp: -1, _id: -1 });
flowSchema.index({ orgId: 1, sourceIp: 1, timestamp: -1 });
flowSchema.index({ orgId: 1, destinationIp: 1, timestamp: -1 });
flowSchema.index({ orgId: 1, "scored.label": 1, timestamp: -1 });
flowSchema.index({ orgId: 1, scoreStatus: 1, featureSchema: 1, _id: 1 });
flowSchema.index({ orgId: 1, datasetId: 1 });
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

/** Collections holding tenant data, used when an org is deleted. */
export const TENANT_MODELS = [Flow, Dataset, Incident, AuditLog] as const;
