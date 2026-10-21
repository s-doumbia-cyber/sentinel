import { retentionPreviewQuerySchema, retentionSettingsBodySchema } from "@sentinel/shared";
import type { z } from "zod";
import type { AppConfig } from "../../config/index.js";
import { AppError } from "../../lib/errors.js";
import { ah, authOf, parsed, validate } from "../../lib/http.js";
import { PolicyRouter } from "../../lib/routes.js";
import { Org } from "../../models/identity.js";
import { auditFromRequest } from "../audit/audit.service.js";
import type { Scheduler } from "../jobs/job.handlers.js";
import { previewRetention } from "./retention.service.js";

export function retentionRoutes(config: AppConfig, deps: { schedule: Pick<Scheduler, "retention" | "busy"> }): PolicyRouter {
  const r = new PolicyRouter(config);

  r.route(
    "get",
    "/retention",
    "retention:read",
    ah(async (req, res) => {
      const { orgId } = authOf(req);
      const org = await Org.findById(orgId).select("settings.retentionDays settings.lastRetentionRun").lean();
      const last = org?.settings?.lastRetentionRun;
      res.json({
        retentionDays: org?.settings?.retentionDays ?? null,
        basis: "storage time (when Sentinel stored the flow, or last updated the alert), not event time",
        sweepHours: config.retentionSweepHours,
        running: await deps.schedule.busy("retention", orgId),
        lastRun: last?.at ? { at: last.at, cutoff: last.cutoff, flowsDeleted: last.flowsDeleted, alertsDeleted: last.alertsDeleted, alertsKept: last.alertsKept } : null,
        neverPurged: ["incidents and their linked alerts", "audit log", "dataset import records", "identity records", "validation runs"],
      });
    }),
  );

  r.route(
    "get",
    "/retention/preview",
    "retention:read",
    validate("query", retentionPreviewQuerySchema),
    ah(async (req, res) => {
      const { orgId } = authOf(req);
      const q = parsed<z.infer<typeof retentionPreviewQuerySchema>>(req, "query");
      const days = q.days ?? (await Org.findById(orgId).select("settings.retentionDays").lean())?.settings?.retentionDays ?? null;
      if (!days) throw AppError.validation("No retention period set: pass ?days= to preview one");
      // A dry run: counts only, nothing is deleted or audited.
      res.json({ dryRun: true, ...(await previewRetention(orgId, days)) });
    }),
  );

  r.route(
    "patch",
    "/retention",
    "retention:manage",
    validate("body", retentionSettingsBodySchema),
    ah(async (req, res) => {
      const { orgId } = authOf(req);
      const { retentionDays } = parsed<z.infer<typeof retentionSettingsBodySchema>>(req, "body");
      const before = await Org.findOneAndUpdate({ _id: orgId }, { $set: { "settings.retentionDays": retentionDays } }).select("settings.retentionDays").lean();
      const previous = before?.settings?.retentionDays ?? null;
      await auditFromRequest(req, "retention.settings_update", { type: "org", id: String(orgId) }, { from: previous, to: retentionDays });
      res.json({ retentionDays });
    }),
  );

  r.route(
    "post",
    "/retention/run",
    "retention:manage",
    ah(async (req, res) => {
      const { orgId, userId } = authOf(req);
      const org = await Org.findById(orgId).select("settings.retentionDays").lean();
      if (!org?.settings?.retentionDays) throw AppError.conflict("Set a retention period first");
      const jobId = await deps.schedule.retention(orgId, userId);
      await auditFromRequest(req, "retention.run", { type: "org", id: String(orgId) }, { retentionDays: org.settings.retentionDays, jobId });
      res.status(202).json({ started: true, jobId });
    }),
  );

  return r;
}
