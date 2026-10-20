import mongoose, { Schema, type InferSchemaType, type Types } from "mongoose";
import { IDENTITY_SOURCES } from "@sentinel/shared";
import { tenantGuard } from "./tenantGuard.js";

const orgRef = { type: Schema.Types.ObjectId, ref: "Org", required: true } as const;

// ---- Assets: addresses observed in flows ----------------------------------------------

const assetSchema = new Schema(
  {
    orgId: orgRef,
    ip: { type: String, required: true },
    scope: { type: String, enum: ["internal", "external", "unknown"], required: true },
    firstSeen: { type: Date, required: true },
    lastSeen: { type: Date, required: true },
    flowsAsSource: { type: Number, default: 0 },
    flowsAsDestination: { type: Number, default: 0 },
    /** Services this address accepted in observed flows (as destination), busiest first. */
    services: [{ _id: false, port: Number, protocol: String, flows: Number, firstSeen: Date, lastSeen: Date }],
    distinctPeers: { type: Number, default: 0 },
    // Accepted ports observed; `services` keeps only the busiest ones.
    distinctServices: { type: Number, default: 0 },
    /** Every "PROTO/port" accepted with at least MIN_SERVICE_FLOWS flows: the baseline history diffs against. */
    serviceKeys: { type: [String], default: [] },
    /** Device estimate label at the last refresh, so a change can be recorded. */
    estimateLabel: { type: String, default: null },
    sourceKinds: { type: [String], default: [] },
    /** Analyst-provided context. Kept across refreshes. */
    notes: { type: String, default: "", maxlength: 5000 },
    tags: { type: [String], default: [] },
    /** False when the latest refresh found no flow for this address (e.g. its dataset was deleted). */
    active: { type: Boolean, default: true },
    refreshedAt: { type: Date, required: true },
  },
  { timestamps: true },
);
assetSchema.index({ orgId: 1, ip: 1 }, { unique: true });
assetSchema.index({ orgId: 1, lastSeen: -1, _id: -1 });
tenantGuard(assetSchema, "Asset");

export type AssetDoc = InferSchemaType<typeof assetSchema> & { _id: Types.ObjectId };
export const Asset = mongoose.model("Asset", assetSchema);

// ---- Asset history: what changed in the inventory, and when we noticed --------------

export const ASSET_EVENT_KINDS = [
  "first_observed",
  "service_observed",
  "service_gone",
  "estimate_changed",
  "became_inactive",
  "reactivated",
  "notes_updated",
] as const;
export type AssetEventKind = (typeof ASSET_EVENT_KINDS)[number];

const assetEventSchema = new Schema(
  {
    orgId: orgRef,
    ip: { type: String, required: true },
    kind: { type: String, enum: ASSET_EVENT_KINDS, required: true },
    /** Wall-clock time Sentinel recorded the change (inventory refresh or analyst edit). */
    ts: { type: Date, required: true, default: () => new Date() },
    /** Event time in the flows when it is known (e.g. first flow of a new service). */
    eventTime: { type: Date, default: null },
    /** Null when Sentinel recorded it during a refresh. */
    actorId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    detail: { type: Schema.Types.Mixed, default: {} },
  },
  { versionKey: false },
);
assetEventSchema.index({ orgId: 1, ip: 1, ts: -1, _id: -1 });
tenantGuard(assetEventSchema, "AssetEvent");
for (const op of ["updateOne", "updateMany", "findOneAndUpdate", "replaceOne"] as const) {
  assetEventSchema.pre(op, () => {
    throw new Error("asset_events is append-only");
  });
}
export type AssetEventDoc = InferSchemaType<typeof assetEventSchema> & { _id: Types.ObjectId };
export const AssetEvent = mongoose.model("AssetEvent", assetEventSchema, "asset_events");

// ---- Identity sources: imported VPN / DHCP / auth / EDR / directory records ----------

const identityImportSchema = new Schema(
  {
    orgId: orgRef,
    name: { type: String, required: true, maxlength: 255 },
    fileSha256: { type: String, required: true },
    rowsRead: { type: Number, default: 0 },
    rowsInserted: { type: Number, default: 0 },
    invalidRows: { type: Number, default: 0 },
    invalidSamples: { type: [String], default: [] },
    sources: { type: [String], default: [] },
    importedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true },
);
identityImportSchema.index({ orgId: 1, createdAt: -1 });
tenantGuard(identityImportSchema, "IdentityImport");
export type IdentityImportDoc = InferSchemaType<typeof identityImportSchema> & { _id: Types.ObjectId };
export const IdentityImport = mongoose.model("IdentityImport", identityImportSchema, "identity_imports");

const identityObservationSchema = new Schema(
  {
    orgId: orgRef,
    importId: { type: Schema.Types.ObjectId, ref: "IdentityImport", required: true },
    ip: { type: String, required: true },
    username: { type: String, default: null },
    hostname: { type: String, default: null },
    mac: { type: String, default: null },
    source: { type: String, enum: IDENTITY_SOURCES, required: true },
    validFrom: { type: Date, required: true },
    /** Null for a point-in-time record (e.g. a single sign-in). */
    validTo: { type: Date, default: null },
  },
  { timestamps: true },
);
identityObservationSchema.index({ orgId: 1, ip: 1, validFrom: -1 });
identityObservationSchema.index({ orgId: 1, importId: 1 });
tenantGuard(identityObservationSchema, "IdentityObservation");
export type IdentityObservationDoc = InferSchemaType<typeof identityObservationSchema> & { _id: Types.ObjectId };
export const IdentityObservation = mongoose.model("IdentityObservation", identityObservationSchema, "identity_observations");

export const CONTEXT_MODELS = [Asset, AssetEvent, IdentityImport, IdentityObservation] as const;
