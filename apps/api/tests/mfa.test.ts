import { generate } from "otplib";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { AuthSession, User } from "../src/models/identity.js";
import { AuditLog } from "../src/models/tenant.js";
import { API, PASSWORD, buildApp, oid, registerUser, type TestUser } from "./helpers.js";

const sa = buildApp();
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const now = () => Math.floor(Date.now() / 1000);
/** A code for the current step (+offset steps of 30 s); the server accepts one step of drift. */
const codeAt = (secret: string, steps = 0) => generate({ secret, epoch: now() + steps * 30 });

async function enrol(u: TestUser) {
  const setup = await request(sa.app).post(`${API}/auth/mfa/setup`).set(bearer(u.token)).send({ password: PASSWORD });
  expect(setup.status).toBe(200);
  const enabled = await request(sa.app).post(`${API}/auth/mfa/enable`).set(bearer(u.token)).send({ code: await codeAt(setup.body.secret) });
  expect(enabled.status).toBe(200);
  return { secret: setup.body.secret as string, recoveryCodes: enabled.body.recoveryCodes as string[] };
}

async function passwordStep(email: string) {
  const res = await request(sa.app).post(`${API}/auth/login`).send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  return res;
}

describe("MFA enrolment", () => {
  it("needs the password, shows a QR code once, seals the seed and hashes the recovery codes", async () => {
    const u = await registerUser(sa);
    const other = await request(sa.app).post(`${API}/auth/login`).send({ email: u.email, password: PASSWORD });
    expect((await request(sa.app).post(`${API}/auth/mfa/setup`).set(bearer(u.token)).send({ password: "wrong password!!" })).status).toBe(400);

    const setup = await request(sa.app).post(`${API}/auth/mfa/setup`).set(bearer(u.token)).send({ password: PASSWORD }).expect(200);
    expect(setup.body.otpauthUri).toMatch(/^otpauth:\/\/totp\/Sentinel:/);
    expect(setup.body.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    const stored = await User.findById(u.userId).lean();
    expect(stored?.mfa?.pendingSecretEnc).toMatch(/^v1\./);
    expect(JSON.stringify(stored)).not.toContain(setup.body.secret);

    expect((await request(sa.app).post(`${API}/auth/mfa/enable`).set(bearer(u.token)).send({ code: "000000" })).status).toBe(400);
    const enabled = await request(sa.app).post(`${API}/auth/mfa/enable`).set(bearer(u.token)).send({ code: await codeAt(setup.body.secret) }).expect(200);
    const codes = enabled.body.recoveryCodes as string[];
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[A-Z2-7]{5}-[A-Z2-7]{5}$/);

    const after = await User.findById(u.userId).lean();
    expect(after?.mfa?.enabled).toBe(true);
    expect(after?.mfa?.pendingSecretEnc).toBeNull();
    expect(JSON.stringify(after)).not.toContain(codes[0]);
    // Sessions opened with the password alone end; the enrolling device stays signed in.
    const sessions = await AuthSession.find({ userId: oid(u.userId) }).lean();
    expect(sessions.filter((s) => !s.revokedAt)).toHaveLength(1);
    expect((await request(sa.app).get(`${API}/me`).set(bearer(other.body.accessToken))).status).toBe(401);

    const me = await request(sa.app).get(`${API}/me`).set(bearer(u.token)).expect(200);
    expect(me.body.user.mfaEnabled).toBe(true);
    expect((await request(sa.app).get(`${API}/auth/mfa`).set(bearer(u.token))).body).toMatchObject({ enabled: true, recoveryCodesLeft: 10 });
    const exported = await request(sa.app).get(`${API}/me/export`).set(bearer(u.token)).expect(200);
    expect(JSON.stringify(exported.body)).not.toMatch(/secretEnc|recoveryCodeHashes|v1\./);
    for (const action of ["auth.mfa_setup", "auth.mfa_enabled"]) {
      expect(await AuditLog.countDocuments({ orgId: oid(u.orgId), action }), action).toBe(1);
    }
    expect((await request(sa.app).post(`${API}/auth/mfa/setup`).set(bearer(u.token)).send({ password: PASSWORD })).status).toBe(409);
  });
});

