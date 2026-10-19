import bcrypt from "bcryptjs";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { AuthSession, Membership, Org, User } from "../src/models/identity.js";
import { API, PASSWORD, buildApp, refreshCookieFrom, registerUser } from "./helpers.js";

const sa = buildApp();
const csrf = { "X-Sentinel-CSRF": "1" };

describe("register and login", () => {
  it("registers a user as Owner of a new org and returns an access token, not a stored token", async () => {
    const res = await request(sa.app)
      .post(`${API}/auth/register`)
      .send({ name: "Amira", email: "Amira@Example.com", password: PASSWORD });
    expect(res.status).toBe(201);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.refreshToken).toBeUndefined();
    expect(res.body.user.email).toBe("amira@example.com");
    expect(res.body.orgs).toHaveLength(1);
    expect(res.body.orgs[0].role).toBe("Owner");

    const user = await User.findOne({ email: "amira@example.com" }).lean();
    expect(user?.passwordHash.startsWith("$argon2id$")).toBe(true);
  });

  it("sets the refresh token as an httpOnly, Secure, SameSite=Strict cookie scoped to /api/v1/auth", async () => {
    const res = await request(sa.app).post(`${API}/auth/register`).send({ name: "C", email: "c@example.com", password: PASSWORD });
    const cookie = (res.headers["set-cookie"] as unknown as string[]).find((c) => c.startsWith("sentinel_rt="));
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=\/api\/v1\/auth/i);
  });

  it("rejects invalid input with the error envelope", async () => {
    const res = await request(sa.app).post(`${API}/auth/register`).send({ name: "T", email: "nope", password: "short" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.requestId).toEqual(expect.any(String));
    expect(res.body.error.details.map((d: { path: string }) => d.path).sort()).toEqual(["email", "password"]);
  });

  it("rejects a duplicate email with 409", async () => {
    await registerUser(sa, "dup@example.com");
    const res = await request(sa.app).post(`${API}/auth/register`).send({ name: "D", email: "dup@example.com", password: PASSWORD });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CONFLICT");
  });

  it("logs in with the right password and rejects the wrong one with the same message as an unknown email", async () => {
    await registerUser(sa, "login@example.com");
    const ok = await request(sa.app).post(`${API}/auth/login`).send({ email: "login@example.com", password: PASSWORD });
    expect(ok.status).toBe(200);
    expect(ok.body.accessToken).toEqual(expect.any(String));
    const wrong = await request(sa.app).post(`${API}/auth/login`).send({ email: "login@example.com", password: "wrong password!" });
    const unknown = await request(sa.app).post(`${API}/auth/login`).send({ email: "nobody@example.com", password: "wrong password!" });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.message).toBe(unknown.body.error.message);
  });

  it("accepts a legacy bcrypt hash once and upgrades it to argon2id", async () => {
    const user = await User.create({ name: "Legacy", email: "legacy@example.com", passwordHash: await bcrypt.hash(PASSWORD, 4) });
    const org = await Org.create({ name: "Legacy org", slug: "legacy-org" });
    await Membership.create({ orgId: org._id, userId: user._id, role: "Admin" });
    const res = await request(sa.app).post(`${API}/auth/login`).send({ email: "legacy@example.com", password: PASSWORD });
    expect(res.status).toBe(200);
    const after = await User.findById(user._id).lean();
    expect(after?.passwordHash.startsWith("$argon2id$")).toBe(true);
  });

  it("rate-limits repeated login attempts", async () => {
    const limited = buildApp({ authRateLimit: { windowMs: 60_000, max: 3 } });
    const attempt = () => request(limited.app).post(`${API}/auth/login`).send({ email: "x@example.com", password: "wrong password!" });
    for (let i = 0; i < 3; i++) expect((await attempt()).status).toBe(401);
    const blocked = await attempt();
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe("RATE_LIMITED");
  });
});

describe("access token", () => {
  it("authenticates /me and rejects missing or forged tokens", async () => {
    const u = await registerUser(sa);
    const me = await request(sa.app).get(`${API}/me`).set("Authorization", `Bearer ${u.token}`);
    expect(me.status).toBe(200);
    expect(me.body.activeOrg.role).toBe("Owner");
    expect((await request(sa.app).get(`${API}/me`)).status).toBe(401);
    expect((await request(sa.app).get(`${API}/me`).set("Authorization", `Bearer ${u.token}x`)).status).toBe(401);
  });

  it("persists a preferences update", async () => {
    const u = await registerUser(sa);
    const patch = await request(sa.app)
      .patch(`${API}/me`)
      .set("Authorization", `Bearer ${u.token}`)
      .send({ preferences: { emailAlerts: false, language: "fr" } });
    expect(patch.status).toBe(200);
    const me = await request(sa.app).get(`${API}/me`).set("Authorization", `Bearer ${u.token}`);
    expect(me.body.user.preferences).toMatchObject({ emailAlerts: false, language: "fr" });
  });
});

