import request from "supertest";
import { describe, expect, it } from "vitest";
import { Alert, Flow } from "../src/models/tenant.js";
import { isUnusualBehaviour } from "../src/modules/scoring/scoring.service.js";
import { API, FakeMl, buildApp, oid, registerUser, writeCsv, type CsvRow } from "./helpers.js";

// FakeMl with novelty: scores above the threshold for DDoS-like flows and Flow Duration 7 / 21 / 22.
const ml = new FakeMl();
const sa = buildApp({ ml });

const rows = (src: string, n: number, raw: Record<string, string>): CsvRow[] => Array.from({ length: n }, () => ({ srcIp: src, dstIp: "10.0.0.80", raw }));

async function setup(withNovelty: boolean) {
  ml.novelty = withNovelty;
  const u = await registerUser(sa);
  const auth = { Authorization: `Bearer ${u.token}` };
  await request(sa.app).post(`${API}/models/bench-a/activate`).set(auth).expect(200);
  const csv = writeCsv([
    ...rows("192.0.2.21", 3, { "Flow Duration": "21" }), // Normal verdict, far from benign traffic
    ...rows("192.0.2.5", 3, { "Flow Packets/s": "5000" }), // confident DDoS: unusual too, but recognised
    ...rows("192.0.2.7", 3, { "Flow Duration": "7" }), // low-confidence PortScan, far from benign traffic
    ...rows("192.0.2.9", 3, {}), // ordinary Normal
  ]);
  await request(sa.app).post(`${API}/imports/csv`).set(auth).attach("file", csv).expect(202);
  await sa.jobs.idle();
  return { u, auth };
}

describe("isUnusualBehaviour", () => {
  it("needs a novelty score above the threshold and a verdict that is not a confident known attack", () => {
    const above = { aboveThreshold: true };
    expect(isUnusualBehaviour(above, "Normal", 0.99, 0.6)).toBe(true);
    expect(isUnusualBehaviour(above, "PortScan", 0.4, 0.6)).toBe(true);
    expect(isUnusualBehaviour(above, "DDoS", 0.95, 0.6)).toBe(false);
    expect(isUnusualBehaviour({ aboveThreshold: false }, "Normal", 0.9, 0.6)).toBe(false);
    expect(isUnusualBehaviour(undefined, "Normal", 0.9, 0.6)).toBe(false);
  });
});

describe("novelty (unusual behaviour)", () => {
  it("flags unusual flows without changing their class, and never raises an attack alert for them", async () => {
    const { u, auth } = await setup(true);
    const unusual = (await request(sa.app).get(`${API}/flows?unusual=true&limit=100`).set(auth)).body.items as {
      sourceIp: string;
      scored: { label: string; unusualBehaviour: boolean; novelty: { score: number; threshold: number; aboveThreshold: boolean }; needsReview: boolean };
    }[];
    expect(unusual.map((f) => f.sourceIp).sort()).toEqual(["192.0.2.21", "192.0.2.21", "192.0.2.21", "192.0.2.7", "192.0.2.7", "192.0.2.7"]);
    // The verdicts are exactly what the classifier said: novelty never relabels a flow.
    const byIp = (ip: string) => unusual.filter((f) => f.sourceIp === ip).map((f) => f.scored.label);
    expect(byIp("192.0.2.21")).toEqual(["Normal", "Normal", "Normal"]);
    expect(byIp("192.0.2.7")).toEqual(["PortScan", "PortScan", "PortScan"]);
    expect(unusual[0]?.scored.novelty).toMatchObject({ aboveThreshold: true, threshold: 0.55 });

    // Confident known attack: above the threshold, but recognised, so not "unusual".
    const ddos = await Flow.findOne({ orgId: oid(u.orgId), sourceIp: "192.0.2.5" }).lean();
    expect(ddos?.scored?.novelty?.aboveThreshold).toBe(true);
    expect(ddos?.scored?.unusualBehaviour).toBe(false);
    const ordinary = await Flow.findOne({ orgId: oid(u.orgId), sourceIp: "192.0.2.9" }).lean();
    expect(ordinary?.scored?.unusualBehaviour).toBe(false);

    // A Normal verdict that is unusual raises no alert; alerts still follow the model verdicts only.
    expect(await Alert.countDocuments({ orgId: oid(u.orgId), srcIp: "192.0.2.21" })).toBe(0);
    expect((await Alert.find({ orgId: oid(u.orgId) }).lean()).map((a) => `${a.type}:${a.srcIp}`).sort()).toEqual(["DDoS:192.0.2.5", "PortScan:192.0.2.7"]);
  });

  it("leaves flows untouched when the active model has no novelty detector", async () => {
    const { auth } = await setup(false);
    const flows = (await request(sa.app).get(`${API}/flows?limit=100`).set(auth)).body.items as { scored: { novelty: unknown; unusualBehaviour: boolean } }[];
    expect(flows).toHaveLength(12);
    expect(flows.every((f) => f.scored.novelty === null && f.scored.unusualBehaviour === false)).toBe(true);
    expect((await request(sa.app).get(`${API}/flows?unusual=true`).set(auth)).body.items).toEqual([]);
    expect((await request(sa.app).get(`${API}/flows?unusual=yes`).set(auth)).status).toBe(400);
  });
});
