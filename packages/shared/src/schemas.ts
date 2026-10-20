import { z } from "zod";
import { parseCidr } from "./net.js";
import { ROLES } from "./rbac.js";
import { SEVERITIES } from "./severity.js";
import { ATTACK_CLASSES, FEATURE_SCHEMA_IDS, SOURCE_KINDS } from "./taxonomy.js";

export const roleSchema = z.enum(ROLES);
export const severitySchema = z.enum(SEVERITIES);
export const attackClassSchema = z.enum(ATTACK_CLASSES);
export const sourceKindSchema = z.enum(SOURCE_KINDS);
export const featureSchemaIdSchema = z.enum(FEATURE_SCHEMA_IDS);

export const objectIdSchema = z.string().regex(/^[a-f0-9]{24}$/i, "Invalid id");

/** Error envelope (CLAUDE.md §8). */
export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.array(z.unknown()).optional(),
    requestId: z.string().optional(),
  }),
});
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

// ---- Auth ----------------------------------------------------------------

export const registerBodySchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  email: z.string().trim().toLowerCase().email("Invalid email address").max(255),
  password: z.string().min(12, "Password must be at least 12 characters (OWASP ASVS 2.1.1)").max(200),
  orgName: z.string().trim().min(1).max(100).optional(),
});

export const loginBodySchema = z.object({
  email: z.string().trim().toLowerCase().email("Invalid email address"),
  password: z.string().min(1, "Password is required").max(200),
});

export const changePasswordBodySchema = z.object({
  currentPassword: z.string().min(1, "Current password is required").max(200),
  newPassword: z.string().min(12, "New password must be at least 12 characters").max(200),
});

export const LANGUAGES = ["en", "fr", "hi"] as const;
/** Natural accents of the light identity; "pine" is the default. */
export const ACCENTS = ["pine", "ocean", "plum"] as const;
export const THEMES = ["light", "dark", "system"] as const;
export const DENSITIES = ["comfortable", "compact"] as const;

export const updateMeBodySchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    preferences: z
      .object({
        emailAlerts: z.boolean().optional(),
        pushAlerts: z.boolean().optional(),
        language: z.enum(LANGUAGES).optional(),
        accentColor: z.enum(ACCENTS).optional(),
        theme: z.enum(THEMES).optional(),
        density: z.enum(DENSITIES).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

// ---- Flows ---------------------------------------------------------------

const isoDate = z.string().datetime({ offset: true });

export const flowQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(200).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  sourceIp: z.string().ip().optional(),
  destinationIp: z.string().ip().optional(),
  port: z.coerce.number().int().min(0).max(65535).optional(),
  protocol: z.enum(["TCP", "UDP", "ICMP", "OTHER"]).optional(),
  sourceKind: sourceKindSchema.optional(),
  datasetId: objectIdSchema.optional(),
  /**
   * Filter on the model verdict: a class, `malicious` (any non-Normal verdict),
   * `unscored` (waiting for a model) or `error` (scoring failed).
   */
  verdict: z.union([attackClassSchema, z.enum(["unscored", "malicious", "error"])]).optional(),
  severity: severitySchema.optional(),
  needsReview: z.enum(["true"]).optional(),
});
export type FlowQuery = z.infer<typeof flowQuerySchema>;

export const statsQuerySchema = flowQuerySchema.pick({
  from: true,
  to: true,
  sourceKind: true,
  datasetId: true,
  protocol: true,
  verdict: true,
  severity: true,
  needsReview: true,
});
export type StatsQuery = z.infer<typeof statsQuerySchema>;

// ---- Incidents -------------------------------------------------------------

export const INCIDENT_STATUSES = ["Open", "Investigating", "Contained", "Resolved", "Closed"] as const;
export const PRIORITIES = ["P1", "P2", "P3", "P4"] as const;

export const createIncidentBodySchema = z
  .object({
    title: z.string().trim().min(3).max(200),
    attackType: attackClassSchema,
    severity: severitySchema,
    priority: z.enum(PRIORITIES).default("P3"),
    sourceIp: z.string().ip().optional(),
    assigneeId: objectIdSchema.nullable().optional(),
    description: z.string().trim().max(5000).optional(),
  })
  .strict();

export const updateIncidentBodySchema = z
  .object({
    title: z.string().trim().min(3).max(200).optional(),
    status: z.enum(INCIDENT_STATUSES).optional(),
    priority: z.enum(PRIORITIES).optional(),
    severity: severitySchema.optional(),
    assigneeId: objectIdSchema.nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "At least one field is required");

export const incidentNoteBodySchema = z.object({ text: z.string().trim().min(1).max(5000) }).strict();

// ---- Members ---------------------------------------------------------------

export const updateMemberRoleBodySchema = z.object({ role: roleSchema }).strict();

// ---- Detection tuning (alert noise controls) ----------------------------------------

export const MAX_ALLOWLIST_ENTRIES = 200;

export const allowlistEntryInputSchema = z
  .object({
    cidr: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .refine((v) => parseCidr(v) !== null, "Use an address or a network such as 203.0.113.0/24 (host bits must be zero)"),
    note: z.string().trim().min(1, "Say why this address is trusted").max(200),
  })
  .strict();

export const detectionSettingsUpdateSchema = z
  .object({
    /** Model verdicts below this confidence never become alerts (they stay visible in Flows). 0 disables the filter. */
    modelAlertMinConfidence: z.number().min(0).max(1).optional(),
    allowlist: z.array(allowlistEntryInputSchema).max(MAX_ALLOWLIST_ENTRIES).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "At least one field is required");
export type DetectionSettingsUpdate = z.infer<typeof detectionSettingsUpdateSchema>;
