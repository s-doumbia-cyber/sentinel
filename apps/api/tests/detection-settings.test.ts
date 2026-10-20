import request from "supertest";
import { describe, expect, it } from "vitest";
import { STARTER_RULE_UPGRADES, STARTER_RULES, ruleDefinitionSchema } from "@sentinel/shared";
import { AuditLog, Alert, Flow, Rule } from "../src/models/tenant.js";
import { API, FakeMl, addMember, buildApp, oid, registerUser, writeCsv, type CsvRow } from "./helpers.js";

const sa = buildApp({ ml: new FakeMl() });

// FakeMl: Flow Packets/s > 1000 → DDoS at 0.95; Flow Duration 7 → PortScan at 0.4.
const ddos = (src: string): CsvRow[] => Array.from({ length: 3 }, () => ({ srcIp: src, dstIp: "10.0.0.80", raw: { "Flow Packets/s": "5000" } }));
const weakScan = (src: string): CsvRow[] => Array.from({ length: 3 }, () => ({ srcIp: src, dstIp: "10.0.0.80", raw: { "Flow Duration": "7" } }));
const portScan = (src: string): CsvRow[] =>
  Array.from({ length: 120 }, (_, i) => ({ srcIp: src, dstIp: "10.0.0.80", raw: { "Destination Port": String(1000 + i), "Total Fwd Packets": "1", "Total Backward Packets": "1" } }));

async function setup() {
  const u = await registerUser(sa);
  const auth = { Authorization: `Bearer ${u.token}` };
  await request(sa.app).post(`${API}/models/bench-a/activate`).set(auth).expect(200);
  return { u, auth };
}

async function importRows(auth: Record<string, string>, rows: CsvRow[]) {
  await request(sa.app).post(`${API}/imports/csv`).set(auth).attach("file", writeCsv(rows)).expect(202);
  await sa.jobs.idle();
}

describe("detection settings", () => {
  it("are readable by every role, editable by Owners/Admins only, validated and audited", async () => {
    const { u, auth } = await setup();
    const initial = (await request(sa.app).get(`${API}/detection/settings`).set(auth)).body;
    expect(initial).toEqual({ modelAlertMinConfidence: 0, needsReviewThreshold: 0.6, allowlist: [], suppressedVerdicts: { belowMinConfidence: 0, allowlisted: 0 } });

    const viewer = await addMember(u.orgId, "Viewer");
    expect((await request(sa.app).get(`${API}/detection/settings`).set("Authorization", `Bearer ${viewer.token}`)).status).toBe(200);
    const analyst = await addMember(u.orgId, "Analyst");
    expect((await request(sa.app).patch(`${API}/detection/settings`).set("Authorization", `Bearer ${analyst.token}`).send({ modelAlertMinConfidence: 0.5 })).status).toBe(403);

    for (const bad of [{ allowlist: [{ cidr: "10.0.0.5/24", note: "x" }] }, { allowlist: [{ cidr: "cdn.example.com", note: "x" }] }, { allowlist: [{ cidr: "10.0.0.0/8", note: "" }] }, { modelAlertMinConfidence: 1.5 }, {}]) {
      expect((await request(sa.app).patch(`${API}/detection/settings`).set(auth).send(bad)).status, JSON.stringify(bad)).toBe(400);
    }

    const res = await request(sa.app)
      .patch(`${API}/detection/settings`)
      .set(auth)
      .send({ modelAlertMinConfidence: 0.5, allowlist: [{ cidr: "172.217.0.0/16", note: "Google front ends" }, { cidr: " 172.217.0.0/16 ", note: "duplicate" }, { cidr: "72.21.91.29", note: "CDN" }] });
    expect(res.status).toBe(200);
    expect(res.body.modelAlertMinConfidence).toBe(0.5);
    expect(res.body.allowlist.map((e: { cidr: string }) => e.cidr)).toEqual(["172.217.0.0/16", "72.21.91.29/32"]);
    expect(res.body.allowlist[0]).toMatchObject({ note: "Google front ends", addedBy: "Test User" });

    // Editing a note keeps who added the entry and when.
    const addedAt = res.body.allowlist[0].addedAt;
    const edited = (await request(sa.app).patch(`${API}/detection/settings`).set(auth).send({ allowlist: [{ cidr: "172.217.0.0/16", note: "Google (checked)" }] })).body;
    expect(edited.allowlist).toEqual([{ cidr: "172.217.0.0/16", note: "Google (checked)", addedBy: "Test User", addedAt }]);
    expect(edited.modelAlertMinConfidence).toBe(0.5);

    const audit = await AuditLog.find({ orgId: oid(u.orgId), action: "detection.settings_update" }).sort({ ts: 1 }).lean();
    expect(audit).toHaveLength(2);
    expect(audit[0]?.meta).toMatchObject({ before: { modelAlertMinConfidence: 0, allowlist: [] }, after: { modelAlertMinConfidence: 0.5, allowlist: ["172.217.0.0/16", "72.21.91.29/32"] } });
  });

  it("keeps low-confidence model verdicts out of alerts, without losing them or reprocessing them", async () => {
    const { u, auth } = await setup();
    await request(sa.app).patch(`${API}/detection/settings`).set(auth).send({ modelAlertMinConfidence: 0.5 }).expect(200);
    await importRows(auth, [...ddos("203.0.113.7"), ...weakScan("198.51.100.4")]);

    const alerts = (await request(sa.app).get(`${API}/alerts`).set(auth)).body.items as { type: string }[];
    expect(alerts.map((a) => a.type)).toEqual(["DDoS"]);
    // The verdicts stay on the flows, marked with the reason.
    const weak = await Flow.find({ orgId: oid(u.orgId), sourceIp: "198.51.100.4" }).lean();
    expect(weak.every((f) => f.scored?.label === "PortScan" && f.alertSuppressed === "below_min_confidence" && f.alertedAt)).toBe(true);

    // Re-running detections (which backfills unalerted verdicts) neither alerts nor loops on them.
    await request(sa.app).post(`${API}/detections/run`).set(auth).send({}).expect(202);
    await sa.jobs.idle();
    expect(await Alert.countDocuments({ orgId: oid(u.orgId), type: "PortScan" })).toBe(0);
    expect((await request(sa.app).get(`${API}/detection/settings`).set(auth)).body.suppressedVerdicts).toEqual({ belowMinConfidence: 3, allowlisted: 0 });
  });

  it("raises no model or rule alert for allowlisted addresses, and still alerts on the rest", async () => {
    const { u, auth } = await setup();
    await request(sa.app).patch(`${API}/detection/settings`).set(auth).send({ allowlist: [{ cidr: "203.0.113.0/24", note: "Our vulnerability scanner" }] }).expect(200);
    await importRows(auth, [...ddos("203.0.113.7"), ...portScan("203.0.113.9"), ...portScan("10.9.9.9")]);

    const alerts = (await request(sa.app).get(`${API}/alerts`).set(auth)).body.items as { type: string; srcIp: string }[];
    expect(alerts.map((a) => `${a.type}:${a.srcIp}`)).toEqual(["PortScan:10.9.9.9"]);
    expect(await Flow.countDocuments({ orgId: oid(u.orgId), alertSuppressed: "allowlisted" })).toBe(3);
  });
});

