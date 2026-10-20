import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { AuditLog } from "../src/models/tenant.js";
import { API, FakeMl, addMember, buildApp, oid, registerUser, writeCsv, type CsvRow } from "./helpers.js";

const sa = buildApp({ ml: new FakeMl() });

function identityCsv(lines: string[]): string {
  const file = path.join(tmpdir(), `sentinel-identity-test-${randomBytes(6).toString("hex")}.csv`);
  writeFileSync(file, ["ip,start,end,source,username,hostname,mac", ...lines].join("\n"));
  return file;
}

/** Two clients talking to one web server; the CSV timestamp "7/7/2017 3:56" is stored as 03:56 UTC. */
const traffic: CsvRow[] = [
  ...Array.from({ length: 4 }, () => ({ srcIp: "10.0.0.21", dstIp: "10.0.0.80" })),
  ...Array.from({ length: 3 }, () => ({ srcIp: "10.0.0.22", dstIp: "10.0.0.80" })),
  { srcIp: "10.0.0.21", dstIp: "8.8.8.8", raw: { "Destination Port": "53", Protocol: "17" } },
];

async function setup() {
  const u = await registerUser(sa);
  const auth = { Authorization: `Bearer ${u.token}` };
  const imp = await request(sa.app).post(`${API}/imports/csv`).set(auth).attach("file", writeCsv(traffic));
  await sa.jobs.idle();
  return { u, auth, datasetId: imp.body.id as string };
}

describe("asset inventory", () => {
  it("is built from observed flows, with the device type labelled as a low-confidence estimate", async () => {
    const { auth } = await setup();
    const list = await request(sa.app).get(`${API}/assets`).set(auth);
    expect(list.status).toBe(200);
    expect(list.body.items.map((a: { ip: string }) => a.ip).sort()).toEqual(["10.0.0.21", "10.0.0.22", "10.0.0.80", "8.8.8.8"]);
    const server = list.body.items.find((a: { ip: string }) => a.ip === "10.0.0.80");
    expect(server).toMatchObject({ scope: "internal", flowsAsDestination: 7, flowsAsSource: 0, distinctPeers: 2 });
    expect(server.services[0]).toMatchObject({ port: 80, protocol: "TCP", flows: 7 });
    expect(server.deviceEstimate).toMatchObject({ label: "Web server", confidence: "low", source: "port-heuristic" });
    const client = list.body.items.find((a: { ip: string }) => a.ip === "10.0.0.21");
    expect(client.deviceEstimate.label).toMatch(/Client/);
    // One DNS flow is a probe, not evidence of a DNS server.
    expect(list.body.items.find((a: { ip: string }) => a.ip === "8.8.8.8")).toMatchObject({ scope: "external", deviceEstimate: null });
    expect((await request(sa.app).get(`${API}/assets?scope=external`).set(auth)).body.items).toHaveLength(1);
    expect((await request(sa.app).get(`${API}/assets?role=server`).set(auth)).body.items.map((a: { ip: string }) => a.ip)).toContain("10.0.0.80");
  });

  it("shows the asset's peers, activity and alerts, and keeps analyst notes across refreshes", async () => {
    const { u, auth } = await setup();
    const patch = await request(sa.app).patch(`${API}/assets/10.0.0.80`).set(auth).send({ notes: "Intranet web server (confirmed with IT)", tags: ["web"] });
    expect(patch.status).toBe(200);
    await request(sa.app).post(`${API}/assets/refresh`).set(auth).expect(202);
    await sa.jobs.idle();
    const detail = (await request(sa.app).get(`${API}/assets/10.0.0.80`).set(auth)).body;
    expect(detail.asset).toMatchObject({ notes: "Intranet web server (confirmed with IT)", tags: ["web"], flowsAsDestination: 7 });
    expect(detail.peers.inbound.map((p: { ip: string }) => p.ip).sort()).toEqual(["10.0.0.21", "10.0.0.22"]);
    expect(detail.activity.reduce((a: number, b: { asDestination: number }) => a + b.asDestination, 0)).toBe(7);
    expect(detail.alerts).toEqual([]);
    expect(await AuditLog.countDocuments({ orgId: oid(u.orgId), action: "asset.update" })).toBe(1);
  });

  it("marks assets inactive when their flows are deleted, and hides them by default", async () => {
    const { auth, datasetId } = await setup();
    await request(sa.app).delete(`${API}/datasets/${datasetId}`).set(auth).expect(200);
    await request(sa.app).post(`${API}/assets/refresh`).set(auth).expect(202);
    await sa.jobs.idle();
    expect((await request(sa.app).get(`${API}/assets`).set(auth)).body.items).toHaveLength(0);
    const all = (await request(sa.app).get(`${API}/assets?includeInactive=true`).set(auth)).body.items;
    expect(all).toHaveLength(4);
    expect(all.every((a: { active: boolean; flowsAsSource: number }) => !a.active && a.flowsAsSource === 0)).toBe(true);
  });

  it("isolates assets per org", async () => {
    await setup();
    const other = await registerUser(sa);
    const res = await request(sa.app).get(`${API}/assets/10.0.0.80`).set("Authorization", `Bearer ${other.token}`);
    expect(res.status).toBe(404);
  });
});

