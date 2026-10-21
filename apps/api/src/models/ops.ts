import mongoose, { Schema, type InferSchemaType, type Types } from "mongoose";
import { tenantGuard } from "./tenantGuard.js";

const orgRef = { type: Schema.Types.ObjectId, ref: "Org", required: true } as const;

// ---- Dead letters: jobs that exhausted their attempts ------------------------------------

const failedJobSchema = new Schema(
  {
    orgId: orgRef,
    kind: { type: String, required: true },
    jobId: { type: String, required: true },
    /** The job payload, so an Admin can retry it. Never contains secrets. */
    payload: { type: Schema.Types.Mixed, default: {} },
    error: { type: String, required: true, maxlength: 1000 },
    attempts: { type: Number, required: true },
    /** True when the error said retrying cannot help (e.g. the uploaded file is gone). */
    permanent: { type: Boolean, default: false },
    mode: { type: String, enum: ["in-process", "redis"], required: true },
    failedAt: { type: Date, required: true },
    retriedAt: { type: Date, default: null },
    retriedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    retryJobId: { type: String, default: null },
  },
  { versionKey: false },
);
failedJobSchema.index({ orgId: 1, failedAt: -1, _id: -1 });
// A retried job that fails again records a new entry; the same attempt is recorded once.
failedJobSchema.index({ orgId: 1, jobId: 1 }, { unique: true });
tenantGuard(failedJobSchema, "FailedJob");
export type FailedJobDoc = InferSchemaType<typeof failedJobSchema> & { _id: Types.ObjectId };
export const FailedJob = mongoose.model("FailedJob", failedJobSchema, "failed_jobs");

// ---- Leases: one holder at a time for work that must not overlap (rollup rebuilds) --------

const leaseSchema = new Schema(
  {
    _id: { type: String, required: true },
    token: { type: String, required: true },
    until: { type: Date, required: true },
  },
  { versionKey: false },
);
export const Lease = mongoose.model("Lease", leaseSchema, "leases");
