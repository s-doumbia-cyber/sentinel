import { describe, expect, it } from "vitest";
import { STARTER_RULES, ruleDefinitionSchema, type RuleDefinition } from "@sentinel/shared";
import { RuleEvaluator, evaluateRule, type RuleFlow } from "../src/modules/rules/evaluator.js";

const rules = Object.fromEntries(STARTER_RULES.map((r) => [r.key, ruleDefinitionSchema.parse(r)])) as Record<string, RuleDefinition>;
const T0 = Date.parse("2026-10-20T10:00:00Z");
let seq = 0;

function flow(over: Partial<RuleFlow> & { atMs?: number } = {}): RuleFlow {
  const { atMs = 0, ...rest } = over;
  return {
    id: `f${seq++}`,
    timestamp: new Date(T0 + atMs),
    sourceIp: "10.0.0.66",
    destinationIp: "10.0.0.10",
    sourcePort: 40000,
    destinationPort: 80,
    protocol: "TCP",
    totalPackets: 2,
    flowDurationMs: 5,
    features: { "SYN Flag Count": 1, "ACK Flag Count": 0, "Flow Packets/s": 0.5 },
    ...rest,
  };
}

/** n flows spread evenly over `spanMs`, built by `make(i)`. */
function burst(n: number, spanMs: number, make: (i: number) => Partial<RuleFlow>): RuleFlow[] {
  return Array.from({ length: n }, (_, i) => flow({ atMs: Math.floor((i * spanMs) / n), ...make(i) }));
}

describe("starter rules", () => {
  it("all starter rules are valid definitions", () => {
    expect(Object.keys(rules)).toHaveLength(STARTER_RULES.length);
  });

  describe("R-PORTSCAN-01", () => {
    const rule = rules["R-PORTSCAN-01"]!;
    it("fires on 100 distinct ports from one source within a minute", () => {
      const hits = evaluateRule(rule, burst(120, 50_000, (i) => ({ destinationPort: 1000 + i })));
      expect(hits).toHaveLength(1);
      expect(hits[0]).toMatchObject({ ruleKey: "R-PORTSCAN-01", group: { sourceIp: "10.0.0.66" }, value: 100 });
    });
    it("does not fire on many flows to the same few ports", () => {
      expect(evaluateRule(rule, burst(500, 50_000, (i) => ({ destinationPort: 80 + (i % 3) })))).toHaveLength(0);
    });
    it("does not fire when the ports are spread over more than the window", () => {
      expect(evaluateRule(rule, burst(120, 10 * 60_000, (i) => ({ destinationPort: 1000 + i })))).toHaveLength(0);
    });
    it("ignores large flows (filter maxPacketsPerFlow) and unknown packet counts", () => {
      expect(evaluateRule(rule, burst(120, 30_000, (i) => ({ destinationPort: 1000 + i, totalPackets: 40 })))).toHaveLength(0);
      expect(evaluateRule(rule, burst(120, 30_000, (i) => ({ destinationPort: 1000 + i, totalPackets: null })))).toHaveLength(0);
    });
  });

  describe("R-BRUTEFORCE-SSH-01", () => {
    const rule = rules["R-BRUTEFORCE-SSH-01"]!;
    it("fires on 30 short flows to port 22 within a minute", () => {
      const hits = evaluateRule(rule, burst(40, 40_000, () => ({ destinationPort: 22, flowDurationMs: 800 })));
      expect(hits).toHaveLength(1);
      expect(hits[0]?.group).toEqual({ sourceIp: "10.0.0.66", destinationIp: "10.0.0.10" });
    });
    it("does not fire on long interactive SSH sessions or on another port", () => {
      expect(evaluateRule(rule, burst(40, 40_000, () => ({ destinationPort: 22, flowDurationMs: 600_000 })))).toHaveLength(0);
      expect(evaluateRule(rule, burst(40, 40_000, () => ({ destinationPort: 2222, flowDurationMs: 800 })))).toHaveLength(0);
    });
    it("does not merge different targets", () => {
      expect(evaluateRule(rule, burst(40, 40_000, (i) => ({ destinationPort: 22, flowDurationMs: 800, destinationIp: `10.0.1.${i}` })))).toHaveLength(0);
    });
  });

  describe("R-BRUTEFORCE-FTP-01", () => {
    const rule = rules["R-BRUTEFORCE-FTP-01"]!;
    it("fires on 30 short flows to port 21 within a minute", () => {
      expect(evaluateRule(rule, burst(30, 59_000, () => ({ destinationPort: 21, flowDurationMs: 300 })))).toHaveLength(1);
    });
    it("does not fire below the threshold or over UDP", () => {
      expect(evaluateRule(rule, burst(29, 59_000, () => ({ destinationPort: 21, flowDurationMs: 300 })))).toHaveLength(0);
      expect(evaluateRule(rule, burst(40, 59_000, () => ({ destinationPort: 21, flowDurationMs: 300, protocol: "UDP" })))).toHaveLength(0);
    });
  });

  describe("R-SYNFLOOD-01", () => {
    const rule = rules["R-SYNFLOOD-01"]!;
    it("fires on 500 SYN-only flows to one destination, from many sources", () => {
      const hits = evaluateRule(rule, burst(600, 30_000, (i) => ({ sourceIp: `198.51.100.${i % 250}` })));
      expect(hits).toHaveLength(1);
      expect(hits[0]?.group).toEqual({ destinationIp: "10.0.0.10" });
    });
    it("does not fire on completed handshakes or flows without flag features", () => {
      expect(evaluateRule(rule, burst(600, 30_000, () => ({ features: { "SYN Flag Count": 1, "ACK Flag Count": 3 } })))).toHaveLength(0);
      expect(evaluateRule(rule, burst(600, 30_000, () => ({ features: null })))).toHaveLength(0);
    });
  });

  describe("R-SLOWHTTP-01", () => {
    const rule = rules["R-SLOWHTTP-01"]!;
    const silentServer = { "Flow Packets/s": 0.5, "Total Length of Bwd Packets": 0 };
    it("fires on 20 long low-rate flows to a plain-HTTP server that sends almost nothing back", () => {
      expect(evaluateRule(rule, burst(25, 4 * 60_000, () => ({ flowDurationMs: 90_000, features: silentServer })))).toHaveLength(1);
      expect(evaluateRule(rule, burst(25, 4 * 60_000, () => ({ destinationPort: 8080, flowDurationMs: 90_000, features: silentServer })))).toHaveLength(1);
    });
    // Both cases below were false positives of the previous default on CICIDS2017 (long benign HTTPS / CDN sessions).
    it("does not fire when the server answers, or on HTTPS sessions", () => {
      const answered = { "Flow Packets/s": 0.5, "Total Length of Bwd Packets": 11_595 };
      expect(evaluateRule(rule, burst(25, 4 * 60_000, () => ({ flowDurationMs: 90_000, features: answered })))).toHaveLength(0);
      expect(evaluateRule(rule, burst(25, 4 * 60_000, () => ({ destinationPort: 443, flowDurationMs: 90_000, features: silentServer })))).toHaveLength(0);
      // Missing payload size: no evidence the server stayed silent, so no hit.
      expect(evaluateRule(rule, burst(25, 4 * 60_000, () => ({ flowDurationMs: 90_000, features: { "Flow Packets/s": 0.5 } })))).toHaveLength(0);
    });
    it("does not fire on short or fast flows", () => {
      expect(evaluateRule(rule, burst(25, 4 * 60_000, () => ({ flowDurationMs: 2_000 })))).toHaveLength(0);
      expect(evaluateRule(rule, burst(25, 4 * 60_000, () => ({ flowDurationMs: 90_000, features: { "Flow Packets/s": 40 } })))).toHaveLength(0);
    });
  });
});

