import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import dotenv from "dotenv";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/index.js";

// The documented setup is "copy .env.example, set JWT_ACCESS_SECRET": it must start as is.
const example = dotenv.parse(readFileSync(new URL("../.env.example", import.meta.url)));

describe("configuration", () => {
  it("accepts .env.example once a secret is set, and treats empty optional values as unset", () => {
    const config = loadConfig({ ...example, JWT_ACCESS_SECRET: randomBytes(48).toString("base64url") });
    expect(config.ml).toEqual({ url: "http://127.0.0.1:8000", token: null });
    expect(config.corsOrigins).toEqual(["http://localhost:5173"]);
    expect(config.mongoUri).toBe("mongodb://127.0.0.1:27017/sentinel");
  });

  it("fails fast, without echoing secrets, when required values are missing or wrong", () => {
    expect(() => loadConfig({ ...example })).toThrow(/JWT_ACCESS_SECRET is required/);
    expect(() => loadConfig({ ...example, JWT_ACCESS_SECRET: "x".repeat(40), ML_SERVICE_TOKEN: "short" })).toThrow(/ML_SERVICE_TOKEN/);
    expect(() => loadConfig({ ...example, JWT_ACCESS_SECRET: "x".repeat(40), CORS_ORIGINS: "*" })).toThrow(/Wildcard/);
    const secret = "do-not-print-" + randomBytes(8).toString("hex");
    try {
      loadConfig({ ...example, NODE_ENV: "production", JWT_ACCESS_SECRET: secret });
    } catch (e) {
      expect((e as Error).message).not.toContain(secret);
    }
  });
});
