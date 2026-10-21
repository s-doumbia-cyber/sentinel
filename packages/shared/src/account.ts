import { z } from "zod";
import { ROLES } from "./rbac.js";

/**
 * Contracts for team management (invitations), multi-factor authentication and
 * data retention. Kept apart from schemas.ts so these features evolve independently.
 */

// ---- Invitations -------------------------------------------------------------------

/** Invitation tokens: 32 random bytes, base64url (shown once, stored as a SHA-256 hash). */
export const inviteTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/, "Invalid invitation link");

export const createInviteBodySchema = z
  .object({
    email: z.string().trim().toLowerCase().email("Invalid email address").max(255),
    role: z.enum(ROLES),
    /** Single-use link valid for this many days (PRODUCT_SPEC F1: 7 by default). */
    expiresInDays: z.number().int().min(1).max(14).default(7),
  })
  .strict();
export type CreateInviteBody = z.infer<typeof createInviteBodySchema>;

export const inviteTokenBodySchema = z.object({ token: inviteTokenSchema }).strict();

export const acceptInviteNewAccountBodySchema = z
  .object({
    token: inviteTokenSchema,
    name: z.string().trim().min(1, "Name is required").max(100),
    password: z.string().min(12, "Password must be at least 12 characters (OWASP ASVS 2.1.1)").max(200),
  })
  .strict();

export const INVITE_STATUSES = ["pending", "accepted", "revoked", "expired"] as const;
export type InviteStatus = (typeof INVITE_STATUSES)[number];

// ---- MFA (TOTP) ----------------------------------------------------------------------

export const totpCodeSchema = z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code from your authenticator app");
/** Recovery codes: 10 base32 characters, shown as two groups of five ("ABCDE-FGHIJ"). */
export const recoveryCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .transform((v) => v.replace(/[\s-]/g, ""))
  .pipe(z.string().regex(/^[A-Z2-7]{10}$/, "Invalid recovery code"));

export const mfaEnableBodySchema = z.object({ code: totpCodeSchema }).strict();

export const mfaLoginBodySchema = z
  .object({
    mfaToken: z.string().min(20).max(1000),
    code: totpCodeSchema.optional(),
    recoveryCode: recoveryCodeSchema.optional(),
  })
  .strict()
  .refine((v) => Boolean(v.code) !== Boolean(v.recoveryCode), "Send either a 6-digit code or a recovery code");

export const passwordConfirmBodySchema = z.object({ password: z.string().min(1, "Password is required").max(200) }).strict();

// ---- Data retention --------------------------------------------------------------------

export const RETENTION_MIN_DAYS = 1;
export const RETENTION_MAX_DAYS = 3650;

export const retentionDaysSchema = z.number().int().min(RETENTION_MIN_DAYS).max(RETENTION_MAX_DAYS);

/** `null` keeps data until someone deletes it (the default: nothing is purged silently). */
export const retentionSettingsBodySchema = z.object({ retentionDays: retentionDaysSchema.nullable() }).strict();

export const retentionPreviewQuerySchema = z.object({ days: z.coerce.number().int().min(RETENTION_MIN_DAYS).max(RETENTION_MAX_DAYS).optional() });
