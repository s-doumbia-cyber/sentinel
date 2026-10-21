import request from "supertest";
import { describe, expect, it } from "vitest";
import { sha256 } from "../src/lib/crypto.js";
import { Membership, User } from "../src/models/identity.js";
import { Invite } from "../src/models/invites.js";
import { AuditLog } from "../src/models/tenant.js";
import { API, PASSWORD, addMember, buildApp, oid, refreshCookieFrom, registerUser } from "./helpers.js";

const sa = buildApp();
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

async function invite(token: string, body: Record<string, unknown>) {
  return request(sa.app).post(`${API}/invites`).set(bearer(token)).send(body);
}

describe("invitations", () => {
  it("creates a single-use link shown once, and a new person joins with the invited role", async () => {
    const owner = await registerUser(sa);
    const created = await invite(owner.token, { email: "New.Analyst@Example.com", role: "Analyst" });
    expect(created.status).toBe(201);
    const token = created.body.token as string;
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(created.body.email).toBe("new.analyst@example.com");

    // Only the hash is stored, and the list never repeats the token.
    const stored = await Invite.findById(created.body.id).lean();
    expect(stored?.tokenHash).toBe(sha256(token));
    expect(JSON.stringify(stored)).not.toContain(token);
    const list = await request(sa.app).get(`${API}/invites`).set(bearer(owner.token)).expect(200);
    expect(list.body.items).toEqual([expect.objectContaining({ email: "new.analyst@example.com", role: "Analyst", status: "pending", createdBy: "Test User" })]);
    expect(JSON.stringify(list.body)).not.toContain(token);

    const lookup = await request(sa.app).post(`${API}/invites/lookup`).send({ token }).expect(200);
    expect(lookup.body).toMatchObject({ role: "Analyst", email: "new.analyst@example.com", accountExists: false, orgName: "Test User's workspace" });

    const accepted = await request(sa.app).post(`${API}/invites/accept`).send({ token, name: "Nia Analyst", password: PASSWORD });
    expect(accepted.status).toBe(201);
    expect(accepted.body.orgs).toEqual([expect.objectContaining({ id: owner.orgId, role: "Analyst" })]);
    expect(refreshCookieFrom(accepted)).toMatch(/^sentinel_rt=/);
    // The invited person gets no personal workspace: only the org they were invited to.
    const user = await User.findOne({ email: "new.analyst@example.com" }).lean();
    expect(await Membership.countDocuments({ userId: user?._id })).toBe(1);
    // They can work in the org straight away with the returned access token.
    expect((await request(sa.app).get(`${API}/alerts`).set(bearer(accepted.body.accessToken))).status).toBe(200);

    // Single use: the same link fails afterwards, with the same answer as an unknown link.
    const again = await request(sa.app).post(`${API}/invites/accept`).send({ token, name: "Copy", password: PASSWORD });
    expect(again.status).toBe(404);
    expect((await request(sa.app).post(`${API}/invites/lookup`).send({ token })).status).toBe(404);
    expect((await request(sa.app).get(`${API}/invites`).set(bearer(owner.token))).body.items[0].status).toBe("accepted");

    for (const action of ["invite.create", "invite.accept"]) {
      expect(await AuditLog.countDocuments({ orgId: oid(owner.orgId), action }), action).toBe(1);
    }
    const create = await AuditLog.findOne({ orgId: oid(owner.orgId), action: "invite.create" }).lean();
    expect(JSON.stringify(create)).not.toContain(token);
  });

  it("refuses expired and revoked links, and audits the revocation", async () => {
    const owner = await registerUser(sa);
    const a = await invite(owner.token, { email: "late@example.com", role: "Viewer", expiresInDays: 1 });
    await Invite.updateOne({ _id: a.body.id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await request(sa.app).post(`${API}/invites/lookup`).send({ token: a.body.token })).status).toBe(404);
    expect((await request(sa.app).post(`${API}/invites/accept`).send({ token: a.body.token, name: "Late", password: PASSWORD })).status).toBe(404);

    const b = await invite(owner.token, { email: "revoked@example.com", role: "Viewer" });
    await request(sa.app).delete(`${API}/invites/${b.body.id}`).set(bearer(owner.token)).expect(204);
    expect((await request(sa.app).delete(`${API}/invites/${b.body.id}`).set(bearer(owner.token))).status).toBe(409);
    expect((await request(sa.app).post(`${API}/invites/accept`).send({ token: b.body.token, name: "R", password: PASSWORD })).status).toBe(404);
    expect(await AuditLog.countDocuments({ orgId: oid(owner.orgId), action: "invite.revoke" })).toBe(1);
    const statuses = (await request(sa.app).get(`${API}/invites`).set(bearer(owner.token))).body.items.map((i: { status: string }) => i.status);
    expect(statuses.sort()).toEqual(["expired", "revoked"]);
  });

  it("enforces who may invite whom, and refuses duplicates", async () => {
    const owner = await registerUser(sa);
    const admin = await addMember(owner.orgId, "Admin");
    const analyst = await addMember(owner.orgId, "Analyst");
    expect((await invite(admin.token, { email: "boss@example.com", role: "Owner" })).status).toBe(403);
    expect((await invite(analyst.token, { email: "x@example.com", role: "Viewer" })).status).toBe(403);
    const ownerInvite = await invite(owner.token, { email: "boss@example.com", role: "Owner" });
    expect(ownerInvite.status).toBe(201);
    expect((await request(sa.app).delete(`${API}/invites/${ownerInvite.body.id}`).set(bearer(admin.token))).status).toBe(403);
    expect((await invite(admin.token, { email: "boss@example.com", role: "Viewer" })).status).toBe(409);
    const member = await User.findById(analyst.userId).lean();
    expect((await invite(owner.token, { email: member?.email, role: "Viewer" })).status).toBe(409);
    expect((await invite(owner.token, { email: "y@example.com", role: "Viewer", expiresInDays: 30 })).status).toBe(400);
  });

  it("an existing account accepts while signed in, only with the invited email", async () => {
    const owner = await registerUser(sa);
    const existing = await registerUser(sa, "existing.person@example.com");
    const stranger = await registerUser(sa);
    const created = await invite(owner.token, { email: "existing.person@example.com", role: "Admin" });
    const token = created.body.token as string;

    expect((await request(sa.app).post(`${API}/invites/lookup`).send({ token })).body.accountExists).toBe(true);
    const asNew = await request(sa.app).post(`${API}/invites/accept`).send({ token, name: "Imposter", password: PASSWORD });
    expect(asNew.status).toBe(409);
    expect((await request(sa.app).post(`${API}/invites/accept-existing`).send({ token })).status).toBe(401);
    expect((await request(sa.app).post(`${API}/invites/accept-existing`).set(bearer(stranger.token)).send({ token })).status).toBe(403);

    const ok = await request(sa.app).post(`${API}/invites/accept-existing`).set(bearer(existing.token)).send({ token });
    expect(ok.status).toBe(200);
    expect(ok.body.joinedOrgId).toBe(owner.orgId);
    expect(ok.body.orgs.map((o: { id: string; role: string }) => [o.id, o.role])).toContainEqual([owner.orgId, "Admin"]);
    expect((await request(sa.app).post(`${API}/invites/accept-existing`).set(bearer(existing.token)).send({ token })).status).toBe(404);
  });

  it("someone removed from every org can still accept a new invitation", async () => {
    const owner = await registerUser(sa);
    const other = await registerUser(sa, "wanderer@example.com");
    await Membership.deleteMany({ userId: oid(other.userId) });
    expect((await request(sa.app).get(`${API}/alerts`).set(bearer(other.token))).status).toBe(403);
    const created = await invite(owner.token, { email: "wanderer@example.com", role: "Viewer" });
    const res = await request(sa.app).post(`${API}/invites/accept-existing`).set(bearer(other.token)).send({ token: created.body.token });
    expect(res.status).toBe(200);
    expect((await request(sa.app).get(`${API}/alerts`).set(bearer(other.token))).status).toBe(200);
  });

  it("rate-limits the public invitation endpoints", async () => {
    const limited = buildApp({ authRateLimit: { windowMs: 60_000, max: 3 } });
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      statuses.push((await request(limited.app).post(`${API}/invites/lookup`).send({ token: "A".repeat(43) })).status);
    }
    expect(statuses).toEqual([404, 404, 404, 429]);
  });
});

