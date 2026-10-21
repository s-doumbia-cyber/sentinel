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

const bool = z.enum(["true", "false", "1", "0"]).transform((v) => v === "true" || v === "1");

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
    /** Where uploads wait for their import job; must be shared with the worker process. Default: OS temp dir. */
    UPLOAD_DIR: z.string().min(1).optional(),
    /** Durable queues (BullMQ). Without it, jobs run in-process and do not survive a restart. */
    REDIS_URL: z.string().regex(/^rediss?:\/\//, "REDIS_URL must start with redis:// or rediss://").optional(),
    QUEUE_PREFIX: z.string().regex(/^[a-z0-9_-]{1,32}$/).default("sentinel"),
    JOB_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
    JOB_BACKOFF_MS: z.coerce.number().int().min(1).max(600_000).default(5000),
    /** false: this process only enqueues; a separate `worker` process runs the jobs (needs REDIS_URL). */
    RUN_WORKERS: bool.default("true"),
    METRICS_ENABLED: bool.default("false"),
    /** When set, /metrics requires `Authorization: Bearer <token>`. */
    METRICS_TOKEN: z.string().min(16).optional(),
    /** Key for secrets stored at rest (TOTP seeds). >= 32 characters. Derived from JWT_ACCESS_SECRET when unset. */
    ENCRYPTION_KEY: z.string().min(32, "ENCRYPTION_KEY must be at least 32 characters").optional(),
    /** How often the retention sweep checks orgs that set a retention period. 0 disables the sweep. */
    RETENTION_SWEEP_HOURS: z.coerce.number().min(0).max(168).default(24),
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
    if (!env.RUN_WORKERS && !env.REDIS_URL) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "RUN_WORKERS=false needs REDIS_URL (in-process jobs have no other worker)", path: ["RUN_WORKERS"] });
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
      uploadDir: env.UPLOAD_DIR ?? null,
      jobs: {
        redisUrl: env.REDIS_URL ?? null,
        prefix: env.QUEUE_PREFIX,
        attempts: env.JOB_ATTEMPTS,
        backoffMs: env.JOB_BACKOFF_MS,
        runWorkers: env.RUN_WORKERS,
      },
      metrics: { enabled: env.METRICS_ENABLED, token: env.METRICS_TOKEN ?? null },
      encryption: { key: env.ENCRYPTION_KEY ?? accessSecret, derivedFromAccessSecret: !env.ENCRYPTION_KEY },
      retentionSweepHours: env.RETENTION_SWEEP_HOURS,
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
