import type { Types } from "mongoose";
import { z } from "zod";
import type { AppConfig } from "../../config/index.js";
import { ah, authOf, validate } from "../../lib/http.js";
import { PolicyRouter } from "../../lib/routes.js";
import { auditFromRequest } from "../audit/audit.service.js";
import { loadAlertPolicy } from "./policy.js";
import type { AlertRebuildService } from "./rebuild.service.js";

export interface RebuildRouteDeps {
  rebuild: AlertRebuildService;
  /** Runs the rebuild in the background; the caller already holds the lock from `rebuild.begin()`. */
  scheduleRebuild: (orgId: Types.ObjectId, actorId: Types.ObjectId) => void;
}

/**
 * Re-applies the org's current alert noise settings (minimum confidence,
 * allowlist, review threshold) to alerts that already exist. Owner / Admin only,
 * like the settings themselves.
 */
export function rebuildRoutes(config: AppConfig, deps: RebuildRouteDeps): PolicyRouter {
  const r = new PolicyRouter(config);

  r.route(
    "get",
    "/detection/reapply",
    "rules:read",
    ah(async (req, res) => {
      const { orgId } = authOf(req);
      const [preview, last] = await Promise.all([deps.rebuild.plan(orgId), deps.rebuild.lastRun(orgId)]);
      res.json({ running: deps.rebuild.isRunning(orgId), preview, last });
    }),
  );

  r.route(
    "post",
    "/detection/reapply",
    "rules:manage",
    validate("body", z.object({}).strict().default({})),
    ah(async (req, res) => {
      const { orgId, userId } = authOf(req);
      deps.rebuild.begin(orgId);
      try {
        const [policy, preview] = await Promise.all([loadAlertPolicy(orgId), deps.rebuild.plan(orgId)]);
        await auditFromRequest(req, "detection.reapply", { type: "org", id: String(orgId) }, {
          settings: { modelAlertMinConfidence: policy.modelAlertMinConfidence, needsReviewThreshold: policy.needsReviewThreshold, allowlist: policy.allowlist.length },
          plan: preview,
        });
        deps.scheduleRebuild(orgId, userId);
        res.status(202).json({ started: true, preview });
      } catch (err) {
        // The job never started, so nobody else will release the lock.
        deps.rebuild.release(orgId);
        throw err;
      }
    }),
  );

  return r;
}
