import { randomUUID } from "node:crypto";
import mongoose, { type PipelineStage, type Types } from "mongoose";
import { Lease } from "../../models/ops.js";
import { FlowRollup, RollupState } from "../../models/rollups.js";
import { Flow } from "../../models/tenant.js";

/**
 * Minute rollups of flows (docs/ARCHITECTURE.md §3.6, `flow_rollups_1m`): counts per
 * minute and per every dimension a stats filter can use, so dashboards read thousands
 * of rows instead of millions of flows. Endpoints of malicious flows are kept (top
 * attackers / targets / ports); benign rows drop them to stay small.
 *
 * Freshness is exact, never guessed: every write to flows bumps `version` (after the
 * write); a rebuild records the version it started from; readers use the rollups only
 * when `builtVersion === version`, otherwise they read raw flows (and ask for a rebuild).
 * Rows carry a generation: a rebuild writes a new one, switches the pointer, then drops
 * the old rows, so a reader never mixes two builds.
 */

export const ROLLUP_BUCKET_MS = 60_000;

/** The generation readers may use, or null when the rollups are missing or stale. */
export async function freshRollupGen(orgId: Types.ObjectId): Promise<string | null> {
  const s = await RollupState.findById(orgId).lean();
  return s?.gen && s.builtVersion === s.version ? s.gen : null;
}

export async function rollupStatus(orgId: Types.ObjectId) {
  const s = await RollupState.findById(orgId).lean();
  return { fresh: Boolean(s?.gen && s.builtVersion === s.version), builtAt: s?.builtAt ?? null, buildMs: s?.buildMs ?? null, rows: s?.rows ?? 0 };
}

const MALICIOUS_EXPR = { $and: [{ $eq: ["$scoreStatus", "scored"] }, { $ne: ["$scored.label", "Normal"] }] };
const ifMalicious = (field: string) => ({ $cond: [MALICIOUS_EXPR, field, null] });

/** One holder per key; an expired lease (crashed holder) can be taken over. */
async function acquireLease(key: string, ms: number): Promise<string | null> {
  const token = randomUUID();
  const now = new Date();
  try {
    const doc = await Lease.findOneAndUpdate(
      { _id: key, until: { $lte: now } },
      { $set: { token, until: new Date(now.getTime() + ms) } },
      { upsert: true, new: true },
    ).lean();
    return doc?.token === token ? token : null;
  } catch (err) {
    if ((err as { code?: number }).code === 11000) return null;
    throw err;
  }
}

async function releaseLease(key: string, token: string): Promise<void> {
  await Lease.deleteOne({ _id: key, token });
}

/**
 * Rebuilds the org's rollups from its flows. Returns false when another rebuild holds
 * the lease (that one will finish the job; a later write triggers another).
 */
export async function rebuildRollups(orgId: Types.ObjectId): Promise<boolean> {
  const key = `rollup:${String(orgId)}`;
  const token = await acquireLease(key, 30 * 60 * 1000);
  if (!token) return false;
  try {
    const started = Date.now();
    const state = await RollupState.findOneAndUpdate({ _id: orgId }, { $setOnInsert: { version: 0 } }, { upsert: true, new: true }).lean();
    const startVersion = state?.version ?? 0;
    const gen = new mongoose.Types.ObjectId().toHexString();
    const pipeline: PipelineStage[] = [
      { $match: { orgId } },
      {
        $group: {
          _id: {
            bucket: { $dateTrunc: { date: "$timestamp", unit: "minute" } },
            datasetId: "$datasetId",
            sourceKind: "$sourceKind",
            protocol: "$protocol",
            featureSchema: "$featureSchema",
            scoreStatus: "$scoreStatus",
            label: { $ifNull: ["$scored.label", null] },
            severity: { $ifNull: ["$scored.severity", null] },
            needsReview: { $ifNull: ["$scored.needsReview", null] },
            modelVersion: { $ifNull: ["$scored.modelVersion", null] },
            groundTruth: "$groundTruthLabel",
            malicious: MALICIOUS_EXPR,
            srcIp: ifMalicious("$sourceIp"),
            dstIp: ifMalicious("$destinationIp"),
            dstPort: ifMalicious("$destinationPort"),
          },
          n: { $sum: 1 },
          minTs: { $min: "$timestamp" },
          maxTs: { $max: "$timestamp" },
        },
      },
      {
        $project: {
          _id: 0,
          orgId: { $literal: orgId },
          gen: { $literal: gen },
          bucket: "$_id.bucket",
          datasetId: "$_id.datasetId",
          sourceKind: "$_id.sourceKind",
          protocol: "$_id.protocol",
          featureSchema: "$_id.featureSchema",
          scoreStatus: "$_id.scoreStatus",
          label: "$_id.label",
          severity: "$_id.severity",
          needsReview: "$_id.needsReview",
          modelVersion: "$_id.modelVersion",
          groundTruth: "$_id.groundTruth",
          malicious: "$_id.malicious",
          srcIp: "$_id.srcIp",
          dstIp: "$_id.dstIp",
          dstPort: "$_id.dstPort",
          n: 1,
          minTs: 1,
          maxTs: 1,
        },
      },
      { $merge: { into: "flow_rollups_1m", whenMatched: "fail", whenNotMatched: "insert" } },
    ];
    await Flow.aggregate(pipeline).allowDiskUse(true);
    const rows = await FlowRollup.countDocuments({ orgId, gen });
    await RollupState.updateOne({ _id: orgId }, { $set: { gen, builtVersion: startVersion, builtAt: new Date(), buildMs: Date.now() - started, rows } });
    await FlowRollup.deleteMany({ orgId, gen: { $ne: gen } });
    return true;
  } finally {
    await releaseLease(key, token);
  }
}
