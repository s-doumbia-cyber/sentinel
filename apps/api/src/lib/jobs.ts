import { randomUUID } from "node:crypto";
import { Queue, Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import type { Logger } from "./logger.js";

/**
 * Background work: imports, scoring, detections, asset refresh, rollups and
 * retention. With REDIS_URL the jobs go through BullMQ (they survive a restart,
 * retry with exponential backoff and land in a dead-letter list when they run
 * out of attempts); without it they run in this process with the same retry
 * policy, which keeps `npm test` and the e2e suite free of external services.
 *
 * Handlers must be idempotent: a job can run again after a crash or a retry.
 */
export const JOB_KINDS = ["import", "score", "detect", "assets", "rollup", "retention"] as const;
export type JobKind = (typeof JOB_KINDS)[number];

/** JSON-only payload; `orgId` scopes the job to one tenant. */
export interface JobPayload {
  orgId: string;
  [key: string]: unknown;
}

export interface JobContext {
  /** Stable across retries of the same job, so a retry can recognise its own earlier work. */
  jobId: string;
  attempt: number;
  maxAttempts: number;
  /** True on the last attempt: clean up inputs (e.g. the uploaded file) whatever the outcome. */
  final: boolean;
}

export type JobHandler = (payload: JobPayload, ctx: JobContext) => Promise<void>;

/** Retrying cannot help (the input is gone or invalid): fail now, straight to the dead-letter list. */
export class PermanentJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentJobError";
  }
}

export interface DeadLetter {
  kind: JobKind;
  jobId: string;
  payload: JobPayload;
  error: string;
  attempts: number;
  permanent: boolean;
}

export interface QueueDepth {
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
}

export interface JobQueue {
  readonly mode: "in-process" | "redis";
  register(kind: JobKind, handler: JobHandler): void;
  enqueue(kind: JobKind, payload: JobPayload, opts?: { jobId?: string }): Promise<string>;
  /** True while a job of this kind is waiting or running for the org. */
  busy(kind: JobKind, orgId: string): Promise<boolean>;
  depth(): Promise<Record<JobKind, QueueDepth>>;
  health(): Promise<"ok" | "down" | "not_configured">;
  /** Resolves once nothing is waiting or running, including jobs enqueued by other jobs (tests, shutdown). */
  idle(timeoutMs?: number): Promise<void>;
  start(): Promise<void>;
  close(): Promise<void>;
}

export interface RetryPolicy {
  attempts: number;
  backoffMs: number;
}

type DeadLetterSink = (entry: DeadLetter) => Promise<void>;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function messageOf(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 1000);
}

function emptyDepths(): Record<JobKind, QueueDepth> {
  return Object.fromEntries(JOB_KINDS.map((k) => [k, { waiting: 0, active: 0, delayed: 0, failed: 0 }])) as Record<JobKind, QueueDepth>;
}

// ---- In-process fallback ---------------------------------------------------------------

export class InProcessJobQueue implements JobQueue {
  readonly mode = "in-process" as const;
  private readonly handlers = new Map<JobKind, JobHandler>();
  private readonly running = new Set<Promise<void>>();
  private readonly jobs = new Map<string, { kind: JobKind; orgId: string; state: "active" | "delayed" }>();
  private failed = emptyDepths();

  constructor(
    private readonly logger: Logger,
    private readonly policy: RetryPolicy,
    private readonly deadLetter: DeadLetterSink,
  ) {}

  register(kind: JobKind, handler: JobHandler): void {
    this.handlers.set(kind, handler);
  }

  async enqueue(kind: JobKind, payload: JobPayload, opts?: { jobId?: string }): Promise<string> {
    const handler = this.handlers.get(kind);
    if (!handler) throw new Error(`No handler registered for ${kind} jobs`);
    const jobId = opts?.jobId ?? `${kind}-${randomUUID()}`;
    this.jobs.set(jobId, { kind, orgId: payload.orgId, state: "active" });
    const p: Promise<void> = this.execute(kind, handler, payload, jobId).finally(() => {
      this.running.delete(p);
      this.jobs.delete(jobId);
    });
    this.running.add(p);
    return jobId;
  }

