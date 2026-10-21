import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import mongoose, { type Types } from "mongoose";
import request from "supertest";
import type { Role } from "@sentinel/shared";
import { createApp, type SentinelApp } from "../src/app.js";
import { loadConfig } from "../src/config/index.js";
import { signAccessToken } from "../src/lib/crypto.js";
import type { JobQueue } from "../src/lib/jobs.js";
import { createLogger } from "../src/lib/logger.js";
import { AuthSession, Membership, User } from "../src/models/identity.js";
import type { MlClient, ModelDetail, PredictResponse, ReferenceHistogram } from "../src/modules/models/ml.client.js";

export const TEST_SECRET = "test-access-secret-0123456789abcdef";
export const API = "/api/v1";
export const PASSWORD = "correct horse battery";

export function testConfig(extra: Record<string, string> = {}) {
  return loadConfig({
    NODE_ENV: "test",
    MONGO_URI: "mongodb://unused-in-tests",
    JWT_ACCESS_SECRET: TEST_SECRET,
    CORS_ORIGINS: "http://localhost:5173",
    // Retries stay on (attempts 3) but without the production backoff.
    JOB_BACKOFF_MS: "5",
    ...extra,
  });
}

export function buildApp(opts: { ml?: MlClient; authRateLimit?: { windowMs: number; max: number }; queue?: JobQueue } = {}): SentinelApp {
  const config = testConfig(opts.ml ? { ML_SERVICE_URL: "http://ml.test" } : {});
  return createApp({ config, logger: createLogger("silent"), ...opts });
}

export interface TestUser {
  token: string;
  cookie: string;
  userId: string;
  orgId: string;
  email: string;
}

export function refreshCookieFrom(res: request.Response): string {
  const raw = res.headers["set-cookie"] as unknown as string[] | undefined;
  const c = raw?.find((x) => x.startsWith("sentinel_rt="));
  if (!c) throw new Error("No refresh cookie in response");
  return c.split(";")[0] ?? "";
}

export async function registerUser(sa: SentinelApp, email = `u${randomBytes(4).toString("hex")}@example.com`): Promise<TestUser> {
  const res = await request(sa.app).post(`${API}/auth/register`).send({ name: "Test User", email, password: PASSWORD });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  return {
    token: res.body.accessToken,
    cookie: refreshCookieFrom(res),
    userId: res.body.user.id,
    orgId: res.body.orgs[0].id,
    email,
  };
}

