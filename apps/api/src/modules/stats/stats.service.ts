import type { PipelineStage, Types } from "mongoose";
import { ATTACK_CLASSES, type AttackClass, type StatsQuery } from "@sentinel/shared";
import { Flow } from "../../models/tenant.js";
import { buildFlowFilter } from "../flows/flow.filters.js";
import {
  RAW_PLAN,
  breakdownRollup,
  evaluationRollup,
  overviewRollup,
  rangeRollup,
  rollupMatch,
  timeseriesRollup,
  topRollup,
  topRollupSupported,
  type StatsPlan,
} from "./rollup.queries.js";

const MALICIOUS = { scoreStatus: "scored", "scored.label": { $ne: "Normal" } };

function countBy(rows: { _id: unknown; n: number }[]): Record<string, number> {
  return Object.fromEntries(rows.map((r) => [String(r._id ?? "null"), r.n]));
}

function addCounts(into: Record<string, number>, from: Record<string, number>) {
  for (const [k, v] of Object.entries(from)) into[k] = (into[k] ?? 0) + v;
  return into;
}

function widen(a: { from: Date; to: Date } | null, b: { from: Date; to: Date } | null) {
  if (!a) return b;
  if (!b) return a;
  return { from: a.from < b.from ? a.from : b.from, to: a.to > b.to ? a.to : b.to };
}

// ---- Raw-flow aggregations (used alone when rollups are stale, and for partial-minute edges) ----

async function overviewParts(orgId: Types.ObjectId, q: StatsQuery) {
  const match = buildFlowFilter(orgId, q);
  const [f] = await Flow.aggregate<{
    total: { n: number }[];
    byScoreStatus: { _id: string; n: number }[];
    bySourceKind: { _id: string; n: number }[];
    malicious: { n: number }[];
    needsReview: { n: number }[];
    sources: { _id: string }[];
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
        sources: [{ $match: MALICIOUS }, { $group: { _id: "$sourceIp" } }],
        range: [{ $group: { _id: null, from: { $min: "$timestamp" }, to: { $max: "$timestamp" } } }],
      },
    },
  ]).allowDiskUse(true);
  return {
    total: f?.total[0]?.n ?? 0,
    byScoreStatus: countBy(f?.byScoreStatus ?? []),
    bySourceKind: countBy(f?.bySourceKind ?? []),
    malicious: f?.malicious[0]?.n ?? 0,
    needsReview: f?.needsReview[0]?.n ?? 0,
    sources: (f?.sources ?? []).map((r) => r._id),
    range: f?.range[0] ? { from: f.range[0].from, to: f.range[0].to } : null,
  };
}

/**
 * Headline numbers. "Malicious" always means a model verdict; dataset labels
 * are reported separately as ground truth (CLAUDE.md §3.2).
 */
