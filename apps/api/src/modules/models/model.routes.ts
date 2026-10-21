import type { Types } from "mongoose";
import { FEATURE_SCHEMA_IDS, featureSchemaIdSchema, type FeatureSchemaId } from "@sentinel/shared";
import { z } from "zod";
import type { AppConfig } from "../../config/index.js";
import { AppError } from "../../lib/errors.js";
import { ah, authOf, parsed, validate } from "../../lib/http.js";
import { PolicyRouter } from "../../lib/routes.js";
import { Org } from "../../models/identity.js";
import { Dataset, Flow } from "../../models/tenant.js";
import { auditFromRequest } from "../audit/audit.service.js";
import { activeModelsOf, type ScoringService } from "../scoring/scoring.service.js";
import type { MlClient } from "./ml.client.js";

const versionParams = z.object({ version: z.string().regex(/^[A-Za-z0-9._-]{1,100}$/, "Invalid model version") });

export interface ModelRouteDeps {
  ml: MlClient;
  scoring: ScoringService;
  /** Queues a scoring run (durable with Redis). */
  scheduleScoring: (orgId: Types.ObjectId) => Promise<void>;
  /** True while a scoring job for the org is queued or running, in any worker. */
  scoringBusy: (orgId: Types.ObjectId) => Promise<boolean>;
}

async function activeFor(orgId: Types.ObjectId): Promise<Record<string, string>> {
  return activeModelsOf(await Org.findById(orgId).lean());
}

export function modelRoutes(config: AppConfig, deps: ModelRouteDeps): PolicyRouter {
  const r = new PolicyRouter(config);

  r.route(
    "get",
    "/models",
    "models:read",
    ah(async (req, res) => {
      const { orgId } = authOf(req);
      const [models, active] = await Promise.all([deps.ml.listModels(), activeFor(orgId)]);
      res.json({
        items: models.map((m) => ({ ...m, active: active[m.schema] === m.version })),
        active,
      });
    }),
  );

  r.route(
    "get",
    "/models/:version",
    "models:read",
    validate("params", versionParams),
    ah(async (req, res) => {
      const { orgId } = authOf(req);
      const { version } = parsed<{ version: string }>(req, "params");
      const model = await deps.ml.getModel(version);
      if (!model) throw AppError.notFound("Model");
      // Flag datasets of this org that were also used to train the model: evaluating on them is not independent.
      const hashes = model.trainedOn.files.map((f) => f.sha256);
      const overlapping = hashes.length
        ? await Dataset.find({ orgId, fileSha256: { $in: hashes } }).select("_id name").lean()
        : [];
      const active = await activeFor(orgId);
      res.json({
        ...model,
        active: active[model.schema] === model.version,
        trainingOverlap: overlapping.map((d) => ({ datasetId: String(d._id), name: d.name })),
      });
    }),
  );

  r.route(
    "post",
    "/models/:version/activate",
    "models:manage",
    validate("params", versionParams),
    ah(async (req, res) => {
      const { orgId } = authOf(req);
      const { version } = parsed<{ version: string }>(req, "params");
      const model = await deps.ml.getModel(version);
      if (!model) throw AppError.notFound("Model");
      const previous = (await activeFor(orgId))[model.schema] ?? null;
      await Org.updateOne({ _id: orgId }, { $set: { [`settings.activeModels.${model.schema}`]: version } });
      await auditFromRequest(req, "model.activate", { type: "model", id: version }, { schema: model.schema, previous });
      await deps.scheduleScoring(orgId);
      res.json({ schema: model.schema, active: version, previous, versionWarnings: model.versionWarnings });
    }),
  );

  r.route(
    "delete",
    "/models/active/:schema",
    "models:manage",
    validate("params", z.object({ schema: featureSchemaIdSchema })),
    ah(async (req, res) => {
      const { orgId } = authOf(req);
      const { schema } = parsed<{ schema: FeatureSchemaId }>(req, "params");
      const previous = (await activeFor(orgId))[schema] ?? null;
      await Org.updateOne({ _id: orgId }, { $unset: { [`settings.activeModels.${schema}`]: "" } });
      await auditFromRequest(req, "model.deactivate", { type: "model", id: previous }, { schema });
      res.status(204).end();
    }),
  );

  r.route(
    "get",
    "/scoring/status",
    "stats:read",
    ah(async (req, res) => {
      const { orgId } = authOf(req);
      // One count per (schema, status), each answered from the {orgId, scoreStatus, featureSchema} index
      // instead of grouping every flow of the org (seconds at millions of flows).
      const rows = (
        await Promise.all(
          FEATURE_SCHEMA_IDS.flatMap((schema) =>
            (["pending", "scored", "error"] as const).map(async (status) => ({
              _id: { schema, status },
              n: await Flow.countDocuments({ orgId, scoreStatus: status, featureSchema: schema }),
            })),
          ),
        )
      ).filter((x) => x.n > 0);
      const active = await activeFor(orgId);
      res.json({
        running: deps.scoring.isRunning(orgId) || (await deps.scoringBusy(orgId)),
        mlConfigured: Boolean(config.ml.url),
        schemas: FEATURE_SCHEMA_IDS.map((schema) => {
          const of = (status: string) => rows.find((x) => x._id.schema === schema && x._id.status === status)?.n ?? 0;
          return { schema, activeModel: active[schema] ?? null, pending: of("pending"), scored: of("scored"), error: of("error") };
        }),
      });
    }),
  );

  r.route(
    "post",
    "/scoring/run",
    "scoring:run",
    ah(async (req, res) => {
      const { orgId } = authOf(req);
      if (!config.ml.url) throw new AppError("ML_UNAVAILABLE", 503, "ML service is not configured (set ML_SERVICE_URL)");
      await auditFromRequest(req, "scoring.run", { type: "org", id: String(orgId) });
      await deps.scheduleScoring(orgId);
      res.status(202).json({ started: true });
    }),
  );

  return r;
}
