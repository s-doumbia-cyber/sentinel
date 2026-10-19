import type { Logger } from "./logger.js";

/**
 * Minimal in-process job runner for imports and scoring. It keeps the request
 * path fast (202 + polling) and lets tests await completion. It does not
 * survive a restart; durable queues (BullMQ) are roadmap task 1.5.
 */
export class BackgroundJobs {
  private readonly running = new Set<Promise<unknown>>();

  constructor(private readonly logger: Logger) {}

  run(name: string, fn: () => Promise<unknown>): void {
    const p = fn()
      .catch((err: unknown) => this.logger.error({ err, job: name }, "Background job failed"))
      .finally(() => this.running.delete(p));
    this.running.add(p);
  }

  get size(): number {
    return this.running.size;
  }

  /** Resolves once no job is running, including jobs started by other jobs. */
  async idle(): Promise<void> {
    while (this.running.size) await Promise.allSettled([...this.running]);
  }
}
