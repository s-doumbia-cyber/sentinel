import type { Types } from "mongoose";
import type { Logger } from "../../lib/logger.js";
import { Org } from "../../models/identity.js";
import { Alert, Flow } from "../../models/tenant.js";
import { writeAudit } from "../audit/audit.service.js";

const BATCH = 5000;

export interface RetentionPreview {
  retentionDays: number;
  cutoff: Date;
  flows: number;
  alerts: number;
  /** Alerts older than the cutoff that stay because an incident references them. */
  alertsKept: number;
}

/**
 * What a purge would delete. Age is storage age (`createdAt` for flows, last update for
 * alerts), not event time: an imported 2017 dataset is not purged on the day it arrives.
 * Incidents, the audit log, datasets (import records), identity records and validation
 * runs are never purged; alerts linked to an incident are kept with it.
 */
export async function previewRetention(orgId: Types.ObjectId, retentionDays: number, now = new Date()): Promise<RetentionPreview> {
  const cutoff = new Date(now.getTime() - retentionDays * 86_400_000);
  const [flows, alerts, alertsKept] = await Promise.all([
    Flow.countDocuments({ orgId, createdAt: { $lt: cutoff } }),
    Alert.countDocuments({ orgId, updatedAt: { $lt: cutoff }, incidentId: null }),
    Alert.countDocuments({ orgId, updatedAt: { $lt: cutoff }, incidentId: { $ne: null } }),
  ]);
  return { retentionDays, cutoff, flows, alerts, alertsKept };
}

/** Deletes in id batches so a large purge never holds one long write. */
async function deleteInBatches(find: () => Promise<{ _id: Types.ObjectId }[]>, remove: (ids: Types.ObjectId[]) => Promise<number>): Promise<number> {
  let total = 0;
  for (;;) {
    const ids = (await find()).map((d) => d._id);
    if (!ids.length) return total;
    total += await remove(ids);
  }
}

export interface RetentionResult {
  ran: boolean;
  cutoff: Date | null;
  flowsDeleted: number;
  alertsDeleted: number;
  alertsKept: number;
}

/**
 * Applies the org's retention setting. Idempotent: running it again deletes nothing
 * more until data ages past the cutoff. Every run that deletes something is audited.
 */
export async function runRetention(orgId: Types.ObjectId, opts: { actorId: Types.ObjectId | null; logger: Logger; now?: Date }): Promise<RetentionResult> {
  const org = await Org.findById(orgId).select("settings.retentionDays").lean();
  const days = org?.settings?.retentionDays ?? null;
  if (!days) return { ran: false, cutoff: null, flowsDeleted: 0, alertsDeleted: 0, alertsKept: 0 };
  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - days * 86_400_000);

  const flowsDeleted = await deleteInBatches(
    () => Flow.find({ orgId, createdAt: { $lt: cutoff } }).select("_id").limit(BATCH).lean(),
    async (ids) => (await Flow.deleteMany({ orgId, _id: { $in: ids } })).deletedCount,
  );
  const alertsDeleted = await deleteInBatches(
    () => Alert.find({ orgId, updatedAt: { $lt: cutoff }, incidentId: null }).select("_id").limit(BATCH).lean(),
    async (ids) => (await Alert.deleteMany({ orgId, _id: { $in: ids }, incidentId: null })).deletedCount,
  );
  const alertsKept = await Alert.countDocuments({ orgId, updatedAt: { $lt: cutoff }, incidentId: { $ne: null } });

  await Org.updateOne(
    { _id: orgId },
    { $set: { "settings.lastRetentionRun": { at: now, cutoff, flowsDeleted, alertsDeleted, alertsKept } } },
  );
  if (flowsDeleted || alertsDeleted) {
    await writeAudit(null, {
      orgId,
      actorId: opts.actorId,
      action: "retention.purge",
      target: { type: "org", id: String(orgId) },
      meta: { retentionDays: days, cutoff: cutoff.toISOString(), flowsDeleted, alertsDeleted, alertsKept },
    });
  }
  opts.logger.info({ orgId: String(orgId), days, flowsDeleted, alertsDeleted }, "Retention purge finished");
  return { ran: true, cutoff, flowsDeleted, alertsDeleted, alertsKept };
}

/**
 * Periodically queues a purge for every org that set a retention period. The job id
 * includes the date, so several API processes queue one purge per org per day.
 */
export function startRetentionSweep(
  schedule: { retention: (orgId: Types.ObjectId, actorId: null, jobId?: string) => Promise<string> },
  hours: number,
  logger: Logger,
): () => void {
  if (hours <= 0) return () => undefined;
  const sweep = async () => {
    // System-wide on purpose (Org is not a tenant collection): finds orgs that opted in.
    const orgs = await Org.find({ "settings.retentionDays": { $ne: null } }).select("_id").lean();
    const day = new Date().toISOString().slice(0, 10);
    for (const o of orgs) await schedule.retention(o._id, null, `retention-${String(o._id)}-${day}`);
  };
  const timer = setInterval(() => void sweep().catch((err: unknown) => logger.error({ err }, "Retention sweep failed")), hours * 3_600_000);
  timer.unref();
  return () => clearInterval(timer);
}
