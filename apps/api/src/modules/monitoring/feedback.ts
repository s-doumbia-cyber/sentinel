import type { Types } from "mongoose";
import { ALERT_VERDICTS, type AlertVerdict } from "@sentinel/shared";
import { Alert } from "../../models/tenant.js";

export interface FeedbackRow {
  type: string;
  truePositive: number;
  falsePositive: number;
  benign: number;
  /** Alerts of this class from this model that nobody has judged yet. */
  unreviewed: number;
}

export interface ModelFeedback {
  modelVersion: string;
  totals: { alerts: number; reviewed: number; truePositive: number; falsePositive: number; benign: number; unreviewed: number; withRuleEvidence: number };
  /** truePositive / reviewed: only over alerts an analyst chose to review, so it is not the model's precision. */
  confirmedShareOfReviewed: number | null;
  byType: FeedbackRow[];
}

const FIELD: Record<AlertVerdict, "truePositive" | "falsePositive" | "benign"> = { true_positive: "truePositive", false_positive: "falsePositive", benign: "benign" };

/**
 * Analyst verdicts on alerts the model contributed to, aggregated per model
 * version. An alert fed by two model versions counts under both. Triage is
 * selective (analysts open the loud and the odd ones first), so these figures
 * describe reviewed alerts only and must not be presented as precision.
 */
export async function modelFeedback(orgId: Types.ObjectId, version: string): Promise<ModelFeedback> {
  const rows = await Alert.aggregate<{ _id: { type: string; verdict: AlertVerdict | null; rule: boolean }; n: number }>([
    { $match: { orgId, modelVersions: version } },
    { $group: { _id: { type: "$type", verdict: "$verdict", rule: { $gt: [{ $size: { $ifNull: ["$ruleIds", []] } }, 0] } }, n: { $sum: 1 } } },
  ]);
  const byType = new Map<string, FeedbackRow>();
  const totals = { alerts: 0, reviewed: 0, truePositive: 0, falsePositive: 0, benign: 0, unreviewed: 0, withRuleEvidence: 0 };
  for (const { _id, n } of rows) {
    const row = byType.get(_id.type) ?? { type: _id.type, truePositive: 0, falsePositive: 0, benign: 0, unreviewed: 0 };
    totals.alerts += n;
    if (_id.rule) totals.withRuleEvidence += n;
    if (_id.verdict && ALERT_VERDICTS.includes(_id.verdict)) {
      row[FIELD[_id.verdict]] += n;
      totals[FIELD[_id.verdict]] += n;
      totals.reviewed += n;
    } else {
      row.unreviewed += n;
      totals.unreviewed += n;
    }
    byType.set(_id.type, row);
  }
  return {
    modelVersion: version,
    totals,
    confirmedShareOfReviewed: totals.reviewed ? Math.round((totals.truePositive / totals.reviewed) * 10_000) / 10_000 : null,
    byType: [...byType.values()].sort((a, b) => a.type.localeCompare(b.type)),
  };
}
