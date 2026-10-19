import { describe, expect, it } from "vitest";
import request from "supertest";
import "./setup.js";
import { createApp } from "../src/app.js";
import { NetworkFlow } from "../src/models/NetworkFlow.js";

const app = createApp();

async function getToken(email = "flowtester@example.com") {
  const res = await request(app)
    .post("/api/auth/register")
    .send({ name: "Flow Tester", email, password: "password123" });
  return res.body.token;
}

function makeFlow(overrides = {}) {
  return {
    timestamp: new Date(),
    sourceIp: "10.0.0.1",
    destinationIp: "10.0.0.2",
    sourcePort: 1234,
    destinationPort: 80,
    protocol: "TCP",
    flowDurationMs: 100,
    packetLength: 500,
    label: "Normal",
    prediction: "Normal",
    severity: "safe",
    isAttack: false,
    ...overrides,
  };
}

describe("Flow KPIs and aggregations", () => {
  it("rejects requests without a token", async () => {
    const res = await request(app).get("/api/flows/kpis");
    expect(res.status).toBe(401);
  });

  it("computes totals correctly for a known seeded set", async () => {
    const token = await getToken("kpi1@example.com");
    await NetworkFlow.insertMany([
      makeFlow({ label: "DDoS", severity: "critical", isAttack: true }),
      makeFlow({}),
      makeFlow({}),
    ]);

    const res = await request(app).get("/api/flows/kpis").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.totalFlows).toBe(3);
    expect(res.body.totalAttacks).toBe(1);
    expect(res.body.normalTraffic).toBe(2);
    expect(res.body.attackPercentage).toBeCloseTo(33.33, 1);
  });

  it("filters KPIs by attackType", async () => {
    const token = await getToken("kpi2@example.com");
    await NetworkFlow.insertMany([
      makeFlow({ label: "DDoS", severity: "critical", isAttack: true, destinationPort: 80 }),
      makeFlow({ label: "FTPPatator", severity: "medium", isAttack: true, destinationPort: 21 }),
    ]);

    const res = await request(app)
      .get("/api/flows/kpis?attackType=DDoS")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.totalFlows).toBe(1);
    expect(res.body.totalAttacks).toBe(1);
  });

  it("groups attack-breakdown by label, attacks only", async () => {
    const token = await getToken("breakdown@example.com");
    await NetworkFlow.insertMany([
      makeFlow({ label: "DDoS", severity: "critical", isAttack: true }),
      makeFlow({ label: "DDoS", severity: "critical", isAttack: true }),
      makeFlow({ label: "PortScan", severity: "low", isAttack: true }),
      makeFlow({}), // normal traffic — should be excluded from the breakdown
    ]);

    const res = await request(app).get("/api/flows/attack-breakdown").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    const ddos = res.body.find((r) => r.name === "DDoS");
    expect(ddos.value).toBe(2);
    const normalEntry = res.body.find((r) => r.name === "Normal");
    expect(normalEntry).toBeUndefined();
  });

  it("ranks top attacking source IPs correctly", async () => {
    const token = await getToken("attackers@example.com");
    await NetworkFlow.insertMany([
      makeFlow({ sourceIp: "192.168.1.50", label: "PortScan", severity: "low", isAttack: true }),
      makeFlow({ sourceIp: "192.168.1.50", label: "PortScan", severity: "low", isAttack: true }),
      makeFlow({ sourceIp: "192.168.1.99", label: "DDoS", severity: "critical", isAttack: true }),
    ]);

    const res = await request(app).get("/api/flows/top-attackers").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body[0].sourceIp).toBe("192.168.1.50");
    expect(res.body[0].attacks).toBe(2);
  });

  it("groups top-subnets by first octet", async () => {
    const token = await getToken("subnets@example.com");
    await NetworkFlow.insertMany([
      makeFlow({ sourceIp: "172.16.0.1", label: "Botnet", severity: "critical", isAttack: true }),
      makeFlow({ sourceIp: "172.16.5.9", label: "Botnet", severity: "critical", isAttack: true }),
      makeFlow({ sourceIp: "10.0.0.1", label: "PortScan", severity: "low", isAttack: true }),
    ]);

    const res = await request(app).get("/api/flows/top-subnets").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    const subnet172 = res.body.find((r) => r.subnet === "172");
    expect(subnet172.attacks).toBe(2);
  });

  it("paginates the flow listing", async () => {
    const token = await getToken("paginate@example.com");
    const flows = Array.from({ length: 15 }, (_, i) => makeFlow({ sourcePort: 1000 + i }));
    await NetworkFlow.insertMany(flows);

    const res = await request(app)
      .get("/api/flows?page=1&limit=10")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.rows.length).toBe(10);
    expect(res.body.total).toBe(15);
    expect(res.body.pages).toBe(2);
  });
});
