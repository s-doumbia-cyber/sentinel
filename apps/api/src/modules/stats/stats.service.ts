import type { PipelineStage, Types } from "mongoose";
import { ATTACK_CLASSES, type AttackClass, type StatsQuery } from "@sentinel/shared";
import { Flow } from "../../models/tenant.js";
import { buildFlowFilter } from "../flows/flow.filters.js";

const MALICIOUS = { scoreStatus: "scored", "scored.label": { $ne: "Normal" } };

function countBy(rows: { _id: unknown; n: number }[]): Record<string, number> {
  return Object.fromEntries(rows.map((r) => [String(r._id ?? "null"), r.n]));
}

/**
 * Headline numbers. "Malicious" always means a model verdict; dataset labels
 * are reported separately as ground truth (CLAUDE.md §3.2).
 */
export async function overview(orgId: Types.ObjectId, q: StatsQuery) {
  const match = buildFlowFilter(orgId, q);
  const [facets] = await Flow.aggregate<{
    total: { n: number }[];
    byScoreStatus: { _id: string; n: number }[];
    bySourceKind: { _id: string; n: number }[];
    malicious: { n: number }[];
    needsReview: { n: number }[];
    sources: { n: number }[];
    range: { from: Date; to: Date }[];
  }>([
    { $match: match },
    {
      $facet: {
        total: [{ $count: "n" }],
        byScoreStatus: [{ $group: { _id: "$scoreStatus", n: { $sum: 1 } } }],
        bySourceKind: [{ $group: { _id: "$sourceKind", n: { $sum: 1 } } }],
        malicious: [{ $match: MALICIOUS }, { $count: "n" }],
        needsReview: [{ $match: { scoreStatus: "scored", "scored.needsReview": true } }, { $count: "n" }],
        sources: [{ $match: MALICIOUS }, { $group: { _id: "$sourceIp" } }, { $count: "n" }],
        range: [{ $group: { _id: null, from: { $min: "$timestamp" }, to: { $max: "$timestamp" } } }],
      },
    },
  ]).allowDiskUse(true);
  const byScoreStatus = countBy(facets?.byScoreStatus ?? []);
  return {
    totalFlows: facets?.total[0]?.n ?? 0,
    scoredFlows: byScoreStatus.scored ?? 0,
    pendingFlows: byScoreStatus.pending ?? 0,
    errorFlows: byScoreStatus.error ?? 0,
    maliciousFlows: facets?.malicious[0]?.n ?? 0,
    needsReviewFlows: facets?.needsReview[0]?.n ?? 0,
    maliciousSourceIps: facets?.sources[0]?.n ?? 0,
    bySourceKind: countBy(facets?.bySourceKind ?? []),
    dataRange: facets?.range[0] ? { from: facets.range[0].from, to: facets.range[0].to } : null,
  };
}

export const BREAKDOWN_FIELDS = {
  verdict: "$scored.label",
  severity: "$scored.severity",
  protocol: "$protocol",
  sourceKind: "$sourceKind",
  groundTruth: "$groundTruthLabel",
} as const;
export type BreakdownBy = keyof typeof BREAKDOWN_FIELDS;

export async function breakdown(orgId: Types.ObjectId, q: StatsQuery, by: BreakdownBy) {
  const match = buildFlowFilter(orgId, q);
  if (by === "verdict" || by === "severity") Object.assign(match, { scoreStatus: "scored" });
  if (by === "groundTruth") Object.assign(match, { groundTruthLabel: { $ne: null } });
  const rows = await Flow.aggregate<{ _id: string; n: number }>([
    { $match: match },
    { $group: { _id: BREAKDOWN_FIELDS[by], n: { $sum: 1 } } },
    { $sort: { n: -1 } },
  ]).allowDiskUse(true);
  return rows.map((r) => ({ key: r._id, count: r.n }));
}

export async function timeseries(orgId: Types.ObjectId, q: StatsQuery) {
  const match = buildFlowFilter(orgId, q);
  const [range] = await Flow.aggregate<{ from: Date; to: Date }>([
    { $match: match },
    { $group: { _id: null, from: { $min: "$timestamp" }, to: { $max: "$timestamp" } } },
  ]);
  if (!range) return { interval: "hour" as const, buckets: [] };
  const spanMs = range.to.getTime() - range.from.getTime();
  // Keep the series within a few hundred points whatever the range.
  const interval = spanMs <= 6 * 3_600_000 ? "minute" : spanMs <= 14 * 86_400_000 ? "hour" : "day";
  const rows = await Flow.aggregate<{ _id: Date; total: number; malicious: number; unscored: number }>([
    { $match: match },
    {
      $group: {
        _id: { $dateTrunc: { date: "$timestamp", unit: interval } },
        total: { $sum: 1 },
        malicious: {
          $sum: { $cond: [{ $and: [{ $eq: ["$scoreStatus", "scored"] }, { $ne: ["$scored.label", "Normal"] }] }, 1, 0] },
        },
        unscored: { $sum: { $cond: [{ $ne: ["$scoreStatus", "scored"] }, 1, 0] } },
      },
    },
    { $sort: { _id: 1 } },
  ]).allowDiskUse(true);
  return {
    interval,
    buckets: rows.map((r) => ({ bucket: r._id, total: r.total, malicious: r.malicious, unscored: r.unscored })),
  };
}

