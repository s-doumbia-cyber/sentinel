import { unlinkSync } from "node:fs";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InProcessJobQueue, PermanentJobError, type DeadLetter, type JobContext } from "../src/lib/jobs.js";
import { createLogger } from "../src/lib/logger.js";
import { FailedJob } from "../src/models/ops.js";
import { Alert, AuditLog, Dataset, Flow } from "../src/models/tenant.js";
import { STALE_CLAIM_MS } from "../src/modules/alerts/alert.service.js";
import { API, FakeMl, buildApp, oid, registerUser, writeCsv, type CsvRow } from "./helpers.js";

const sa = buildApp({ ml: new FakeMl() });

const ddos = (n: number): CsvRow[] =>
  Array.from({ length: n }, () => ({ label: "DDoS", srcIp: "172.16.0.1", dstIp: "192.168.10.50", features: { "Flow Packets/s": "5000" } }));
const benign = (n: number): CsvRow[] => Array.from({ length: n }, () => ({ label: "BENIGN", srcIp: "10.0.0.5" }));

async function setup() {
  const u = await registerUser(sa);
  const auth = { Authorization: `Bearer ${u.token}` };
  await request(sa.app).post(`${API}/models/bench-a/activate`).set(auth).expect(200);
  await sa.jobs.idle();
  return { u, auth };
}

async function importRows(auth: Record<string, string>, rows: CsvRow[]) {
  const res = await request(sa.app).post(`${API}/imports/csv`).set(auth).attach("file", writeCsv(rows));
  expect(res.status).toBe(202);
  await sa.jobs.idle();
  return res.body.id as string;
}

/** Wraps a model static so its first matching call fails like a process dying at that point. */
function crashOnce<T extends object>(model: T, method: keyof T & string, when: (args: unknown[]) => boolean) {
  const original = (model[method] as (...a: unknown[]) => unknown).bind(model);
  let crashed = false;
  return vi.spyOn(model, method as never).mockImplementation(((...args: unknown[]) => {
    if (!crashed && when(args)) {
      crashed = true;
      return Promise.reject(new Error(`simulated crash in ${method}`));
    }
    return original(...args);
  }) as never);
}

const isSettle = (args: unknown[]) => Boolean((args[1] as { $unset?: Record<string, unknown> } | undefined)?.$unset?.alertClaimedAt);
const isAlertUpsert = (args: unknown[]) => Boolean((args[2] as { upsert?: boolean } | undefined)?.upsert) && "claimKeys" in ((args[0] as object) ?? {});