export async function overview(orgId: Types.ObjectId, q: StatsQuery, plan: StatsPlan = RAW_PLAN) {
  const parts =
    plan.source === "raw"
      ? [await overviewParts(orgId, q)]
      : [...(plan.bucket ? [await overviewRollup(rollupMatch(orgId, plan, q))] : []), ...(await Promise.all(plan.edges.map((e) => overviewParts(orgId, e))))];
  const byScoreStatus: Record<string, number> = {};
  const bySourceKind: Record<string, number> = {};
  const sources = new Set<string>();
  let range: { from: Date; to: Date } | null = null;
  let total = 0;
  let malicious = 0;
  let needsReview = 0;
  for (const p of parts) {
    total += p.total;
    malicious += p.malicious;
    needsReview += p.needsReview;
    addCounts(byScoreStatus, p.byScoreStatus);
    addCounts(bySourceKind, p.bySourceKind);
    for (const s of p.sources) sources.add(s);
    range = widen(range, p.range);
  }
  return {
    totalFlows: total,
    scoredFlows: byScoreStatus.scored ?? 0,
    pendingFlows: byScoreStatus.pending ?? 0,
    errorFlows: byScoreStatus.error ?? 0,
    maliciousFlows: malicious,
    needsReviewFlows: needsReview,
    maliciousSourceIps: sources.size,
    bySourceKind,
    dataRange: range,
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

async function breakdownRaw(orgId: Types.ObjectId, q: StatsQuery, by: BreakdownBy) {
  const match = buildFlowFilter(orgId, q);
  if (by === "verdict" || by === "severity") Object.assign(match, { scoreStatus: "scored" });
  if (by === "groundTruth") Object.assign(match, { groundTruthLabel: { $ne: null } });
  return Flow.aggregate<{ _id: string; n: number }>([{ $match: match }, { $group: { _id: BREAKDOWN_FIELDS[by], n: { $sum: 1 } } }]).allowDiskUse(true);
}

export async function breakdown(orgId: Types.ObjectId, q: StatsQuery, by: BreakdownBy, plan: StatsPlan = RAW_PLAN) {
  const parts =
    plan.source === "raw"
      ? [await breakdownRaw(orgId, q, by)]
      : [...(plan.bucket ? [await breakdownRollup(rollupMatch(orgId, plan, q), by)] : []), ...(await Promise.all(plan.edges.map((e) => breakdownRaw(orgId, e, by))))];
  const counts = new Map<string | null, number>();
  for (const rows of parts) for (const r of rows) counts.set(r._id ?? null, (counts.get(r._id ?? null) ?? 0) + r.n);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([key, count]) => ({ key, count }));
}

type Interval = "minute" | "hour" | "day";

async function rangeRaw(orgId: Types.ObjectId, q: StatsQuery) {
  const [range] = await Flow.aggregate<{ from: Date; to: Date }>([
    { $match: buildFlowFilter(orgId, q) },
    { $group: { _id: null, from: { $min: "$timestamp" }, to: { $max: "$timestamp" } } },
  ]);
  return range ?? null;
}

async function timeseriesRaw(orgId: Types.ObjectId, q: StatsQuery, interval: Interval) {
  return Flow.aggregate<{ _id: Date; total: number; malicious: number; unscored: number }>([
    { $match: buildFlowFilter(orgId, q) },
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
  ]).allowDiskUse(true);
}

export async function timeseries(orgId: Types.ObjectId, q: StatsQuery, plan: StatsPlan = RAW_PLAN) {
  const useRollup = plan.source === "rollup" && plan.bucket !== null;
  const edges = plan.source === "raw" ? [q] : plan.edges;
  let range = useRollup ? await rangeRollup(rollupMatch(orgId, plan, q)) : null;
  for (const e of edges) range = widen(range, await rangeRaw(orgId, e));
  if (!range) return { interval: "hour" as const, buckets: [] };
  const spanMs = range.to.getTime() - range.from.getTime();
  // Keep the series within a few hundred points whatever the range.
  const interval: Interval = spanMs <= 6 * 3_600_000 ? "minute" : spanMs <= 14 * 86_400_000 ? "hour" : "day";
  const parts = [...(useRollup ? [await timeseriesRollup(rollupMatch(orgId, plan, q), interval)] : []), ...(await Promise.all(edges.map((e) => timeseriesRaw(orgId, e, interval))))];
  const byBucket = new Map<number, { bucket: Date; total: number; malicious: number; unscored: number }>();
  for (const rows of parts) {
    for (const r of rows) {
      const k = r._id.getTime();
      const cur = byBucket.get(k) ?? { bucket: r._id, total: 0, malicious: 0, unscored: 0 };
      cur.total += r.total;
      cur.malicious += r.malicious;
      cur.unscored += r.unscored;
      byBucket.set(k, cur);
    }
  }
  return { interval, buckets: [...byBucket.values()].sort((a, b) => a.bucket.getTime() - b.bucket.getTime()) };
}

export const TOP_KINDS = ["attackers", "targets", "ports", "subnets"] as const;
export type TopKind = (typeof TOP_KINDS)[number];

async function topRaw(orgId: Types.ObjectId, q: StatsQuery, kind: TopKind, limit: number) {
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
  return Flow.aggregate<{ _id: string | number; count: number; classes: string[]; lastSeen: Date }>(pipeline).allowDiskUse(true);
}

export async function top(orgId: Types.ObjectId, q: StatsQuery, kind: TopKind, limit: number, plan: StatsPlan = RAW_PLAN) {
  if (plan.source === "raw" || !topRollupSupported(q)) {
    return (await topRaw(orgId, q, kind, limit)).map((r) => ({ key: String(r._id), count: r.count, classes: [...r.classes].sort(), lastSeen: r.lastSeen }));
  }
  // Edges are partial minutes (small): read them whole so the merged ranking is exact.
  const parts = [...(plan.bucket ? [await topRollup(rollupMatch(orgId, plan, q), kind)] : []), ...(await Promise.all(plan.edges.map((e) => topRaw(orgId, e, kind, 100_000))))];
  const merged = new Map<string, { key: string; count: number; classes: Set<string>; lastSeen: Date }>();
  for (const rows of parts) {
    for (const r of rows) {
      const key = String(r._id);
      const cur = merged.get(key) ?? { key, count: 0, classes: new Set<string>(), lastSeen: r.lastSeen };
      cur.count += r.count;
      for (const c of r.classes) if (c) cur.classes.add(c);
      if (r.lastSeen > cur.lastSeen) cur.lastSeen = r.lastSeen;
      merged.set(key, cur);
    }
  }
  return [...merged.values()]
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, limit)
    .map((r) => ({ key: r.key, count: r.count, classes: [...r.classes].sort(), lastSeen: r.lastSeen }));
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

async function evaluationRaw(orgId: Types.ObjectId, q: StatsQuery) {
  const match = { ...buildFlowFilter(orgId, q), scoreStatus: "scored", groundTruthLabel: { $ne: null } };
  return Flow.aggregate<{ _id: { t: string; p: string; v: string }; n: number }>([
    { $match: match },
    { $group: { _id: { t: "$groundTruthLabel", p: "$scored.label", v: "$scored.modelVersion" }, n: { $sum: 1 } } },
  ]).allowDiskUse(true);
}

/**
 * Compares model verdicts with dataset ground truth for scored, labelled flows.
 * This is the only place ground truth meets verdicts, and only for evaluation.
 */
export async function evaluation(orgId: Types.ObjectId, q: StatsQuery, plan: StatsPlan = RAW_PLAN) {
  const parts =
    plan.source === "raw"
      ? [await evaluationRaw(orgId, q)]
      : [...(plan.bucket ? [await evaluationRollup(rollupMatch(orgId, plan, q))] : []), ...(await Promise.all(plan.edges.map((e) => evaluationRaw(orgId, e))))];
  const pairs = parts.flat();
  const labels = ATTACK_CLASSES.filter((c) => pairs.some((p) => p._id.t === c || p._id.p === c));
  const index = new Map<string, number>(labels.map((l, i) => [l, i]));
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
