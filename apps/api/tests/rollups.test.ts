import request from "supertest";
import { describe, expect, it } from "vitest";
import type { StatsQuery } from "@sentinel/shared";
import { FlowRollup, RollupState } from "../src/models/rollups.js";
import { Flow } from "../src/models/tenant.js";
import { RAW_PLAN } from "../src/modules/stats/rollup.queries.js";
import { breakdown, evaluation, overview, timeseries, top } from "../src/modules/stats/stats.service.js";
import { API, FakeMl, buildApp, oid, registerUser, writeCsv, type CsvRow } from "./helpers.js";

const sa = buildApp({ ml: new FakeMl() });

const rows: CsvRow[] = [
  ...Array.from({ length: 6 }, () => ({ label: "DDoS", srcIp: "172.16.0.1", dstIp: "192.168.10.50", timestamp: "7/7/2017 3:56", features: { "Flow Packets/s": "5000" } })),
  ...Array.from({ length: 4 }, () => ({ label: "DDoS", srcIp: "172.16.0.9", dstIp: "192.168.10.51", timestamp: "7/7/2017 4:00", features: { "Flow Packets/s": "9000" } })),
  // Labelled DDoS but the (fake) model says Normal: a false negative for the evaluation.
  ...Array.from({ length: 3 }, () => ({ label: "DDoS", srcIp: "172.16.0.9", dstIp: "192.168.10.51", timestamp: "7/7/2017 4:10" })),
  ...Array.from({ length: 5 }, (_, i) => ({ label: "BENIGN", srcIp: `10.0.0.${i + 1}`, timestamp: "7/7/2017 4:00" })),
  ...Array.from({ length: 2 }, () => ({ label: "PortScan", srcIp: "10.9.9.9", timestamp: "8/7/2017 9:15", features: { "Flow Duration": "7" } })),
];

async function setup() {
  const u = await registerUser(sa);
  const auth = { Authorization: `Bearer ${u.token}` };
  await request(sa.app).post(`${API}/models/bench-a/activate`).set(auth).expect(200);
  await request(sa.app).post(`${API}/imports/csv`).set(auth).attach("file", writeCsv(rows)).expect(202);
  await sa.jobs.idle();
  return { u, auth };
}

const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as unknown;

const QUERIES: [string, StatsQuery][] = [
  ["everything", {}],
  // Partial minutes at both ends: 03:55:30 → 04:00:30 takes the 04:00:00 flows from raw edges.
  ["partial-minute range", { from: "2017-07-07T03:55:30.000Z", to: "2017-07-07T04:00:30.000Z" }],
  ["range inside one minute", { from: "2017-07-07T04:00:00.000Z", to: "2017-07-07T04:00:20.000Z" }],
  ["malicious only", { verdict: "malicious" }],
  ["one class", { verdict: "DDoS" }],
  ["unscored", { verdict: "unscored" }],
  ["protocol", { protocol: "TCP" }],
  ["needs review", { needsReview: "true" }],
];

describe("stats rollups", () => {
  it("answer every stats endpoint exactly like the raw flows", async () => {
    const { u, auth } = await setup();
    const orgId = oid(u.orgId);
    expect((await RollupState.findById(orgId).lean())?.builtVersion).toBe((await RollupState.findById(orgId).lean())?.version);
    expect(await FlowRollup.countDocuments({ orgId })).toBeGreaterThan(0);

    for (const [name, q] of QUERIES) {
      const qs = new URLSearchParams(q as Record<string, string>).toString();
      const get = (path: string) => request(sa.app).get(`${API}${path}${path.includes("?") ? "&" : "?"}${qs}`).set(auth).expect(200);

      const ov = await get("/stats/overview");
      expect(ov.headers["x-sentinel-stats-source"], name).toBe("rollup");
      expect(ov.body, name).toEqual(json(await overview(orgId, q, RAW_PLAN)));
      for (const by of ["verdict", "severity", "protocol", "sourceKind", "groundTruth"] as const) {
        const b = await get(`/stats/breakdown?by=${by}`);
        const raw = await breakdown(orgId, q, by, RAW_PLAN);
        expect(new Map(b.body.items.map((i: { key: string; count: number }) => [i.key, i.count])), `${name} ${by}`).toEqual(new Map(raw.map((i) => [i.key, i.count])));
      }
      expect((await get("/stats/timeseries")).body, name).toEqual(json(await timeseries(orgId, q, RAW_PLAN)));
      for (const kind of ["attackers", "targets", "ports", "subnets"] as const) {
        expect((await get(`/stats/top?kind=${kind}&limit=10`)).body.items, `${name} ${kind}`).toEqual(json(await top(orgId, q, kind, 10, RAW_PLAN)));
      }
      expect((await get("/stats/evaluation")).body, name).toEqual(json(await evaluation(orgId, q, RAW_PLAN)));
    }
  });

  it("fall back to raw flows as soon as flows change, and rebuild on the next read", async () => {
    const { u, auth } = await setup();
    const orgId = oid(u.orgId);
    const before = (await request(sa.app).get(`${API}/stats/overview`).set(auth)).body.totalFlows as number;

    await Flow.create({
      orgId,
      sourceKind: "IMPORTED",
      timestamp: new Date("2017-07-07T05:00:00Z"),
      sourceIp: "10.1.1.1",
      destinationIp: "10.1.1.2",
      sourcePort: 1,
      destinationPort: 2,
      protocol: "UDP",
      featureSchema: "cicids2017-v1",
      scoreStatus: "pending",
    });
    const stale = await request(sa.app).get(`${API}/stats/overview`).set(auth).expect(200);
    expect(stale.headers["x-sentinel-stats-source"]).toBe("raw");
    expect(stale.body.totalFlows).toBe(before + 1);

    await sa.jobs.idle();
    const fresh = await request(sa.app).get(`${API}/stats/overview`).set(auth).expect(200);
    expect(fresh.headers["x-sentinel-stats-source"]).toBe("rollup");
    expect(fresh.body.totalFlows).toBe(before + 1);
    // Only one generation of rows is kept.
    const gens = await FlowRollup.distinct("gen", { orgId });
    expect(gens).toHaveLength(1);
  });

  it("stay fresh when only alert bookkeeping fields change", async () => {
    const { u } = await setup();
    const orgId = oid(u.orgId);
    const s = await RollupState.findById(orgId).lean();
    await Flow.updateMany({ orgId, alertedAt: { $ne: null } }, { $set: { alertedAt: new Date() } });
    expect((await RollupState.findById(orgId).lean())?.version).toBe(s?.version);
    await Flow.updateMany({ orgId, scoreStatus: "error" }, { $set: { scoreStatus: "pending" } });
    expect((await RollupState.findById(orgId).lean())?.version).toBe((s?.version ?? 0) + 1);
  });
});
