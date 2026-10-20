import { z } from "zod";

const WEAK_SECRET_MARKERS = ["replace", "change", "example", "secret", "demo"];

const csv = z
  .string()
  .transform((s) =>
    s
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean),
  );

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
    MONGO_URI: z.string().min(1, "MONGO_URI is required (see apps/api/.env.example)"),
    JWT_ACCESS_SECRET: z.string().optional(),
    /** Legacy name from the JavaScript backend, accepted so an existing .env keeps working. */
    JWT_SECRET: z.string().optional(),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(7),
    CORS_ORIGINS: csv.optional(),
    /** Legacy single-origin variable from the JavaScript backend. */
    CLIENT_ORIGIN: z.string().optional(),
    TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
    ML_SERVICE_URL: z.string().url().optional(),
    ML_SERVICE_TOKEN: z.string().min(16).optional(),
    UPLOAD_MAX_MB: z.coerce.number().int().min(1).max(2048).default(500),
  })
  .transform((env, ctx) => {
    const accessSecret = env.JWT_ACCESS_SECRET ?? env.JWT_SECRET;
    if (!accessSecret) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "JWT_ACCESS_SECRET is required", path: ["JWT_ACCESS_SECRET"] });
      return z.NEVER;
    }
    if (env.NODE_ENV === "production") {
      const lower = accessSecret.toLowerCase();
      if (accessSecret.length < 32 || WEAK_SECRET_MARKERS.some((m) => lower.includes(m))) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "JWT_ACCESS_SECRET is too weak for production (>= 32 random characters required)",
          path: ["JWT_ACCESS_SECRET"],
        });
        return z.NEVER;
      }
    }
    const corsOrigins = env.CORS_ORIGINS ?? (env.CLIENT_ORIGIN ? [env.CLIENT_ORIGIN] : ["http://localhost:5173"]);
    if (corsOrigins.includes("*")) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Wildcard CORS origins are not allowed", path: ["CORS_ORIGINS"] });
      return z.NEVER;
    }
    return {
      env: env.NODE_ENV,
      isProduction: env.NODE_ENV === "production",
      isTest: env.NODE_ENV === "test",
      port: env.PORT,
      logLevel: env.NODE_ENV === "test" ? "silent" : env.LOG_LEVEL,
      mongoUri: env.MONGO_URI,
      auth: {
        accessSecret,
        accessTtlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
        refreshTtlDays: env.REFRESH_TOKEN_TTL_DAYS,
        usedLegacySecretName: !env.JWT_ACCESS_SECRET && Boolean(env.JWT_SECRET),
      },
      corsOrigins,
      trustProxy: env.TRUST_PROXY,
      ml: { url: env.ML_SERVICE_URL ?? null, token: env.ML_SERVICE_TOKEN ?? null },
      uploadMaxBytes: env.UPLOAD_MAX_MB * 1024 * 1024,
    };
  });

export type AppConfig = z.output<typeof envSchema>;

/**
 * Parses and validates the environment. Throws a readable error listing every
 * problem so the process fails fast on a bad configuration (CLAUDE.md §7).
 * Never include secret values in the message.
 */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  // `KEY=` in .env (as in .env.example) means "not set": without this, an empty optional
  // value such as ML_SERVICE_TOKEN failed its length check and the documented setup did not start.
  const present = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== undefined && v.trim() !== ""));
  const parsed = envSchema.safeParse(present);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".") || "env"}: ${i.message}`);
    throw new Error(`Invalid configuration:\n${lines.join("\n")}`);
  }
  return parsed.data;
}
