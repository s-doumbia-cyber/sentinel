import type { Types, mongo } from "mongoose";
import { extractFeatures, normalizeLabel } from "@sentinel/shared";
import { Membership, Org, normalizeLanguage } from "../../models/identity.js";
import { markFlowsChanged } from "../../models/rollups.js";
import { parseIp, parseTimestamp } from "../datasets/csv.parsing.js";

type Db = mongo.Db;

export const LEGACY_ORG_SLUG = "legacy-workspace";
const INVENTED_ASSIGNEES = ["A. Kade", "M. Reyes", "S. Okafor", "J. Tran", "L. Novak", "Unassigned"];
const BATCH = 2000;

type Raw = Record<string, unknown>;

function rawValue(raw: Raw | undefined, name: string): unknown {
  if (!raw) return undefined;
  if (name in raw) return raw[name];
  const key = Object.keys(raw).find((k) => k.trim() === name);
  return key ? raw[key] : undefined;
}

const noOrg = { orgId: { $exists: false } };

export interface LegacyReport {
  users: number;
  usersWithoutMembership: number;
  importedFlows: number;
  seededFlowsNotMigrated: number;
  datasets: number;
  incidents: number;
  inventedIncidents: number;
}

/** Read-only: counts what a migration would change. */
export async function planLegacyMigration(db: Db): Promise<LegacyReport> {
  const users = db.collection("users");
  const flows = db.collection("networkflows");
  const incidents = db.collection("incidents");
  const withMembership = new Set((await Membership.find({}).lean()).map((m) => String(m.userId)));
  const allUsers = await users.find({}, { projection: { _id: 1 } }).toArray();
  return {
    users: allUsers.length,
    usersWithoutMembership: allUsers.filter((u) => !withMembership.has(String(u._id))).length,
    importedFlows: await flows.countDocuments({ ...noOrg, datasetId: { $type: "objectId" } }),
    seededFlowsNotMigrated: await flows.countDocuments({ ...noOrg, datasetId: { $in: [null] } }),
    datasets: await db.collection("datasets").countDocuments(noOrg),
    incidents: await incidents.countDocuments(noOrg),
    inventedIncidents: await incidents.countDocuments({ ...noOrg, assignee: { $in: INVENTED_ASSIGNEES } }),
  };
}

export interface ApplyResult {
  orgId: Types.ObjectId;
  usersAttached: number;
  flowsMigrated: number;
  flowsWithLegacyTimestamp: number;
}

/**
 * Performs the migration described in scripts/migrate-legacy.ts. Idempotent:
 * only documents without an orgId are touched, and nothing is deleted.
 */
