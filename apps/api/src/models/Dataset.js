import mongoose from "mongoose";

const datasetSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    sourceType: { type: String, enum: ["CICIDS2017", "UNSW-NB15", "KDD99", "CSE-CIC-IDS2018", "Custom"], default: "Custom" },
    rows: { type: Number, default: 0 },
    columns: { type: Number, default: 0 },
    detectedSchema: [{ type: String }], // auto-detected CSV column names
    attackTypesFound: [{ type: String }],
    status: { type: String, enum: ["Processing", "Processed", "Failed"], default: "Processing" },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

export const Dataset = mongoose.model("Dataset", datasetSchema);
