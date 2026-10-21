import request from "supertest";
import { describe, expect, it } from "vitest";
import { severityRank } from "@sentinel/shared";
import { Alert, Flow, Incident } from "../src/models/tenant.js";
import { API, addMember, buildApp, oid, registerUser } from "./helpers.js";

const sa = buildApp();

const T0 = new Date("2026-10-19T09:00:00Z");
const minutes = (n: number) => new Date(T0.getTime() + n * 60_000);

function flow(orgId: string, src: string, dst: string, at: Date, extra: Record<string, unknown> = {}) {
  return {
    orgId: oid(orgId),
    sourceKind: "DEMO",
    timestamp: at,
    sourceIp: src,
    destinationIp: dst,
    sourcePort: 40000,
    destinationPort: 22,
    protocol: "TCP",
    featureSchema: "cicids2017-v1",
    scoreStatus: "pending",
    ...extra,
  };
}

let alertSeq = 0;
const alertDoc = (orgId: string, over: Record<string, unknown>) => ({
  orgId: oid(orgId),
  dedupeKey: `k-${alertSeq++}`,
  type: "PortScan",
  severityRank: severityRank("medium"),
  status: "open",
  count: 1,
  firstSeen: minutes(0),
  lastSeen: minutes(5),
  ...over,
});

async function seed() {
  const u = await registerUser(sa);
  await Flow.insertMany([
    ...Array.from({ length: 5 }, (_, i) => flow(u.orgId, "10.0.0.66", "10.0.0.20", minutes(i))),
    ...Array.from({ length: 2 }, (_, i) => flow(u.orgId, "10.0.0.20", "10.0.0.66", minutes(i))),
    flow(u.orgId, "10.0.0.66", "8.8.8.8", minutes(1), {
      scoreStatus: "scored",
      scored: { modelVersion: "m", label: "PortScan", confidence: 0.9, severity: "medium", needsReview: false, scoredAt: T0 },
    }),
    flow(u.orgId, "8.8.8.8", "1.1.1.1", minutes(2)), // two hops from the centre
    flow(u.orgId, "10.0.0.66", "10.0.0.21", minutes(600)), // outside a narrow range
  ]);
  await Alert.create(alertDoc(u.orgId, { srcIp: "10.0.0.66", dstIp: "10.0.0.20", severityRank: severityRank("high") }));
  await Alert.create(alertDoc(u.orgId, { srcIp: "10.0.0.66", dstIp: null, type: "DDoS", severityRank: severityRank("critical") }));
  await Alert.create(alertDoc(u.orgId, { srcIp: "10.0.0.66", dstIp: "8.8.8.8", status: "dismissed", severityRank: severityRank("critical") }));
  return { u, auth: { Authorization: `Bearer ${u.token}` } };
}

type N = { id: string; seed: boolean; scope: string; alerts: { count: number; maxSeverity: string } | null };
type E = { source: string; target: string; flows: number };

