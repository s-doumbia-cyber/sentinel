import { objectIdSchema } from "@sentinel/shared";
import { z } from "zod";
import type { AppConfig } from "../../config/index.js";
import { AppError } from "../../lib/errors.js";
import { ah, authOf, parsed, validate } from "../../lib/http.js";
import { PolicyRouter } from "../../lib/routes.js";
import { User } from "../../models/identity.js";
import { ValidationRun, type ValidationRunDoc } from "../../models/validation.js";
import { auditFromRequest } from "../audit/audit.service.js";
import type { MlClient } from "../models/ml.client.js";
import { validateModel, validateRule } from "./validation.service.js";

const runBody = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("model"), modelVersion: z.string().regex(/^[A-Za-z0-9._-]{1,100}$/), datasetId: objectIdSchema }).strict(),
  z.object({ kind: z.literal("rule"), ruleId: objectIdSchema, datasetId: objectIdSchema }).strict(),
]);

function toRunResponse(r: ValidationRunDoc, by: string | null) {
  return {
    id: String(r._id),
    kind: r.kind,
    target: r.target,
    targetVersion: r.targetVersion ?? null,
    dataset: { id: String(r.datasetId), name: r.datasetName, sha256: r.datasetSha256 ?? null },
    trainingOverlap: r.trainingOverlap ?? null,
    createdBy: by,
    createdAt: r.createdAt,
    flowsScanned: r.flowsScanned,
    metrics: r.metrics,
    falsePositives: r.falsePositives,
    falseNegatives: r.falseNegatives,
    notes: r.notes,
  };
}

async function nameOf(id: unknown): Promise<string | null> {
  const u = id ? await User.findById(id).select("name").lean() : null;
  return u?.name ?? (id ? "Former member" : null);
}

export function validationRoutes(config: AppConfig, deps: { ml: MlClient }): PolicyRouter {
  const r = new PolicyRouter(config);

  r.route(
    "get",
    "/validation/runs",
    "rules:read",
    ah(async (req, res) => {
      const { orgId } = authOf(req);
      const runs = await ValidationRun.find({ orgId }).select("-falsePositives -falseNegatives").sort({ createdAt: -1 }).limit(100).lean<ValidationRunDoc[]>();
      const users = await User.find({ _id: { $in: runs.map((x) => x.createdBy) } }).select("name").lean();
      const names = new Map(users.map((u) => [String(u._id), u.name]));
      res.json({ items: runs.map((x) => ({ ...toRunResponse({ ...x, falsePositives: [], falseNegatives: [] } as ValidationRunDoc, names.get(String(x.createdBy)) ?? "Former member") })) });
    }),
  );

  r.route(
    "get",
    "/validation/runs/:id",
    "rules:read",
    validate("params", z.object({ id: objectIdSchema })),
    ah(async (req, res) => {
      const { orgId } = authOf(req);
      const { id } = parsed<{ id: string }>(req, "params");
      const run = await ValidationRun.findOne({ orgId, _id: id }).lean<ValidationRunDoc>();
      if (!run) throw AppError.notFound("Validation run");
      res.json(toRunResponse(run, await nameOf(run.createdBy)));
    }),
  );

  r.route(
    "post",
    "/validation/runs",
    "rules:test",
    validate("body", runBody),
    ah(async (req, res) => {
      const { orgId, userId } = authOf(req);
      const body = parsed<z.infer<typeof runBody>>(req, "body");
      const run =
        body.kind === "model"
          ? await validateModel(orgId, userId, deps.ml, body.modelVersion, body.datasetId)
          : await validateRule(orgId, userId, body.ruleId, body.datasetId);
      await auditFromRequest(req, "validation.run", { type: "validation_run", id: String(run._id) }, {
        kind: run.kind,
        target: run.target,
        targetVersion: run.targetVersion ?? null,
        dataset: run.datasetName,
        datasetSha256: run.datasetSha256 ?? null,
      });
      res.status(201).json(toRunResponse(run, await nameOf(run.createdBy)));
    }),
  );

  return r;
}
