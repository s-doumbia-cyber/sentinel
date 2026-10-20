import request from "supertest";
import { describe, expect, it } from "vitest";
import { AuditLog, Flow } from "../src/models/tenant.js";
import { ValidationRun } from "../src/models/validation.js";
import { API, FakeMl, addMember, buildApp, oid, registerUser, writeCsv, type CsvRow } from "./helpers.js";

const sa = buildApp({ ml: new FakeMl() });

async function setup(rows: CsvRow[]) {
  const u = await registerUser(sa);
  const auth = { Authorization: `Bearer ${u.token}` };
  const imp = await request(sa.app).post(`${API}/imports/csv`).set(auth).attach("file", writeCsv(rows));
  await sa.jobs.idle();
  return { u, auth, datasetId: imp.body.id as string };
}

describe("model validation runs", () => {
  it("re-scores a labelled dataset without touching stored verdicts and keeps FP/FN samples with explanations", async () => {
    // FakeMl: Flow Packets/s > 1000 → DDoS, otherwise Normal. No model is activated.
    const { u, auth, datasetId } = await setup([
      { label: "DDoS", features: { "Flow Packets/s": "5000" } },
      { label: "DDoS", features: { "Flow Packets/s": "5000" } },
      { label: "DDoS", features: { "Flow Packets/s": "1" } },
      { label: "BENIGN", features: { "Flow Packets/s": "5000" } },
      { label: "BENIGN", features: { "Flow Packets/s": "1" } },
      { label: "Something Unknown", features: { "Flow Packets/s": "1" } },
    ]);
    const res = await request(sa.app).post(`${API}/validation/runs`).set(auth).send({ kind: "model", modelVersion: "bench-a", datasetId });
    expect(res.status).toBe(201);
    const run = res.body;
    expect(run).toMatchObject({ kind: "model", target: "bench-a", trainingOverlap: false, flowsScanned: 6, createdBy: "Test User" });
    expect(run.dataset.sha256).toMatch(/^[a-f0-9]{64}$/);
    const ddos = run.metrics.perClass.find((c: { label: string }) => c.label === "DDoS");
    expect(ddos).toMatchObject({ support: 3, predicted: 3, unstable: true });
    expect(ddos.precision).toBeCloseTo(2 / 3);
    expect(ddos.recall).toBeCloseTo(2 / 3);
    expect(run.metrics.evaluated).toBe(5);
    expect(run.falsePositives).toHaveLength(1);
    expect(run.falsePositives[0]).toMatchObject({ truth: "Normal", predicted: "DDoS" });
    expect(run.falsePositives[0].topFeatures[0].name).toBe("Flow Packets/s");
    expect(run.falseNegatives[0]).toMatchObject({ truth: "DDoS", predicted: "Normal" });
    expect(run.notes.join(" ")).toMatch(/1 flows without a usable label were excluded/);
    expect(run.notes.join(" ")).toMatch(/not a guarantee/);
    expect(await Flow.countDocuments({ orgId: oid(u.orgId), scoreStatus: "scored" })).toBe(0);
    expect(await AuditLog.countDocuments({ orgId: oid(u.orgId), action: "validation.run" })).toBe(1);

    const list = (await request(sa.app).get(`${API}/validation/runs`).set(auth)).body.items;
    expect(list).toHaveLength(1);
    const again = (await request(sa.app).get(`${API}/validation/runs/${run.id}`).set(auth)).body;
    expect(again.metrics).toEqual(run.metrics);
    await expect(ValidationRun.updateMany({ orgId: oid(u.orgId) }, { $set: { target: "x" } })).rejects.toThrow(/immutable/);
  });

  it("rejects unknown models, unknown datasets and Viewers", async () => {
    const { u, auth, datasetId } = await setup([{ label: "BENIGN" }]);
    expect((await request(sa.app).post(`${API}/validation/runs`).set(auth).send({ kind: "model", modelVersion: "nope", datasetId })).status).toBe(404);
    expect((await request(sa.app).post(`${API}/validation/runs`).set(auth).send({ kind: "model", modelVersion: "bench-a", datasetId: "0123456789abcdef01234567" })).status).toBe(404);
    const viewer = await addMember(u.orgId, "Viewer");
    expect((await request(sa.app).post(`${API}/validation/runs`).set("Authorization", `Bearer ${viewer.token}`).send({ kind: "model", modelVersion: "bench-a", datasetId })).status).toBe(403);
    const other = await registerUser(sa);
    expect((await request(sa.app).post(`${API}/validation/runs`).set("Authorization", `Bearer ${other.token}`).send({ kind: "model", modelVersion: "bench-a", datasetId })).status).toBe(404);
  });
});

describe("rule validation runs", () => {
  it("scores a rule flow by flow against labels, with missed and wrongly flagged samples", async () => {
    const scan: CsvRow[] = Array.from({ length: 120 }, (_, i) => ({ label: "PortScan", srcIp: "10.9.9.9", timestamp: "7/7/2017 3:40", raw: { "Destination Port": String(1000 + i), "Total Fwd Packets": "1", "Total Backward Packets": "1" } }));
    const slowScan: CsvRow[] = Array.from({ length: 10 }, (_, i) => ({ label: "PortScan", srcIp: "10.7.7.7", timestamp: "7/7/2017 3:40", raw: { "Destination Port": String(2000 + i) } }));
    const benign: CsvRow[] = Array.from({ length: 5 }, () => ({ label: "BENIGN", srcIp: "10.9.9.9", timestamp: "7/7/2017 3:40", raw: { "Destination Port": "443", "Total Fwd Packets": "1", "Total Backward Packets": "1" } }));
    const { auth, datasetId } = await setup([...scan, ...slowScan, ...benign]);
    const rules = (await request(sa.app).get(`${API}/rules`).set(auth)).body.items as Array<{ id: string; key: string }>;
    const rule = rules.find((r) => r.key === "R-PORTSCAN-01");
    const run = (await request(sa.app).post(`${API}/validation/runs`).set(auth).send({ kind: "rule", ruleId: rule?.id, datasetId })).body;
    expect(run).toMatchObject({ kind: "rule", target: "R-PORTSCAN-01", targetVersion: 1, trainingOverlap: null, flowsScanned: 135 });
    const pos = run.metrics.perClass.find((c: { label: string }) => c.label === "PortScan");
    expect(pos).toMatchObject({ support: 130, predicted: 125 });
    expect(pos.precision).toBeCloseTo(120 / 125);
    expect(pos.recall).toBeCloseTo(120 / 130);
    // The benign flows from the scanner share its window: flagged, so false positives at flow level.
    expect(run.falsePositives).toHaveLength(5);
    expect(run.falseNegatives).toHaveLength(10);
    expect(run.falseNegatives[0]).toMatchObject({ truth: "PortScan", predicted: "not flagged" });
    expect(run.notes[0]).toMatch(/approximation/);
  });
});
