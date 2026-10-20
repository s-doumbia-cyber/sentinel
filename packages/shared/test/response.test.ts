import { describe, expect, it } from "vitest";
import { ATTACK_CLASSES } from "../src/taxonomy.js";
import { isIP } from "../src/net.js";
import { KNOWLEDGE_BASE, STAGE_BY_CLASS, generateBlocklist, sanitizeComment } from "../src/response.js";

describe("knowledge base and stages", () => {
  it("covers every malicious class with confirm and contain steps and a reference", () => {
    for (const cls of ATTACK_CLASSES.filter((c) => c !== "Normal")) {
      const k = KNOWLEDGE_BASE[cls];
      expect(k, cls).toBeDefined();
      expect(k?.confirm.length, cls).toBeGreaterThan(0);
      expect(k?.contain.length, cls).toBeGreaterThan(0);
      expect(k?.references[0]?.url, cls).toMatch(/^https:\/\//);
      expect(STAGE_BY_CLASS[cls], cls).toBeDefined();
    }
  });
});

describe("isIP", () => {
  it.each(["10.0.0.1", "255.255.255.255", "::1", "2001:db8::1", "fe80:0:0:0:0:0:0:1"])("accepts %s", (ip) => expect(isIP(ip)).toBe(true));
  it.each(["256.1.1.1", "1.2.3", "10.0.0.1; rm -rf /", "abc", "2001:db8:::1", ""])("rejects %j", (ip) => expect(isIP(ip)).toBe(false));
});

describe("generateBlocklist (simulation only)", () => {
  it("produces syntactically valid iptables lines", () => {
    const out = generateBlocklist(["203.0.113.7", "2001:db8::7", "203.0.113.7"], "iptables", "INC-42 port scan");
    const lines = out.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^iptables -I INPUT -s 203\.0\.113\.7 -j DROP -m comment --comment "INC-42 port scan"$/);
    expect(lines[1]).toMatch(/^ip6tables -I INPUT -s 2001:db8::7 -j DROP/);
  });

  it("produces a balanced nftables table with typed sets", () => {
    const out = generateBlocklist(["203.0.113.7", "198.51.100.1"], "nftables", "x");
    expect(out).toContain("elements = { 203.0.113.7, 198.51.100.1 }");
    expect(out).toContain("ip saddr @blocked_v4 drop");
    expect(out).not.toContain("blocked_v6");
    expect((out.match(/{/g) ?? []).length).toBe((out.match(/}/g) ?? []).length);
  });

  it("produces CSV and refuses invalid addresses instead of emitting them", () => {
    expect(generateBlocklist(["203.0.113.7"], "csv", "c")).toBe("ip,comment\n203.0.113.7,c\n");
    expect(() => generateBlocklist(["203.0.113.7 -j ACCEPT"], "iptables", "c")).toThrow(/Invalid IP/);
  });

  it("strips characters that could break out of the shell comment", () => {
    expect(sanitizeComment('a"; rm -rf / #`$(x)')).toBe("a rm -rf  x");
    expect(sanitizeComment("")).toBe("sentinel");
  });
});
