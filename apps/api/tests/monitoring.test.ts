import request from "supertest";
import { describe, expect, it } from "vitest";
import { AuditLog, DriftReport, Flow } from "../src/models/tenant.js";
import { computeDrift } from "../src/modules/monitoring/drift.service.js";
import { binCounts, binIndex, driftLevel, psi, PSI_SIGNIFICANT } from "../src/modules/monitoring/psi.js";
import type { ReferenceHistogram } from "../src/modules/models/ml.client.js";
import { API, FakeMl, addMember, buildApp, oid, registerUser, writeCsv, type CsvRow } from "./helpers.js";

/** Deterministic standard-normal samples (mulberry32 + Box-Muller), so the shift test never flakes. */
function normals(n: number, mean: number, seed: number): number[] {
  let a = seed;
  const uniform = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Array.from({ length: n }, () => mean + Math.sqrt(-2 * Math.log(uniform() || 1e-12)) * Math.cos(2 * Math.PI * uniform()));
}

// Decile edges of N(0, 1): each of the ten reference bins holds 10 % of the training rows.
const DECILE_EDGES = [-1.2816, -0.8416, -0.5244, -0.2533, 0, 0.2533, 0.5244, 0.8416, 1.2816];
const UNIFORM_REF = new Array<number>(10).fill(0.1);

describe("PSI", () => {
  it("bins like numpy searchsorted(side=left): (edges[i-1], edges[i]], open at both ends", () => {
    const edges = [1, 2, 3];
    expect([0, 1, 1.5, 2, 3, 3.0001, 1e9].map((v) => binIndex(v, edges))).toEqual([0, 0, 1, 1, 2, 3, 3]);
    expect(binCounts([0.5, 1, 2.5, null, undefined, Number.NaN, Number.POSITIVE_INFINITY], edges)).toEqual([2, 0, 1, 0]);
  });

  it("is close to zero when recent data follows the training distribution", () => {
    const score = psi(UNIFORM_REF, binCounts(normals(5000, 0, 11), DECILE_EDGES)) as number;
    expect(score).toBeLessThan(0.02);
    expect(driftLevel(score)).toBe("stable");
  });

  it("flags a synthetic mean shift and grows with the size of the shift", () => {
    const small = psi(UNIFORM_REF, binCounts(normals(5000, 0.5, 12), DECILE_EDGES)) as number;
    const large = psi(UNIFORM_REF, binCounts(normals(5000, 1.5, 13), DECILE_EDGES)) as number;
    expect(small).toBeGreaterThan(0.1);
    expect(small).toBeLessThan(large);
    expect(large).toBeGreaterThan(PSI_SIGNIFICANT);
    expect(driftLevel(large)).toBe("significant");
  });

  it("is finite when a bin is empty and null when there is nothing to compare", () => {
    const score = psi(UNIFORM_REF, [1000, 0, 0, 0, 0, 0, 0, 0, 0, 0]) as number;
    expect(Number.isFinite(score)).toBe(true);
    expect(score).toBeGreaterThan(PSI_SIGNIFICANT);
    expect(psi(UNIFORM_REF, new Array<number>(10).fill(0))).toBeNull();
    expect(psi(UNIFORM_REF, [1, 2])).toBeNull();
  });
});

describe("computeDrift", () => {
  const reference: ReferenceHistogram = {
    schema: "cicids2017-v1",
    rows: 10_000,
    bins: 10,
    classProportions: { Normal: 0.5, DDoS: 0.5 },
    features: {
      "Flow Duration": { edges: DECILE_EDGES, proportions: UNIFORM_REF, missing: 0 },
      "Flow Packets/s": { edges: DECILE_EDGES, proportions: UNIFORM_REF, missing: 0 },
      "All Missing": { edges: [], proportions: [], missing: 1 },
    },
  };

  it("ranks features by PSI, counts the drifted ones and reports missing values and the predicted mix", () => {
    const stable = normals(2000, 0, 21);
    const shifted = normals(2000, 1.5, 22);
    const sample = stable.map((v, i) => ({ features: { "Flow Duration": v, "Flow Packets/s": i % 10 === 0 ? null : (shifted[i] as number) }, label: i % 4 === 0 ? "DDoS" : "Normal" }));
    const d = computeDrift(reference, sample);
    expect(d.features.map((f) => f.name)).toEqual(["Flow Packets/s", "Flow Duration"]);
    expect(d.features[0]).toMatchObject({ level: "significant", missingCurrent: 0.1, missingReference: 0 });
    expect(d.features[1]?.level).toBe("stable");
    expect(d).toMatchObject({ sampleSize: 2000, level: "significant", driftedFeatureCount: 1, predictedClassShare: { DDoS: 0.25, Normal: 0.75 } });
    // A feature with no reference bins is skipped, never scored.
    expect(d.features.some((f) => f.name === "All Missing")).toBe(false);
  });
});

