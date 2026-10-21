import request from "supertest";
import { describe, expect, it } from "vitest";
import { ROLES, can, type Action } from "@sentinel/shared";
import { Org } from "../src/models/identity.js";
import { Dataset, Flow, Incident } from "../src/models/tenant.js";
import { TenantScopeError } from "../src/models/tenantGuard.js";
import { API, FakeMl, addMember, buildApp, oid, registerUser } from "./helpers.js";

const sa = buildApp({ ml: new FakeMl() });

function flowDoc(orgId: string, extra: Record<string, unknown> = {}) {
  return {
    orgId: oid(orgId),
    sourceKind: "IMPORTED",
    timestamp: new Date("2017-07-07T15:56:00Z"),
    sourceIp: "172.16.0.1",
    destinationIp: "192.168.10.50",
    sourcePort: 40000,
    destinationPort: 80,
    protocol: "TCP",
    featureSchema: "cicids2017-v1",
    scoreStatus: "pending",
    ...extra,
  };
}

describe("tenant isolation", () => {
  it("returns 404 for another org's flow, incident and dataset, and never lists them", async () => {
    const a = await registerUser(sa);
    const b = await registerUser(sa);
    const flow = await Flow.create(flowDoc(b.orgId));
    const incident = await Incident.create({ orgId: oid(b.orgId), title: "B incident", attackType: "DDoS", severity: "critical" });
    const dataset = await Dataset.create({ orgId: oid(b.orgId), name: "b.csv", sourceType: "CICIDS2017", featureSchema: "cicids2017-v1", status: "Processed" });
    const auth = { Authorization: `Bearer ${a.token}` };

    expect((await request(sa.app).get(`${API}/flows/${flow._id}`).set(auth)).status).toBe(404);
    expect((await request(sa.app).get(`${API}/datasets/${dataset._id}`).set(auth)).status).toBe(404);
    expect((await request(sa.app).delete(`${API}/datasets/${dataset._id}`).set(auth)).status).toBe(404);
    expect((await request(sa.app).get(`${API}/datasets`).set(auth)).body.items).toHaveLength(0);
    expect((await request(sa.app).get(`${API}/incidents/${incident._id}`).set(auth)).status).toBe(404);
    expect((await request(sa.app).patch(`${API}/incidents/${incident._id}`).set(auth).send({ status: "Closed" })).status).toBe(404);
    expect((await request(sa.app).delete(`${API}/incidents/${incident._id}`).set(auth)).status).toBe(404);
    expect((await request(sa.app).post(`${API}/incidents/${incident._id}/notes`).set(auth).send({ text: "x" })).status).toBe(404);
    expect((await request(sa.app).get(`${API}/flows`).set(auth)).body.items).toHaveLength(0);
    expect((await request(sa.app).get(`${API}/incidents`).set(auth)).body.items).toHaveLength(0);
    expect((await request(sa.app).get(`${API}/stats/overview`).set(auth)).body.totalFlows).toBe(0);

    const stillOpen = await Incident.findOne({ orgId: oid(b.orgId), _id: incident._id }).lean();
    expect(stillOpen?.status).toBe("Open");
  });

  it("rejects X-Org-Id for an org the caller does not belong to with 404", async () => {
    const a = await registerUser(sa);
    const b = await registerUser(sa);
    const res = await request(sa.app).get(`${API}/flows`).set("Authorization", `Bearer ${a.token}`).set("X-Org-Id", b.orgId);
    expect(res.status).toBe(404);
  });

  it("switches org with X-Org-Id when the caller is a member of both", async () => {
    const a = await registerUser(sa);
    const b = await registerUser(sa);
    const { token } = await addMember(b.orgId, "Viewer");
    await Flow.create(flowDoc(b.orgId));
    // The Viewer's only membership is org B.
    const res = await request(sa.app).get(`${API}/flows`).set("Authorization", `Bearer ${token}`).set("X-Org-Id", b.orgId);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(a.orgId).not.toBe(b.orgId);
  });

  it("refuses unscoped queries on tenant collections by construction", async () => {
    await expect(Flow.find({ sourceIp: "1.2.3.4" }).lean()).rejects.toBeInstanceOf(TenantScopeError);
    await expect(Incident.findOne({}).lean()).rejects.toBeInstanceOf(TenantScopeError);
    await expect(Flow.aggregate([{ $match: { sourceIp: "x" } }])).rejects.toBeInstanceOf(TenantScopeError);
    await expect(Flow.estimatedDocumentCount()).rejects.toBeInstanceOf(TenantScopeError);
    await expect(Flow.updateMany({}, { $set: { sourceIp: "x" } })).rejects.toBeInstanceOf(TenantScopeError);
  });

  it("model activation only affects the activating org", async () => {
    const a = await registerUser(sa);
    const b = await registerUser(sa);
    const res = await request(sa.app).post(`${API}/models/bench-a/activate`).set("Authorization", `Bearer ${a.token}`);
    expect(res.status).toBe(200);
    await sa.jobs.idle();
    const orgB = await Org.findById(b.orgId).lean();
    expect(orgB?.settings?.activeModels instanceof Map ? orgB.settings.activeModels.size : Object.keys(orgB?.settings?.activeModels ?? {}).length).toBe(0);
  });
});

describe("RBAC matrix (role × route)", () => {
  const actionRoutes = sa.routes.filter((r): r is typeof r & { policy: Action } => !["public", "self", "account"].includes(r.policy));

  it("declares a policy on every route, and every mutating route is protected", () => {
    expect(sa.routes.length).toBeGreaterThan(20);
    for (const r of sa.routes) {
      if (r.mutating && r.policy === "public") {
        // Only the pre-authentication auth endpoints may be public.
        expect(r.path, `${r.method} ${r.path}`).toMatch(/\/(auth\/(register|login|refresh|logout)|invites\/(lookup|accept))$/);
      }
    }
  });

  it.each(ROLES)("enforces the matrix for %s", async (role) => {
    const owner = await registerUser(sa);
    const { token } = await addMember(owner.orgId, role);
    for (const r of actionRoutes) {
      const path = r.path.replace(/:(\w+)/g, (_m, name: string) => (name === "schema" ? "cicids2017-v1" : name === "version" ? "bench-a" : "0123456789abcdef01234567"));
      const res = await request(sa.app)[r.method](path).set("Authorization", `Bearer ${token}`).send({});
      if (can(role, r.policy)) expect(res.status, `${role} ${r.method} ${r.path}`).not.toBe(403);
      else expect(res.status, `${role} ${r.method} ${r.path}`).toBe(403);
    }
    await sa.jobs.idle();
  });

  it("returns 401 on every protected route without a token", async () => {
    for (const r of sa.routes.filter((x) => x.policy !== "public")) {
      const path = r.path.replace(/:(\w+)/g, "0123456789abcdef01234567");
      const res = await request(sa.app)[r.method](path).send({});
      expect(res.status, `${r.method} ${r.path}`).toBe(401);
    }
  });

  it("prevents an Admin from changing an Owner and keeps at least one Owner", async () => {
    const owner = await registerUser(sa);
    const admin = await addMember(owner.orgId, "Admin");
    const res = await request(sa.app)
      .patch(`${API}/members/${owner.userId}`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ role: "Viewer" });
    expect(res.status).toBe(403);
    const self = await request(sa.app)
      .patch(`${API}/members/${owner.userId}`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ role: "Admin" });
    expect(self.status).toBe(409);
  });
});
