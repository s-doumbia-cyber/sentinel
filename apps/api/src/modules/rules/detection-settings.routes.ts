import { detectionSettingsUpdateSchema, normalizeCidr, type DetectionSettingsUpdate } from "@sentinel/shared";
import type { Types } from "mongoose";
import type { AppConfig } from "../../config/index.js";
import { AppError } from "../../lib/errors.js";
import { ah, authOf, parsed, validate } from "../../lib/http.js";
import { PolicyRouter } from "../../lib/routes.js";
import { Org } from "../../models/identity.js";
import { Flow } from "../../models/tenant.js";
import { auditFromRequest } from "../audit/audit.service.js";
import { userNames } from "../incidents/incident.dto.js";

type Entry = { cidr: string; note: string; addedBy?: Types.ObjectId | null; addedAt: Date };
type Settings = { needsReviewThreshold?: number; modelAlertMinConfidence?: number; alertAllowlist?: Entry[] };

async function view(orgId: Types.ObjectId) {
  const org = await Org.findById(orgId).select("settings").lean();
  if (!org) throw AppError.notFound("Organisation");
  const s = (org.settings ?? {}) as Settings;
  const entries = s.alertAllowlist ?? [];
  const [names, belowMinConfidence, allowlisted] = await Promise.all([
    userNames(entries.map((e) => e.addedBy)),
    Flow.countDocuments({ orgId, alertSuppressed: "below_min_confidence" }),
    Flow.countDocuments({ orgId, alertSuppressed: "allowlisted" }),
  ]);
  return {
    modelAlertMinConfidence: s.modelAlertMinConfidence ?? 0,
    needsReviewThreshold: s.needsReviewThreshold ?? 0.6,
    allowlist: entries.map((e) => ({ cidr: e.cidr, note: e.note, addedBy: e.addedBy ? (names.get(String(e.addedBy)) ?? "Former member") : null, addedAt: e.addedAt })),
    // Model verdicts kept on their flows but not turned into alerts, by reason.
    suppressedVerdicts: { belowMinConfidence, allowlisted },
  };
}

/**
 * Alert noise controls (docs/ML_AND_DETECTION.md §8): a minimum model
 * confidence for alerting and an allowlist of trusted addresses. They apply to
 * evidence processed after the change; existing alerts are not rewritten.
 */
export function detectionSettingsRoutes(config: AppConfig): PolicyRouter {
  const r = new PolicyRouter(config);

  r.route(
    "get",
    "/detection/settings",
    "rules:read",
    ah(async (req, res) => {
      res.json(await view(authOf(req).orgId));
    }),
  );

  r.route(
    "patch",
    "/detection/settings",
    "rules:manage",
    validate("body", detectionSettingsUpdateSchema),
    ah(async (req, res) => {
      const { orgId, userId } = authOf(req);
      const body = parsed<DetectionSettingsUpdate>(req, "body");
      const org = await Org.findById(orgId).select("settings").lean();
      if (!org) throw AppError.notFound("Organisation");
      const before = (org.settings ?? {}) as Settings;
      const set: Record<string, unknown> = {};
      if (body.modelAlertMinConfidence !== undefined) set["settings.modelAlertMinConfidence"] = body.modelAlertMinConfidence;
      if (body.allowlist) {
        const previous = new Map((before.alertAllowlist ?? []).map((e) => [e.cidr, e]));
        const seen = new Set<string>();
        const now = new Date();
        set["settings.alertAllowlist"] = body.allowlist.flatMap((e) => {
          const cidr = normalizeCidr(e.cidr);
          if (!cidr || seen.has(cidr)) return [];
          seen.add(cidr);
          const kept = previous.get(cidr);
          // Who added an entry, and when, survives later edits of its note.
          return [{ cidr, note: e.note, addedBy: kept ? (kept.addedBy ?? null) : userId, addedAt: kept?.addedAt ?? now }];
        });
      }
      await Org.updateOne({ _id: orgId }, { $set: set });
      await auditFromRequest(
        req,
        "detection.settings_update",
        { type: "org", id: String(orgId) },
        {
          before: { modelAlertMinConfidence: before.modelAlertMinConfidence ?? 0, allowlist: (before.alertAllowlist ?? []).map((e) => e.cidr) },
          after: {
            modelAlertMinConfidence: body.modelAlertMinConfidence ?? before.modelAlertMinConfidence ?? 0,
            allowlist: body.allowlist ? (set["settings.alertAllowlist"] as Entry[]).map((e) => e.cidr) : (before.alertAllowlist ?? []).map((e) => e.cidr),
          },
        },
      );
      res.json(await view(orgId));
    }),
  );

  return r;
}