describe("MFA sign-in", () => {
  it("asks for a code after the password, refuses a replayed code, and the challenge is not a session", async () => {
    const u = await registerUser(sa);
    const { secret } = await enrol(u);
    const step = await passwordStep(u.email);
    expect(step.body).toMatchObject({ mfaRequired: true, expiresIn: 300 });
    expect(step.body.accessToken).toBeUndefined();
    expect(step.headers["set-cookie"]).toBeUndefined();
    expect((await request(sa.app).get(`${API}/me`).set(bearer(step.body.mfaToken))).status).toBe(401);

    // The enrolment code's time step was consumed: use the next one.
    const code = await codeAt(secret, 1);
    const ok = await request(sa.app).post(`${API}/auth/mfa/verify`).send({ mfaToken: step.body.mfaToken, code });
    expect(ok.status).toBe(200);
    expect(ok.body.accessToken).toEqual(expect.any(String));
    expect(ok.headers["set-cookie"]?.[0]).toMatch(/^sentinel_rt=/);
    const login = await AuditLog.findOne({ orgId: oid(u.orgId), action: "auth.login", "meta.factor": "password+totp" }).lean();
    expect(login).not.toBeNull();

    const step2 = await passwordStep(u.email);
    const replay = await request(sa.app).post(`${API}/auth/mfa/verify`).send({ mfaToken: step2.body.mfaToken, code });
    expect(replay.status).toBe(401);
    const forged = await request(sa.app).post(`${API}/auth/mfa/verify`).send({ mfaToken: `${step2.body.mfaToken}x`, code: "123456" });
    expect(forged.status).toBe(401);
    // An access token is not a challenge token either.
    expect((await request(sa.app).post(`${API}/auth/mfa/verify`).send({ mfaToken: u.token, code: "123456" })).status).toBe(401);
  });

  it("accepts each recovery code once and audits its use", async () => {
    const u = await registerUser(sa);
    const { recoveryCodes } = await enrol(u);
    const used = (recoveryCodes[3] ?? "").toLowerCase();
    const step = await passwordStep(u.email);
    const ok = await request(sa.app).post(`${API}/auth/mfa/verify`).send({ mfaToken: step.body.mfaToken, recoveryCode: used });
    expect(ok.status).toBe(200);
    expect(ok.body.recoveryCodesLeft).toBe(9);
    expect(await AuditLog.countDocuments({ orgId: oid(u.orgId), action: "auth.mfa_recovery_used" })).toBe(1);
    const again = await request(sa.app).post(`${API}/auth/mfa/verify`).send({ mfaToken: step.body.mfaToken, recoveryCode: used });
    expect(again.status).toBe(401);
    expect((await request(sa.app).post(`${API}/auth/mfa/verify`).send({ mfaToken: step.body.mfaToken })).status).toBe(400);
  });

  it("locks the second factor for 15 minutes after five wrong codes, even for a right one", async () => {
    const u = await registerUser(sa);
    const { secret } = await enrol(u);
    const step = await passwordStep(u.email);
    for (let i = 0; i < 5; i++) {
      expect((await request(sa.app).post(`${API}/auth/mfa/verify`).send({ mfaToken: step.body.mfaToken, code: "000000" })).status).toBe(401);
    }
    const locked = await request(sa.app).post(`${API}/auth/mfa/verify`).send({ mfaToken: step.body.mfaToken, code: await codeAt(secret, 1) });
    expect(locked.status).toBe(429);
    const user = await User.findById(u.userId).lean();
    expect(user?.mfa?.lockedUntil?.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);
  });

  it("rate-limits the code endpoint per address and account", async () => {
    const limited = buildApp({ authRateLimit: { windowMs: 60_000, max: 3 } });
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) statuses.push((await request(limited.app).post(`${API}/auth/mfa/verify`).send({ mfaToken: "x".repeat(40), code: "123456" })).status);
    expect(statuses).toEqual([401, 401, 401, 429]);
  });
});

describe("MFA management", () => {
  it("disabling needs the password, is audited, and sign-in is back to one step", async () => {
    const u = await registerUser(sa);
    await enrol(u);
    expect((await request(sa.app).post(`${API}/auth/mfa/disable`).set(bearer(u.token)).send({ password: "not my password" })).status).toBe(400);
    await request(sa.app).post(`${API}/auth/mfa/disable`).set(bearer(u.token)).send({ password: PASSWORD }).expect(204);
    expect(await AuditLog.countDocuments({ orgId: oid(u.orgId), action: "auth.mfa_disabled" })).toBe(1);
    const user = await User.findById(u.userId).lean();
    expect(user?.mfa).toMatchObject({ enabled: false, secretEnc: null, recoveryCodeHashes: [] });
    const login = await passwordStep(u.email);
    expect(login.body.accessToken).toEqual(expect.any(String));
    expect((await request(sa.app).post(`${API}/auth/mfa/disable`).set(bearer(u.token)).send({ password: PASSWORD })).status).toBe(409);
  });

  it("regenerates recovery codes, invalidating the old ones", async () => {
    const u = await registerUser(sa);
    const { recoveryCodes } = await enrol(u);
    const fresh = await request(sa.app).post(`${API}/auth/mfa/recovery-codes`).set(bearer(u.token)).send({ password: PASSWORD }).expect(200);
    expect(fresh.body.recoveryCodes).toHaveLength(10);
    const step = await passwordStep(u.email);
    expect((await request(sa.app).post(`${API}/auth/mfa/verify`).send({ mfaToken: step.body.mfaToken, recoveryCode: recoveryCodes[0] })).status).toBe(401);
    expect((await request(sa.app).post(`${API}/auth/mfa/verify`).send({ mfaToken: step.body.mfaToken, recoveryCode: fresh.body.recoveryCodes[0] })).status).toBe(200);
    expect(await AuditLog.countDocuments({ orgId: oid(u.orgId), action: "auth.mfa_recovery_regenerated" })).toBe(1);
  });

  it("shows which members use MFA on the Team list", async () => {
    const u = await registerUser(sa);
    await enrol(u);
    const members = await request(sa.app).get(`${API}/members`).set(bearer(u.token)).expect(200);
    expect(members.body.items[0]).toMatchObject({ userId: u.userId, mfaEnabled: true });
  });
});
