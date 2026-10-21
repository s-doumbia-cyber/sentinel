import type { RequestHandler } from "express";
import type { JobQueue } from "./jobs.js";

/**
 * Minimal Prometheus text exposition (format 0.0.4) without a client library:
 * request counts and latency by route template, job queue depth, process memory.
 * Route labels are templates (`/api/v1/alerts/:id`), never raw URLs, so the
 * label set stays bounded and carries no ids or personal data.
 */
const BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

interface Series {
  count: number;
  sum: number;
  buckets: number[];
}

export class Metrics {
  private readonly requests = new Map<string, number>();
  private readonly durations = new Map<string, Series>();
  private readonly startedAt = Date.now();

  middleware(): RequestHandler {
    return (req, res, next) => {
      const start = process.hrtime.bigint();
      res.on("finish", () => {
        const route = req.route?.path ? `${req.baseUrl}${String(req.route.path)}` : "unmatched";
        const seconds = Number(process.hrtime.bigint() - start) / 1e9;
        const key = `method="${req.method}",route="${route}",status="${res.statusCode}"`;
        this.requests.set(key, (this.requests.get(key) ?? 0) + 1);
        const dKey = `method="${req.method}",route="${route}"`;
        const s = this.durations.get(dKey) ?? { count: 0, sum: 0, buckets: BUCKETS.map(() => 0) };
        s.count++;
        s.sum += seconds;
        BUCKETS.forEach((b, i) => {
          if (seconds <= b) s.buckets[i] = (s.buckets[i] ?? 0) + 1;
        });
        this.durations.set(dKey, s);
      });
      next();
    };
  }

  async render(deps: { queue: JobQueue; mongoUp: boolean }): Promise<string> {
    const out: string[] = [];
    out.push("# HELP sentinel_http_requests_total HTTP requests by method, route template and status.", "# TYPE sentinel_http_requests_total counter");
    for (const [k, v] of this.requests) out.push(`sentinel_http_requests_total{${k}} ${v}`);
    out.push("# HELP sentinel_http_request_duration_seconds Request latency by route template.", "# TYPE sentinel_http_request_duration_seconds histogram");
    for (const [k, s] of this.durations) {
      BUCKETS.forEach((b, i) => out.push(`sentinel_http_request_duration_seconds_bucket{${k},le="${b}"} ${s.buckets[i] ?? 0}`));
      out.push(`sentinel_http_request_duration_seconds_bucket{${k},le="+Inf"} ${s.count}`);
      out.push(`sentinel_http_request_duration_seconds_sum{${k}} ${s.sum.toFixed(6)}`, `sentinel_http_request_duration_seconds_count{${k}} ${s.count}`);
    }
    const depth = await deps.queue.depth().catch(() => null);
    out.push("# HELP sentinel_jobs Background jobs by kind and state (all organisations).", "# TYPE sentinel_jobs gauge");
    if (depth) {
      for (const [kind, d] of Object.entries(depth)) {
        for (const [state, n] of Object.entries(d)) out.push(`sentinel_jobs{kind="${kind}",state="${state}",queue="${deps.queue.mode}"} ${n}`);
      }
    }
    const redis = await deps.queue.health();
    out.push(
      "# HELP sentinel_up Dependency reachability (1 up, 0 down).",
      "# TYPE sentinel_up gauge",
      `sentinel_up{dependency="mongodb"} ${deps.mongoUp ? 1 : 0}`,
      ...(redis === "not_configured" ? [] : [`sentinel_up{dependency="redis"} ${redis === "ok" ? 1 : 0}`]),
    );
    const mem = process.memoryUsage();
    out.push(
      "# HELP sentinel_process_resident_memory_bytes Resident memory of the API process.",
      "# TYPE sentinel_process_resident_memory_bytes gauge",
      `sentinel_process_resident_memory_bytes ${mem.rss}`,
      "# HELP sentinel_process_heap_used_bytes V8 heap in use.",
      "# TYPE sentinel_process_heap_used_bytes gauge",
      `sentinel_process_heap_used_bytes ${mem.heapUsed}`,
      "# HELP sentinel_process_uptime_seconds Seconds since the process started.",
      "# TYPE sentinel_process_uptime_seconds gauge",
      `sentinel_process_uptime_seconds ${((Date.now() - this.startedAt) / 1000).toFixed(0)}`,
    );
    return `${out.join("\n")}\n`;
  }
}