  private async execute(kind: JobKind, handler: JobHandler, payload: JobPayload, jobId: string): Promise<void> {
    const maxAttempts = this.policy.attempts;
    for (let attempt = 1; ; attempt++) {
      const final = attempt >= maxAttempts;
      try {
        await handler(payload, { jobId, attempt, maxAttempts, final });
        return;
      } catch (err) {
        const permanent = err instanceof PermanentJobError;
        if (permanent || final) {
          this.logger.error({ err, job: kind, jobId, attempt }, "Background job failed");
          this.failed[kind].failed++;
          await this.deadLetter({ kind, jobId, payload, error: messageOf(err), attempts: attempt, permanent }).catch((e: unknown) =>
            this.logger.error({ err: e, jobId }, "Could not record a dead letter"),
          );
          return;
        }
        this.logger.warn({ err, job: kind, jobId, attempt }, "Background job failed; retrying");
        const entry = this.jobs.get(jobId);
        if (entry) entry.state = "delayed";
        await sleep(this.policy.backoffMs * 2 ** (attempt - 1));
        if (entry) entry.state = "active";
      }
    }
  }

  async busy(kind: JobKind, orgId: string): Promise<boolean> {
    return [...this.jobs.values()].some((j) => j.kind === kind && j.orgId === orgId);
  }

  async depth(): Promise<Record<JobKind, QueueDepth>> {
    const out = emptyDepths();
    for (const k of JOB_KINDS) out[k].failed = this.failed[k].failed;
    for (const j of this.jobs.values()) out[j.kind][j.state]++;
    return out;
  }

  async health(): Promise<"not_configured"> {
    return "not_configured";
  }

  get size(): number {
    return this.running.size;
  }

  async idle(): Promise<void> {
    while (this.running.size) await Promise.allSettled([...this.running]);
  }

  async start(): Promise<void> {}

  async close(): Promise<void> {
    await this.idle();
  }
}

// ---- BullMQ on Redis ---------------------------------------------------------------------

/** Imports read large files: one at a time. Scoring and detection are mostly I/O bound. */
const CONCURRENCY: Record<JobKind, number> = { import: 1, score: 2, detect: 2, assets: 1, rollup: 1, retention: 1 };

export class RedisJobQueue implements JobQueue {
  readonly mode = "redis" as const;
  private readonly handlers = new Map<JobKind, JobHandler>();
  private readonly queues = new Map<JobKind, Queue>();
  private readonly workers: Worker[] = [];
  private readonly connections: Redis[] = [];
  private readonly connection: Redis;

  constructor(
    private readonly url: string,
    private readonly prefix: string,
    private readonly policy: RetryPolicy,
    private readonly logger: Logger,
    private readonly deadLetter: DeadLetterSink,
    /** How long a dead worker keeps a job locked before another worker takes it over. */
    private readonly locks: { lockDurationMs: number; stalledIntervalMs: number } = { lockDurationMs: 60_000, stalledIntervalMs: 30_000 },
  ) {
    this.connection = this.connect();
    for (const kind of JOB_KINDS) {
      this.queues.set(
        kind,
        new Queue(kind, {
          connection: this.connection,
          prefix,
          defaultJobOptions: {
            attempts: policy.attempts,
            backoff: { type: "exponential", delay: policy.backoffMs },
            removeOnComplete: { age: 24 * 3600, count: 1000 },
            // Failed jobs are also copied to the dead-letter collection, which is what the UI reads.
            removeOnFail: { age: 7 * 24 * 3600, count: 1000 },
          },
        }),
      );
    }
  }

  private connect(): Redis {
    // BullMQ workers need maxRetriesPerRequest: null (blocking commands must not time out).
    const conn = new Redis(this.url, { maxRetriesPerRequest: null, connectTimeout: 5000 });
    conn.on("error", (err) => this.logger.warn({ err: err.message }, "Redis connection error"));
    this.connections.push(conn);
    return conn;
  }

  private queue(kind: JobKind): Queue {
    const q = this.queues.get(kind);
    if (!q) throw new Error(`Unknown job kind ${kind}`);
    return q;
  }

  register(kind: JobKind, handler: JobHandler): void {
    this.handlers.set(kind, handler);
  }

