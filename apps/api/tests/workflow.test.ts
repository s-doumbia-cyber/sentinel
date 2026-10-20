import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { Org } from "../src/models/identity.js";
import { Alert, AuditLog, Incident, IncidentEvent } from "../src/models/tenant.js";
import { API, addMember, buildApp, oid, registerUser, writeCsv, type CsvRow } from "./helpers.js";

// Rules only (no model): every alert here is deterministic.
const sa = buildApp();

const scan = (src: string, at: string): CsvRow[] =>
  Array.from({ length: 120 }, (_, i) => ({
    srcIp: src,
    dstIp: "192.168.10.50",
    timestamp: at,
    raw: { "Destination Port": String(1000 + i), "Total Fwd Packets": "1", "Total Backward Packets": "1" },
  }));

/** 40 short SSH connections (0.5 s each) from one source to one server. */
const sshBurst = (src: string, at: string): CsvRow[] =>
  Array.from({ length: 40 }, () => ({ srcIp: src, dstIp: "192.168.10.50", timestamp: at, raw: { "Destination Port": "22", "Flow Duration": "500000" } }));

async function importRows(token: string, rows: CsvRow[]) {
  const res = await request(sa.app).post(`${API}/imports/csv`).set("Authorization", `Bearer ${token}`).attach("file", writeCsv(rows));
  expect(res.status).toBe(202);
  await sa.jobs.idle();
  return res.body.id as string;
}

async function setup(rows: CsvRow[]) {
  const u = await registerUser(sa);
  const auth = { Authorization: `Bearer ${u.token}` };
  const datasetId = await importRows(u.token, rows);
  return { u, auth, datasetId };
}

describe("correlation", () => {
  it("groups a port scan followed by SSH brute force from one source into one escalated incident", async () => {
    const { u, auth } = await setup([...scan("10.9.9.9", "7/7/2017 3:40"), ...sshBurst("10.9.9.9", "7/7/2017 3:45")]);
    const alerts = (await request(sa.app).get(`${API}/alerts`).set(auth)).body.items;
    expect(alerts.map((a: { type: string }) => a.type).sort()).toEqual(["PortScan", "SSHPatator"]);
    const incidents = (await request(sa.app).get(`${API}/incidents`).set(auth)).body.items;
    expect(incidents).toHaveLength(1);
    const inc = incidents[0];
    expect(inc).toMatchObject({
      title: "Discovery → Credential access from 10.9.9.9",
      origin: "correlated",
      alertCount: 2,
      // max(low, medium) raised one level because two kill-chain stages are involved
      severity: "high",
      priority: "P2",
      sourceIp: "10.9.9.9",
    });
    expect(inc.correlation.basis).toMatch(/Same source address 10\.9\.9\.9/);
    expect(inc.description).toMatch(/hypothesis/);
    expect(inc.entities).toEqual(expect.arrayContaining([{ type: "ip", value: "10.9.9.9", role: "source" }, { type: "ip", value: "192.168.10.50", role: "target" }]));
    expect(await Alert.countDocuments({ orgId: oid(u.orgId), incidentId: oid(inc.id) })).toBe(2);
    expect(await AuditLog.countDocuments({ orgId: oid(u.orgId), action: "incident.correlated", actorId: null })).toBe(1);

    // Re-running detections does not create a second incident.
    await request(sa.app).post(`${API}/detections/run`).set(auth).send({}).expect(202);
    await sa.jobs.idle();
    expect(await Incident.countDocuments({ orgId: oid(u.orgId) })).toBe(1);
  });

  it("leaves a lone alert, and alerts far apart in time, uncorrelated", async () => {
    const { u } = await setup([...scan("10.9.9.9", "7/7/2017 3:40"), ...sshBurst("10.9.9.9", "7/7/2017 4:40"), ...scan("10.8.8.8", "7/7/2017 3:40")]);
    expect(await Alert.countDocuments({ orgId: oid(u.orgId) })).toBe(3);
    expect(await Incident.countDocuments({ orgId: oid(u.orgId) })).toBe(0);
  });

  it("respects the organisation's correlation window", async () => {
    const u = await registerUser(sa);
    await Org.updateOne({ _id: oid(u.orgId) }, { $set: { "settings.correlationWindowMinutes": 90 } });
    await importRows(u.token, [...scan("10.9.9.9", "7/7/2017 3:40"), ...sshBurst("10.9.9.9", "7/7/2017 4:40")]);
    const incidents = await Incident.find({ orgId: oid(u.orgId) }).lean();
    expect(incidents).toHaveLength(1);
    expect(incidents[0]?.correlation?.windowMinutes).toBe(90);
  });

  it("joins a new alert from the same source to the open incident", async () => {
    const { u } = await setup([...scan("10.9.9.9", "7/7/2017 3:40"), ...sshBurst("10.9.9.9", "7/7/2017 3:45")]);
    await importRows(u.token, Array.from({ length: 40 }, () => ({ srcIp: "10.9.9.9", dstIp: "192.168.10.51", timestamp: "7/7/2017 3:52", raw: { "Destination Port": "21", "Flow Duration": "500000" } })));
    const [inc] = await Incident.find({ orgId: oid(u.orgId) }).lean();
    expect(inc?.alertIds).toHaveLength(3);
    expect(await IncidentEvent.countDocuments({ orgId: oid(u.orgId), kind: "alerts_linked" })).toBe(2);
  });
});

