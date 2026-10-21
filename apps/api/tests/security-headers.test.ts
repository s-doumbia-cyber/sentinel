import request from "supertest";
import { describe, expect, it } from "vitest";
import { API, buildApp, registerUser } from "./helpers.js";

const sa = buildApp();

describe("security headers and transport rules", () => {
  it("sends a deny-all CSP, nosniff, no framing, no caching and no framework banner", async () => {
    const res = await request(sa.app).get(`${API}/healthz`).expect(200);
    expect(res.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(res.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["strict-transport-security"]).toMatch(/max-age=\d+/);
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("rejects origins outside the allow-list (CORS) and cookie endpoints without the CSRF header", async () => {
    const pre = await request(sa.app).options(`${API}/auth/login`).set("Origin", "https://evil.example").set("Access-Control-Request-Method", "POST");
    expect(pre.headers["access-control-allow-origin"]).toBeUndefined();
    const ok = await request(sa.app).options(`${API}/auth/login`).set("Origin", "http://localhost:5173").set("Access-Control-Request-Method", "POST");
    expect(ok.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    const u = await registerUser(sa);
    expect((await request(sa.app).post(`${API}/auth/refresh`).set("Cookie", u.cookie)).status).toBe(403);
    const crossSite = await request(sa.app).post(`${API}/auth/refresh`).set("Cookie", u.cookie).set("X-Sentinel-CSRF", "1").set("Origin", "https://evil.example");
    expect(crossSite.status).toBe(403);
  });

  it("does not parse form or text bodies as JSON (no simple-request CSRF into JSON routes)", async () => {
    const res = await request(sa.app).post(`${API}/auth/login`).set("Content-Type", "text/plain").send(JSON.stringify({ email: "a@b.co", password: "x" }));
    expect(res.status).toBe(400);
  });

  it("never echoes internal errors: the envelope carries a request id only", async () => {
    const res = await request(sa.app).get(`${API}/flows/not-an-id`).set("Authorization", `Bearer ${(await registerUser(sa)).token}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: "VALIDATION_ERROR", requestId: expect.any(String) });
    expect(JSON.stringify(res.body)).not.toMatch(/at \w+ \(|node_modules/);
  });
});
