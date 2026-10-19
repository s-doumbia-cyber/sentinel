import request from "supertest";
import { describe, expect, it } from "vitest";
import { Alert, AuditLog } from "../src/models/tenant.js";
import { API, FakeMl, addMember, buildApp, oid, registerUser, writeCsv, type CsvRow } from "./helpers.js";

const sa = buildApp({ ml: new FakeMl() });

async function importRows(token: string, rows: CsvRow[]) {
  const res = await request(sa.app).post(`${API}/imports/csv`).set("Authorization", `Bearer ${token}`).attach("file", writeCsv(rows));
  expect(res.status).toBe(202);
  await sa.jobs.idle();
  return res.body.id as string;
}

async function setup(withModel = true) {
  const u = await registerUser(sa);
  const auth = { Authorization: `Bearer ${u.token}` };
  if (withModel) await request(sa.app).post(`${API}/models/bench-a/activate`).set(auth).expect(200);
  await sa.jobs.idle();
  return { u, auth };
}

const ddos = (n: number, src = "172.16.0.1"): CsvRow[] =>
  Array.from({ length: n }, () => ({ label: "DDoS", srcIp: src, dstIp: "192.168.10.50", features: { "Flow Packets/s": "5000" } }));

/** A port scan as CICFlowMeter records it: tiny flows to many ports from one source within a minute. */
const portScan = (ports: number, src = "10.9.9.9"): CsvRow[] =>
  Array.from({ length: ports }, (_, i) => ({
    label: "PortScan",
    srcIp: src,
    dstIp: "192.168.10.50",
    raw: { "Destination Port": String(1000 + i), "Total Fwd Packets": "1", "Total Backward Packets": "1" },
  }));

async function alerts(auth: Record<string, string>, query = "") {
  return (await request(sa.app).get(`${API}/alerts${query}`).set(auth)).body.items as Array<Record<string, unknown>>;
}

describe("alerts from the model", () => {
  it("a labelled attack sample produces the expected alert", async () => {
    const { auth } = await setup();
    await importRows(auth.Authorization.slice(7), ddos(12));
    const items = await alerts(auth);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      type: "DDoS",
      severity: "critical",
      status: "open",
      srcIp: "172.16.0.1",
      dstIp: "192.168.10.50",
      dstPort: 80,
      count: 12,
      sources: ["model:bench-a"],
      maxConfidence: 0.95,
    });
    expect((items[0]?.mitre as { techniqueId: string }).techniqueId).toBe("T1498");
  });

  it("a benign sample produces no alert", async () => {
    const { auth } = await setup();
    await importRows(auth.Authorization.slice(7), Array.from({ length: 30 }, () => ({ label: "BENIGN" })));
    expect(await alerts(auth)).toHaveLength(0);
  });

  it("a duplicate burst becomes one alert with a count, and re-running detections does not double-count", async () => {
    const { auth } = await setup();
    await importRows(auth.Authorization.slice(7), ddos(25));
    await request(sa.app).post(`${API}/detections/run`).set(auth).send({}).expect(202);
    await sa.jobs.idle();
    const items = await alerts(auth);
    expect(items).toHaveLength(1);
    expect(items[0]?.count).toBe(25);
  });

  it("separates different attackers and keeps low-confidence verdicts in needs_review", async () => {
    const { auth } = await setup();
    await importRows(auth.Authorization.slice(7), [
      ...ddos(3, "172.16.0.1"),
      ...ddos(2, "172.16.0.2"),
      { label: "PortScan", srcIp: "10.1.1.1", features: { "Flow Duration": "7" } },
    ]);
    const items = await alerts(auth);
    expect(items).toHaveLength(3);
    const low = items.find((a) => a.type === "PortScan");
    expect(low).toMatchObject({ status: "needs_review", maxConfidence: 0.4 });
    expect((await alerts(auth, "?status=needs_review")).length).toBe(1);
  });

  it("does not alert while flows are unscored, and backfills once they are scored", async () => {
    const { auth } = await setup(false);
    await importRows(auth.Authorization.slice(7), ddos(4));
    expect(await alerts(auth)).toHaveLength(0);
    await request(sa.app).post(`${API}/models/bench-a/activate`).set(auth).expect(200);
    await sa.jobs.idle();
    expect((await alerts(auth))[0]).toMatchObject({ type: "DDoS", count: 4 });
  });

  it("serves the detail with the explanation and evidence flows", async () => {
    const { auth } = await setup();
    await importRows(auth.Authorization.slice(7), ddos(3));
    const [a] = await alerts(auth);
    const detail = (await request(sa.app).get(`${API}/alerts/${a?.id}`).set(auth)).body;
    expect(detail.evidence).toHaveLength(3);
    expect(detail.explanationFlow.scored.topFeatures[0].name).toBe("Flow Packets/s");
    expect(detail.explanationFlow.groundTruthLabel).toBe("DDoS");
    const summary = (await request(sa.app).get(`${API}/alerts/summary`).set(auth)).body;
    expect(summary).toMatchObject({ total: 1, byStatus: { open: 1 }, activeBySeverity: { critical: 1 } });
  });
});