/** Adds a member with `role` to an org directly in the database and returns a valid access token. */
export async function addMember(orgId: string, role: Role): Promise<{ token: string; userId: string }> {
  const user = await User.create({
    name: `${role} member`,
    email: `${role.toLowerCase()}-${randomBytes(4).toString("hex")}@example.com`,
    passwordHash: "$argon2id$v=19$m=19456,t=2,p=1$not-a-real-hash",
  });
  await Membership.create({ orgId, userId: user._id, role });
  const session = await AuthSession.create({
    userId: user._id,
    refreshTokenHash: randomBytes(32).toString("hex"),
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  return {
    token: signAccessToken({ sub: String(user._id), sid: String(session._id) }, TEST_SECRET, 900),
    userId: String(user._id),
  };
}

export function oid(id: string): Types.ObjectId {
  return new mongoose.Types.ObjectId(id);
}

// ---- CSV fixtures -----------------------------------------------------------

const SAMPLE = fileURLToPath(new URL("../../../data/samples/cicids2017-friday-ddos-sample.csv", import.meta.url));
export const CICIDS_HEADER = (readFileSync(SAMPLE, "utf-8").split(/\r?\n/)[0] ?? "").split(",");

export interface CsvRow {
  label?: string;
  srcIp?: string;
  dstIp?: string;
  timestamp?: string;
  features?: Record<string, string>;
  raw?: Record<string, string>;
}

/** Builds a CICIDS2017-shaped CSV with the real header (including its leading spaces, when present). */
export function writeCsv(rows: CsvRow[], header: string[] = CICIDS_HEADER): string {
  const lines = [header.join(",")];
  for (const r of rows) {
    const values: Record<string, string> = {
      "Flow ID": "x",
      "Source IP": r.srcIp ?? "10.0.0.1",
      "Source Port": "40000",
      "Destination IP": r.dstIp ?? "10.0.0.2",
      "Destination Port": "80",
      Protocol: "6",
      Timestamp: r.timestamp ?? "7/7/2017 3:56",
      Label: r.label ?? "BENIGN",
      ...(r.features ?? {}),
      ...(r.raw ?? {}),
    };
    lines.push(header.map((h) => values[h.trim()] ?? "1").join(","));
  }
  const file = path.join(tmpdir(), `sentinel-test-${randomBytes(6).toString("hex")}.csv`);
  writeFileSync(file, lines.join("\n"));
  return file;
}

// ---- ML test double -----------------------------------------------------------

/**
 * Deterministic stand-in for services/ml, used only by tests. It decides from
 * feature values (never from labels, which it does not receive):
 *  - Flow Packets/s > 1000 → DDoS (0.95)
 *  - Flow Duration == 7 → PortScan with low confidence (0.4)
 *  - Flow Duration == 13 → an unknown class name
 *  - otherwise Normal (0.9)
 */
export class FakeMl implements MlClient {
  calls: { modelVersion: string; count: number }[] = [];
  /** When true, every result carries a novelty score: above the threshold for DDoS-like flows and Flow Duration 7 / 21 / 22. */
  novelty = false;
  fail: "none" | "unavailable" | "contract" = "none";
  readonly models: ModelDetail[] = ["bench-a", "bench-b"].map((version) => ({
    version,
    name: "test model",
    schema: "cicids2017-v1",
    algorithm: "test",
    kind: "benchmark",
    trainedAt: "2026-10-20T00:00:00Z",
    classes: ["DDoS", "Normal", "PortScan"],
    metrics: { macroF1: 0.5, testRows: 10, perClass: [] },
    trainedOn: { files: [] },
    libVersions: { "scikit-learn": "test" },
    versionWarnings: [],
  }));

  async listModels() {
    return this.models;
  }
  async getModel(version: string) {
    return this.models.find((m) => m.version === version) ?? null;
  }
  /** Training-time histogram served for drift checks; tests set it, null means "trained before references existed". */
  reference: ReferenceHistogram | null = null;
  async getReference(version: string) {
    return this.models.some((m) => m.version === version) ? this.reference : null;
  }
  async predict(req: Parameters<MlClient["predict"]>[0]): Promise<PredictResponse> {
    if (this.fail === "unavailable") {
      const { AppError } = await import("../src/lib/errors.js");
      throw new AppError("ML_UNAVAILABLE", 503, "down");
    }
    if (this.fail === "contract") {
      const { MlContractError } = await import("../src/modules/models/ml.client.js");
      throw new MlContractError("Missing feature: Flow Duration", 422);
    }
    this.calls.push({ modelVersion: req.modelVersion, count: req.flows.length });
    return {
      modelVersion: req.modelVersion,
      schema: "cicids2017-v1",
      results: req.flows.map((f) => {
        const pps = f.features["Flow Packets/s"] ?? 0;
        const dur = f.features["Flow Duration"];
        const [label, confidence] =
          dur === 13 ? ["Alien", 0.99] : dur === 7 ? ["PortScan", 0.4] : pps > 1000 ? ["DDoS", 0.95] : ["Normal", 0.9];
        return {
          id: f.id,
          label: label as string,
          confidence: confidence as number,
          probabilities: { [label as string]: confidence as number },
          ...(this.novelty
            ? (() => {
                const above = pps > 1000 || dur === 7 || dur === 21 || dur === 22;
                return { novelty: { score: above ? 0.7 : 0.4, threshold: 0.55, aboveThreshold: above } };
              })()
            : {}),
          topFeatures: label === "Normal" ? [] : [{ name: "Flow Packets/s", contribution: 0.3, value: pps }],
        };
      }),
    };
  }
}