describe("starter rule upgrades", () => {
  const up = STARTER_RULE_UPGRADES.find((x) => x.key === "R-SLOWHTTP-01")!;
  const latest = ruleDefinitionSchema.parse(STARTER_RULES.find((r) => r.key === "R-SLOWHTTP-01"));

  it("moves an unedited rule from the old default to the new one, keeps its enabled state, and audits why", async () => {
    const { u, auth } = await setup();
    await request(sa.app).get(`${API}/rules`).set(auth).expect(200);
    // Simulate an org seeded before the revision, with the rule switched off by an analyst.
    await Rule.updateOne({ orgId: oid(u.orgId), key: up.key }, { $set: { definition: { ...ruleDefinitionSchema.parse(up.from), enabled: false }, enabled: false } });

    await request(sa.app).post(`${API}/detections/run`).set(auth).send({}).expect(202);
    await sa.jobs.idle();
    const rule = await Rule.findOne({ orgId: oid(u.orgId), key: up.key }).lean();
    expect(rule?.version).toBe(2);
    expect(rule?.enabled).toBe(false);
    expect(rule?.definition).toMatchObject({ filter: latest.filter, description: latest.description });
    const audit = await AuditLog.findOne({ orgId: oid(u.orgId), action: "rule.upgrade" }).lean();
    expect(audit).toMatchObject({ actorId: null, meta: { key: up.key, fromVersion: 1, toVersion: 2 } });
    expect((audit?.meta as { reason: string }).reason).toMatch(/161 times/);

    // Running again changes nothing.
    await request(sa.app).post(`${API}/detections/run`).set(auth).send({}).expect(202);
    await sa.jobs.idle();
    expect((await Rule.findOne({ orgId: oid(u.orgId), key: up.key }).lean())?.version).toBe(2);
  });

  it("never touches a rule an analyst customised", async () => {
    const { u, auth } = await setup();
    await request(sa.app).get(`${API}/rules`).set(auth).expect(200);
    const custom = { ...ruleDefinitionSchema.parse(up.from), condition: { gte: 40 } };
    await Rule.updateOne({ orgId: oid(u.orgId), key: up.key }, { $set: { definition: custom } });
    await request(sa.app).post(`${API}/detections/run`).set(auth).send({}).expect(202);
    await sa.jobs.idle();
    const rule = await Rule.findOne({ orgId: oid(u.orgId), key: up.key }).lean();
    expect(rule?.version).toBe(1);
    expect(rule?.definition).toMatchObject({ condition: { gte: 40 } });
    expect(await AuditLog.countDocuments({ orgId: oid(u.orgId), action: "rule.upgrade" })).toBe(0);
  });
});