// ---- API ------------------------------------------------------------------------------

const ml = new FakeMl();
const sa = buildApp({ ml });
const FEATURE = "Flow Packets/s";
// Training saw slow flows only: 90 % <= 1 packet/s, the rest spread below 1,000.
const REFERENCE: ReferenceHistogram = {
  schema: "cicids2017-v1",
  rows: 5000,
  bins: 4,
  classProportions: { Normal: 0.9, DDoS: 0.1 },
  features: { [FEATURE]: { edges: [1, 10, 1000], proportions: [0.9, 0.05, 0.04, 0.01], missing: 0 } },
};

/** 240 flows from three sources: mostly fast ones the reference never saw (DDoS verdicts), plus low-confidence PortScans. */
function traffic(): CsvRow[] {
  const rows: CsvRow[] = [];
  for (let i = 0; i < 200; i++) rows.push({ srcIp: `203.0.113.${1 + (i % 2)}`, dstIp: "10.0.0.80", raw: { [FEATURE]: "5000" } });
  for (let i = 0; i < 40; i++) rows.push({ srcIp: "198.51.100.4", dstIp: "10.0.0.80", raw: { "Flow Duration": "7", [FEATURE]: "0.5" } });
  return rows;
}

async function setup(rows: CsvRow[] = traffic()) {
  const u = await registerUser(sa);
  const auth = { Authorization: `Bearer ${u.token}` };
  await request(sa.app).post(`${API}/models/bench-a/activate`).set(auth).expect(200);
  await request(sa.app).post(`${API}/imports/csv`).set(auth).attach("file", writeCsv(rows)).expect(202);
  await sa.jobs.idle();
  return { u, auth };
}

