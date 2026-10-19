import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { Membership } from "../src/models/identity.js";
import { applyLegacyMigration, planLegacyMigration } from "../src/modules/migration/legacy.js";
import { API, PASSWORD, buildApp } from "./helpers.js";

const SAMPLE = fileURLToPath(new URL("../../../data/samples/cicids2017-friday-ddos-sample.csv", import.meta.url));

/** First data row of the real sample as the legacy backend stored it in `raw` (untrimmed keys allowed). */
function legacyRaw(overrides: Record<string, string> = {}) {
  const [header, row] = readFileSync(SAMPLE, "utf-8").split(/\r?\n/);
  const keys = (header ?? "").split(",");
  const values = (row ?? "").split(",");
  const raw: Record<string, string> = {};
  keys.forEach((k, i) => (raw[` ${k}`] = values[i] ?? ""));
  return { ...raw, ...overrides };
}

async function seedLegacy() {
  const db = mongoose.connection.db!;
  const t0 = new Date("2026-01-01");
  await db.collection("users").insertMany([
    { name: "Old Admin", email: "admin@legacy.io", passwordHash: await bcrypt.hash(PASSWORD, 4), role: "Admin", tokenVersion: 2, preferences: { language: "Français" }, createdAt: t0 },
    { name: "Analyst", email: "analyst@legacy.io", passwordHash: await bcrypt.hash(PASSWORD, 4), role: "Analyst", createdAt: new Date("2026-02-01") },
  ]);
  const datasetId = new mongoose.Types.ObjectId();
  await db.collection("datasets").insertOne({ _id: datasetId, name: "Friday.csv", sourceType: "CICIDS2017", rows: 2, status: "Processed" });
  await db.collection("networkflows").insertMany([
    // Legacy bugs reproduced: prediction copied from the label, GoldenEye mapped to DoSHulk, month/day swapped.
    { datasetId, timestamp: new Date("2017-04-07T08:53:00Z"), sourceIp: "172.16.0.1", destinationIp: "192.168.10.50", sourcePort: 1, destinationPort: 80, protocol: "TCP", label: "DoSHulk", prediction: "DoSHulk", severity: "high", isAttack: true, raw: legacyRaw({ " Label": "DoS GoldenEye", " Timestamp": "4/7/2017 8:53" }) },
    { datasetId, timestamp: new Date(), sourceIp: "172.16.0.1", destinationIp: "192.168.10.50", sourcePort: 2, destinationPort: 80, protocol: "TCP", label: "Normal", prediction: "Normal", severity: "safe", isAttack: false, raw: legacyRaw({ " Label": "BENIGN" }) },
    // Random seed.js row: no dataset, fabricated.
    { timestamp: new Date(), sourceIp: "8.8.8.8", destinationIp: "1.1.1.1", protocol: "UDP", label: "Botnet", prediction: "Botnet", country: "Brazil", isAttack: true },
  ]);
  await db.collection("incidents").insertMany([
    { title: "DDoS activity detected from 172.16.0.1 (500 flows)", attackType: "DDoS", status: "Investigating", priority: "P1", severity: "critical", assignee: "M. Reyes" },
    { title: "Safe one", attackType: "Normal", status: "Open", priority: "P3", severity: "safe", assignee: "Unassigned" },
  ]);
  return { db, datasetId };
}

describe("legacy migration", () => {
  it("dry run reports without writing anything", async () => {
    const { db } = await seedLegacy();
    const report = await planLegacyMigration(db);
    expect(report).toMatchObject({ users: 2, usersWithoutMembership: 2, importedFlows: 2, seededFlowsNotMigrated: 1, datasets: 1, incidents: 2, inventedIncidents: 2 });
    expect(await db.collection("networkflows").countDocuments({ orgId: { $exists: true } })).toBe(0);
    expect(await Membership.countDocuments({})).toBe(0);
  });

  it("migrates in place, fixes legacy bugs, never keeps a copied prediction, and is idempotent", async () => {
    const { db, datasetId } = await seedLegacy();
    const result = await applyLegacyMigration(db);
    expect(result).toMatchObject({ usersAttached: 2, flowsMigrated: 2 });

    const roles = await Membership.find({ orgId: result.orgId }).lean();
    expect(roles.map((r) => r.role).sort()).toEqual(["Analyst", "Owner"]);

    const flows = await db.collection("networkflows").find({ orgId: result.orgId }).sort({ sourcePort: 1 }).toArray();
    expect(flows).toHaveLength(2);
    const [golden, benign] = flows;
    expect(golden?.groundTruthLabel).toBe("DoSGoldenEye");
    expect(golden?.timestamp.toISOString()).toBe("2017-07-04T08:53:00.000Z");
    expect(golden?.scoreStatus).toBe("pending");
    expect(golden?.scored).toBeNull();
    expect(golden?.prediction).toBeUndefined();
    expect(golden?.label).toBeUndefined();
    expect(golden?.legacy).toMatchObject({ label: "DoSHulk", prediction: "DoSHulk" });
    expect(golden?.features["Flow Duration"]).toEqual(expect.any(Number));
    expect(golden?.raw).toBeDefined();
    expect(benign?.groundTruthLabel).toBe("Normal");

    // The seeded random flow is left invisible to the new API.
    expect(await db.collection("networkflows").countDocuments({ orgId: { $exists: false } })).toBe(1);

    const ds = await db.collection("datasets").findOne({ _id: datasetId });
    expect(ds?.groundTruthCounts).toEqual({ DoSGoldenEye: 1, Normal: 1 });

    const incidents = await db.collection("incidents").find({ orgId: result.orgId }).toArray();
    expect(incidents.every((i) => i.legacyAutoGenerated === true && i.assignee === undefined)).toBe(true);
    expect(incidents.find((i) => i.title === "Safe one")?.severity).toBe("info");

    const again = await applyLegacyMigration(db);
    expect(again).toMatchObject({ usersAttached: 0, flowsMigrated: 0 });
    expect(await Membership.countDocuments({})).toBe(2);
  });

  it("lets a legacy user sign in afterwards and see the migrated data", async () => {
    const { db } = await seedLegacy();
    await applyLegacyMigration(db);
    const sa = buildApp();
    const login = await request(sa.app).post(`${API}/auth/login`).send({ email: "admin@legacy.io", password: PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body.orgs[0]).toMatchObject({ name: "Legacy workspace", role: "Owner" });
    expect(login.body.user.preferences.language).toBe("fr");
    const flows = await request(sa.app).get(`${API}/flows`).set("Authorization", `Bearer ${login.body.accessToken}`);
    expect(flows.body.items).toHaveLength(2);
    expect(flows.body.items.every((f: { scored: unknown }) => f.scored === null)).toBe(true);
    const incidents = await request(sa.app).get(`${API}/incidents`).set("Authorization", `Bearer ${login.body.accessToken}`);
    expect(incidents.body.items).toHaveLength(2);
    expect(incidents.body.items[0].legacyAutoGenerated).toBe(true);
    expect(incidents.body.items[0].assignee).toBeNull();
  });
});
