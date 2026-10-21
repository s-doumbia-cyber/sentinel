import mongoose, { Schema, type Types } from "mongoose";
import { tenantGuard } from "./tenantGuard.js";

/**
 * Minute rollups of flows (`flow_rollups_1m`, docs/ARCHITECTURE.md §3.6) and their
 * freshness state. See modules/stats/rollup.service.ts for how they are built and read.
 */
const rollupSchema = new Schema(
  {
    orgId: { type: Schema.Types.ObjectId, required: true },
    gen: { type: String, required: true },
    bucket: { type: Date, required: true },
    datasetId: { type: Schema.Types.ObjectId, default: null },
    sourceKind: String,
    protocol: String,
    featureSchema: String,
    scoreStatus: String,
    label: { type: String, default: null },
    severity: { type: String, default: null },
    needsReview: { type: Boolean, default: null },
    modelVersion: { type: String, default: null },
    groundTruth: { type: String, default: null },
    malicious: Boolean,
    srcIp: { type: String, default: null },
    dstIp: { type: String, default: null },
    dstPort: { type: Number, default: null },
    n: { type: Number, required: true },
    minTs: Date,
    maxTs: Date,
  },
  { versionKey: false },
);
rollupSchema.index({ orgId: 1, gen: 1, bucket: 1 });
tenantGuard(rollupSchema, "FlowRollup");
export const FlowRollup = mongoose.model("FlowRollup", rollupSchema, "flow_rollups_1m");

const stateSchema = new Schema(
  {
    // The org id: one state per org.
    _id: { type: Schema.Types.ObjectId, required: true },
    /** Bumped after every write that changes what the rollups count. */
    version: { type: Number, default: 0 },
    /** The `version` the current generation was built from. */
    builtVersion: { type: Number, default: -1 },
    gen: { type: String, default: null },
    builtAt: { type: Date, default: null },
    buildMs: { type: Number, default: null },
    rows: { type: Number, default: 0 },
  },
  { versionKey: false },
);
export const RollupState = mongoose.model("RollupState", stateSchema, "rollup_states");

/** Call after any write that adds, removes or re-scores flows of the org. */
export async function markFlowsChanged(orgId: Types.ObjectId | string): Promise<void> {
  await RollupState.updateOne({ _id: orgId }, { $inc: { version: 1 } }, { upsert: true });
}

/** Flow fields the rollups group or filter on; writes touching only others (alert claims) keep them fresh. */
const ROLLUP_FIELDS = [
  "timestamp",
  "datasetId",
  "sourceKind",
  "protocol",
  "featureSchema",
  "scoreStatus",
  "scored",
  "groundTruthLabel",
  "sourceIp",
  "destinationIp",
  "destinationPort",
  "orgId",
];

function touchesRollupFields(update: unknown): boolean {
  if (!update || typeof update !== "object") return false;
  if (Array.isArray(update)) return true; // aggregation-pipeline update: assume it does
  const paths = Object.entries(update as Record<string, unknown>).flatMap(([k, v]) =>
    k.startsWith("$") && v && typeof v === "object" ? Object.keys(v as object) : [k],
  );
  return paths.some((p) => ROLLUP_FIELDS.includes(p.split(".")[0] ?? ""));
}

/**
 * Registers the staleness bump on the flow schema, so no write path can forget it.
 * Raw driver writes (migrations, test fixtures) bypass it and must call markFlowsChanged.
 * `bulkWrite` is not covered (its post hook cannot see the operations): callers bump.
 */
export function trackRollupChanges(schema: Schema): void {
  schema.post("insertMany", async function bump(docs: { orgId?: Types.ObjectId }[]) {
    const orgs = new Set(docs.map((d) => String(d.orgId)).filter((o) => o !== "undefined"));
    for (const org of orgs) await markFlowsChanged(org);
  });
  schema.post("save", async function bump(doc: { orgId?: Types.ObjectId }) {
    if (doc.orgId) await markFlowsChanged(doc.orgId);
  });
  for (const op of ["deleteMany", "deleteOne"] as const) {
    schema.post(op, async function bump(this: mongoose.Query<unknown, unknown>) {
      const orgId = this.getFilter().orgId as Types.ObjectId | undefined;
      if (orgId) await markFlowsChanged(orgId);
    });
  }
  for (const op of ["updateMany", "updateOne", "findOneAndUpdate"] as const) {
    schema.post(op, async function bump(this: mongoose.Query<unknown, unknown>) {
      const orgId = this.getFilter().orgId as Types.ObjectId | undefined;
      if (orgId && touchesRollupFields(this.getUpdate())) await markFlowsChanged(orgId);
    });
  }
}
