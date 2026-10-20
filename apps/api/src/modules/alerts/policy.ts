import type { Types } from "mongoose";
import { cidrContains, parseCidr, type Cidr } from "@sentinel/shared";
import { Org } from "../../models/identity.js";

/** What turns evidence into an alert for one org (docs/ML_AND_DETECTION.md §8). */
export interface AlertPolicy {
  /** Confidence at or above which a model-only alert is `open` rather than `needs_review`. */
  needsReviewThreshold: number;
  /** Model verdicts below this never create alerts; 0 disables the filter. */
  modelAlertMinConfidence: number;
  allowlist: Cidr[];
}

export const DEFAULT_POLICY: AlertPolicy = { needsReviewThreshold: 0.6, modelAlertMinConfidence: 0, allowlist: [] };

type OrgSettings = { needsReviewThreshold?: number | null; modelAlertMinConfidence?: number | null; alertAllowlist?: { cidr: string }[] | null } | null | undefined;

export function policyFromSettings(settings: OrgSettings): AlertPolicy {
  return {
    needsReviewThreshold: settings?.needsReviewThreshold ?? DEFAULT_POLICY.needsReviewThreshold,
    modelAlertMinConfidence: settings?.modelAlertMinConfidence ?? 0,
    // Entries were validated on write; anything unparsable is ignored rather than matching everything.
    allowlist: (settings?.alertAllowlist ?? []).flatMap((e) => {
      const c = parseCidr(e.cidr);
      return c ? [c] : [];
    }),
  };
}

export async function loadAlertPolicy(orgId: Types.ObjectId): Promise<AlertPolicy> {
  const org = await Org.findById(orgId).select("settings").lean();
  return policyFromSettings(org?.settings as OrgSettings);
}

/** True when either endpoint is on the org's allowlist. */
export function isAllowlisted(policy: AlertPolicy, ...ips: (string | null | undefined)[]): boolean {
  return ips.some((ip) => typeof ip === "string" && policy.allowlist.some((c) => cidrContains(c, ip)));
}