export async function applyLegacyMigration(
  db: Db,
  opts: { dropRaw?: boolean; onProgress?: (flows: number) => void } = {},
): Promise<ApplyResult> {
  const users = db.collection("users");
  const flows = db.collection("networkflows");
  const datasets = db.collection("datasets");
  const incidents = db.collection("incidents");

  let org = await Org.findOne({ slug: LEGACY_ORG_SLUG });
  if (!org) org = await Org.create({ name: "Legacy workspace", slug: LEGACY_ORG_SLUG });
  const orgId = org._id as Types.ObjectId;

  const withMembership = new Set((await Membership.find({}).lean()).map((m) => String(m.userId)));
  const toAttach = (await users.find({}).sort({ createdAt: 1 }).toArray()).filter((u) => !withMembership.has(String(u._id)));
  let ownerAssigned = Boolean(await Membership.exists({ orgId, role: "Owner" }));
  const hasAdmin = toAttach.some((u) => u.role === "Admin");
  for (const u of toAttach) {
    let role: "Owner" | "Admin" | "Analyst" | "Viewer" =
      u.role === "Admin" ? "Admin" : u.role === "Viewer" ? "Viewer" : "Analyst";
    // The oldest Admin (or, without any Admin, the oldest user) becomes the Owner.
    if (!ownerAssigned && (u.role === "Admin" || !hasAdmin)) {
      role = "Owner";
      ownerAssigned = true;
    }
    await Membership.create({ orgId, userId: u._id, role });
    await users.updateOne(
      { _id: u._id },
      {
        $set: { "preferences.language": normalizeLanguage(u.preferences?.language) },
        $unset: { role: "", tokenVersion: "" },
      },
    );
  }

  let migrated = 0;
  let legacyTs = 0;
  for (;;) {
    const batch = await flows.find({ ...noOrg, datasetId: { $type: "objectId" } }).limit(BATCH).toArray();
    if (!batch.length) break;
    const ops = batch.map((f) => {
      const raw = f.raw as Raw | undefined;
      const record: Record<string, unknown> = {};
      for (const k of Object.keys(raw ?? {})) record[k.trim()] = raw?.[k];
      const { features, missing } = extractFeatures(record, "cicids2017-v1");
      const ts = parseTimestamp(rawValue(raw, "Timestamp"));
      if (!ts) legacyTs++;
      const rawLabel = rawValue(raw, "Label");
      const set: Record<string, unknown> = {
        orgId,
        sourceKind: "IMPORTED",
        featureSchema: "cicids2017-v1",
        groundTruthLabel: normalizeLabel(rawLabel),
        rawLabel: typeof rawLabel === "string" ? rawLabel.trim() : null,
        // Missing feature columns cannot be scored by cicids2017-v1: record why.
        scoreStatus: missing.length ? "error" : "pending",
        scoreError: missing.length ? `Legacy row lacks ${missing.length} cicids2017-v1 features` : null,
        scored: null,
        features,
        protocol: ["TCP", "UDP", "ICMP"].includes(String(f.protocol)) ? f.protocol : "OTHER",
        sourceIp: parseIp(f.sourceIp) ?? f.sourceIp,
        "legacy.label": f.label ?? null,
        "legacy.prediction": f.prediction ?? null,
        "legacy.severity": f.severity ?? null,
        "legacy.isAttack": f.isAttack ?? null,
        "legacy.timestamp": f.timestamp ?? null,
      };
      if (ts) set.timestamp = ts;
      const unset: Record<string, ""> = { label: "", prediction: "", severity: "", isAttack: "", country: "" };
      if (opts.dropRaw) unset.raw = "";
      return { updateOne: { filter: { _id: f._id, ...noOrg }, update: { $set: set, $unset: unset } } };
    });
    const res = await flows.bulkWrite(ops, { ordered: false });
    migrated += res.modifiedCount;
    opts.onProgress?.(migrated);
    if (res.modifiedCount === 0) break;
  }

  for (const d of await datasets.find(noOrg).toArray()) {
    const counts = await flows
      .aggregate<{ _id: string; n: number }>([
        { $match: { orgId, datasetId: d._id, groundTruthLabel: { $ne: null } } },
        { $group: { _id: "$groundTruthLabel", n: { $sum: 1 } } },
      ])
      .toArray();
    await datasets.updateOne(
      { _id: d._id },
      {
        $set: {
          orgId,
          sourceType: "CICIDS2017",
          sourceKind: "IMPORTED",
          featureSchema: "cicids2017-v1",
          rowsInserted: d.rows ?? 0,
          groundTruthCounts: Object.fromEntries(counts.map((c) => [c._id, c.n])),
        },
      },
    );
  }

  await incidents.updateMany({ ...noOrg, assignee: { $in: INVENTED_ASSIGNEES } }, { $set: { legacyAutoGenerated: true } });
  await incidents.updateMany({ ...noOrg, severity: "safe" }, { $set: { severity: "info" } });
  await incidents.updateMany(noOrg, [{ $set: { orgId, "legacy.assignee": "$assignee", assigneeId: null } }, { $unset: ["assignee"] }]);

  // Raw driver writes bypass the flow hooks: mark the org's rollups stale explicitly.
  if (migrated) await markFlowsChanged(orgId);
  return { orgId, usersAttached: toAttach.length, flowsMigrated: migrated, flowsWithLegacyTimestamp: legacyTs };
}