describe("identity sources and attribution", () => {
  it("imports identity records with provenance and reports invalid rows", async () => {
    const { u, auth } = await setup();
    const file = identityCsv([
      "10.0.0.21,2017-07-07T15:00:00Z,2017-07-07T17:00:00Z,vpn,alice,,",
      "10.0.0.22,2017-07-07T08:00:00Z,2017-07-07T20:00:00Z,dhcp,,LAPTOP-22,aa:bb:cc:dd:ee:ff",
      "10.0.0.23,not-a-date,,dhcp,,X,",
      "10.0.0.24,2017-07-07T08:00:00Z,,geoip,bob,,",
      "10.0.0.25,2017-07-07T08:00:00Z,,auth,,,",
    ]);
    const res = await request(sa.app).post(`${API}/identity/imports`).set(auth).attach("file", file);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ rowsRead: 5, rowsInserted: 2, invalidRows: 3, sources: ["dhcp", "vpn"] });
    expect(res.body.invalidSamples).toHaveLength(3);
    expect(await AuditLog.countDocuments({ orgId: oid(u.orgId), action: "identity.import" })).toBe(1);
  });

  it("grades each match and says unknown, with what would help, when nothing matches", async () => {
    const { auth } = await setup();
    await request(sa.app)
      .post(`${API}/identity/imports`)
      .set(auth)
      .attach("file", identityCsv(["10.0.0.21,2017-07-07T15:00:00Z,2017-07-07T17:00:00Z,vpn,alice,,", "10.0.0.22,2017-07-07T15:50:00Z,2017-07-07T15:58:00Z,dhcp,,LAPTOP-22,"]));
    const window = "from=2017-07-07T15:55:00Z&to=2017-07-07T15:57:00Z";
    const a = (await request(sa.app).get(`${API}/identity/attribution?ip=10.0.0.21&${window}`).set(auth)).body;
    expect(a.candidates).toHaveLength(1);
    expect(a.candidates[0]).toMatchObject({ username: "alice", source: "vpn", confidence: "high" });
    expect(a.caveats.join(" ")).toMatch(/does not identify a person/);
    expect(a.connectedSources.map((s: { source: string }) => s.source)).toEqual(["dhcp", "vpn"]);

    const b = (await request(sa.app).get(`${API}/identity/attribution?ip=10.0.0.22&${window}`).set(auth)).body;
    expect(b.candidates[0]).toMatchObject({ hostname: "LAPTOP-22", confidence: "medium" });

    const none = (await request(sa.app).get(`${API}/identity/attribution?ip=10.0.0.80&${window}`).set(auth)).body;
    expect(none.candidates).toEqual([]);
    expect(none.help.length).toBeGreaterThan(0);

    const before = (await request(sa.app).get(`${API}/identity/attribution?ip=10.0.0.21&from=2017-07-06T00:00:00Z&to=2017-07-06T01:00:00Z`).set(auth)).body;
    expect(before.candidates).toEqual([]);
  });

  it("flags an address held by several identities as ambiguous", async () => {
    const { auth } = await setup();
    await request(sa.app)
      .post(`${API}/identity/imports`)
      .set(auth)
      .attach("file", identityCsv(["10.0.0.21,2017-07-07T15:00:00Z,2017-07-07T17:00:00Z,vpn,alice,,", "10.0.0.21,2017-07-07T15:30:00Z,2017-07-07T16:30:00Z,vpn,carol,,"]));
    const a = (await request(sa.app).get(`${API}/identity/attribution?ip=10.0.0.21&from=2017-07-07T15:55:00Z&to=2017-07-07T15:57:00Z`).set(auth)).body;
    expect(a.ambiguous).toBe(true);
    expect(a.candidates).toHaveLength(2);
  });

  it("keeps identity data from Viewers and imports to Owners/Admins", async () => {
    const { u, auth } = await setup();
    // Covers the asset's activity (03:56 UTC), which is the window the asset page explains.
    await request(sa.app).post(`${API}/identity/imports`).set(auth).attach("file", identityCsv(["10.0.0.21,2017-07-07T03:00:00Z,2017-07-07T05:00:00Z,auth,alice,,"])).expect(201);
    const viewer = await addMember(u.orgId, "Viewer");
    const v = { Authorization: `Bearer ${viewer.token}` };
    const detail = (await request(sa.app).get(`${API}/assets/10.0.0.21`).set(v)).body;
    expect(detail).toMatchObject({ identity: null, identityRestricted: true });
    expect((await request(sa.app).get(`${API}/identity/attribution?ip=10.0.0.21&from=2017-07-07T03:00:00Z&to=2017-07-07T04:00:00Z`).set(v)).status).toBe(403);
    const analyst = await addMember(u.orgId, "Analyst");
    const an = { Authorization: `Bearer ${analyst.token}` };
    expect((await request(sa.app).get(`${API}/assets/10.0.0.21`).set(an)).body.identity.candidates[0].username).toBe("alice");
    expect((await request(sa.app).post(`${API}/identity/imports`).set(an).attach("file", identityCsv(["10.0.0.21,2017-07-07T15:00:00Z,,auth,x,,"]))).status).toBe(403);
    const other = await registerUser(sa);
    const o = (await request(sa.app).get(`${API}/identity/attribution?ip=10.0.0.21&from=2017-07-07T03:00:00Z&to=2017-07-07T04:00:00Z`).set("Authorization", `Bearer ${other.token}`)).body;
    expect(o.candidates).toEqual([]);
  });

  it("deletes an import and its records", async () => {
    const { auth } = await setup();
    const imp = await request(sa.app).post(`${API}/identity/imports`).set(auth).attach("file", identityCsv(["10.0.0.21,2017-07-07T15:00:00Z,,auth,alice,,"]));
    const del = await request(sa.app).delete(`${API}/identity/imports/${imp.body.id}`).set(auth);
    expect(del.body).toEqual({ recordsDeleted: 1 });
    const a = (await request(sa.app).get(`${API}/identity/attribution?ip=10.0.0.21&from=2017-07-07T15:00:00Z&to=2017-07-07T16:00:00Z`).set(auth)).body;
    expect(a.candidates).toEqual([]);
  });
});