describe("refresh token rotation", () => {
  it("requires the CSRF header", async () => {
    const u = await registerUser(sa);
    const res = await request(sa.app).post(`${API}/auth/refresh`).set("Cookie", u.cookie);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("CSRF_FAILED");
  });

  it("rejects a foreign Origin", async () => {
    const u = await registerUser(sa);
    const res = await request(sa.app).post(`${API}/auth/refresh`).set(csrf).set("Origin", "https://evil.example").set("Cookie", u.cookie);
    expect(res.status).toBe(403);
  });

  it("rotates the refresh token and issues a new access token", async () => {
    const u = await registerUser(sa);
    const res = await request(sa.app).post(`${API}/auth/refresh`).set(csrf).set("Cookie", u.cookie);
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
    const next = refreshCookieFrom(res);
    expect(next).not.toBe(u.cookie);
    const again = await request(sa.app).post(`${API}/auth/refresh`).set(csrf).set("Cookie", next);
    expect(again.status).toBe(200);
  });

  it("detects reuse of a rotated token outside the grace window and revokes the session", async () => {
    const u = await registerUser(sa);
    const first = await request(sa.app).post(`${API}/auth/refresh`).set(csrf).set("Cookie", u.cookie);
    const current = refreshCookieFrom(first);
    // Move the last rotation outside the grace window.
    await AuthSession.updateMany({ userId: u.userId }, { $set: { lastRotatedAt: new Date(Date.now() - 60_000) } });

    const replay = await request(sa.app).post(`${API}/auth/refresh`).set(csrf).set("Cookie", u.cookie);
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe("REFRESH_REUSE_DETECTED");

    // The whole family is revoked: the legitimate current token and access token stop working too.
    expect((await request(sa.app).post(`${API}/auth/refresh`).set(csrf).set("Cookie", current)).status).toBe(401);
    expect((await request(sa.app).get(`${API}/me`).set("Authorization", `Bearer ${first.body.accessToken}`)).status).toBe(401);
  });

  it("tolerates a concurrent refresh with the just-rotated token inside the grace window", async () => {
    const u = await registerUser(sa);
    await request(sa.app).post(`${API}/auth/refresh`).set(csrf).set("Cookie", u.cookie);
    const concurrent = await request(sa.app).post(`${API}/auth/refresh`).set(csrf).set("Cookie", u.cookie);
    expect(concurrent.status).toBe(200);
    expect(concurrent.headers["set-cookie"]).toBeUndefined();
  });
});

describe("logout", () => {
  it("logout revokes the session behind the cookie and its access tokens", async () => {
    const u = await registerUser(sa);
    expect((await request(sa.app).post(`${API}/auth/logout`).set(csrf).set("Cookie", u.cookie)).status).toBe(204);
    expect((await request(sa.app).get(`${API}/me`).set("Authorization", `Bearer ${u.token}`)).status).toBe(401);
    expect((await request(sa.app).post(`${API}/auth/refresh`).set(csrf).set("Cookie", u.cookie)).status).toBe(401);
  });

  it("logout-all revokes every session of the user", async () => {
    const u = await registerUser(sa, "multi@example.com");
    const second = await request(sa.app).post(`${API}/auth/login`).send({ email: "multi@example.com", password: PASSWORD });
    expect((await request(sa.app).post(`${API}/auth/logout-all`).set("Authorization", `Bearer ${u.token}`)).status).toBe(204);
    expect((await request(sa.app).get(`${API}/me`).set("Authorization", `Bearer ${second.body.accessToken}`)).status).toBe(401);
    expect(await AuthSession.countDocuments({ userId: u.userId, revokedAt: null })).toBe(0);
  });

  it("change-password keeps the current session and signs out the others", async () => {
    const u = await registerUser(sa, "pw@example.com");
    const other = await request(sa.app).post(`${API}/auth/login`).send({ email: "pw@example.com", password: PASSWORD });
    const res = await request(sa.app)
      .post(`${API}/auth/change-password`)
      .set("Authorization", `Bearer ${u.token}`)
      .send({ currentPassword: PASSWORD, newPassword: "a brand new passphrase" });
    expect(res.status).toBe(200);
    expect((await request(sa.app).get(`${API}/me`).set("Authorization", `Bearer ${u.token}`)).status).toBe(200);
    expect((await request(sa.app).get(`${API}/me`).set("Authorization", `Bearer ${other.body.accessToken}`)).status).toBe(401);
    const relog = await request(sa.app).post(`${API}/auth/login`).send({ email: "pw@example.com", password: "a brand new passphrase" });
    expect(relog.status).toBe(200);
  });

  it("lists and revokes individual sessions", async () => {
    const u = await registerUser(sa, "sess@example.com");
    await request(sa.app).post(`${API}/auth/login`).send({ email: "sess@example.com", password: PASSWORD });
    const list = await request(sa.app).get(`${API}/auth/sessions`).set("Authorization", `Bearer ${u.token}`);
    expect(list.body.items).toHaveLength(2);
    const other = list.body.items.find((s: { current: boolean }) => !s.current);
    const del = await request(sa.app).delete(`${API}/auth/sessions/${other.id}`).set("Authorization", `Bearer ${u.token}`);
    expect(del.status).toBe(204);
  });
});

describe("account deletion", () => {
  it("deletes a solo user's own workspace with them", async () => {
    const u = await registerUser(sa);
    const res = await request(sa.app).delete(`${API}/me`).set("Authorization", `Bearer ${u.token}`);
    expect(res.status).toBe(204);
    expect(await User.exists({ _id: u.userId })).toBeNull();
    expect(await Org.exists({ _id: u.orgId })).toBeNull();
  });
});
