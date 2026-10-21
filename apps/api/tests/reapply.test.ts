import request from "supertest";
import { describe, expect, it } from "vitest";
import { AppError } from "../src/lib/errors.js";
import { Alert, AuditLog, Flow, Incident, IncidentEvent } from "../src/models/tenant.js";
import { AlertRebuildService } from "../src/modules/alerts/rebuild.service.js";
import type { ScoringService } from "../src/modules/scoring/scoring.service.js";
import { API, FakeMl, addMember, buildApp, oid, registerUser, writeCsv, type CsvRow } from "./helpers.js";

const sa = buildApp({ ml: new FakeMl() });

// FakeMl: Flow Packets/s > 1000 -> DDoS (0.95); Flow Duration 7 -> PortScan (0.4, below the default threshold).
const ddos = (src: string): CsvRow[] => Array.from({ length: 3 }, () => ({ srcIp: src, dstIp: "10.0.0.80", raw: { "Flow Packets/s": "5000" } }));
const weakScan = (src: string): CsvRow[] => Array.from({ length: 3 }, () => ({ srcIp: src, dstIp: "10.0.0.80", raw: { "Flow Duration": "7" } }));
const portScan = (src: string, at: string): CsvRow[] =>
  Array.from({ length: 120 }, (_, i) => ({ srcIp: src, dstIp: "192.168.10.50", timestamp: at, raw: { "Destination Port": String(1000 + i), "Total Fwd Packets": "1", "Total Backward Packets": "1" } }));
const sshBurst = (src: string, at: string): CsvRow[] =>
  Array.from({ length: 40 }, () => ({ srcIp: src, dstIp: "192.168.10.50", timestamp: at, raw: { "Destination Port": "22", "Flow Duration": "500000" } }));

const NOISY_SOURCE = "203.0.113.7";
const WEAK_SOURCE = "198.51.100.4";
const ATTACKER = "10.9.9.9";

async function setup() {
  const u = await registerUser(sa);
  const auth = { Authorization: `Bearer ${u.token}` };
  await request(sa.app).post(`${API}/models/bench-a/activate`).set(auth).expect(200);
  await request(sa.app)
    .post(`${API}/imports/csv`)
    .set(auth)
    .attach("file", writeCsv([...ddos(NOISY_SOURCE), ...weakScan(WEAK_SOURCE), ...portScan(ATTACKER, "7/7/2017 3:40"), ...sshBurst(ATTACKER, "7/7/2017 3:45")]))
    .expect(202);
  await sa.jobs.idle();
  return { u, auth };
}

async function alertsOf(auth: Record<string, string>) {
  const items = (await request(sa.app).get(`${API}/alerts?limit=200`).set(auth)).body.items as { id: string; type: string; srcIp: string; count: number; status: string; verdict: string | null }[];
  return items;
}
const summary = (items: { type: string; srcIp: string; count: number; status: string }[]) => items.map((a) => `${a.type}:${a.srcIp}:${a.count}:${a.status}`).sort();

async function reapply(auth: Record<string, string>) {
  const res = await request(sa.app).post(`${API}/detection/reapply`).set(auth).send({});
  await sa.jobs.idle();
  return res;
}