describe("incident timeline, actions, simulation and report", () => {
  it("separates event-time facts from hypotheses, and logs who did what", async () => {
    const { auth } = await setup([...scan("10.9.9.9", "7/7/2017 3:40"), ...sshBurst("10.9.9.9", "7/7/2017 3:45")]);
    const [inc] = (await request(sa.app).get(`${API}/incidents`).set(auth)).body.items;
    await request(sa.app).patch(`${API}/incidents/${inc.id}`).set(auth).send({ status: "Investigating" }).expect(200);
    await request(sa.app).post(`${API}/incidents/${inc.id}/notes`).set(auth).send({ text: "Checking auth.log on the server" }).expect(201);
    const t = (await request(sa.app).get(`${API}/incidents/${inc.id}/timeline`).set(auth)).body;
    expect(t.attack.steps.map((s: { stage: string }) => s.stage)).toEqual(["Discovery", "Credential access"]);
    expect(t.attack.steps[0].fact).toMatch(/Sentinel raised a low PortScan alert for 10\.9\.9\.9/);
    expect(t.attack.steps[0].at).toBe("2017-07-07T03:40:00.000Z");
    expect(t.attack.hypotheses[0].statement).toBe("Possible progression: Discovery → Credential access.");
    expect(t.attack.hypotheses[0].limits.join(" ")).toMatch(/not proof/);
    expect(t.log.map((e: { kind: string; actor: string }) => `${e.kind}:${e.actor}`)).toEqual([
      "correlated:Sentinel",
      "alerts_linked:Sentinel",
      "status_changed:Test User",
      "note:Test User",
    ]);
    expect(t.log[2].payload).toEqual({ from: "Open", to: "Investigating" });
  });

  it("records analyst actions and blocklist simulations without claiming enforcement", async () => {
    const { u, auth } = await setup([...scan("10.9.9.9", "7/7/2017 3:40"), ...sshBurst("10.9.9.9", "7/7/2017 3:45")]);
    const [inc] = (await request(sa.app).get(`${API}/incidents`).set(auth)).body.items;
    await request(sa.app).post(`${API}/incidents/${inc.id}/actions`).set(auth).send({ description: "Blocked 10.9.9.9 on the edge firewall (change CHG-118)" }).expect(201);
    const sim = await request(sa.app).post(`${API}/response/blocklist`).set(auth).send({ ips: ["10.9.9.9", "203.0.113.9"], format: "iptables", comment: "INC test", incidentId: inc.id });
    expect(sim.status).toBe(200);
    expect(sim.body).toMatchObject({ simulated: true, applied: false });
    expect(sim.body.content).toContain('iptables -I INPUT -s 203.0.113.9 -j DROP -m comment --comment "INC test"');
    expect(sim.body.warnings).toHaveLength(1);
    expect((await request(sa.app).post(`${API}/response/blocklist`).set(auth).send({ ips: ["1.2.3.4; reboot"], format: "iptables" })).status).toBe(400);
    const guidance = (await request(sa.app).get(`${API}/incidents/${inc.id}/guidance`).set(auth)).body;
    expect(guidance.enforcement).toBe("none");
    expect(guidance.entries.map((e: { type: string }) => e.type).sort()).toEqual(["PortScan", "SSHPatator"]);
    const log = (await request(sa.app).get(`${API}/incidents/${inc.id}/timeline`).set(auth)).body.log;
    const action = log.find((e: { kind: string }) => e.kind === "action_recorded");
    expect(action.payload.verification).toMatch(/not executed or verified by Sentinel/);
    expect(log.some((e: { kind: string; payload: { applied?: boolean } }) => e.kind === "simulation_generated" && e.payload.applied === false)).toBe(true);
    expect(await AuditLog.countDocuments({ orgId: oid(u.orgId), action: "incident.action_recorded" })).toBe(1);
    await expect(IncidentEvent.updateMany({ orgId: oid(u.orgId) }, { $set: { kind: "note" } })).rejects.toThrow(/append-only/);
  });

  it("builds a report with facts, hypotheses, provenance and limits, and logs its generation", async () => {
    const { u, auth } = await setup([...scan("10.9.9.9", "7/7/2017 3:40"), ...sshBurst("10.9.9.9", "7/7/2017 3:45")]);
    const [inc] = (await request(sa.app).get(`${API}/incidents`).set(auth)).body.items;
    const report = (await request(sa.app).post(`${API}/incidents/${inc.id}/report`).set(auth)).body;
    expect(report.meta).toMatchObject({ reportVersion: 1, timezone: "UTC" });
    expect(report.attack.steps).toHaveLength(2);
    expect(report.provenance.datasets[0].sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(report.provenance.rules.sort()).toEqual(["R-BRUTEFORCE-SSH-01", "R-PORTSCAN-01"]);
    expect(report.response.enforcement).toMatch(/did not block/);
    expect(report.limitations.join(" ")).toMatch(/does not identify a person/);
    const source = report.entities.find((e: { role: string }) => e.role === "source");
    expect(source.identity.candidates).toEqual([]);
    expect(await IncidentEvent.countDocuments({ orgId: oid(u.orgId), kind: "report_generated" })).toBe(1);

    const viewer = await addMember(u.orgId, "Viewer");
    const vr = (await request(sa.app).post(`${API}/incidents/${inc.id}/report`).set("Authorization", `Bearer ${viewer.token}`)).body;
    expect(vr.entities[0].identity).toBe("restricted");
  });

  it("creates an incident from selected alerts once, and unlinks alerts when it is deleted", async () => {
    const { u, auth } = await setup(scan("10.8.8.8", "7/7/2017 3:40"));
    const [alert] = (await request(sa.app).get(`${API}/alerts`).set(auth)).body.items;
    const created = await request(sa.app).post(`${API}/incidents/from-alerts`).set(auth).send({ alertIds: [alert.id] });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ origin: "from_alerts", alertCount: 1, severity: "low" });
    expect((await request(sa.app).post(`${API}/incidents/from-alerts`).set(auth).send({ alertIds: [alert.id] })).status).toBe(409);
    const detail = (await request(sa.app).get(`${API}/alerts/${alert.id}`).set(auth)).body;
    expect(detail.incident).toMatchObject({ id: created.body.id });
    await request(sa.app).delete(`${API}/incidents/${created.body.id}`).set(auth).expect(204);
    expect((await Alert.findOne({ orgId: oid(u.orgId), _id: oid(alert.id) }).lean())?.incidentId).toBeNull();
    const other = await registerUser(sa);
    expect((await request(sa.app).post(`${API}/incidents/from-alerts`).set("Authorization", `Bearer ${other.token}`).send({ alertIds: [alert.id] })).status).toBe(404);
  });
});

