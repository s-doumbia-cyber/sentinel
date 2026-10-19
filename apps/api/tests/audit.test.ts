import request from "supertest";
import { describe, expect, it } from "vitest";
import { AuditLog, Dataset, Incident } from "../src/models/tenant.js";
import { API, FakeMl, addMember, buildApp, oid, registerUser, writeCsv } from "./helpers.js";

const sa = buildApp({ ml: new FakeMl() });

async function auditCount(orgId: string, action: string) {
  return AuditLog.countDocuments({ orgId: oid(orgId), action });
}

describe("audit log", () => {
  it("writes exactly one entry per mutating action", async () => {
    const u = await registerUser(sa);
    const auth = { Authorization: `Bearer ${u.token}` };
    const member = await addMember(u.orgId, "Analyst");

    const created = await request(sa.app)
      .post(`${API}/incidents`)
      .set(auth)
      .send({ title: "Port scan from 10.0.0.1", attackType: "PortScan", severity: "low" });
    expect(created.status).toBe(201);
    const id = created.body.id as string;
    await request(sa.app).patch(`${API}/incidents/${id}`).set(auth).send({ status: "Investigating", assigneeId: member.userId }).expect(200);
    await request(sa.app).post(`${API}/incidents/${id}/notes`).set(auth).send({ text: "Looking into it" }).expect(201);
    await request(sa.app).delete(`${API}/incidents/${id}`).set(auth).expect(204);
    await request(sa.app).patch(`${API}/members/${member.userId}`).set(auth).send({ role: "Viewer" }).expect(200);
    await request(sa.app).patch(`${API}/me`).set(auth).send({ name: "Renamed" }).expect(200);
    const imp = await request(sa.app).post(`${API}/imports/csv`).set(auth).attach("file", writeCsv([{}]));
    await sa.jobs.idle();
    await request(sa.app).delete(`${API}/datasets/${imp.body.id}`).set(auth).expect(200);
    await request(sa.app).post(`${API}/models/bench-a/activate`).set(auth).expect(200);
    await request(sa.app).post(`${API}/scoring/run`).set(auth).expect(202);
    await sa.jobs.idle();

    for (const action of [
      "auth.register",
      "incident.create",
      "incident.update",
      "incident.note",
      "incident.delete",
      "member.role_change",
      "user.update_profile",
      "dataset.import",
      "dataset.delete",
      "model.activate",
      "scoring.run",
    ]) {
      expect(await auditCount(u.orgId, action), action).toBe(1);
    }
    const update = await AuditLog.findOne({ orgId: oid(u.orgId), action: "incident.update" }).lean();
    expect(update?.meta).toMatchObject({ changes: { status: { from: "Open", to: "Investigating" } } });
    expect(update?.actorId?.toString()).toBe(u.userId);
    expect(update?.requestId).toEqual(expect.any(String));
  });

  it("does not write an entry for a rejected mutation", async () => {
    const u = await registerUser(sa);
    const viewer = await addMember(u.orgId, "Viewer");
    await request(sa.app)
      .post(`${API}/incidents`)
      .set("Authorization", `Bearer ${viewer.token}`)
      .send({ title: "Nope", attackType: "DDoS", severity: "high" })
      .expect(403);
    expect(await auditCount(u.orgId, "incident.create")).toBe(0);
    expect(await Incident.countDocuments({ orgId: oid(u.orgId) })).toBe(0);
    expect(await Dataset.countDocuments({ orgId: oid(u.orgId) })).toBe(0);
  });

  it("is append-only and readable only by Owners and Admins", async () => {
    const u = await registerUser(sa);
    await expect(AuditLog.updateMany({ orgId: oid(u.orgId) }, { $set: { action: "x" } })).rejects.toThrow(/append-only/);
    await expect(AuditLog.deleteMany({ orgId: oid(u.orgId) })).rejects.toThrow(/append-only/);
    const list = await request(sa.app).get(`${API}/audit`).set("Authorization", `Bearer ${u.token}`);
    expect(list.status).toBe(200);
    expect(list.body.items[0].action).toBe("auth.register");
    const analyst = await addMember(u.orgId, "Analyst");
    expect((await request(sa.app).get(`${API}/audit`).set("Authorization", `Bearer ${analyst.token}`)).status).toBe(403);
  });
});
