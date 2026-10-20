import mongoose, { Schema, type InferSchemaType, type Types } from "mongoose";
import { tenantGuard } from "./tenantGuard.js";

/**
 * One reproducible detection test: which model or rule version, on which
 * dataset (by SHA-256), by whom, with per-class results and error samples.
 * Runs are never edited after creation.
 */
const validationRunSchema = new Schema(
  {
    orgId: { type: Schema.Types.ObjectId, ref: "Org", required: true },
    kind: { type: String, enum: ["model", "rule"], required: true },
    target: { type: String, required: true },
    targetVersion: { type: Number, default: null },
    datasetId: { type: Schema.Types.ObjectId, ref: "Dataset", required: true },
    datasetName: { type: String, required: true },
    datasetSha256: { type: String, default: null },
    /** Model runs only: the dataset file was among the model's training files. */
    trainingOverlap: { type: Boolean, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    flowsScanned: { type: Number, default: 0 },
    metrics: { type: Schema.Types.Mixed, required: true },
    falsePositives: { type: [Schema.Types.Mixed], default: [] },
    falseNegatives: { type: [Schema.Types.Mixed], default: [] },
    notes: { type: [String], default: [] },
  },
  { timestamps: true },
);
validationRunSchema.index({ orgId: 1, createdAt: -1 });
tenantGuard(validationRunSchema, "ValidationRun");
for (const op of ["updateOne", "updateMany", "findOneAndUpdate", "replaceOne"] as const) {
  validationRunSchema.pre(op, () => {
    throw new Error("validation_runs are immutable");
  });
}

export type ValidationRunDoc = InferSchemaType<typeof validationRunSchema> & { _id: Types.ObjectId; createdAt: Date };
export const ValidationRun = mongoose.model("ValidationRun", validationRunSchema, "validation_runs");
