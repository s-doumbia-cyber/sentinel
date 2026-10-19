import mongoose from "mongoose";

const incidentSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    attackType: { type: String, required: true },
    status: { type: String, enum: ["Open", "Investigating", "Resolved", "Closed"], default: "Open", index: true },
    priority: { type: String, enum: ["P1", "P2", "P3", "P4"], default: "P3" },
    severity: { type: String, enum: ["critical", "high", "medium", "low", "info", "safe"], required: true },
    assignee: { type: String, default: "Unassigned" },
    sourceIp: { type: String },
    relatedFlows: [{ type: mongoose.Schema.Types.ObjectId, ref: "NetworkFlow" }],
    notes: [
      {
        author: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        text: String,
        createdAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

export const Incident = mongoose.model("Incident", incidentSchema);