describe("alerts from rules", () => {
  it("the port-scan starter rule fires without any model and is idempotent on re-run", async () => {
    const { auth } = await setup(false);
    await importRows(auth.Authorization.slice(7), portScan(120));
    let items = await alerts(auth);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: "PortScan", severity: "low", status: "open", srcIp: "10.9.9.9", dstIp: null, sources: ["rule:R-PORTSCAN-01"], ruleIds: ["R-PORTSCAN-01"], maxConfidence: null, count: 1 });
    await request(sa.app).post(`${API}/detections/run`).set(auth).send({}).expect(202);
    await sa.jobs.idle();
    items = await alerts(auth);
    expect(items).toHaveLength(1);
    expect(items[0]?.count).toBe(1);
    const detail = (await request(sa.app).get(`${API}/alerts/${items[0]?.id}`).set(auth)).body;
    expect(detail.rules[0]).toMatchObject({ key: "R-PORTSCAN-01", condition: { distinct: "destinationPort", gte: 100 } });
    expect(detail.ruleHits[0]).toMatchObject({ ruleKey: "R-PORTSCAN-01", value: 100 });
  });

  it("changing a rule threshold changes behaviour without a redeploy", async () => {
    const { auth } = await setup(false);
    const rules = (await request(sa.app).get(`${API}/rules`).set(auth)).body.items as Array<{ id: string; key: string; version: number }>;
    const scan = rules.find((r) => r.key === "R-PORTSCAN-01");
    const patched = await request(sa.app).patch(`${API}/rules/${scan?.id}`).set(auth).send({ condition: { distinct: "destinationPort", gte: 200 } });
    expect(patched.status).toBe(200);
    expect(patched.body.version).toBe(2);
    await importRows(auth.Authorization.slice(7), portScan(120));
    expect(await alerts(auth)).toHaveLength(0);
  });

  it("hybrid severity is the max of model and rule, and both sources are listed", async () => {
    const { auth } = await setup();
    const created = await request(sa.app)
      .post(`${API}/rules`)
      .set(auth)
      .send({ key: "R-TEST-BURST-01", name: "Test burst", type: "threshold", window: "60s", groupBy: ["sourceIp", "destinationIp"], condition: { gte: 5 }, severity: "medium", alertType: "DDoS" });
    expect(created.status).toBe(201);
    await importRows(auth.Authorization.slice(7), ddos(8));
    const items = await alerts(auth);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: "DDoS", severity: "critical", count: 9 });
    expect((items[0]?.sources as string[]).sort()).toEqual(["model:bench-a", "rule:R-TEST-BURST-01"]);
  });

  it("the rule test endpoint shows would-be hits and creates no alert, even for a disabled rule", async () => {
    const { auth } = await setup(false);
    const rules = (await request(sa.app).get(`${API}/rules`).set(auth)).body.items as Array<{ id: string; key: string }>;
    const scan = rules.find((r) => r.key === "R-PORTSCAN-01");
    await request(sa.app).patch(`${API}/rules/${scan?.id}`).set(auth).send({ enabled: false }).expect(200);
    const datasetId = await importRows(auth.Authorization.slice(7), portScan(150));
    expect(await alerts(auth)).toHaveLength(0);
    const test = await request(sa.app).post(`${API}/rules/${scan?.id}/test`).set(auth).send({ datasetId });
    expect(test.status).toBe(200);
    expect(test.body).toMatchObject({ rule: "R-PORTSCAN-01", flowsScanned: 150, hitCount: 1, truncated: false });
    expect(await Alert.countDocuments({ orgId: oid((await request(sa.app).get(`${API}/me`).set(auth)).body.activeOrg.id) })).toBe(0);
  });

  it("rejects invalid definitions, duplicate keys and deleting starter rules", async () => {
    const { auth } = await setup(false);
    const rules = (await request(sa.app).get(`${API}/rules`).set(auth)).body.items as Array<{ id: string; key: string; starter: boolean }>;
    expect(rules).toHaveLength(5);
    const starter = rules[0];
    expect((await request(sa.app).patch(`${API}/rules/${starter?.id}`).set(auth).send({ window: "3d" })).status).toBe(400);
    expect((await request(sa.app).delete(`${API}/rules/${starter?.id}`).set(auth)).status).toBe(409);
    const body = { key: "R-CUSTOM-01", name: "Custom", type: "threshold", window: "5m", groupBy: ["sourceIp"], condition: { gte: 3 }, severity: "low", alertType: "PortScan" };
    expect((await request(sa.app).post(`${API}/rules`).set(auth).send(body)).status).toBe(201);
    expect((await request(sa.app).post(`${API}/rules`).set(auth).send(body)).status).toBe(409);
    expect((await request(sa.app).post(`${API}/rules`).set(auth).send({ ...body, key: "R-X-02", alertType: "Normal" })).status).toBe(400);
    const custom = (await request(sa.app).get(`${API}/rules`).set(auth)).body.items.find((r: { key: string }) => r.key === "R-CUSTOM-01");
    expect((await request(sa.app).delete(`${API}/rules/${custom.id}`).set(auth)).status).toBe(204);
  });
});

