import { existsSync } from "node:fs";
import { unlink } from "node:fs/promises";
import mongoose, { type Types } from "mongoose";
import { AppError } from "../../lib/errors.js";
import { PermanentJobError, type DeadLetter, type JobContext, type JobPayload, type JobQueue } from "../../lib/jobs.js";
import type { Logger } from "../../lib/logger.js";
import { FailedJob } from "../../models/ops.js";
import { Dataset, Flow } from "../../models/tenant.js";
import { refreshAssets } from "../assets/asset.service.js";
import { SCHEMA_FOR_SOURCE_TYPE, checkCsvHeader, runCsvImport, type ImportInput } from "../datasets/csv.importer.js";
import type { CorrelationService } from "../incidents/correlation.service.js";
import { runRetention } from "../retention/retention.service.js";
import { rebuildRollups } from "../stats/rollup.service.js";
import type { RuleService } from "../rules/rule.service.js";
import type { ScoringService } from "../scoring/scoring.service.js";

const oid = (v: unknown) => new mongoose.Types.ObjectId(String(v));
/** Job ids of failed runs a dead-letter retry takes over (their open alert claims). */
const resumeOf = (p: JobPayload): string[] => (Array.isArray(p.resumeOf) ? p.resumeOf.filter((x): x is string => typeof x === "string") : []);

/** What a CSV import job needs; stored in the queue, so JSON only and no secrets. */
export interface ImportJobInput {
  orgId: string;
  datasetId: string;
  userId: string | null;
  filePath: string;
  name: string;
  fileBytes: number;
  sourceType: ImportInput["sourceType"];
  sourceKind: ImportInput["sourceKind"];
}

/** Entry points the routes use; each returns once the job is durably queued (or started in-process). */
export interface Scheduler {
  readonly mode: JobQueue["mode"];
  importCsv(input: ImportJobInput): Promise<string>;
  score(orgId: Types.ObjectId): Promise<void>;
  detect(orgId: Types.ObjectId, datasetId?: Types.ObjectId): Promise<void>;
  assets(orgId: Types.ObjectId): Promise<void>;
  /** Rebuilds the stats rollups; skipped when one is already queued or running for the org. */
  rollup(orgId: Types.ObjectId): Promise<void>;
  /** `jobId` deduplicates sweeps (Redis keeps one job per id). */
  retention(orgId: Types.ObjectId, actorId: Types.ObjectId | null, jobId?: string): Promise<string>;
  busy(kind: "import" | "score" | "detect" | "retention" | "rollup", orgId: Types.ObjectId): Promise<boolean>;
}

export interface JobHandlerDeps {
  queue: JobQueue;
  logger: Logger;
  scoring: ScoringService;
  rules: RuleService;
  correlation: CorrelationService;
  /** Scoring needs the ML service (or a test double); without it flows stay pending. */
  canScore: boolean;
}

/** Dead-letter sink: one record per job that ran out of attempts, readable per org. */
export async function recordDeadLetter(entry: DeadLetter, mode: JobQueue["mode"]): Promise<void> {
  if (!mongoose.isValidObjectId(entry.payload.orgId)) return;
  try {
    await FailedJob.create({
      orgId: oid(entry.payload.orgId),
      kind: entry.kind,
      jobId: entry.jobId,
      payload: entry.payload,
      error: entry.error,
      attempts: entry.attempts,
      permanent: entry.permanent,
      mode,
      failedAt: new Date(),
    });
  } catch (err) {
    // The same job id recorded twice (a duplicate "failed" event) is fine.
    if ((err as { code?: number }).code !== 11000) throw err;
  }
}