describe("re-apply detection settings to existing alerts", () => {
  it("rebuilds machine alerts and incidents under the new settings and keeps flows and verdicts", async () => {
    const { u, auth } = await setup();
    const before = await alertsOf(auth);
    expect(summary(before)).toEqual(
      expect.arrayContaining([`DDoS:${NOISY_SOURCE}:3:open`, `PortScan:${WEAK_SOURCE}:3:needs_review`, `PortScan:${ATTACKER}:1:open`, `SSHPatator:${ATTACKER}:1:open`]),
    );
    expect(await Incident.countDocuments({ orgId: oid(u.orgId) })).toBe(1);
    const flowVerdicts = await Flow.find({ orgId: oid(u.orgId), scoreStatus: "scored" }).select("scored.label scored.confidence").sort({ _id: 1 }).lean();

    // Saving settings does not rewrite existing alerts...
    await request(sa.app)
      .patch(`${API}/detection/settings`)
      .set(auth)
      .send({ modelAlertMinConfidence: 0.5, allowlist: [{ cidr: "203.0.113.0/24", note: "Our scanner" }] })
      .expect(200);
    expect(summary(await alertsOf(auth))).toEqual(summary(before));

    // ...the explicit action does.
    const res = await reapply(auth);
    expect(res.status).toBe(202);
    expect(res.body.preview).toMatchObject({ alertsKept: 0, incidentsKept: 0 });
    const after = await alertsOf(auth);
    expect(summary(after)).toEqual([`PortScan:${ATTACKER}:1:open`, `SSHPatator:${ATTACKER}:1:open`].sort());
    // The correlated incident was rebuilt from the surviving alerts.
    const incidents = await Incident.find({ orgId: oid(u.orgId) }).lean();
    expect(incidents).toHaveLength(1);
    expect(incidents[0]?.origin).toBe("correlated");

    // Verdicts stay on the flows; only the reason they produced no alert is recorded.
    const flowsAfter = await Flow.find({ orgId: oid(u.orgId), scoreStatus: "scored" }).select("scored.label scored.confidence").sort({ _id: 1 }).lean();
    expect(flowsAfter.map((f) => `${f.scored?.label}:${f.scored?.confidence}`)).toEqual(flowVerdicts.map((f) => `${f.scored?.label}:${f.scored?.confidence}`));
    expect(await Flow.countDocuments({ orgId: oid(u.orgId), alertSuppressed: "allowlisted" })).toBe(3);
    expect(await Flow.countDocuments({ orgId: oid(u.orgId), alertSuppressed: "below_min_confidence" })).toBe(3);

    // Audited: the request, with the settings and what would be kept, and the outcome.
    const started = await AuditLog.findOne({ orgId: oid(u.orgId), action: "detection.reapply" }).lean();
    expect(started?.actorId).toEqual(oid(u.userId));
    expect(started?.meta).toMatchObject({ settings: { modelAlertMinConfidence: 0.5, allowlist: 1 }, plan: { alertsRebuilt: 4, incidentsRebuilt: 1 } });
    const done = await AuditLog.findOne({ orgId: oid(u.orgId), action: "detection.reapply_done" }).lean();
    expect(done?.meta).toMatchObject({ after: { alerts: 2, incidents: 1, suppressedVerdicts: { belowMinConfidence: 3, allowlisted: 3 } } });

    const status = (await request(sa.app).get(`${API}/detection/reapply`).set(auth)).body;
    expect(status.running).toBe(false);
    expect(status.last).toMatchObject({ status: "done", after: { alerts: 2 } });
  });

  it("is idempotent: running it again with the same settings changes nothing", async () => {
    const { u, auth } = await setup();
    await request(sa.app).patch(`${API}/detection/settings`).set(auth).send({ modelAlertMinConfidence: 0.5 }).expect(200);
    await reapply(auth);
    const first = summary(await alertsOf(auth));
    const firstIncident = await Incident.find({ orgId: oid(u.orgId) }).select("title severity alertIds").lean();
    await reapply(auth);
    await reapply(auth);
    expect(summary(await alertsOf(auth))).toEqual(first);
    const again = await Incident.find({ orgId: oid(u.orgId) }).select("title severity alertIds").lean();
    expect(again.map((i) => `${i.title}:${i.severity}:${i.alertIds.length}`)).toEqual(firstIncident.map((i) => `${i.title}:${i.severity}:${i.alertIds.length}`));
    // Rebuilt, not stacked: no duplicate alerts or orphan events from the earlier incident.
    expect(await Alert.countDocuments({ orgId: oid(u.orgId) })).toBe(first.length);
    expect(await IncidentEvent.countDocuments({ orgId: oid(u.orgId), incidentId: { $nin: again.map((i) => i._id) } })).toBe(0);
  });

  it("never discards what an analyst did: triaged alerts and worked incidents stay, without double counting", async () => {
    const { u, auth } = await setup();
    const alerts = await alertsOf(auth);
    const noisy = alerts.find((a) => a.srcIp === NOISY_SOURCE);
    expect(noisy).toBeTruthy();
    await request(sa.app).patch(`${API}/alerts/${noisy?.id}`).set(auth).send({ verdict: "true_positive" }).expect(200);
    const incident = (await request(sa.app).get(`${API}/incidents`).set(auth)).body.items[0] as { id: string };
    await request(sa.app).post(`${API}/incidents/${incident.id}/notes`).set(auth).send({ text: "Checking auth.log" }).expect(201);

    // Allowlist both the noisy source and the attacker: machine output for them would vanish.
    await request(sa.app)
      .patch(`${API}/detection/settings`)
      .set(auth)
      .send({ modelAlertMinConfidence: 0.5, allowlist: [{ cidr: "203.0.113.0/24", note: "scanner" }, { cidr: "10.9.9.0/24", note: "pretend" }] })
      .expect(200);
    const preview = (await request(sa.app).get(`${API}/detection/reapply`).set(auth)).body.preview;
    expect(preview).toEqual({ alertsRebuilt: 1, alertsKept: 3, incidentsRebuilt: 0, incidentsKept: 1 });
    await reapply(auth);

    const after = await alertsOf(auth);
    // Kept as they were (counts unchanged, not doubled); the only machine alert (weak scan) is gone.
    expect(summary(after)).toEqual(
      [`DDoS:${NOISY_SOURCE}:3:open`, `PortScan:${ATTACKER}:1:open`, `SSHPatator:${ATTACKER}:1:open`].sort(),
    );
    expect(after.find((a) => a.srcIp === NOISY_SOURCE)).toMatchObject({ id: noisy?.id, verdict: "true_positive" });
    const kept = await Incident.find({ orgId: oid(u.orgId) }).lean();
    expect(kept).toHaveLength(1);
    expect(String(kept[0]?._id)).toBe(incident.id);
    expect(kept[0]?.notes).toHaveLength(1);
    expect(kept[0]?.alertIds).toHaveLength(2);
    // The worked incident keeps its investigation log.
    expect(await IncidentEvent.countDocuments({ orgId: oid(u.orgId), incidentId: kept[0]?._id, kind: "note" })).toBe(1);
  });

  it("is limited to Owners and Admins to start, readable by everyone, and scoped to the caller's organisation", async () => {
    const { u, auth } = await setup();
    const other = await setup();
    const otherBefore = summary(await alertsOf(other.auth));
    await request(sa.app).patch(`${API}/detection/settings`).set(auth).send({ modelAlertMinConfidence: 0.5 }).expect(200);

    const analyst = await addMember(u.orgId, "Analyst");
    const viewer = await addMember(u.orgId, "Viewer");
    expect((await request(sa.app).post(`${API}/detection/reapply`).set("Authorization", `Bearer ${analyst.token}`).send({})).status).toBe(403);
    expect((await request(sa.app).get(`${API}/detection/reapply`).set("Authorization", `Bearer ${viewer.token}`)).status).toBe(200);
    expect((await request(sa.app).post(`${API}/detection/reapply`).send({})).status).toBe(401);
    expect((await request(sa.app).post(`${API}/detection/reapply`).set(auth).send({ orgId: "somebody-else" })).status).toBe(400);
    expect(await AuditLog.countDocuments({ orgId: oid(u.orgId), action: "detection.reapply" })).toBe(0);

    await reapply(auth);
    expect(summary(await alertsOf(other.auth))).toEqual(otherBefore);
  });

  it("refuses to start while scoring or another rebuild is running or queued, and releases the lock afterwards", async () => {
    let scoring = false;
    const queued = { score: false, reapply: false };
    const svc = new AlertRebuildService({ isRunning: () => scoring } as unknown as ScoringService, {} as never, {} as never, {} as never, async (kind) => queued[kind]);
    const org = oid("64b64b64b64b64b64b64b64b");
    await svc.begin(org);
    expect(await svc.isRunning(org)).toBe(true);
    await expect(svc.begin(org)).rejects.toThrow(AppError);
    svc.release(org);
    // Two requests racing past the async checks: only one takes the lock.
    expect((await Promise.allSettled([svc.begin(org), svc.begin(org)])).map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    svc.release(org);
    scoring = true;
    await expect(svc.begin(org)).rejects.toThrow(/Scoring is running/);
    scoring = false;
    queued.score = true;
    await expect(svc.begin(org)).rejects.toThrow(/Scoring is running/);
    queued.score = false;
    // A rebuild queued by another API process or still running in a worker.
    queued.reapply = true;
    expect(await svc.isRunning(org)).toBe(true);
    await expect(svc.begin(org)).rejects.toThrow(/already being rebuilt/);
    queued.reapply = false;
    expect(await svc.isRunning(org)).toBe(false);
  });
});
