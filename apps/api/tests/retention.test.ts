import request from "supertest";
import { describe, expect, it } from "vitest";
import { Org } from "../src/models/identity.js";
import { Alert, AuditLog, Flow, Incident } from "../src/models/tenant.js";
import { API, addMember, buildApp, oid, registerUser } from "./helpers.js";

const sa = buildApp();
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000);

/** Raw inserts so `createdAt` / `updatedAt` can be set in the past (Mongoose would stamp "now"). */
async function seed(orgId: string) {
  const org = oid(orgId);
  const flow = (storedDaysAgo: number) => ({
    orgId: org,
    sourceKind: "IMPORTED",
    // Event time is years old on purpose: retention looks at storage time only.
    timestamp: new Date("2017-07-07T15:56:00Z"),
    sourceIp: "172.16.0.1",
    destinationIp: "192.168.10.50",
    sourcePort: 40000,
    destinationPort: 80,
    protocol: "TCP",
    featureSchema: "cicids2017-v1",
    scoreStatus: "pending",
    createdAt: daysAgo(storedDaysAgo),
    updatedAt: daysAgo(storedDaysAgo),
  });
  await Flow.collection.insertMany([flow(40), flow(40), flow(40), flow(5), flow(1)]);
  const incident = await Incident.create({ orgId: org, title: "Kept with its alerts", attackType: "DDoS", severity: "high" });
  const alert = (key: string, updatedDaysAgo: number, incidentId: unknown = null) => ({
    orgId: org,
    dedupeKey: key,
    type: "DDoS",
    severityRank: 4,
    status: "open",
    count: 1,
    firstSeen: daysAgo(updatedDaysAgo),
    lastSeen: daysAgo(updatedDaysAgo),
    incidentId,
    createdAt: daysAgo(updatedDaysAgo),
    updatedAt: daysAgo(updatedDaysAgo),
  });
  await Alert.collection.insertMany([alert("a", 60), alert("b", 45, incident._id), alert("c", 2)]);
}

describe("data retention", () => {
  it("is off by default, previews as a dry run, and only Owners set or run it", async () => {
    const owner = await registerUser(sa);
    const admin = await addMember(owner.orgId, "Admin");
    const analyst = await addMember(owner.orgId, "Analyst");
    await seed(owner.orgId);

    const initial = await request(sa.app).get(`${API}/retention`).set(bearer(owner.token)).expect(200);
    expect(initial.body).toMatchObject({ retentionDays: null, lastRun: null });
    expect((await request(sa.app).get(`${API}/retention/preview`).set(bearer(owner.token))).status).toBe(400);
    expect((await request(sa.app).post(`${API}/retention/run`).set(bearer(owner.token))).status).toBe(409);

    const preview = await request(sa.app).get(`${API}/retention/preview?days=30`).set(bearer(admin.token)).expect(200);
    expect(preview.body).toMatchObject({ dryRun: true, retentionDays: 30, flows: 3, alerts: 1, alertsKept: 1 });
    expect(await Flow.countDocuments({ orgId: oid(owner.orgId) })).toBe(5);
    expect((await request(sa.app).get(`${API}/retention/preview?days=30`).set(bearer(analyst.token))).status).toBe(403);

    expect((await request(sa.app).patch(`${API}/retention`).set(bearer(admin.token)).send({ retentionDays: 30 })).status).toBe(403);
    expect((await request(sa.app).patch(`${API}/retention`).set(bearer(owner.token)).send({ retentionDays: 0 })).status).toBe(400);
    await request(sa.app).patch(`${API}/retention`).set(bearer(owner.token)).send({ retentionDays: 30 }).expect(200);
    const update = await AuditLog.findOne({ orgId: oid(owner.orgId), action: "retention.settings_update" }).lean();
    expect(update?.meta).toEqual({ from: null, to: 30 });
  });

  it("purges flows and unlinked alerts older than the period, keeps incident evidence, audits, and is idempotent", async () => {
    const owner = await registerUser(sa);
    await seed(owner.orgId);
    await request(sa.app).patch(`${API}/retention`).set(bearer(owner.token)).send({ retentionDays: 30 }).expect(200);

    await request(sa.app).post(`${API}/retention/run`).set(bearer(owner.token)).expect(202);
    await sa.jobs.idle();
    expect(await Flow.countDocuments({ orgId: oid(owner.orgId) })).toBe(2);
    expect((await Alert.find({ orgId: oid(owner.orgId) }).lean()).map((a) => a.dedupeKey).sort()).toEqual(["b", "c"]);
    expect(await Incident.countDocuments({ orgId: oid(owner.orgId) })).toBe(1);

    const purge = await AuditLog.findOne({ orgId: oid(owner.orgId), action: "retention.purge" }).lean();
    expect(purge?.meta).toMatchObject({ retentionDays: 30, flowsDeleted: 3, alertsDeleted: 1, alertsKept: 1 });
    expect(purge?.actorId?.toString()).toBe(owner.userId);
    expect(await AuditLog.countDocuments({ orgId: oid(owner.orgId), action: "retention.run" })).toBe(1);
    const status = await request(sa.app).get(`${API}/retention`).set(bearer(owner.token)).expect(200);
    expect(status.body.lastRun).toMatchObject({ flowsDeleted: 3, alertsDeleted: 1, alertsKept: 1 });

    await request(sa.app).post(`${API}/retention/run`).set(bearer(owner.token)).expect(202);
    await sa.jobs.idle();
    expect(await Flow.countDocuments({ orgId: oid(owner.orgId) })).toBe(2);
    // Nothing deleted the second time, so no second purge entry.
    expect(await AuditLog.countDocuments({ orgId: oid(owner.orgId), action: "retention.purge" })).toBe(1);
  });

  it("never touches another org's data", async () => {
    const a = await registerUser(sa);
    const b = await registerUser(sa);
    await seed(a.orgId);
    await seed(b.orgId);
    await Org.updateOne({ _id: oid(a.orgId) }, { $set: { "settings.retentionDays": 3 } });
    await request(sa.app).post(`${API}/retention/run`).set(bearer(a.token)).expect(202);
    await sa.jobs.idle();
    expect(await Flow.countDocuments({ orgId: oid(a.orgId) })).toBe(1);
    expect(await Flow.countDocuments({ orgId: oid(b.orgId) })).toBe(5);
  });
});