describe("entity graph", () => {
  it("aggregates directed edges with flow counts, model-flagged counts and alert markers", async () => {
    const { auth } = await seed();
    const res = await request(sa.app).get(`${API}/entities/ip/10.0.0.66/graph`).set(auth);
    expect(res.status).toBe(200);
    const nodes: N[] = res.body.nodes;
    const edges: E[] = res.body.edges;
    expect(res.body.seeds).toEqual(["10.0.0.66"]);
    expect(res.body.truncated).toEqual({ nodes: false, edges: false });
    expect(nodes.map((n) => n.id).sort()).toEqual(["10.0.0.20", "10.0.0.21", "10.0.0.66", "8.8.8.8"]);
    expect(nodes[0]).toMatchObject({ id: "10.0.0.66", seed: true });
    const edge = (s: string, d: string) => edges.find((e) => e.source === s && e.target === d);
    expect(edge("10.0.0.66", "10.0.0.20")).toMatchObject({ flows: 5, maliciousFlows: 0, alerts: { count: 1, maxSeverity: "high" } });
    // Directions stay separate.
    expect(edge("10.0.0.20", "10.0.0.66")).toMatchObject({ flows: 2, alerts: null });
    // Model verdicts count, dataset labels never do.
    expect(edge("10.0.0.66", "8.8.8.8")).toMatchObject({ flows: 1, maliciousFlows: 1, alerts: null });
    // Node markers: the dismissed alert is ignored, the many-targets alert still marks its source.
    const node = (id: string) => nodes.find((n) => n.id === id);
    expect(node("10.0.0.66")?.alerts).toEqual({ count: 2, maxSeverity: "critical" });
    expect(node("10.0.0.20")?.alerts).toEqual({ count: 1, maxSeverity: "high" });
    expect(node("8.8.8.8")?.alerts).toBeNull();
    expect(node("10.0.0.66")?.scope).toBe("internal");
    expect(node("8.8.8.8")?.scope).toBe("external");
  });

  it("honours the time range and the depth", async () => {
    const { auth } = await seed();
    const ids = (body: { nodes: N[] }) => body.nodes.map((n) => n.id);
    const narrow = await request(sa.app).get(`${API}/entities/ip/10.0.0.66/graph`).query({ from: minutes(0).toISOString(), to: minutes(10).toISOString() }).set(auth);
    expect(ids(narrow.body)).not.toContain("10.0.0.21");
    expect(narrow.body.range.to).toBe(minutes(10).toISOString());
    const deep = await request(sa.app).get(`${API}/entities/ip/10.0.0.66/graph`).query({ depth: 2 }).set(auth);
    expect(ids(deep.body)).toContain("1.1.1.1");
    expect(deep.body.limits.depth).toBe(2);
    const shallow = await request(sa.app).get(`${API}/entities/ip/10.0.0.66/graph`).set(auth);
    expect(ids(shallow.body)).not.toContain("1.1.1.1");
  });

  it("returns a lone seed for an address with no flows", async () => {
    const { auth } = await seed();
    const res = await request(sa.app).get(`${API}/entities/ip/192.0.2.99/graph`).set(auth);
    expect(res.status).toBe(200);
    expect(res.body.nodes).toHaveLength(1);
    expect(res.body.edges).toEqual([]);
  });

  it("validates its input", async () => {
    const { auth } = await seed();
    const get = (path: string, query: Record<string, string | number> = {}) => request(sa.app).get(`${API}${path}`).query(query).set(auth);
    expect((await get("/entities/ip/not-an-ip/graph")).status).toBe(400);
    expect((await get("/entities/ip/10.0.0.66/graph", { maxNodes: 5000 })).status).toBe(400);
    expect((await get("/entities/ip/10.0.0.66/graph", { depth: 3 })).status).toBe(400);
    expect((await get("/entities/ip/10.0.0.66/graph", { from: "2026-10-20T00:00:00Z", to: "2026-10-19T00:00:00Z" })).status).toBe(400);
  });

  it("is scoped to the caller organisation", async () => {
    const { u } = await seed();
    const other = await registerUser(sa);
    const res = await request(sa.app).get(`${API}/entities/ip/10.0.0.66/graph`).set("Authorization", `Bearer ${other.token}`);
    expect(res.body.nodes).toHaveLength(1);
    expect(res.body.edges).toEqual([]);
    expect(u.orgId).not.toBe(other.orgId);
  });

  it("lets every role read it (assets:read) and requires a token", async () => {
    const { u } = await seed();
    const viewer = await addMember(u.orgId, "Viewer");
    expect((await request(sa.app).get(`${API}/entities/ip/10.0.0.66/graph`).set("Authorization", `Bearer ${viewer.token}`)).status).toBe(200);
    expect((await request(sa.app).get(`${API}/entities/ip/10.0.0.66/graph`)).status).toBe(401);
  });

  it("caps nodes and edges and says so, keeping the busiest edges and the seed", async () => {
    const u = await registerUser(sa);
    const auth = { Authorization: `Bearer ${u.token}` };
    // 600 distinct peers; peer n sent (n % 7) + 1 flows, so busier peers must win the budget.
    const docs = [];
    for (let n = 0; n < 600; n++) {
      const peer = `10.${Math.floor(n / 250)}.1.${(n % 250) + 1}`;
      for (let k = 0; k <= n % 7; k++) docs.push(flow(u.orgId, peer, "10.9.9.9", minutes(k)));
    }
    await Flow.insertMany(docs);
    const started = performance.now();
    const res = await request(sa.app).get(`${API}/entities/ip/10.9.9.9/graph`).query({ maxNodes: 500, maxEdges: 2000 }).set(auth);
    const elapsed = performance.now() - started;
    expect(res.status).toBe(200);
    expect(res.body.nodes).toHaveLength(500);
    expect(res.body.edges).toHaveLength(499);
    expect(res.body.truncated.nodes).toBe(true);
    expect(res.body.nodes[0].id).toBe("10.9.9.9");
    // The busiest peers (7 flows) are kept: dropped ones are all from the thinner end.
    expect(Math.min(...(res.body.edges as E[]).map((e) => e.flows))).toBeGreaterThanOrEqual(2);
    const ids = new Set((res.body.nodes as N[]).map((n) => n.id));
    expect((res.body.edges as E[]).every((e) => ids.has(e.source) && ids.has(e.target))).toBe(true);
    // The roadmap target (3.4) is 500 ms; the margin absorbs a loaded CI runner.
    expect(elapsed).toBeLessThan(1500);

    const small = await request(sa.app).get(`${API}/entities/ip/10.9.9.9/graph`).query({ maxNodes: 10 }).set(auth);
    expect(small.body.nodes).toHaveLength(10);
    expect(small.body.truncated.nodes).toBe(true);
    const fewerEdges = await request(sa.app).get(`${API}/entities/ip/10.9.9.9/graph`).query({ maxEdges: 5, maxNodes: 500 }).set(auth);
    expect(fewerEdges.body.edges).toHaveLength(5);
    expect(fewerEdges.body.truncated.edges).toBe(true);
  });
});

describe("incident graph", () => {
  it("seeds with every address on the incident and defaults to its activity window", async () => {
    const u = await registerUser(sa);
    const auth = { Authorization: `Bearer ${u.token}` };
    await Flow.insertMany([flow(u.orgId, "10.0.0.66", "10.0.0.20", minutes(1)), flow(u.orgId, "10.0.0.66", "10.0.0.20", minutes(900))]);
    const inc = await Incident.create({
      orgId: oid(u.orgId),
      title: "Scan",
      attackType: "PortScan",
      severity: "medium",
      sourceIp: "10.0.0.66",
      entities: [
        { type: "ip", value: "10.0.0.66", role: "source" },
        { type: "ip", value: "10.0.0.20", role: "target" },
      ],
      firstSeen: minutes(0),
      lastSeen: minutes(10),
    });
    const res = await request(sa.app).get(`${API}/incidents/${inc._id}/graph`).set(auth);
    expect(res.status).toBe(200);
    expect((res.body.seeds as string[]).sort()).toEqual(["10.0.0.20", "10.0.0.66"]);
    expect(res.body.range.from).toBe(minutes(0).toISOString());
    expect(res.body.edges).toHaveLength(1);
    // Only the flow inside the incident window counts.
    expect(res.body.edges[0].flows).toBe(1);
    const other = await registerUser(sa);
    expect((await request(sa.app).get(`${API}/incidents/${inc._id}/graph`).set("Authorization", `Bearer ${other.token}`)).status).toBe(404);
  });
});