async function importJob(p: JobPayload, ctx: JobContext, deps: JobHandlerDeps, schedule: Scheduler) {
  const job = p as unknown as ImportJobInput;
  const orgId = oid(job.orgId);
  const datasetId = oid(job.datasetId);
  const input: ImportInput = {
    orgId,
    userId: job.userId ? oid(job.userId) : null,
    filePath: job.filePath,
    name: job.name,
    fileBytes: job.fileBytes,
    sourceType: job.sourceType,
    sourceKind: job.sourceKind,
  };
  const markFailed = (message: string) =>
    Dataset.updateOne({ orgId, _id: datasetId, status: "Processing" }, { $set: { status: "Failed", error: message.slice(0, 500), completedAt: new Date() } });
  try {
    if (!(await Dataset.exists({ orgId, _id: datasetId }))) throw new PermanentJobError("The dataset record no longer exists");
    if (!existsSync(input.filePath)) throw new PermanentJobError("The uploaded file is no longer available; upload it again");
    let header;
    try {
      header = await checkCsvHeader(input.filePath, SCHEMA_FOR_SOURCE_TYPE[input.sourceType]);
    } catch (err) {
      throw err instanceof AppError && err.status < 500 ? new PermanentJobError(err.message) : err;
    }
    // A retry starts from a clean slate: rows stored by an interrupted attempt are removed first,
    // so a crash mid-file never leaves duplicates.
    await Flow.deleteMany({ orgId, datasetId });
    await Dataset.updateOne({ orgId, _id: datasetId }, { $set: { status: "Processing", error: null, completedAt: null } });
    await runCsvImport(datasetId, input, header, deps.logger);
  } catch (err) {
    if (ctx.final || err instanceof PermanentJobError) {
      await markFailed(err instanceof Error ? err.message : "Import failed");
      await unlink(input.filePath).catch(() => undefined);
    }
    throw err;
  }
  await unlink(input.filePath).catch(() => undefined);
  await schedule.score(orgId);
  await schedule.detect(orgId, datasetId);
  await schedule.assets(orgId);
  await schedule.rollup(orgId);
}

/**
 * Registers every handler on the queue and returns the scheduler the routes call.
 * All handlers are idempotent: scoring only touches `pending` flows, alert evidence is
 * claimed and settled once per claim key (retries reuse the job id as claim prefix),
 * rule hits carry deterministic keys, assets are rebuilt from flows.
 */
export function registerJobHandlers(deps: JobHandlerDeps): Scheduler {
  const { queue } = deps;
  const schedule: Scheduler = {
    mode: queue.mode,
    importCsv: (input) => queue.enqueue("import", { ...input }),
    async score(orgId) {
      if (deps.canScore) await queue.enqueue("score", { orgId: String(orgId) });
    },
    async detect(orgId, datasetId) {
      await queue.enqueue("detect", { orgId: String(orgId), ...(datasetId ? { datasetId: String(datasetId) } : {}) });
    },
    async assets(orgId) {
      await queue.enqueue("assets", { orgId: String(orgId) });
    },
    async rollup(orgId) {
      if (!(await queue.busy("rollup", String(orgId)))) await queue.enqueue("rollup", { orgId: String(orgId) });
    },
    retention: (orgId, actorId, jobId) =>
      queue.enqueue("retention", { orgId: String(orgId), actorId: actorId ? String(actorId) : null }, jobId ? { jobId } : undefined),
    busy: (kind, orgId) => queue.busy(kind, String(orgId)),
  };

  queue.register("import", (p, ctx) => importJob(p, ctx, deps, schedule));

  queue.register("score", async (p, ctx) => {
    const orgId = oid(p.orgId);
    await deps.scoring.scorePending(orgId, ctx.jobId, resumeOf(p));
    await deps.correlation.correlate(orgId);
    await schedule.rollup(orgId);
  });

  // Rules do not need the ML service; the backfill folds earlier malicious verdicts into alerts.
  queue.register("detect", async (p, ctx) => {
    const orgId = oid(p.orgId);
    const datasetId = p.datasetId ? oid(p.datasetId) : undefined;
    await deps.rules.run(orgId, { datasetId });
    await deps.scoring.alertUnalerted(orgId, datasetId, { claimPrefix: ctx.jobId, resumeOf: resumeOf(p) });
    await deps.correlation.correlate(orgId);
  });

  queue.register("assets", async (p) => {
    await refreshAssets(oid(p.orgId), deps.logger);
  });

  queue.register("retention", async (p) => {
    const orgId = oid(p.orgId);
    const result = await runRetention(orgId, { actorId: p.actorId ? oid(p.actorId) : null, logger: deps.logger });
    // The inventory is rebuilt from flows: purged addresses become inactive.
    if (result.flowsDeleted) {
      await schedule.assets(orgId);
      await schedule.rollup(orgId);
    }
  });

  queue.register("rollup", async (p) => {
    await rebuildRollups(oid(p.orgId));
  });

  return schedule;
}
