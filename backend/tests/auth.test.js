import { describe, expect, it } from "vitest";
import request from "supertest";
import "./setup.js";
import { createApp } from "../src/app.js";

const app = createApp();

describe("Auth", () => {
  it("registers a new user and returns a token + preferences", async () => {
    const res = await request(app).post("/api/auth/register").send({
      name: "Test Analyst",
      email: "test@example.com",
      password: "password123",
    });
    expect(res.status).toBe(201);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.email).toBe("test@example.com");
    expect(res.body.user.preferences).toBeTruthy();
    expect(res.body.user.preferences.emailAlerts).toBe(true);
  });

  it("rejects registration with an invalid email", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ name: "Test", email: "not-an-email", password: "password123" });
    expect(res.status).toBe(400);
    expect(res.body.errors).toBeTruthy();
  });

  it("rejects a password shorter than 8 characters", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ name: "Test", email: "test2@example.com", password: "short" });
    expect(res.status).toBe(400);
  });

  it("rejects a duplicate email", async () => {
    await request(app)
      .post("/api/auth/register")
      .send({ name: "First", email: "dup@example.com", password: "password123" });
    const res = await request(app)
      .post("/api/auth/register")
      .send({ name: "Second", email: "dup@example.com", password: "password123" });
    expect(res.status).toBe(409);
  });

  it("logs in with correct credentials", async () => {
    await request(app)
      .post("/api/auth/register")
      .send({ name: "Login Test", email: "login@example.com", password: "password123" });
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "login@example.com", password: "password123" });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
  });

  it("rejects login with the wrong password", async () => {
    await request(app)
      .post("/api/auth/register")
      .send({ name: "Wrong Pw", email: "wrongpw@example.com", password: "password123" });
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "wrongpw@example.com", password: "wrongpassword" });
    expect(res.status).toBe(401);
  });

  it("rejects a login body missing a password (validation)", async () => {
    const res = await request(app).post("/api/auth/login").send({ email: "login@example.com" });
    expect(res.status).toBe(400);
  });

  it("returns the current user from /me with a valid token", async () => {
    const register = await request(app)
      .post("/api/auth/register")
      .send({ name: "Me Test", email: "me@example.com", password: "password123" });
    const res = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${register.body.token}`);
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe("me@example.com");
  });

  it("rejects /me without a token", async () => {
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(401);
  });

  it("persists a preferences update via PATCH /me", async () => {
    const register = await request(app)
      .post("/api/auth/register")
      .send({ name: "Pref Test", email: "pref@example.com", password: "password123" });
    const token = register.body.token;

    const patchRes = await request(app)
      .patch("/api/auth/me")
      .set("Authorization", `Bearer ${token}`)
      .send({ preferences: { emailAlerts: false, language: "Français" } });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.user.preferences.emailAlerts).toBe(false);
    expect(patchRes.body.user.preferences.language).toBe("Français");

    // Confirm it actually persisted, not just echoed back
    const meRes = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${token}`);
    expect(meRes.body.user.preferences.emailAlerts).toBe(false);
  });
});
