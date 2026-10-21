import { attackClassSchema, featureSchemaIdSchema } from "@sentinel/shared";
import { z } from "zod";
import type { AppConfig } from "../../config/index.js";
import { AppError } from "../../lib/errors.js";

const perClassSchema = z.object({
  label: z.string(),
  precision: z.number().nullable(),
  recall: z.number().nullable(),
  f1: z.number().nullable(),
  support: z.number(),
});

export const modelSummarySchema = z
  .object({
    version: z.string(),
    name: z.string(),
    schema: featureSchemaIdSchema,
    algorithm: z.string(),
    kind: z.string(),
    trainedAt: z.string(),
    classes: z.array(z.string()),
    metrics: z
      .object({
        macroF1: z.number(),
        weightedF1: z.number().optional(),
        mcc: z.number().optional(),
        testRows: z.number(),
        perClass: z.array(perClassSchema),
      })
      .passthrough(),
    trainedOn: z
      .object({
        files: z.array(z.object({ name: z.string(), sha256: z.string(), rows: z.number().optional() })).default([]),
        rows: z.number().optional(),
        classCounts: z.record(z.number()).optional(),
      })
      .passthrough(),
    libVersions: z.record(z.string()),
    versionWarnings: z.array(z.string()).default([]),
    sha256: z.string().optional(),
  })
  .passthrough();
export type ModelSummary = z.infer<typeof modelSummarySchema>;

/** Training-time histogram per feature (services/ml reference.json), the baseline of the drift check. */
export const referenceHistogramSchema = z.object({
  schema: featureSchemaIdSchema,
  rows: z.number(),
  bins: z.number(),
  classProportions: z.record(z.number()).default({}),
  features: z.record(z.object({ edges: z.array(z.number()), proportions: z.array(z.number()), missing: z.number() })),
});
export type ReferenceHistogram = z.infer<typeof referenceHistogramSchema>;

const modelDetailSchema = modelSummarySchema.extend({ modelCard: z.string().optional() }).passthrough();
export type ModelDetail = z.infer<typeof modelDetailSchema>;

const predictResponseSchema = z.object({
  modelVersion: z.string(),
  schema: featureSchemaIdSchema,
  results: z.array(
    z.object({
      id: z.string(),
      // Validated separately so one unknown class does not reject the whole batch.
      label: z.string(),
      confidence: z.number().min(0).max(1),
      probabilities: z.record(z.number()),
      topFeatures: z
        .array(z.object({ name: z.string(), contribution: z.number(), value: z.number().nullable() }))
        .optional(),
    }),
  ),
});
export type PredictResponse = z.infer<typeof predictResponseSchema>;

export class MlContractError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "MlContractError";
  }
}

export interface MlClient {
  listModels(): Promise<ModelSummary[]>;
  getModel(version: string): Promise<ModelDetail | null>;
  /** The model's training-time reference distribution; null for models trained before it existed. */
  getReference(version: string): Promise<ReferenceHistogram | null>;
  predict(req: {
    schema: string;
    modelVersion: string;
    flows: { id: string; features: Record<string, number | null> }[];
    explain: boolean;
  }): Promise<PredictResponse>;
}

export function isKnownClass(label: string): boolean {
  return attackClassSchema.safeParse(label).success;
}

/** HTTP client for services/ml. Every response is validated before use. */
export function createMlClient(config: AppConfig): MlClient {
  const base = config.ml.url?.replace(/\/$/, "");

  async function call(path: string, init: RequestInit = {}, timeoutMs = 30_000): Promise<unknown> {
    if (!base) throw new AppError("ML_UNAVAILABLE", 503, "ML service is not configured (set ML_SERVICE_URL)");
    let res: Response;
    try {
      res = await fetch(`${base}${path}`, {
        ...init,
        headers: {
          "content-type": "application/json",
          ...(config.ml.token ? { "x-internal-token": config.ml.token } : {}),
          ...(init.headers ?? {}),
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new AppError("ML_UNAVAILABLE", 503, "ML service is unreachable");
    }
    const body: unknown = await res.json().catch(() => null);
    if (res.status === 404) return null;
    if (res.status >= 400 && res.status < 500) {
      const detail = (body as { detail?: unknown } | null)?.detail;
      throw new MlContractError(typeof detail === "string" ? detail : JSON.stringify(detail ?? body), res.status);
    }
    if (!res.ok) throw new AppError("ML_UNAVAILABLE", 503, `ML service error (${res.status})`);
    return body;
  }

  function parseOrFail<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, value: unknown): T {
    const result = schema.safeParse(value);
    if (!result.success) throw new AppError("ML_UNAVAILABLE", 502, "ML service returned an unexpected response");
    return result.data;
  }

  return {
    async listModels() {
      const body = await call("/models");
      return parseOrFail(z.object({ models: z.array(modelSummarySchema) }), body).models;
    },
    async getModel(version) {
      const body = await call(`/models/${encodeURIComponent(version)}`);
      return body === null ? null : parseOrFail(modelDetailSchema, body);
    },
    async getReference(version) {
      const body = await call(`/models/${encodeURIComponent(version)}/reference`);
      return body === null ? null : parseOrFail(referenceHistogramSchema, body);
    },
    async predict(req) {
      const body = await call("/predict", { method: "POST", body: JSON.stringify(req) }, 120_000);
      return parseOrFail(predictResponseSchema, body);
    },
  };
}