  async enqueue(kind: JobKind, payload: JobPayload, opts?: { jobId?: string }): Promise<string> {
    const job = await this.queue(kind).add(kind, payload, opts?.jobId ? { jobId: opts.jobId } : {});
    return String(job.id);
  }

  async start(): Promise<void> {
    for (const [kind, handler] of this.handlers) {
      const worker = new Worker(
        kind,
        async (job: Job<JobPayload>) => {
          const maxAttempts = job.opts.attempts ?? 1;
          const attempt = job.attemptsMade + 1;
          try {
            await handler(job.data, { jobId: String(job.id), attempt, maxAttempts, final: attempt >= maxAttempts });
          } catch (err) {
            // BullMQ skips the remaining attempts for this error name.
            if (err instanceof PermanentJobError) err.name = "UnrecoverableError";
            throw err;
          }
        },
        {
          connection: this.connect(),
          prefix: this.prefix,
          concurrency: CONCURRENCY[kind],
          // A worker that dies mid-job loses its lock; the job is picked up again after lockDuration.
          lockDuration: this.locks.lockDurationMs,
          stalledInterval: this.locks.stalledIntervalMs,
          maxStalledCount: 3,
        },
      );
      worker.on("failed", (job, err) => {
        if (!job) return;
        const permanent = err.name === "UnrecoverableError";
        const attempts = job.opts.attempts ?? 1;
        if (!permanent && job.attemptsMade < attempts) {
          this.logger.warn({ err: err.message, job: kind, jobId: job.id, attempt: job.attemptsMade }, "Background job failed; retrying");
          return;
        }
        this.logger.error({ err: err.message, job: kind, jobId: job.id }, "Background job failed");
        void this.deadLetter({ kind, jobId: String(job.id), payload: job.data, error: messageOf(err), attempts: job.attemptsMade, permanent }).catch(
          (e: unknown) => this.logger.error({ err: e, jobId: job.id }, "Could not record a dead letter"),
        );
      });
      worker.on("error", (err) => this.logger.warn({ err: err.message, job: kind }, "Worker error"));
      this.workers.push(worker);
    }
    await Promise.all(this.workers.map((w) => w.waitUntilReady()));
  }

  async busy(kind: JobKind, orgId: string): Promise<boolean> {
    const jobs = await this.queue(kind).getJobs(["active", "waiting", "delayed", "prioritized"], 0, 500);
    return jobs.some((j) => (j?.data as JobPayload | undefined)?.orgId === orgId);
  }

  async depth(): Promise<Record<JobKind, QueueDepth>> {
    const out = emptyDepths();
    for (const kind of JOB_KINDS) {
      const c = await this.queue(kind).getJobCounts("waiting", "active", "delayed", "failed", "prioritized");
      out[kind] = { waiting: (c.waiting ?? 0) + (c.prioritized ?? 0), active: c.active ?? 0, delayed: c.delayed ?? 0, failed: c.failed ?? 0 };
    }
    return out;
  }

  async health(): Promise<"ok" | "down"> {
    try {
      const pong = await Promise.race([this.connection.ping(), sleep(2000).then(() => "timeout")]);
      return pong === "PONG" ? "ok" : "down";
    } catch {
      return "down";
    }
  }

  async idle(timeoutMs = 120_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const d = await this.depth();
      if (JOB_KINDS.every((k) => d[k].waiting + d[k].active + d[k].delayed === 0)) return;
      if (Date.now() > deadline) throw new Error("Timed out waiting for queues to drain");
      await sleep(50);
    }
  }

  async close(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.close()));
    await Promise.all([...this.queues.values()].map((q) => q.close()));
    await Promise.all(this.connections.map((c) => c.quit().catch(() => c.disconnect())));
  }
}

export function createJobQueue(
  opts: { redisUrl: string | null; prefix: string; policy: RetryPolicy },
  logger: Logger,
  deadLetter: DeadLetterSink,
): JobQueue {
  return opts.redisUrl
    ? new RedisJobQueue(opts.redisUrl, opts.prefix, opts.policy, logger, deadLetter)
    : new InProcessJobQueue(logger, opts.policy, deadLetter);
}
