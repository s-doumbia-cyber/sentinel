import { z } from "zod";
import type { AppConfig } from "../../config/index.js";
import { ah, authOf, parsed, validate } from "../../lib/http.js";
import { PolicyRouter } from "../../lib/routes.js";
import { DriftReport } from "../../models/tenant.js";
import { auditFromRequest } from "../audit/audit.service.js";
import type { DriftService } from "./drift.service.js";
import { modelFeedback } from "./feedback.js";

const versionParams = z.object({ version: z.string().regex(/^[A-Za-z0-9._-]{1,100}$/, "Invalid model version") });
const runBody = z.object({ hours: z.number().int().min(1).max(720).default(24) }).strict().default({});

/** Drift (PSI against the training reference) and analyst feedback per model version. */
export function monitoringRoutes(config: AppConfig, deps: { drift: DriftService }): PolicyRouter {
  const r = new PolicyRouter(config);

  r.route(
    "get",
    "/models/:version/drift",
    "models:read",
    validate("params", versionParams),
    ah(async (req, res) => {
      const { orgId } = authOf(req);
      const { version } = parsed<{ version: string }>(req, "params");
      const reports = await DriftReport.find({ orgId, modelVersion: version }).sort({ createdAt: -1, _id: -1 }).limit(20).lean();
      const latest = reports[0];
      res.json({
        latest: latest
          ? {
              id: String(latest._id),
              createdAt: latest.createdAt,
              windowHours: latest.windowHours,
              referenceRows: latest.referenceRows,
              sampleSize: latest.sampleSize,
              maxPsi: latest.maxPsi,
              level: latest.level,
              driftedFeatureCount: latest.driftedFeatureCount,
              features: latest.features,
              predictedClassShare: latest.predictedClassShare,
              trainingClassShare: latest.trainingClassShare,
            }
          : null,
        history: reports.map((d) => ({ id: String(d._id), createdAt: d.createdAt, maxPsi: d.maxPsi, level: d.level, sampleSize: d.sampleSize, windowHours: d.windowHours })),
      });
    }),
  );

  r.route(
    "post",
    "/models/:version/drift",
    "scoring:run",
    validate("params", versionParams),
    validate("body", runBody),
    ah(async (req, res) => {
      const { orgId, userId } = authOf(req);
      const { version } = parsed<{ version: string }>(req, "params");
      const { hours } = parsed<{ hours: number }>(req, "body");
      const outcome = await deps.drift.run(orgId, userId, version, hours);
      await auditFromRequest(
        req,
        "model.drift_check",
        { type: "model", id: version },
        {
          windowHours: hours,
          status: outcome.status,
          sampleSize: outcome.status === "ok" ? outcome.computation.sampleSize : outcome.sampleSize,
          ...(outcome.status === "ok" ? { maxPsi: outcome.computation.maxPsi, level: outcome.computation.level } : {}),
        },
      );
      if (outcome.status !== "ok") {
        res.status(200).json(outcome);
        return;
      }
      res.status(201).json({ status: "ok", id: outcome.reportId, windowHours: outcome.windowHours, ...outcome.computation });
    }),
  );

  r.route(
    "get",
    "/models/:version/feedback",
    "models:read",
    validate("params", versionParams),
    ah(async (req, res) => {
      const { orgId } = authOf(req);
      const { version } = parsed<{ version: string }>(req, "params");
      res.json(await modelFeedback(orgId, version));
    }),
  );

  return r;
}
