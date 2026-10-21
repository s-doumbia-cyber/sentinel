import mongoose, { Schema, type InferSchemaType, type Types } from "mongoose";
import { ROLES } from "@sentinel/shared";

/**
 * Single-use invitations to join an org. The token itself is never stored: only
 * its SHA-256, so a database leak does not hand out working links. Not wrapped by
 * tenantGuard because acceptance looks a token up before any org is known; every
 * org-side query passes `orgId` explicitly.
 */
const inviteSchema = new Schema(
  {
    orgId: { type: Schema.Types.ObjectId, ref: "Org", required: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    role: { type: String, enum: ROLES, required: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    acceptedAt: { type: Date, default: null },
    acceptedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    revokedAt: { type: Date, default: null },
    revokedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true },
);
inviteSchema.index({ orgId: 1, createdAt: -1 });
inviteSchema.index({ orgId: 1, email: 1 });
// Expired invitations are kept 30 days for the Team page history, then removed.
inviteSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 30 * 86_400 });

export type InviteDoc = InferSchemaType<typeof inviteSchema> & { _id: Types.ObjectId; createdAt: Date };
export const Invite = mongoose.model("Invite", inviteSchema, "invites");
