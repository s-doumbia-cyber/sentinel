import mongoose, { Schema, type InferSchemaType, type Types } from "mongoose";
import { ACCENTS, DENSITIES, LANGUAGES, ROLES, THEMES } from "@sentinel/shared";

// ---- Users ------------------------------------------------------------------

const LEGACY_LANGUAGE: Record<string, (typeof LANGUAGES)[number]> = {
  English: "en",
  "Français": "fr",
  "हिन्दी (Hindi)": "hi",
};

/** Accepts the legacy display names stored by the JavaScript backend. */
export function normalizeLanguage(value: unknown): (typeof LANGUAGES)[number] {
  if (typeof value === "string") {
    if ((LANGUAGES as readonly string[]).includes(value)) return value as (typeof LANGUAGES)[number];
    const mapped = LEGACY_LANGUAGE[value];
    if (mapped) return mapped;
  }
  return "en";
}

/** Accents from earlier UIs (violet, cyan, emerald, pink) fall back to the default pine. */
export function normalizeAccent(value: unknown): (typeof ACCENTS)[number] {
  return typeof value === "string" && (ACCENTS as readonly string[]).includes(value) ? (value as (typeof ACCENTS)[number]) : "pine";
}

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    /** argon2id; legacy bcrypt hashes are verified once and upgraded on next login. */
    passwordHash: { type: String, required: true },
    preferences: {
      emailAlerts: { type: Boolean, default: true },
      pushAlerts: { type: Boolean, default: true },
      language: { type: String, default: "en", set: normalizeLanguage },
      accentColor: { type: String, enum: ACCENTS, default: "pine", set: normalizeAccent },
      theme: { type: String, enum: THEMES, default: "light" },
      density: { type: String, enum: DENSITIES, default: "comfortable" },
    },
  },
  { timestamps: true },
);

export type UserDoc = InferSchemaType<typeof userSchema> & { _id: Types.ObjectId };
export const User = mongoose.model("User", userSchema);

// ---- Orgs and memberships ---------------------------------------------------

const orgSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    slug: { type: String, required: true, unique: true },
    settings: {
      /** Model confidence below this marks a verdict `needsReview` (docs/ML_AND_DETECTION.md §8). */
      needsReviewThreshold: { type: Number, default: 0.6, min: 0, max: 1 },
      /** Alerts from the same source within this window are grouped into one incident (docs/PRODUCT_SPEC.md F5). */
      correlationWindowMinutes: { type: Number, default: 15, min: 1, max: 1440 },
      /** Active model version per feature schema, chosen by an Owner/Admin of this org. */
      activeModels: { type: Map, of: String, default: () => new Map() },
    },
  },
  { timestamps: true },
);

export type OrgDoc = InferSchemaType<typeof orgSchema> & { _id: Types.ObjectId };
export const Org = mongoose.model("Org", orgSchema);

const membershipSchema = new Schema(
  {
    orgId: { type: Schema.Types.ObjectId, ref: "Org", required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    role: { type: String, enum: ROLES, required: true },
  },
  { timestamps: true },
);
membershipSchema.index({ orgId: 1, userId: 1 }, { unique: true });

export type MembershipDoc = InferSchemaType<typeof membershipSchema> & { _id: Types.ObjectId };
export const Membership = mongoose.model("Membership", membershipSchema);

// ---- Sessions (refresh-token families) --------------------------------------

const authSessionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    /** SHA-256 of the current refresh token secret; the secret itself is never stored. */
    refreshTokenHash: { type: String, required: true },
    /** Hashes already rotated out. Presenting one again means the token was stolen or replayed. */
    rotatedHashes: { type: [String], default: [] },
    lastRotatedAt: { type: Date, default: null },
    userAgent: { type: String, default: "", maxlength: 500 },
    ip: { type: String, default: "" },
    lastSeenAt: { type: Date, default: () => new Date() },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    revokedReason: { type: String, default: null },
  },
  { timestamps: true },
);
authSessionSchema.index({ userId: 1, revokedAt: 1 });
authSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type AuthSessionDoc = InferSchemaType<typeof authSessionSchema> & { _id: Types.ObjectId };
// A distinct collection from the legacy `sessions` (JWT jti records), which the new code never trusts.
export const AuthSession = mongoose.model("AuthSession", authSessionSchema, "auth_sessions");
