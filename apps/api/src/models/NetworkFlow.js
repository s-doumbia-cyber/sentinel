import mongoose from "mongoose";

const ATTACK_TYPES = [
  "DDoS",
  "PortScan",
  "BruteForce",
  "Botnet",
  "SQLInjection",
  "XSS",
  "Heartbleed",
  "DoSHulk",
  "DoSSlowloris",
  "FTPPatator",
  "SSHPatator",
  "WebAttack",
  "Infiltration",
  "Normal",
];

// Schema intentionally mirrors the common columns across CICIDS2017 / CSE-CIC-IDS2018 /
// UNSW-NB15 / KDD99 so the same collection can ingest any of the four supported
// datasets. Dataset-specific extra columns are kept in `raw` for lossless storage.
const networkFlowSchema = new mongoose.Schema(
  {
    datasetId: { type: mongoose.Schema.Types.ObjectId, ref: "Dataset", index: true },
    timestamp: { type: Date, required: true, index: true },
    sourceIp: { type: String, required: true, index: true },
    destinationIp: { type: String, required: true, index: true },
    sourcePort: { type: Number },
    destinationPort: { type: Number, index: true },
    protocol: { type: String, enum: ["TCP", "UDP", "ICMP"], required: true },
    flowDurationMs: { type: Number, default: 0 },
    packetLength: { type: Number, default: 0 },
    label: { type: String, enum: ATTACK_TYPES, default: "Normal", index: true },
    prediction: { type: String, enum: ATTACK_TYPES },
    severity: { type: String, enum: ["critical", "high", "medium", "low", "info", "safe"], default: "safe", index: true },
    country: { type: String },
    isAttack: { type: Boolean, default: false, index: true },
    raw: { type: mongoose.Schema.Types.Mixed }, // original CSV row for auditability / re-processing
  },
  { timestamps: true }
);

networkFlowSchema.index({ timestamp: -1, isAttack: 1 });

export const NetworkFlow = mongoose.model("NetworkFlow", networkFlowSchema);
export { ATTACK_TYPES };