describe("RuleEvaluator", () => {
  const rule = rules["R-BRUTEFORCE-FTP-01"]!;

  it("emits one hit per window for a sustained burst, and a new one after the quiet period", () => {
    const hits = evaluateRule(rule, burst(300, 150_000, () => ({ destinationPort: 21, flowDurationMs: 300 })));
    // 2 flows/s for 150 s: threshold reached at ~15 s, then quiet 60 s, then again.
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(hits.length).toBeLessThanOrEqual(3);
    expect(new Set(hits.map((h) => h.hitKey)).size).toBe(hits.length);
  });

  it("is deterministic, so re-evaluation produces the same hit keys", () => {
    seq = 0;
    const a = evaluateRule(rule, burst(40, 40_000, () => ({ destinationPort: 21, flowDurationMs: 300 })));
    seq = 0;
    const b = evaluateRule(rule, burst(40, 40_000, () => ({ destinationPort: 21, flowDurationMs: 300 })));
    expect(a.map((h) => h.hitKey)).toEqual(b.map((h) => h.hitKey));
  });

  it("rejects out-of-order input instead of silently miscounting", () => {
    const ev = new RuleEvaluator(rule);
    ev.push(flow({ atMs: 10_000 }));
    expect(() => ev.push(flow({ atMs: 0 }))).toThrow(/timestamp order/);
  });

  it("validates rule definitions", () => {
    const bad = { ...STARTER_RULES[0], window: "2d" };
    expect(ruleDefinitionSchema.safeParse(bad).success).toBe(false);
    expect(ruleDefinitionSchema.safeParse({ ...STARTER_RULES[0], alertType: "Normal" }).success).toBe(false);
    expect(ruleDefinitionSchema.safeParse({ ...STARTER_RULES[0], groupBy: ["destinationPort"] }).success).toBe(false);
  });
});
