import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RedisJobQueue } from "../src/lib/jobs.js";
import { createLogger } from "../src/lib/logger.js";
import { FailedJob } from "../src/models/ops.js";
import { Alert, Flow } from "../src/models/tenant.js";
import { recordDeadLetter } from "../src/modules/jobs/job.handlers.js";
import { API, FakeMl, buildApp, oid, registerUser, writeCsv, type CsvRow } from "./helpers.js";

/**
 * BullMQ path, against a real Redis. Skipped unless SENTINEL_TEST_REDIS_URL points at a
 * throwaway Redis (CI starts one as a service; locally: `docker run --rm -p 6390:6379 redis:7`).
 * Each test uses its own queue prefix, so it never touches another app's keys.
 */
const redisUrl = process.env.SENTINEL_TEST_REDIS_URL;
const require = createRequire(import.meta.url);

const ddos = (n: number): CsvRow[] =>
  Array.from({ length: n }, () => ({ label: "DDoS", srcIp: "172.16.0.1", dstIp: "192.168.10.50", features: { "Flow Packets/s": "5000" } }));

const opened: RedisJobQueue[] = [];
function redisQueue(prefix: string) {
  const q = new RedisJobQueue(redisUrl ?? "", prefix, { attempts: 3, backoffMs: 10 }, createLogger("silent"), (e) => recordDeadLetter(e, "redis"), {
    lockDurationMs: 2000,
    stalledIntervalMs: 1000,
  });
  opened.push(q);
  return q;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(opened.splice(0).map((q) => q.close()));
});

async function expectExactlyCounted(orgId: string, malicious: number) {
  const alerts = await Alert.find({ orgId: oid(orgId) }).lean();
  expect(alerts).toHaveLength(1);
  expect(alerts[0]?.count).toBe(malicious);
  expect(await Flow.countDocuments({ orgId: oid(orgId), alertedAt: null, "scored.label": "DDoS" })).toBe(0);
  expect(await Flow.countDocuments({ orgId: oid(orgId), alertClaimedAt: { $type: "date" } })).toBe(0);
}

describe.skipIf(!redisUrl)("BullMQ queue on Redis", () => {
  it("runs imports, scoring and detections as durable jobs and reports Redis in /readyz", async () => {
    const queue = redisQueue(`sentinel-test-${randomBytes(4).toString("hex")}`);
    const sa = buildApp({ ml: new FakeMl(), queue });
    await queue.start();
    const u = await registerUser(sa);
    const auth = { Authorization: `Bearer ${u.token}` };
    await request(sa.app).post(`${API}/models/bench-a/activate`).set(auth).expect(200);
    const res = await request(sa.app).post(`${API}/imports/csv`).set(auth).attach("file", writeCsv(ddos(8)));
    expect(res.status).toBe(202);
    await queue.idle();
    await expectExactlyCounted(u.orgId, 8);
    const ready = await request(sa.app).get(`${API}/readyz`).expect(200);
    expect(ready.body).toMatchObject({ redis: "ok", queue: "redis" });
    const status = await request(sa.app).get(`${API}/jobs/status`).set(auth).expect(200);
    expect(status.body).toMatchObject({ mode: "redis", durable: true });
  });

  it("retries a failed attempt with backoff and still counts each flow once", async () => {
    const queue = redisQueue(`sentinel-test-${randomBytes(4).toString("hex")}`);
    const sa = buildApp({ ml: new FakeMl(), queue });
    await queue.start();
    const u = await registerUser(sa);
    const auth = { Authorization: `Bearer ${u.token}` };
    await request(sa.app).post(`${API}/models/bench-a/activate`).set(auth).expect(200);
    const original = Flow.updateMany.bind(Flow);
    let crashed = false;
    vi.spyOn(Flow, "updateMany").mockImplementation(((...args: unknown[]) => {
      if (!crashed && (args[1] as { $unset?: Record<string, unknown> } | undefined)?.$unset?.alertClaimedAt) {
        crashed = true;
        return Promise.reject(new Error("simulated crash"));
      }
      return (original as (...a: unknown[]) => unknown)(...args);
    }) as never);
    await request(sa.app).post(`${API}/imports/csv`).set(auth).attach("file", writeCsv(ddos(6))).expect(202);
    await queue.idle();
    expect(crashed).toBe(true);
    await expectExactlyCounted(u.orgId, 6);
    expect(await FailedJob.countDocuments({ orgId: oid(u.orgId) })).toBe(0);
  });

  it("a worker killed with SIGKILL mid-job: another worker takes the stalled job over, nothing lost or double-counted", async () => {
    const prefix = `sentinel-test-${randomBytes(4).toString("hex")}`;
    const queue = redisQueue(prefix);
    const sa = buildApp({ ml: new FakeMl(), queue });
    const u = await registerUser(sa);
    const auth = { Authorization: `Bearer ${u.token}` };
    await request(sa.app).post(`${API}/models/bench-a/activate`).set(auth).expect(200);

    const child = spawn(
      process.execPath,
      [require.resolve("tsx/cli"), "--conditions=development", fileURLToPath(new URL("./fixtures/crashing-worker.ts", import.meta.url))],
      {
        env: { ...process.env, SENTINEL_TEST_PREFIX: prefix, NODE_ENV: "test" },
        stdio: ["ignore", "pipe", "inherit"],
      },
    );
    await new Promise<void>((resolve, reject) => {
      child.stdout.on("data", (d: Buffer) => d.toString().includes("READY") && resolve());
      child.on("exit", (code) => reject(new Error(`worker exited early (${code})`)));
    });
    const exited = new Promise<NodeJS.Signals | number | null>((resolve) => child.on("exit", (code, signal) => resolve(signal ?? code)));

    // Only the crashing worker is running: it imports, scores, updates the alert, then dies.
    await request(sa.app).post(`${API}/imports/csv`).set(auth).attach("file", writeCsv(ddos(5))).expect(202);
    await exited;
    const alertBefore = await Alert.findOne({ orgId: oid(u.orgId) }).lean();
    expect(alertBefore?.count).toBe(5);
    expect(await Flow.countDocuments({ orgId: oid(u.orgId), alertClaimedAt: { $type: "date" } })).toBe(5);

    // A healthy worker starts; BullMQ notices the expired lock and runs the same job (same id) again.
    await queue.start();
    await queue.idle(60_000);
    await expectExactlyCounted(u.orgId, 5);
  }, 90_000);
});