async function expectExactlyCounted(orgId: string, malicious: number) {
  const alerts = await Alert.find({ orgId: oid(orgId) }).lean();
  expect(alerts).toHaveLength(1);
  expect(alerts[0]?.count).toBe(malicious);
  expect(await Flow.countDocuments({ orgId: oid(orgId), scoreStatus: "scored", "scored.label": "DDoS", alertedAt: null })).toBe(0);
  expect(await Flow.countDocuments({ orgId: oid(orgId), alertClaimedAt: { $type: "date" } })).toBe(0);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("in-process job queue", () => {
  const logger = createLogger("silent");

  it("retries with the same job id, then records a dead letter", async () => {
    const letters: DeadLetter[] = [];
    const q = new InProcessJobQueue(logger, { attempts: 3, backoffMs: 1 }, async (d) => void letters.push(d));
    const seen: JobContext[] = [];
    q.register("score", async (_p, ctx) => {
      seen.push(ctx);
      throw new Error("ML down");
    });
    const id = await q.enqueue("score", { orgId: "0123456789abcdef01234567" });
    await q.idle();
    expect(seen.map((c) => [c.jobId, c.attempt, c.final])).toEqual([
      [id, 1, false],
      [id, 2, false],
      [id, 3, true],
    ]);
    expect(letters).toEqual([expect.objectContaining({ kind: "score", jobId: id, attempts: 3, permanent: false, error: "ML down" })]);
    expect((await q.depth()).score.failed).toBe(1);
  });

  it("does not retry a permanent failure, and succeeds on a later attempt otherwise", async () => {
    const letters: DeadLetter[] = [];
    const q = new InProcessJobQueue(logger, { attempts: 3, backoffMs: 1 }, async (d) => void letters.push(d));
    let calls = 0;
    q.register("import", async () => {
      calls++;
      throw new PermanentJobError("file gone");
    });
    let flaky = 0;
    q.register("assets", async () => {
      if (++flaky < 2) throw new Error("transient");
    });
    await q.enqueue("import", { orgId: "0123456789abcdef01234567" });
    await q.enqueue("assets", { orgId: "0123456789abcdef01234567" });
    expect(await q.busy("assets", "0123456789abcdef01234567")).toBe(true);
    await q.idle();
    expect(calls).toBe(1);
    expect(flaky).toBe(2);
    expect(letters).toEqual([expect.objectContaining({ kind: "import", permanent: true, attempts: 1 })]);
    expect(await q.busy("assets", "0123456789abcdef01234567")).toBe(false);
  });
});

describe("scoring job killed mid-run", () => {
  it("a crash after the alert update but before the flows are settled: the retry does not double-count", async () => {
    const { u, auth } = await setup();
    crashOnce(Flow, "updateMany", isSettle);
    await importRows(auth, [...ddos(9), ...benign(4)]);
    await expectExactlyCounted(u.orgId, 9);
    expect(await FailedJob.countDocuments({ orgId: oid(u.orgId) })).toBe(0);
  });

  it("a crash before the alert update: the retry still counts every flow", async () => {
    const { u, auth } = await setup();
    crashOnce(Alert, "updateOne", isAlertUpsert);
    await importRows(auth, [...ddos(7), ...benign(3)]);
    await expectExactlyCounted(u.orgId, 7);
  });

  it("claims left by a run that never retried are recovered by the next detection run", async () => {
    const { u, auth } = await setup();
    // Every settle attempt of the scoring job fails, so it ends in the dead-letter list.
    const original = Flow.updateMany.bind(Flow);
    const spy = vi.spyOn(Flow, "updateMany").mockImplementation(((...args: unknown[]) =>
      isSettle(args) ? Promise.reject(new Error("worker died")) : (original as (...a: unknown[]) => unknown)(...args)) as never);
    await importRows(auth, ddos(5));
    spy.mockRestore();

    const failed = await FailedJob.find({ orgId: oid(u.orgId) }).lean();
    expect(failed.map((f) => f.kind)).toEqual(["score"]);
    // Nothing was lost: the verdicts are stored and claimed, waiting to be settled.
    expect(await Flow.countDocuments({ orgId: oid(u.orgId), alertClaimedAt: { $type: "date" } })).toBe(5);

    // A different job (another prefix) only takes over once the claim is stale.
    await request(sa.app).post(`${API}/detections/run`).set(auth).send({}).expect(202);
    await sa.jobs.idle();
    expect(await Flow.countDocuments({ orgId: oid(u.orgId), alertClaimedAt: { $type: "date" } })).toBe(5);

    await Flow.collection.updateMany({ orgId: oid(u.orgId) }, { $set: { alertClaimedAt: new Date(Date.now() - STALE_CLAIM_MS - 1000) } });
    await request(sa.app).post(`${API}/detections/run`).set(auth).send({}).expect(202);
    await sa.jobs.idle();
    // The first attempt may already have applied the evidence; either way it is counted once.
    await expectExactlyCounted(u.orgId, 5);
  });
});

describe("import job retried after a crash", () => {
  it("removes the rows of the interrupted attempt, so the retry leaves no duplicates", async () => {
    const { u, auth } = await setup();
    crashOnce(Dataset, "updateOne", (args) => (args[1] as { $set?: { status?: string } } | undefined)?.$set?.status === "Processed");
    const id = await importRows(auth, [...ddos(6), ...benign(5)]);
    const dataset = await Dataset.findOne({ orgId: oid(u.orgId), _id: id }).lean();
    expect(dataset?.status).toBe("Processed");
    expect(dataset?.rowsInserted).toBe(11);
    expect(await Flow.countDocuments({ orgId: oid(u.orgId), datasetId: oid(id) })).toBe(11);
    await expectExactlyCounted(u.orgId, 6);
  });

  it("fails permanently when the uploaded file is gone, and the dead letter hides server paths", async () => {
    const { u, auth } = await setup();
    const file = writeCsv(ddos(2));
    // The file disappears between the upload and the job (e.g. temp cleanup on another host).
    const original = sa.schedule.importCsv.bind(sa.schedule);
    vi.spyOn(sa.schedule, "importCsv").mockImplementation(async (input) => {
      unlinkSync(input.filePath);
      return original(input);
    });
    const res = await request(sa.app).post(`${API}/imports/csv`).set(auth).attach("file", file);
    expect(res.status).toBe(202);
    await sa.jobs.idle();
    const dataset = await Dataset.findOne({ orgId: oid(u.orgId), _id: res.body.id }).lean();
    expect(dataset?.status).toBe("Failed");
    expect(dataset?.error).toMatch(/no longer available/);

    const list = await request(sa.app).get(`${API}/jobs/failed`).set(auth).expect(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({ kind: "import", permanent: true, attempts: 1, payload: { datasetId: res.body.id } });
    expect(JSON.stringify(list.body)).not.toContain("sentinel-upload-");
    const retry = await request(sa.app).post(`${API}/jobs/failed/${list.body.items[0].id}/retry`).set(auth);
    expect(retry.status).toBe(409);
  });
});

describe("dead-letter view", () => {
  it("lists the org's failed jobs only, retries once, and audits the retry", async () => {
    const { u, auth } = await setup();
    const other = await registerUser(sa);
    const original = Flow.updateMany.bind(Flow);
    const spy = vi.spyOn(Flow, "updateMany").mockImplementation(((...args: unknown[]) =>
      isSettle(args) ? Promise.reject(new Error("worker died")) : (original as (...a: unknown[]) => unknown)(...args)) as never);
    await importRows(auth, ddos(3));
    spy.mockRestore();

    const status = await request(sa.app).get(`${API}/jobs/status`).set(auth).expect(200);
    expect(status.body).toMatchObject({ mode: "in-process", durable: false, failedNotRetried: 1, retry: { attempts: 3 } });
    const mine = await request(sa.app).get(`${API}/jobs/failed`).set(auth).expect(200);
    expect(mine.body.items).toHaveLength(1);
    expect((await request(sa.app).get(`${API}/jobs/failed`).set("Authorization", `Bearer ${other.token}`)).body.items).toHaveLength(0);
    const id = mine.body.items[0].id as string;
    expect((await request(sa.app).post(`${API}/jobs/failed/${id}/retry`).set("Authorization", `Bearer ${other.token}`)).status).toBe(404);

    const retry = await request(sa.app).post(`${API}/jobs/failed/${id}/retry`).set(auth).expect(202);
    await sa.jobs.idle();
    expect(retry.body.retryJobId).toEqual(expect.any(String));
    await expectExactlyCounted(u.orgId, 3);
    expect((await request(sa.app).post(`${API}/jobs/failed/${id}/retry`).set(auth)).status).toBe(409);
    expect(await AuditLog.countDocuments({ orgId: oid(u.orgId), action: "job.retry" })).toBe(1);
    const after = await request(sa.app).get(`${API}/jobs/status`).set(auth).expect(200);
    expect(after.body.failedNotRetried).toBe(0);
  });
});
