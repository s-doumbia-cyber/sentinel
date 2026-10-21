import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { createLogger } from "../src/lib/logger.js";
import { API, buildApp, registerUser, testConfig } from "./helpers.js";

describe("OpenAPI document", () => {
  const sa = buildApp();

  it("documents every declared route with its policy and the zod schemas it enforces", async () => {
    const res = await request(sa.app).get("/api/docs/openapi.json").expect(200);
    const doc = res.body as { openapi: string; paths: Record<string, Record<string, Record<string, unknown>>> };
    expect(doc.openapi).toBe("3.0.3");
    for (const r of sa.routes) {
      const op = doc.paths[r.path.replace(/:(\w+)/g, "{$1}")]?.[r.method];
      expect(op, `${r.method} ${r.path}`).toBeDefined();
      expect(op?.["x-sentinel-policy"]).toBe(r.policy);
    }
    const invite = doc.paths["/api/v1/invites"]?.post as { requestBody: { content: { "application/json": { schema: { properties: Record<string, unknown>; required: string[] } } } } };
    expect(Object.keys(invite.requestBody.content["application/json"].schema.properties).sort()).toEqual(["email", "expiresInDays", "role"]);
    expect(invite.requestBody.content["application/json"].schema.required).toEqual(expect.arrayContaining(["email", "role"]));
    const flows = doc.paths["/api/v1/flows"]?.get as { parameters: { name: string; in: string }[] };
    expect(flows.parameters.map((p) => p.name)).toEqual(expect.arrayContaining(["limit", "cursor", "verdict"]));
    const one = doc.paths["/api/v1/alerts/{id}"]?.get as { parameters: { name: string; in: string; required: boolean }[] };
    expect(one.parameters).toContainEqual(expect.objectContaining({ name: "id", in: "path", required: true }));
    expect((doc.paths["/api/v1/imports/csv"]?.post as { requestBody: { content: Record<string, unknown> } }).requestBody.content).toHaveProperty("multipart/form-data");
    expect((doc.paths["/api/v1/auth/login"]?.post as { security: unknown[] }).security).toEqual([]);
  });

  it("serves a script-free reference page under a nonce-only CSP", async () => {
    const res = await request(sa.app).get("/api/docs").expect(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    const csp = res.headers["content-security-policy"] as string;
    expect(csp).toMatch(/default-src 'none'; style-src 'nonce-[A-Za-z0-9+/=]+'/);
    expect(res.text).not.toContain("<script");
    expect(res.text).toContain("/api/v1/invites");
  });
});

describe("/metrics", () => {
  it("is off unless enabled", async () => {
    expect((await request(buildApp().app).get("/metrics")).status).toBe(404);
  });

  it("exposes Prometheus text with route templates, queue depth and dependencies, behind an optional token", async () => {
    const token = "metrics-token-0123456789";
    const sa = createApp({ config: testConfig({ METRICS_ENABLED: "true", METRICS_TOKEN: token }), logger: createLogger("silent") });
    const u = await registerUser(sa);
    await request(sa.app).get(`${API}/alerts/0123456789abcdef01234567`).set("Authorization", `Bearer ${u.token}`).expect(404);
    expect((await request(sa.app).get("/metrics")).status).toBe(401);
    expect((await request(sa.app).get("/metrics").set("Authorization", "Bearer wrong-token-0123456789")).status).toBe(401);
    const res = await request(sa.app).get("/metrics").set("Authorization", `Bearer ${token}`).expect(200);
    // Prometheus text format 0.0.4 (Express may reorder the parameters).
    expect(res.headers["content-type"]).toMatch(/^text\/plain;/);
    expect(res.headers["content-type"]).toContain("version=0.0.4");
    expect(res.text).toContain('sentinel_http_requests_total{method="GET",route="/api/v1/alerts/:id",status="404"} 1');
    expect(res.text).toContain('sentinel_http_request_duration_seconds_bucket{method="POST",route="/api/v1/auth/register",le="+Inf"} 1');
    expect(res.text).toMatch(/sentinel_jobs\{kind="score",state="waiting",queue="in-process"\} 0/);
    expect(res.text).toContain('sentinel_up{dependency="mongodb"} 1');
    // No raw ids or addresses in labels.
    expect(res.text).not.toContain("0123456789abcdef01234567");
  });
});

describe("/readyz", () => {
  it("reports MongoDB, the queue mode and Redis status", async () => {
    const res = await request(buildApp().app).get(`${API}/readyz`).expect(200);
    expect(res.body).toMatchObject({ status: "ok", mongo: "ok", redis: "not_configured", queue: "in-process", ml: "not_configured" });
  });
});
