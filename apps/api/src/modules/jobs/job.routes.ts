import { existsSync } from "node:fs";
import { objectIdSchema } from "@sentinel/shared";
import { z } from "zod";
import type { AppConfig } from "../../config/index.js";
import { AppError } from "../../lib/errors.js";
import { ah, authOf, parsed, validate } from "../../lib/http.js";
import { JOB_KINDS, type JobKind, type JobPayload, type JobQueue } from "../../lib/jobs.js";
import { PolicyRouter } from "../../lib/routes.js";
import { FailedJob, type FailedJobDoc } from "../../models/ops.js";
import { Dataset } from "../../models/tenant.js";
import { auditFromRequest } from "../audit/audit.service.js";
import { decodeCursor, encodeCursor } from "../flows/flow.filters.js";

/** Payload fields shown to Admins: internal details such as server file paths stay hidden. */
export function publicPayload(kind: string, payload: Record<string, unknown>): Record<string, unknown> {
  const { orgId: _org, filePath: _path, resumeOf: _resume, ...rest } = payload;
  if (kind === "import") return { datasetId: rest.datasetId ?? null, name: rest.name ?? null, fileBytes: rest.fileBytes ?? null };
  return rest;
}

export function toFailedJobResponse(j: FailedJobDoc) {
  return {
    id: String(j._id),
    kind: j.kind,
    jobId: j.jobId,
    payload: publicPayload(j.kind, (j.payload ?? {}) as Record<string, unknown>),
    error: j.error,
    attempts: j.attempts,
    permanent: j.permanent,
    mode: j.mode,
    failedAt: j.failedAt,
    retriedAt: j.retriedAt ?? null,
    retryJobId: j.retryJobId ?? null,
  };
}

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(200).optional(),
});

export function jobRoutes(config: AppConfig, deps: { queue: JobQueue }): PolicyRouter {
  const r = new PolicyRouter(config);

  r.route(
    "get",
    "/jobs/status",
    "jobs:read",
    ah(async (req, res) => {
      const orgId = String(authOf(req).orgId);
      const busy = Object.fromEntries(await Promise.all(JOB_KINDS.map(async (k) => [k, await deps.queue.busy(k, orgId)] as const)));
      const failed = await FailedJob.countDocuments({ orgId: authOf(req).orgId, retriedAt: null });
      // Queue depths are global (all tenants) and stay on /metrics; this answer is about this org only.
      res.json({
        mode: deps.queue.mode,
        durable: deps.queue.mode === "redis",
        retry: { attempts: config.jobs.attempts, backoffMs: config.jobs.backoffMs },
        busy,
        failedNotRetried: failed,
      });
    }),
  );

  r.route(
    "get",
    "/jobs/failed",
    "jobs:read",
    validate("query", listQuery),
    ah(async (req, res) => {
      const { orgId } = authOf(req);
      const q = parsed<z.infer<typeof listQuery>>(req, "query");
      const filter: Record<string, unknown> = { orgId };
      if (q.cursor) {
        const c = decodeCursor(q.cursor);
        filter.$or = [{ failedAt: { $lt: c.t } }, { failedAt: c.t, _id: { $lt: c.id } }];
      }
      const rows = await FailedJob.find(filter).sort({ failedAt: -1, _id: -1 }).limit(q.limit + 1).lean<FailedJobDoc[]>();
      const page = rows.slice(0, q.limit);
      const last = page.at(-1);
      res.json({
        items: page.map(toFailedJobResponse),
        nextCursor: rows.length > q.limit && last ? encodeCursor(last.failedAt, last._id) : null,
      });
    }),
  );

  r.route(
    "post",
    "/jobs/failed/:id/retry",
    "jobs:manage",
    validate("params", z.object({ id: objectIdSchema })),
    ah(async (req, res) => {
      const { orgId, userId } = authOf(req);
      const { id } = parsed<{ id: string }>(req, "params");
      const failed = await FailedJob.findOne({ orgId, _id: id }).lean<FailedJobDoc>();
      if (!failed) throw AppError.notFound("Failed job");
      if (failed.retriedAt) throw AppError.conflict("This job was already retried");
      const kind = failed.kind as JobKind;
      if (!(JOB_KINDS as readonly string[]).includes(kind)) throw AppError.unprocessable(`Unknown job kind ${failed.kind}`);
      const previous = (failed.payload ?? {}) as Record<string, unknown>;
      // The new job takes over what the failed one left half-done (its open alert claims).
      const resumed = Array.isArray(previous.resumeOf) ? previous.resumeOf.filter((x): x is string => typeof x === "string") : [];
      const payload: JobPayload = { ...previous, orgId: String(orgId), resumeOf: [...resumed, failed.jobId].slice(-10) };
      if (kind === "import") {
        if (typeof payload.filePath !== "string" || !existsSync(payload.filePath)) {
          throw AppError.conflict("The uploaded file was removed after the failure; upload the CSV again");
        }
        await Dataset.updateOne({ orgId, _id: String(payload.datasetId) }, { $set: { status: "Processing", error: null, completedAt: null } });
      }
      const claimed = await FailedJob.findOneAndUpdate(
        { orgId, _id: id, retriedAt: null },
        { $set: { retriedAt: new Date(), retriedBy: userId } },
        { new: true },
      );
      if (!claimed) throw AppError.conflict("This job was already retried");
      const jobId = await deps.queue.enqueue(kind, payload);
      await FailedJob.updateOne({ orgId, _id: id }, { $set: { retryJobId: jobId } });
      await auditFromRequest(req, "job.retry", { type: "job", id: failed.jobId }, { kind, retryJobId: jobId });
      res.status(202).json({ retryJobId: jobId });
    }),
  );

  return r;
}