describe("member management", () => {
  it("removes a member with safeguards, ends their access immediately, and audits it", async () => {
    const owner = await registerUser(sa);
    const admin = await addMember(owner.orgId, "Admin");
    const analyst = await addMember(owner.orgId, "Analyst");

    expect((await request(sa.app).delete(`${API}/members/${owner.userId}`).set(bearer(admin.token))).status).toBe(403);
    expect((await request(sa.app).delete(`${API}/members/${owner.userId}`).set(bearer(owner.token))).status).toBe(400);
    await request(sa.app).delete(`${API}/members/${analyst.userId}`).set(bearer(admin.token)).expect(204);
    expect((await request(sa.app).delete(`${API}/members/${analyst.userId}`).set(bearer(admin.token))).status).toBe(404);
    // The removed member's existing token no longer opens this org.
    expect((await request(sa.app).get(`${API}/alerts`).set(bearer(analyst.token)).set("X-Org-Id", owner.orgId)).status).toBe(404);
    const entry = await AuditLog.findOne({ orgId: oid(owner.orgId), action: "member.remove" }).lean();
    expect(entry).toMatchObject({ target: { type: "user", id: analyst.userId }, meta: { role: "Analyst" } });
    expect(await User.exists({ _id: oid(analyst.userId) })).toBeTruthy();
  });

  it("never leaves an org without an Owner, even with two Owners demoting each other at once", async () => {
    const owner = await registerUser(sa);
    expect((await request(sa.app).post(`${API}/members/leave`).set(bearer(owner.token))).status).toBe(409);
    const second = await addMember(owner.orgId, "Owner");
    const results = await Promise.all([
      request(sa.app).patch(`${API}/members/${second.userId}`).set(bearer(owner.token)).send({ role: "Admin" }),
      request(sa.app).patch(`${API}/members/${owner.userId}`).set(bearer(second.token)).send({ role: "Admin" }),
    ]);
    // Either one demotion wins, or both see "no Owner left" and are undone (409): never zero Owners.
    // When the requests do not overlap, the second caller is already an Admin and gets 403.
    expect(await Membership.countDocuments({ orgId: oid(owner.orgId), role: "Owner" })).toBeGreaterThanOrEqual(1);
    for (const r of results) expect([200, 403, 409]).toContain(r.status);
    // Exactly the successful changes are audited.
    const okCount = results.filter((r) => r.status === 200).length;
    expect(await AuditLog.countDocuments({ orgId: oid(owner.orgId), action: "member.role_change" })).toBe(okCount);
  });

  it("lets a member leave, and an Owner leave once another Owner exists", async () => {
    const owner = await registerUser(sa);
    const viewer = await addMember(owner.orgId, "Viewer");
    await request(sa.app).post(`${API}/members/leave`).set(bearer(viewer.token)).set("X-Org-Id", owner.orgId).expect(204);
    expect(await Membership.exists({ orgId: oid(owner.orgId), userId: oid(viewer.userId) })).toBeNull();
    const second = await addMember(owner.orgId, "Owner");
    await request(sa.app).post(`${API}/members/leave`).set(bearer(owner.token)).set("X-Org-Id", owner.orgId).expect(204);
    const left = await AuditLog.find({ orgId: oid(owner.orgId), action: "member.leave" }).sort({ _id: 1 }).lean();
    expect(left.map((e) => e.meta)).toEqual([{ role: "Viewer" }, { role: "Owner" }]);
    expect(await Membership.countDocuments({ orgId: oid(owner.orgId), role: "Owner" })).toBe(1);
    expect(second.userId).toBeTruthy();
  });
});
