import { fileURLToPath } from "node:url";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createLogger } from "../src/lib/logger.js";
import { Membership, Org, User } from "../src/models/identity.js";
import { AuditLog, Dataset, Flow } from "../src/models/tenant.js";
import { DEMO_ORG_SLUG, DemoExistsError, inspectDemo, seedDemo } from "../src/modules/demo/demo.seed.js";
import { API, buildApp, registerUser } from "./helpers.js";

const sa = buildApp();
const flowsCsv = fileURLToPath(new URL("../../../data/demo/demo-scenario-flows.csv", import.meta.url));
const identityCsv = fileURLToPath(new URL("../../../data/demo/demo-identity.csv", import.meta.url));
const logger = createLogger("silent");

describe("demo seed", () => {
  it("creates an isolated DEMO workspace whose accounts really sign in, and never runs twice", async () => {
    // Someone else's workspace must be left untouched.
    const other = await registerUser(sa);
    const otherOrgs = await Org.countDocuments({});

    expect(await inspectDemo()).toEqual({ orgExists: false, existingUsers: [] });
    const result = await seedDemo({ flowsCsv, identityCsv, logger });
    expect(result.counts).toEqual({ flows: 585, alerts: 2, incidents: 1, identityRecords: 5 });
    expect(result.credentials.map((c) => c.role)).toEqual(["Owner", "Analyst", "Viewer"]);
    expect(new Set(result.credentials.map((c) => c.password)).size).toBe(3);
    expect(result.credentials.every((c) => c.password.length >= 20)).toBe(true);

    const org = await Org.findOne({ slug: DEMO_ORG_SLUG }).lean();
    expect(org).toBeTruthy();
    expect(await Org.countDocuments({})).toBe(otherOrgs + 1);
    expect(await Membership.countDocuments({ orgId: org?._id })).toBe(3);
    // Everything imported is tagged DEMO; passwords are stored only as argon2id hashes.
    expect(await Flow.countDocuments({ orgId: org?._id, sourceKind: { $ne: "DEMO" } })).toBe(0);
    expect((await Dataset.findOne({ orgId: org?._id }).lean())?.sourceKind).toBe("DEMO");
    const users = await User.find({ email: { $in: result.credentials.map((c) => c.email) } }).lean();
    expect(users.every((u) => u.passwordHash.startsWith("$argon2id$"))).toBe(true);
    expect(await AuditLog.countDocuments({ orgId: org?._id, action: "demo.seed" })).toBe(1);

    // The printed credentials work, and roles are enforced.
    const login = async (role: string) => {
      const c = result.credentials.find((x) => x.role === role);
      const res = await request(sa.app).post(`${API}/auth/login`).send({ email: c?.email, password: c?.password });
      expect(res.status).toBe(200);
      return { Authorization: `Bearer ${res.body.accessToken as string}` };
    };
    const analyst = await login("Analyst");
    const incidents = (await request(sa.app).get(`${API}/incidents`).set(analyst)).body.items;
    expect(incidents[0].title).toBe("Discovery → Credential access from 10.0.0.66");
    expect((await request(sa.app).get(`${API}/identity/lookup?q=UNMANAGED-66`).set(analyst)).body.records).toHaveLength(1);
    const viewer = await login("Viewer");
    expect((await request(sa.app).get(`${API}/identity/lookup?q=UNMANAGED-66`).set(viewer)).status).toBe(403);

    // A second run refuses instead of duplicating or resetting anything.
    await expect(seedDemo({ flowsCsv, identityCsv, logger })).rejects.toBeInstanceOf(DemoExistsError);
    expect(await Org.countDocuments({ slug: DEMO_ORG_SLUG })).toBe(1);
    expect((await request(sa.app).get(`${API}/incidents`).set({ Authorization: `Bearer ${other.token}` })).body.items).toEqual([]);
  });
});
