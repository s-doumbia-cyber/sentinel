import request from "supertest";
import { describe, expect, it } from "vitest";
import { Flow } from "../src/models/tenant.js";
import { parseTimestamp } from "../src/modules/datasets/csv.parsing.js";
import { API, CICIDS_HEADER, FakeMl, addMember, buildApp, oid, registerUser, writeCsv } from "./helpers.js";

const ml = new FakeMl();
const sa = buildApp({ ml });

async function importCsv(token: string, file: string) {
  const res = await request(sa.app).post(`${API}/imports/csv`).set("Authorization", `Bearer ${token}`).attach("file", file);
  await sa.jobs.idle();
  return res;
}

describe("CSV import", () => {
  it("stores dataset labels as ground truth only, never as a verdict", async () => {
    const u = await registerUser(sa);
    const file = writeCsv([
      { label: "DDoS", features: { "Flow Packets/s": "5000" } },
      { label: "BENIGN" },
      { label: "Web Attack � XSS" },
    ]);
    const res = await importCsv(u.token, file);
    expect(res.status).toBe(202);
    expect(res.body.status).toBe("Processing");

    const flows = await Flow.find({ orgId: oid(u.orgId) }).lean();
    expect(flows).toHaveLength(3);
    for (const f of flows) {
      expect(f.scoreStatus).toBe("pending"); // no active model yet
      expect(f.scored).toBeNull();
      expect(f.sourceKind).toBe("IMPORTED");
      expect(f.featureSchema).toBe("cicids2017-v1");
    }
    expect(flows.map((f) => f.groundTruthLabel).sort()).toEqual(["DDoS", "Normal", "XSS"]);

    const ds = await request(sa.app).get(`${API}/datasets/${res.body.id}`).set("Authorization", `Bearer ${u.token}`);
    expect(ds.body.status).toBe("Processed");
    expect(ds.body.rowsInserted).toBe(3);
    expect(ds.body.groundTruthCounts).toEqual({ DDoS: 1, Normal: 1, XSS: 1 });
    expect(ds.body.fileSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("keeps unknown-label rows unlabelled and reports them, and rejects invalid rows without placeholders", async () => {
    const u = await registerUser(sa);
    const file = writeCsv([
      { label: "Totally New Attack" },
      { label: "BENIGN", srcIp: "not-an-ip" },
      { label: "BENIGN", timestamp: "yesterday" },
      { label: "BENIGN", features: { "Flow Bytes/s": "Infinity" } },
    ]);
    const res = await importCsv(u.token, file);
    const ds = await request(sa.app).get(`${API}/datasets/${res.body.id}`).set("Authorization", `Bearer ${u.token}`);
    expect(ds.body.rowsRead).toBe(4);
    expect(ds.body.rowsInserted).toBe(2);
    expect(ds.body.skipped.invalidRow).toBe(2);
    expect(ds.body.unknownLabelRows).toBe(1);
    expect(ds.body.unknownLabels).toEqual(["Totally New Attack"]);
    expect(ds.body.invalidSamples).toHaveLength(2);

    const flows = await Flow.find({ orgId: oid(u.orgId) }).lean();
    expect(flows.some((f) => f.sourceIp === "0.0.0.0")).toBe(false);
    const unknown = flows.find((f) => f.rawLabel === "Totally New Attack");
    expect(unknown?.groundTruthLabel).toBeNull();
    const inf = flows.find((f) => f.rawLabel === "BENIGN");
    const features = inf?.features instanceof Map ? Object.fromEntries(inf.features) : inf?.features;
    expect(features?.["Flow Bytes/s"]).toBeNull();
  });

  it("matches headers with the leading spaces of the original CICIDS2017 files", async () => {
    const u = await registerUser(sa);
    const spaced = CICIDS_HEADER.map((h, i) => (i === 0 ? h : ` ${h}`));
    const res = await importCsv(u.token, writeCsv([{ label: "PortScan" }], spaced));
    expect(res.status).toBe(202);
    const flow = await Flow.findOne({ orgId: oid(u.orgId) }).lean();
    expect(flow?.groundTruthLabel).toBe("PortScan");
    expect(flow?.sourceIp).toBe("10.0.0.1");
  });

  it("rejects a CSV without the CICIDS2017 feature columns with the precise missing columns", async () => {
    const u = await registerUser(sa);
    const file = writeCsv([{}], ["Source IP", "Destination IP", "Label"]);
    const res = await request(sa.app).post(`${API}/imports/csv`).set("Authorization", `Bearer ${u.token}`).attach("file", file);
    expect(res.status).toBe(422);
    expect(res.body.error.details.some((d: { message: string }) => d.message.includes("Flow Duration"))).toBe(true);
  });

  it("rejects non-CSV uploads and Viewers", async () => {
    const u = await registerUser(sa);
    const txt = await request(sa.app)
      .post(`${API}/imports/csv`)
      .set("Authorization", `Bearer ${u.token}`)
      .attach("file", Buffer.from("hello"), "notes.txt");
    expect(txt.status).toBe(415);
    const viewer = await addMember(u.orgId, "Viewer");
    const res = await request(sa.app).post(`${API}/imports/csv`).set("Authorization", `Bearer ${viewer.token}`).attach("file", writeCsv([{}]));
    expect(res.status).toBe(403);
  });

  it("parses CICIDS2017 timestamps as day/month/year", () => {
    expect(parseTimestamp("4/7/2017 8:53")?.toISOString()).toBe("2017-07-04T08:53:00.000Z");
    expect(parseTimestamp("03/07/2017 08:55:58")?.toISOString()).toBe("2017-07-03T08:55:58.000Z");
    expect(parseTimestamp("31/02/2017 10:00")).toBeNull();
    expect(parseTimestamp("garbage")).toBeNull();
  });
});

describe("scoring", () => {
  it("leaves flows pending without an active model, then scores them with the model's verdict", async () => {
    const u = await registerUser(sa);
    const auth = { Authorization: `Bearer ${u.token}` };
    // Labels deliberately disagree with the features: the verdict must follow the model, not the label.
    await importCsv(u.token, writeCsv([
      { label: "BENIGN", features: { "Flow Packets/s": "5000" } },
      { label: "DDoS", features: { "Flow Packets/s": "10" } },
      { label: "PortScan", features: { "Flow Duration": "7" } },
    ]));
    const status = await request(sa.app).get(`${API}/scoring/status`).set(auth);
    expect(status.body.schemas[0]).toMatchObject({ schema: "cicids2017-v1", activeModel: null, pending: 3, scored: 0 });

    await request(sa.app).post(`${API}/models/bench-a/activate`).set(auth).expect(200);
    await sa.jobs.idle();

    const flows = await Flow.find({ orgId: oid(u.orgId) }).lean();
    const byLabel = new Map(flows.map((f) => [f.groundTruthLabel, f]));
    expect(byLabel.get("Normal")?.scored?.label).toBe("DDoS");
    expect(byLabel.get("Normal")?.scored?.severity).toBe("critical");
    expect(byLabel.get("DDoS")?.scored?.label).toBe("Normal");
    expect(byLabel.get("PortScan")?.scored?.needsReview).toBe(true);
    for (const f of flows) expect(f.scored?.modelVersion).toBe("bench-a");
  });

  it("is idempotent and a newly activated model scores only the next batch", async () => {
    const u = await registerUser(sa);
    const auth = { Authorization: `Bearer ${u.token}` };
    await request(sa.app).post(`${API}/models/bench-a/activate`).set(auth).expect(200);
    await importCsv(u.token, writeCsv([{ label: "BENIGN" }]));
    await request(sa.app).post(`${API}/scoring/run`).set(auth).expect(202);
    await sa.jobs.idle();
    expect(await Flow.countDocuments({ orgId: oid(u.orgId), "scored.modelVersion": "bench-a" })).toBe(1);

    await request(sa.app).post(`${API}/models/bench-b/activate`).set(auth).expect(200);
    await importCsv(u.token, writeCsv([{ label: "BENIGN" }]));
    await sa.jobs.idle();
    const versions = (await Flow.find({ orgId: oid(u.orgId) }).lean()).map((f) => f.scored?.modelVersion).sort();
    expect(versions).toEqual(["bench-a", "bench-b"]);
  });

  it("never maps an unknown class from the model to a known one", async () => {
    const u = await registerUser(sa);
    await request(sa.app).post(`${API}/models/bench-a/activate`).set("Authorization", `Bearer ${u.token}`);
    await importCsv(u.token, writeCsv([{ label: "BENIGN", features: { "Flow Duration": "13" } }]));
    const f = await Flow.findOne({ orgId: oid(u.orgId) }).lean();
    expect(f?.scoreStatus).toBe("error");
    expect(f?.scored).toBeNull();
    expect(f?.scoreError).toMatch(/unknown class Alien/);
  });

  it("keeps flows pending when the ML service is down, and records contract errors on the flows", async () => {
    const u = await registerUser(sa);
    const auth = { Authorization: `Bearer ${u.token}` };
    ml.fail = "unavailable";
    try {
      await request(sa.app).post(`${API}/models/bench-a/activate`).set(auth);
      await importCsv(u.token, writeCsv([{ label: "BENIGN" }]));
      expect((await Flow.findOne({ orgId: oid(u.orgId) }).lean())?.scoreStatus).toBe("pending");
      ml.fail = "contract";
      await request(sa.app).post(`${API}/scoring/run`).set(auth);
      await sa.jobs.idle();
      const f = await Flow.findOne({ orgId: oid(u.orgId) }).lean();
      expect(f?.scoreStatus).toBe("error");
      expect(f?.scoreError).toMatch(/Missing feature/);
    } finally {
      ml.fail = "none";
    }
  });
});

describe("stats", () => {
  it("counts malicious traffic from verdicts, and evaluates verdicts against ground truth", async () => {
    const u = await registerUser(sa);
    const auth = { Authorization: `Bearer ${u.token}` };
    await request(sa.app).post(`${API}/models/bench-a/activate`).set(auth);
    await importCsv(u.token, writeCsv([
      { label: "DDoS", features: { "Flow Packets/s": "5000" } }, // TP DDoS
      { label: "DDoS", features: { "Flow Packets/s": "5000" } }, // TP DDoS
      { label: "DDoS", features: { "Flow Packets/s": "1" } }, // FN → Normal
      { label: "BENIGN", features: { "Flow Packets/s": "1" } }, // TN
      { label: "BENIGN", features: { "Flow Packets/s": "5000" } }, // FP → DDoS
    ]));

    const overview = await request(sa.app).get(`${API}/stats/overview`).set(auth);
    expect(overview.body).toMatchObject({ totalFlows: 5, scoredFlows: 5, pendingFlows: 0, maliciousFlows: 3 });

    const gt = await request(sa.app).get(`${API}/stats/breakdown?by=groundTruth`).set(auth);
    expect(gt.body.items).toEqual(expect.arrayContaining([{ key: "DDoS", count: 3 }, { key: "Normal", count: 2 }]));

    const ev = await request(sa.app).get(`${API}/stats/evaluation`).set(auth);
    const ddos = ev.body.perClass.find((c: { label: string }) => c.label === "DDoS");
    const normal = ev.body.perClass.find((c: { label: string }) => c.label === "Normal");
    expect(ddos).toMatchObject({ support: 3, predicted: 3, unstable: true });
    expect(ddos.precision).toBeCloseTo(2 / 3);
    expect(ddos.recall).toBeCloseTo(2 / 3);
    expect(normal.precision).toBeCloseTo(1 / 2);
    expect(normal.recall).toBeCloseTo(1 / 2);
    expect(ev.body.macroF1).toBeCloseTo((2 / 3 + 1 / 2) / 2);
    expect(ev.body.evaluatedFlows).toBe(5);

    const top = await request(sa.app).get(`${API}/stats/top?kind=subnets`).set(auth);
    expect(top.body.items[0]).toMatchObject({ key: "10.0.0.0/24", count: 3 });

    const series = await request(sa.app).get(`${API}/stats/timeseries`).set(auth);
    expect(series.body.buckets.reduce((a: number, b: { total: number }) => a + b.total, 0)).toBe(5);
  });

  it("pages flows with a cursor and filters by verdict", async () => {
    const u = await registerUser(sa);
    const auth = { Authorization: `Bearer ${u.token}` };
    await request(sa.app).post(`${API}/models/bench-a/activate`).set(auth);
    const rows = Array.from({ length: 7 }, (_, i) => ({
      label: "BENIGN",
      timestamp: `7/7/2017 3:${String(10 + i).padStart(2, "0")}`,
      features: { "Flow Packets/s": i < 2 ? "5000" : "1" },
    }));
    await importCsv(u.token, writeCsv(rows));
    const first = await request(sa.app).get(`${API}/flows?limit=5`).set(auth);
    expect(first.body.items).toHaveLength(5);
    expect(first.body.nextCursor).toEqual(expect.any(String));
    const second = await request(sa.app).get(`${API}/flows?limit=5&cursor=${first.body.nextCursor}`).set(auth);
    expect(second.body.items).toHaveLength(2);
    expect(second.body.nextCursor).toBeNull();
    const ids = new Set([...first.body.items, ...second.body.items].map((f: { id: string }) => f.id));
    expect(ids.size).toBe(7);
    expect((await request(sa.app).get(`${API}/flows?verdict=unscored`).set(auth)).body.items).toHaveLength(0);
    expect((await request(sa.app).get(`${API}/flows?verdict=error`).set(auth)).body.items).toHaveLength(0);
    expect((await request(sa.app).get(`${API}/flows?needsReview=true`).set(auth)).body.items).toHaveLength(0);
    const malicious = await request(sa.app).get(`${API}/flows?verdict=malicious`).set(auth);
    expect(malicious.body.items).toHaveLength(2);
    expect(malicious.body.items[0].groundTruthLabel).toBe("Normal");
    expect(malicious.body.items[0].scored.label).toBe("DDoS");
  });
});
