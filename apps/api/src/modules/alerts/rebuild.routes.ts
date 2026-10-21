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
  /** Queues the rebuild job; resolves once it is durably queued. */
  scheduleRebuild: (orgId: Types.ObjectId, actorId: Types.ObjectId) => Promise<void>;
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
      res.json({ running: await deps.rebuild.isRunning(orgId), preview, last });
    }),
  );

  r.route(
    "post",
    "/detection/reapply",
    "rules:manage",
    validate("body", z.object({}).strict().default({})),
    ah(async (req, res) => {
      const { orgId, userId } = authOf(req);
      await deps.rebuild.begin(orgId);
      try {
        const [policy, preview] = await Promise.all([loadAlertPolicy(orgId), deps.rebuild.plan(orgId)]);
        await auditFromRequest(req, "detection.reapply", { type: "org", id: String(orgId) }, {
          settings: { modelAlertMinConfidence: policy.modelAlertMinConfidence, needsReviewThreshold: policy.needsReviewThreshold, allowlist: policy.allowlist.length },
          plan: preview,
        });
        await deps.scheduleRebuild(orgId, userId);
        res.status(202).json({ started: true, preview });
      } finally {
        // Queued (the queue now reports it busy) or failed to queue: either way this request is done.
        deps.rebuild.release(orgId);
      }
    }),
  );

  return r;
}
