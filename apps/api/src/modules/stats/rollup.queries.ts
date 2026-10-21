import mongoose, { type PipelineStage, type Types } from "mongoose";
import { ATTACK_CLASSES, type StatsQuery } from "@sentinel/shared";
import { FlowRollup } from "../../models/rollups.js";
import { ROLLUP_BUCKET_MS, freshRollupGen } from "./rollup.service.js";

/**
 * How a stats request is answered. With fresh rollups, whole minutes inside the
 * requested range come from `flow_rollups_1m` and the partial minutes at either end
 * from raw flows (`edges`), so the answer is exact, not rounded to the minute.
 */
export interface StatsPlan {
  source: "rollup" | "raw";
  gen: string | null;
  /** Bucket range for the rollup part; null when no whole minute is inside the range. */
  bucket: { $gte?: Date; $lt?: Date } | null;
  /** Sub-ranges (inclusive) to read from raw flows. */
  edges: StatsQuery[];
}

const floorMin = (d: Date) => new Date(Math.floor(d.getTime() / ROLLUP_BUCKET_MS) * ROLLUP_BUCKET_MS);
const ceilMin = (d: Date) => new Date(Math.ceil(d.getTime() / ROLLUP_BUCKET_MS) * ROLLUP_BUCKET_MS);

export const RAW_PLAN: StatsPlan = { source: "raw", gen: null, bucket: null, edges: [] };

/** `onStale` runs when the rollups cannot be used (missing or older than the flows). */
export async function planStats(orgId: Types.ObjectId, q: StatsQuery, onStale?: () => void): Promise<StatsPlan> {
  const gen = await freshRollupGen(orgId);
  if (!gen) {
    onStale?.();
    return RAW_PLAN;
  }
  const from = q.from ? new Date(q.from) : null;
  const to = q.to ? new Date(q.to) : null;
  const fromFull = from ? ceilMin(from) : null;
  // A bucket is whole inside [from, to] when bucket >= ceil(from) and bucket + 1 min <= to + 1 ms.
  const toExclusive = to ? floorMin(new Date(to.getTime() + 1)) : null;
  if (fromFull && toExclusive && fromFull >= toExclusive) return { source: "rollup", gen, bucket: null, edges: [q] };
  const bucket = { ...(fromFull ? { $gte: fromFull } : {}), ...(toExclusive ? { $lt: toExclusive } : {}) };
  const edges: StatsQuery[] = [];
  if (from && fromFull && from < fromFull) edges.push({ ...q, from: from.toISOString(), to: new Date(fromFull.getTime() - 1).toISOString() });
  if (to && toExclusive && toExclusive <= to) edges.push({ ...q, from: toExclusive.toISOString(), to: to.toISOString() });
  return { source: "rollup", gen, bucket, edges };
}

/** The rollup equivalent of buildFlowFilter (flows/flow.filters.ts). Keep the two in step. */
export function rollupMatch(orgId: Types.ObjectId, plan: StatsPlan, q: StatsQuery): Record<string, unknown> {
  const m: Record<string, unknown> = { orgId, gen: plan.gen };
  if (plan.bucket && Object.keys(plan.bucket).length) m.bucket = plan.bucket;
  if (q.sourceKind) m.sourceKind = q.sourceKind;
  if (q.datasetId) m.datasetId = new mongoose.Types.ObjectId(q.datasetId);
  if (q.protocol) m.protocol = q.protocol;
  if (q.verdict === "unscored") m.scoreStatus = "pending";
  else if (q.verdict === "error") m.scoreStatus = "error";
  else if (q.verdict === "malicious") Object.assign(m, { scoreStatus: "scored", malicious: true });
  else if (q.verdict) Object.assign(m, { scoreStatus: "scored", label: q.verdict });
  if (q.severity) Object.assign(m, { scoreStatus: "scored", severity: q.severity });
  if (q.needsReview) Object.assign(m, { scoreStatus: "scored", needsReview: true });
  return m;
}

const sumN = { $sum: "$n" };