describe("drift API", () => {
  it("computes PSI between the training reference and recently scored flows, stores the report and audits it", async () => {
    ml.reference = REFERENCE;
    const { u, auth } = await setup();
    const run = await request(sa.app).post(`${API}/models/bench-a/drift`).set(auth).send({});
    expect(run.status).toBe(201);
    expect(run.body).toMatchObject({ status: "ok", windowHours: 24, sampleSize: 240, level: "significant", driftedFeatureCount: 1 });
    expect(run.body.features[0]).toMatchObject({ name: FEATURE, level: "significant" });
    expect(run.body.predictedClassShare).toMatchObject({ DDoS: 0.8333, PortScan: 0.1667 });

    const read = (await request(sa.app).get(`${API}/models/bench-a/drift`).set(auth)).body;
    expect(read.latest).toMatchObject({ id: run.body.id, maxPsi: run.body.maxPsi, referenceRows: 5000, trainingClassShare: { Normal: 0.9, DDoS: 0.1 } });
    expect(read.history).toHaveLength(1);
    const audit = await AuditLog.findOne({ orgId: oid(u.orgId), action: "model.drift_check" }).lean();
    expect(audit?.meta).toMatchObject({ status: "ok", level: "significant", sampleSize: 240, windowHours: 24 });
    // Nothing is retrained or reactivated by a check.
    expect((await request(sa.app).get(`${API}/models`).set(auth)).body.active).toEqual({ "cicids2017-v1": "bench-a" });
  });

  it("makes no report from too few flows, honours the window, and never invents a reference", async () => {
    ml.reference = REFERENCE;
    const small = await setup([{ srcIp: "10.0.0.1", raw: { [FEATURE]: "5000" } }]);
    const few = await request(sa.app).post(`${API}/models/bench-a/drift`).set(small.auth).send({});
    expect(few.status).toBe(200);
    expect(few.body).toMatchObject({ status: "insufficient_data", sampleSize: 1, minimum: 200 });
    expect(await DriftReport.countDocuments({ orgId: oid(small.u.orgId) })).toBe(0);

    const { u, auth } = await setup();
    await Flow.updateMany({ orgId: oid(u.orgId) }, { $set: { "scored.scoredAt": new Date(Date.now() - 3 * 86_400_000) } });
    expect((await request(sa.app).post(`${API}/models/bench-a/drift`).set(auth).send({})).body.status).toBe("insufficient_data");
    expect((await request(sa.app).post(`${API}/models/bench-a/drift`).set(auth).send({ hours: 168 })).body.status).toBe("ok");

    ml.reference = null;
    const none = await request(sa.app).post(`${API}/models/bench-a/drift`).set(auth).send({});
    expect(none.status).toBe(409);
    expect(none.body.error.message).toMatch(/no reference distribution/);
    expect((await request(sa.app).post(`${API}/models/nope/drift`).set(auth).send({})).status).toBe(404);
    expect((await request(sa.app).post(`${API}/models/bench-a/drift`).set(auth).send({ hours: 0 })).status).toBe(400);
    ml.reference = REFERENCE;
  });

  it("lets every role read reports, only writers run a check, and keeps organisations apart", async () => {
    ml.reference = REFERENCE;
    const { u, auth } = await setup();
    await request(sa.app).post(`${API}/models/bench-a/drift`).set(auth).send({}).expect(201);
    const viewer = await addMember(u.orgId, "Viewer");
    const v = { Authorization: `Bearer ${viewer.token}` };
    expect((await request(sa.app).get(`${API}/models/bench-a/drift`).set(v)).body.latest).not.toBeNull();
    expect((await request(sa.app).post(`${API}/models/bench-a/drift`).set(v).send({})).status).toBe(403);
    const other = await registerUser(sa);
    expect((await request(sa.app).get(`${API}/models/bench-a/drift`).set("Authorization", `Bearer ${other.token}`)).body).toEqual({ latest: null, history: [] });
  });
});

describe("analyst feedback per model version", () => {
  it("aggregates analyst verdicts on alerts the model contributed to, without calling it precision", async () => {
    ml.reference = REFERENCE;
    const { u, auth } = await setup();
    const alerts = (await request(sa.app).get(`${API}/alerts?limit=50`).set(auth)).body.items as { id: string; type: string; srcIp: string }[];
    const ddos = alerts.filter((a) => a.type === "DDoS");
    expect(ddos).toHaveLength(2);
    await request(sa.app).patch(`${API}/alerts/${ddos[0]?.id}`).set(auth).send({ verdict: "true_positive" }).expect(200);
    await request(sa.app).patch(`${API}/alerts/${ddos[1]?.id}`).set(auth).send({ verdict: "false_positive" }).expect(200);

    const fb = (await request(sa.app).get(`${API}/models/bench-a/feedback`).set(auth)).body;
    expect(fb.totals).toEqual({ alerts: 3, reviewed: 2, truePositive: 1, falsePositive: 1, benign: 0, unreviewed: 1, withRuleEvidence: 0 });
    expect(fb.confirmedShareOfReviewed).toBe(0.5);
    expect(fb.byType).toEqual([
      { type: "DDoS", truePositive: 1, falsePositive: 1, benign: 0, unreviewed: 0 },
      { type: "PortScan", truePositive: 0, falsePositive: 0, benign: 0, unreviewed: 1 },
    ]);

    // Another model version has no feedback yet; another org never sees these numbers.
    expect((await request(sa.app).get(`${API}/models/bench-b/feedback`).set(auth)).body.totals.alerts).toBe(0);
    expect((await request(sa.app).get(`${API}/models/bench-b/feedback`).set(auth)).body.confirmedShareOfReviewed).toBeNull();
    const other = await registerUser(sa);
    expect((await request(sa.app).get(`${API}/models/bench-a/feedback`).set("Authorization", `Bearer ${other.token}`)).body.totals.alerts).toBe(0);
    expect(u.orgId).not.toBe(other.orgId);
  });
});
