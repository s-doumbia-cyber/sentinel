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
    expect(server).toMatchObject({ scope: "internal", flowsAsDestination: 7, flowsAsSource: 0, distinctPeers: 2, distinctServices: 1 });
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

  it("records what changed between refreshes, without scan noise or duplicates", async () => {
    const { auth, datasetId } = await setup();
    const history = async (ip: string) =>
      (await request(sa.app).get(`${API}/assets/${ip}/history`).set(auth)).body.items as { kind: string; actor: string | null; eventTime: string | null; detail: Record<string, unknown> }[];
    expect((await history("10.0.0.80")).map((e) => e.kind)).toEqual(["first_observed"]);
    expect((await history("10.0.0.80"))[0]?.detail).toMatchObject({ services: ["TCP/80"], estimate: "Web server" });

    // A new SSH service (5 flows) and a 2-port probe on the same server arrive in a second file.
    const more: CsvRow[] = [
      ...Array.from({ length: 5 }, () => ({ srcIp: "10.0.0.21", dstIp: "10.0.0.80", timestamp: "7/7/2017 4:10", raw: { "Destination Port": "22" } })),
      ...["3389", "5900"].map((port) => ({ srcIp: "10.0.0.66", dstIp: "10.0.0.80", timestamp: "7/7/2017 4:11", raw: { "Destination Port": port } })),
    ];
    await request(sa.app).post(`${API}/imports/csv`).set(auth).attach("file", writeCsv(more)).expect(202);
    await sa.jobs.idle();
    // Two overlapping refreshes must not record the change twice.
    await Promise.all([request(sa.app).post(`${API}/assets/refresh`).set(auth), request(sa.app).post(`${API}/assets/refresh`).set(auth)]);
    await sa.jobs.idle();
    const after = await history("10.0.0.80");
    expect(after.filter((e) => e.kind === "service_observed").map((e) => e.detail.service)).toEqual(["TCP/22"]);
    expect(after.find((e) => e.kind === "service_observed")?.eventTime).toBe("2017-07-07T04:10:00.000Z");
    expect((await history("10.0.0.66")).map((e) => e.kind)).toEqual(["first_observed"]);

    await request(sa.app).patch(`${API}/assets/10.0.0.80`).set(auth).send({ notes: "Owned by IT" }).expect(200);
    const noted = (await history("10.0.0.80"))[0];
    expect(noted).toMatchObject({ kind: "notes_updated", detail: { fields: ["notes"] } });
    expect(noted?.actor).toBeTruthy();

    // Deleting the first file removes 10.0.0.22 and 8.8.8.8 entirely, and the web service from 10.0.0.80.
    await request(sa.app).delete(`${API}/datasets/${datasetId}`).set(auth).expect(200);
    await request(sa.app).post(`${API}/assets/refresh`).set(auth).expect(202);
    await sa.jobs.idle();
    expect((await history("10.0.0.22"))[0]?.kind).toBe("became_inactive");
    const kinds = (await history("10.0.0.80")).map((e) => e.kind);
    expect(kinds).toContain("service_gone");
    expect(kinds).toContain("estimate_changed");
    expect((await history("10.0.0.80")).find((e) => e.kind === "estimate_changed")?.detail).toMatchObject({ from: "Web server" });
    // Re-importing brings the address back.
    await request(sa.app).post(`${API}/imports/csv`).set(auth).attach("file", writeCsv(traffic)).expect(202);
    await sa.jobs.idle();
    // Same services as before it went inactive: only the reactivation is recorded.
    expect((await history("10.0.0.22")).map((e) => e.kind)).toEqual(["reactivated", "became_inactive", "first_observed"]);
    expect((await request(sa.app).get(`${API}/assets/10.0.0.99/history`).set(auth)).status).toBe(404);
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

  it("looks up an account or device: addresses held, windows, and alerts during those windows", async () => {
    const { u, auth } = await setup();
    // A port scan from 10.0.0.21 at 03:56 UTC raises a rule alert.
    const scan: CsvRow[] = Array.from({ length: 120 }, (_, i) => ({ srcIp: "10.0.0.21", dstIp: "10.0.0.80", raw: { "Destination Port": String(1000 + i), "Total Fwd Packets": "1", "Total Backward Packets": "1" } }));
    await request(sa.app).post(`${API}/imports/csv`).set(auth).attach("file", writeCsv(scan)).expect(202);
    await sa.jobs.idle();
    await request(sa.app)
      .post(`${API}/identity/imports`)
      .set(auth)
      .attach(
        "file",
        identityCsv([
          "10.0.0.21,2017-07-07T03:00:00Z,2017-07-07T05:00:00Z,vpn,alice,,",
          "10.0.0.31,2017-07-08T09:00:00Z,2017-07-08T10:00:00Z,vpn,Alice,,",
          "10.0.0.22,2017-07-07T08:00:00Z,,dhcp,,LAPTOP-22,AA:BB:CC:DD:EE:FF",
        ]),
      )
      .expect(201);

    const res = await request(sa.app).get(`${API}/identity/lookup?q=ALICE`).set(auth);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ query: "ALICE", matchedOn: ["username"], truncated: false });
    expect(res.body.records).toHaveLength(2);
    expect(res.body.records[0]).toMatchObject({ ip: "10.0.0.31", source: "vpn", sourceLabel: expect.any(String), importName: expect.stringMatching(/\.csv$/) });
    const held = Object.fromEntries((res.body.addresses as { ip: string; alerts: { type: string; role: string; duringRecords: string[] }[] }[]).map((a) => [a.ip, a]));
    expect(held["10.0.0.21"]?.alerts).toHaveLength(1);
    expect(held["10.0.0.21"]?.alerts[0]).toMatchObject({ type: "PortScan", role: "source" });
    expect(held["10.0.0.21"]?.alerts[0]?.duringRecords).toHaveLength(1);
    // Outside the window: the address held the next day has no alert attached to Alice.
    expect(held["10.0.0.31"]?.alerts).toEqual([]);
    expect(res.body.caveats.join(" ")).toMatch(/not necessarily this account/);

    expect((await request(sa.app).get(`${API}/identity/lookup?q=aa:bb:cc:dd:ee:ff`).set(auth)).body.matchedOn).toEqual(["mac"]);
    expect((await request(sa.app).get(`${API}/identity/lookup?q=laptop-22`).set(auth)).body.matchedOn).toEqual(["hostname"]);
    // Input is matched literally, never as a pattern.
    expect((await request(sa.app).get(`${API}/identity/lookup?q=.*`).set(auth)).body.records).toEqual([]);
    expect((await request(sa.app).get(`${API}/identity/lookup?q=`).set(auth)).status).toBe(400);

    const lookups = await AuditLog.find({ orgId: oid(u.orgId), action: "identity.lookup" }).lean();
    expect(lookups).toHaveLength(4);
    expect(lookups.map((l) => (l.meta as { query: string }).query)).toContain("ALICE");

    const history = (await request(sa.app).get(`${API}/identity/addresses/10.0.0.22`).set(auth)).body;
    expect(history.records).toHaveLength(1);
    expect(history.records[0]).toMatchObject({ hostname: "LAPTOP-22", mac: "aa:bb:cc:dd:ee:ff", validTo: null });

    const viewer = await addMember(u.orgId, "Viewer");
    const v = { Authorization: `Bearer ${viewer.token}` };
    expect((await request(sa.app).get(`${API}/identity/lookup?q=alice`).set(v)).status).toBe(403);
    expect((await request(sa.app).get(`${API}/identity/addresses/10.0.0.22`).set(v)).status).toBe(403);
    const other = await registerUser(sa);
    expect((await request(sa.app).get(`${API}/identity/lookup?q=alice`).set("Authorization", `Bearer ${other.token}`)).body.records).toEqual([]);
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