describe("alert triage", () => {
  it("records status and verdict changes in the audit log; Viewers cannot triage; other orgs get 404", async () => {
    const { u, auth } = await setup();
    await importRows(u.token, ddos(2));
    const [a] = await alerts(auth);
    const res = await request(sa.app).patch(`${API}/alerts/${a?.id}`).set(auth).send({ status: "dismissed", verdict: "false_positive" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "dismissed", verdict: "false_positive" });
    const entry = await AuditLog.findOne({ orgId: oid(u.orgId), action: "alert.update" }).lean();
    expect(entry?.meta).toMatchObject({ changes: { status: { from: "open", to: "dismissed" }, verdict: { from: null, to: "false_positive" } } });

    // An analyst decision is not overwritten by later evidence.
    await importRows(u.token, ddos(2));
    expect((await alerts(auth))[0]).toMatchObject({ status: "dismissed", count: 4 });

    const viewer = await addMember(u.orgId, "Viewer");
    expect((await request(sa.app).patch(`${API}/alerts/${a?.id}`).set("Authorization", `Bearer ${viewer.token}`).send({ status: "open" })).status).toBe(403);
    expect((await request(sa.app).get(`${API}/alerts/${a?.id}`).set("Authorization", `Bearer ${viewer.token}`)).status).toBe(200);

    const other = await registerUser(sa);
    const otherAuth = { Authorization: `Bearer ${other.token}` };
    expect((await request(sa.app).get(`${API}/alerts/${a?.id}`).set(otherAuth)).status).toBe(404);
    expect((await request(sa.app).patch(`${API}/alerts/${a?.id}`).set(otherAuth).send({ status: "open" })).status).toBe(404);
    expect(await alerts(otherAuth)).toHaveLength(0);
  });

  it("audits rule changes with the before and after definitions", async () => {
    const { u, auth } = await setup(false);
    const [rule] = (await request(sa.app).get(`${API}/rules`).set(auth)).body.items as Array<{ id: string }>;
    await request(sa.app).patch(`${API}/rules/${rule?.id}`).set(auth).send({ enabled: false }).expect(200);
    const entry = await AuditLog.findOne({ orgId: oid(u.orgId), action: "rule.update" }).lean();
    expect(entry?.meta).toMatchObject({ before: { enabled: true }, after: { enabled: false } });
  });
});