describe("alert analysis and traceability", () => {
  it("separates observed, inferred and unknown, with provenance and change history", async () => {
    const { auth } = await setup(scan("10.8.8.8", "7/7/2017 3:40"));
    const [alert] = (await request(sa.app).get(`${API}/alerts`).set(auth)).body.items;
    await request(sa.app).patch(`${API}/alerts/${alert.id}`).set(auth).send({ status: "acknowledged" }).expect(200);
    const d = (await request(sa.app).get(`${API}/alerts/${alert.id}`).set(auth)).body;
    const text = (k: "observed" | "inferred" | "unknown") => d.analysis[k].map((s: { text: string }) => s.text).join(" | ");
    expect(text("observed")).toMatch(/Rule Horizontal\/vertical port scan \(R-PORTSCAN-01 v1\) counted 100 distinct destinationPort values within 60s/);
    expect(d.analysis.observed[0].basis).toMatch(/sha256/);
    expect(text("inferred")).toMatch(/resembles PortScan/);
    expect(text("inferred")).toMatch(/T1046/);
    expect(d.analysis.inferred.find((s: { text: string }) => s.text.includes("T1046")).basis).toMatch(/not proof/);
    expect(text("unknown")).toMatch(/Whether the attempt succeeded/);
    expect(text("unknown")).toMatch(/Who operated 10\.8\.8\.8: no identity record covers this time window \(no identity source is connected\)/);
    expect(d.provenance.datasets[0]).toMatchObject({ importedBy: "Test User", sourceKind: "IMPORTED" });
    expect(d.history.map((h: { action: string; actor: string }) => `${h.action}:${h.actor}`)).toEqual(["alert.update:Test User"]);
  });

  it("traces an incident from ingestion to report, in recorded order", async () => {
    const { u, auth } = await setup([...scan("10.9.9.9", "7/7/2017 3:40"), ...sshBurst("10.9.9.9", "7/7/2017 3:45")]);
    const identity = path.join(tmpdir(), `sentinel-trace-identity-${Date.now()}.csv`);
    writeFileSync(identity, ["ip,start,end,source,username,hostname,mac", "10.9.9.9,2017-07-07T03:00:00Z,2017-07-07T05:00:00Z,dhcp,,KALI-LAB,"].join(String.fromCharCode(10)));
    await request(sa.app).post(`${API}/identity/imports`).set(auth).attach("file", identity).expect(201);
    const [inc] = (await request(sa.app).get(`${API}/incidents`).set(auth)).body.items;
    const ssh = (await request(sa.app).get(`${API}/alerts?type=SSHPatator`).set(auth)).body.items[0];
    await request(sa.app).patch(`${API}/alerts/${ssh.id}`).set(auth).send({ verdict: "true_positive" }).expect(200);
    await request(sa.app).post(`${API}/response/blocklist`).set(auth).send({ ips: ["10.9.9.9"], format: "nftables", incidentId: inc.id }).expect(200);
    const report = (await request(sa.app).post(`${API}/incidents/${inc.id}/report`).set(auth).expect(200)).body;
    // The report carries the chain of custody up to its own generation.
    expect(report.trace[0].stage).toBe("ingest");
    expect(report.trace.map((e: { stage: string }) => e.stage)).toContain("respond");

    const trace = (await request(sa.app).get(`${API}/incidents/${inc.id}/trace`).set(auth)).body;
    const stages = trace.entries.map((e: { stage: string }) => e.stage);
    // Recorded order: the import, then detection, then the analyst's work.
    expect(stages[0]).toBe("ingest");
    expect(stages.indexOf("detect")).toBeLessThan(stages.indexOf("triage"));
    expect(stages.indexOf("triage")).toBeLessThan(stages.indexOf("respond"));
    expect(stages.at(-1)).toBe("report");
    expect(stages).toContain("context");
    const byStage = (s: string) => trace.entries.filter((e: { stage: string }) => e.stage === s);
    expect(byStage("ingest")[0]).toMatchObject({ actor: "Test User", ref: { type: "dataset" } });
    expect(byStage("ingest")[0].summary).toMatch(/flows tagged IMPORTED, sha256 [0-9a-f]{16}…/);
    const detected = byStage("detect").map((e: { summary: string }) => e.summary).join(" ");
    expect(detected).toMatch(/PortScan alert .* from rule R-PORTSCAN-01/);
    expect(detected).toMatch(/SSHPatator alert .* from rule R-BRUTEFORCE-SSH-01/);
    expect(byStage("detect").every((e: { actor: string }) => e.actor === "Sentinel")).toBe(true);
    expect(byStage("triage")[0]).toMatchObject({ actor: "Test User", ref: { type: "alert", id: ssh.id } });
    expect(byStage("triage")[0].summary).toMatch(/verdict none → true_positive/);
    expect(byStage("respond")[0].summary).toMatch(/nftables blocklist simulation for 10\.9\.9\.9; not applied/);
    expect(trace.coverage).toMatchObject({ datasets: 1, alerts: 2, triageChanges: 1, identityImports: 1 });

    // Viewers see the chain of custody but not which identity imports exist.
    const viewer = await addMember(u.orgId, "Viewer");
    const vt = (await request(sa.app).get(`${API}/incidents/${inc.id}/trace`).set("Authorization", `Bearer ${viewer.token}`)).body;
    expect(vt.entries.some((e: { stage: string }) => e.stage === "context")).toBe(false);
    expect(vt.coverage.identityImports).toBeNull();
    const other = await registerUser(sa);
    expect((await request(sa.app).get(`${API}/incidents/${inc.id}/trace`).set("Authorization", `Bearer ${other.token}`)).status).toBe(404);
  });
});