/** One pass over the rows for all counters, one more for the distinct malicious sources. */
export async function overviewRollup(match: Record<string, unknown>) {
  const [groups, sources] = await Promise.all([
    FlowRollup.aggregate<{ _id: { s: string; k: string; m: boolean; r: boolean | null }; n: number; from: Date; to: Date }>([
      { $match: match },
      {
        $group: {
          _id: { s: "$scoreStatus", k: "$sourceKind", m: "$malicious", r: "$needsReview" },
          n: sumN,
          from: { $min: "$minTs" },
          to: { $max: "$maxTs" },
        },
      },
    ]),
    FlowRollup.aggregate<{ _id: string }>([{ $match: { ...match, malicious: true } }, { $group: { _id: "$srcIp" } }]),
  ]);
  const byScoreStatus: Record<string, number> = {};
  const bySourceKind: Record<string, number> = {};
  let total = 0;
  let malicious = 0;
  let needsReview = 0;
  let range = null as { from: Date; to: Date } | null;
  for (const g of groups) {
    total += g.n;
    byScoreStatus[String(g._id.s)] = (byScoreStatus[String(g._id.s)] ?? 0) + g.n;
    bySourceKind[String(g._id.k)] = (bySourceKind[String(g._id.k)] ?? 0) + g.n;
    if (g._id.m) malicious += g.n;
    if (g._id.s === "scored" && g._id.r === true) needsReview += g.n;
    range = range ? { from: g.from < range.from ? g.from : range.from, to: g.to > range.to ? g.to : range.to } : { from: g.from, to: g.to };
  }
  return { total, byScoreStatus, bySourceKind, malicious, needsReview, sources: sources.map((r) => r._id), range };
}

const ROLLUP_BREAKDOWN = {
  verdict: "$label",
  severity: "$severity",
  protocol: "$protocol",
  sourceKind: "$sourceKind",
  groundTruth: "$groundTruth",
} as const;

export async function breakdownRollup(match: Record<string, unknown>, by: keyof typeof ROLLUP_BREAKDOWN) {
  const m = { ...match };
  if (by === "verdict" || by === "severity") m.scoreStatus = "scored";
  if (by === "groundTruth") m.groundTruth = { $ne: null };
  return FlowRollup.aggregate<{ _id: string; n: number }>([{ $match: m }, { $group: { _id: ROLLUP_BREAKDOWN[by], n: sumN } }]);
}

export async function rangeRollup(match: Record<string, unknown>) {
  const [r] = await FlowRollup.aggregate<{ from: Date; to: Date }>([{ $match: match }, { $group: { _id: null, from: { $min: "$minTs" }, to: { $max: "$maxTs" } } }]);
  return r ?? null;
}

export async function timeseriesRollup(match: Record<string, unknown>, interval: "minute" | "hour" | "day") {
  return FlowRollup.aggregate<{ _id: Date; total: number; malicious: number; unscored: number }>([
    { $match: match },
    {
      $group: {
        _id: { $dateTrunc: { date: "$bucket", unit: interval } },
        total: sumN,
        malicious: { $sum: { $cond: ["$malicious", "$n", 0] } },
        unscored: { $sum: { $cond: [{ $ne: ["$scoreStatus", "scored"] }, "$n", 0] } },
      },
    },
  ]);
}

const SUBNET = {
  $cond: [
    { $regexMatch: { input: "$srcIp", regex: /^\d+\.\d+\.\d+\.\d+$/ } },
    {
      $concat: [
        { $reduce: { input: { $slice: [{ $split: ["$srcIp", "."] }, 3] }, initialValue: "", in: { $concat: ["$$value", "$$this", "."] } } },
        "0/24",
      ],
    },
    "$srcIp",
  ],
};
const TOP_KEY = { attackers: "$srcIp", targets: "$dstIp", ports: "$dstPort", subnets: SUBNET } as const;

/** Rollups keep endpoints for malicious flows only: other top lists are answered from raw flows. */
export function topRollupSupported(q: StatsQuery): boolean {
  return !q.verdict || q.verdict === "malicious" || (ATTACK_CLASSES.includes(q.verdict as (typeof ATTACK_CLASSES)[number]) && q.verdict !== "Normal");
}

export async function topRollup(match: Record<string, unknown>, kind: keyof typeof TOP_KEY) {
  const pipeline: PipelineStage[] = [
    { $match: { ...match, malicious: true } },
    { $group: { _id: TOP_KEY[kind], count: sumN, classes: { $addToSet: "$label" }, lastSeen: { $max: "$maxTs" } } },
  ];
  return FlowRollup.aggregate<{ _id: string | number; count: number; classes: string[]; lastSeen: Date }>(pipeline).allowDiskUse(true);
}

export async function evaluationRollup(match: Record<string, unknown>) {
  return FlowRollup.aggregate<{ _id: { t: string; p: string; v: string }; n: number }>([
    { $match: { ...match, scoreStatus: "scored", groundTruth: { $ne: null } } },
    { $group: { _id: { t: "$groundTruth", p: "$label", v: "$modelVersion" }, n: sumN } },
  ]);
}