export const TOP_KINDS = ["attackers", "targets", "ports", "subnets"] as const;
export type TopKind = (typeof TOP_KINDS)[number];

export async function top(orgId: Types.ObjectId, q: StatsQuery, kind: TopKind, limit: number) {
  const match = buildFlowFilter(orgId, q);
  // Keep an explicit class filter; otherwise restrict to malicious verdicts.
  if (match["scored.label"] === undefined) Object.assign(match, MALICIOUS);
  const key: Record<TopKind, unknown> = {
    attackers: "$sourceIp",
    targets: "$destinationIp",
    ports: "$destinationPort",
    // /24 for IPv4; other addresses are grouped as-is.
    subnets: {
      $cond: [
        { $regexMatch: { input: "$sourceIp", regex: /^\d+\.\d+\.\d+\.\d+$/ } },
        {
          $concat: [
            { $reduce: { input: { $slice: [{ $split: ["$sourceIp", "."] }, 3] }, initialValue: "", in: { $concat: ["$$value", "$$this", "."] } } },
            "0/24",
          ],
        },
        "$sourceIp",
      ],
    },
  };
  const pipeline: PipelineStage[] = [
    { $match: match },
    { $group: { _id: key[kind], count: { $sum: 1 }, classes: { $addToSet: "$scored.label" }, lastSeen: { $max: "$timestamp" } } },
    { $sort: { count: -1 } },
    { $limit: limit },
  ];
  const rows = await Flow.aggregate<{ _id: string | number; count: number; classes: string[]; lastSeen: Date }>(pipeline).allowDiskUse(true);
  return rows.map((r) => ({ key: String(r._id), count: r.count, classes: r.classes, lastSeen: r.lastSeen }));
}

export interface ClassMetrics {
  label: AttackClass;
  precision: number | null;
  recall: number | null;
  f1: number | null;
  support: number;
  predicted: number;
  unstable: boolean;
}

/** Fewer test examples than this get an "unstable estimate" flag (docs/ML_AND_DETECTION.md §12). */
export const UNSTABLE_SUPPORT = 30;

/**
 * Compares model verdicts with dataset ground truth for scored, labelled flows.
 * This is the only place ground truth meets verdicts, and only for evaluation.
 */
export async function evaluation(orgId: Types.ObjectId, q: StatsQuery) {
  const match = { ...buildFlowFilter(orgId, q), scoreStatus: "scored", groundTruthLabel: { $ne: null } };
  const pairs = await Flow.aggregate<{ _id: { t: AttackClass; p: AttackClass; v: string }; n: number }>([
    { $match: match },
    { $group: { _id: { t: "$groundTruthLabel", p: "$scored.label", v: "$scored.modelVersion" }, n: { $sum: 1 } } },
  ]).allowDiskUse(true);
  const labels = ATTACK_CLASSES.filter((c) => pairs.some((p) => p._id.t === c || p._id.p === c));
  const index = new Map(labels.map((l, i) => [l, i]));
  const matrix = labels.map(() => labels.map(() => 0));
  const modelVersions = new Set<string>();
  let total = 0;
  let correct = 0;
  for (const { _id, n } of pairs) {
    const ti = index.get(_id.t);
    const pi = index.get(_id.p);
    if (ti === undefined || pi === undefined) continue;
    const row = matrix[ti];
    if (row) row[pi] = (row[pi] ?? 0) + n;
    modelVersions.add(_id.v);
    total += n;
    if (ti === pi) correct += n;
  }
  const perClass: ClassMetrics[] = labels.map((label, i) => {
    const tp = matrix[i]?.[i] ?? 0;
    const support = (matrix[i] ?? []).reduce((a, b) => a + b, 0);
    const predicted = matrix.reduce((a, row) => a + (row[i] ?? 0), 0);
    const precision = predicted ? tp / predicted : null;
    const recall = support ? tp / support : null;
    const f1 = precision !== null && recall !== null && precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : precision === 0 || recall === 0 ? 0 : null;
    return { label, precision, recall, f1, support, predicted, unstable: support < UNSTABLE_SUPPORT };
  });
  // Macro-F1 over classes present in the ground truth (support > 0).
  const evaluated = perClass.filter((c) => c.support > 0);
  const macroF1 = evaluated.length ? evaluated.reduce((a, c) => a + (c.f1 ?? 0), 0) / evaluated.length : null;
  return {
    evaluatedFlows: total,
    labels,
    confusionMatrix: matrix,
    perClass,
    macroF1,
    accuracy: total ? correct / total : null,
    modelVersions: [...modelVersions],
  };
}
