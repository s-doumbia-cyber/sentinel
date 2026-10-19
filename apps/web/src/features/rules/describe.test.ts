import { describe, expect, it } from "vitest";
import { STARTER_RULES, ruleDefinitionSchema } from "@sentinel/shared";
import { describeRule } from "./describe";

const rule = (key: string) => ruleDefinitionSchema.parse(STARTER_RULES.find((r) => r.key === key));

describe("describeRule", () => {
  it("describes distinct-count rules", () => {
    expect(describeRule(rule("R-PORTSCAN-01"))).toBe(
      "Fires on 100 or more distinct destination ports per source IP within 60s, counting only flows at most 3 packets per flow.",
    );
  });

  it("puts the protocol before 'flows' and lists every filter", () => {
    expect(describeRule(rule("R-BRUTEFORCE-SSH-01"))).toBe(
      "Fires on 30 or more flows per source IP + destination IP within 60s, counting only TCP flows to port 22, lasting at most 10 s.",
    );
  });

  it("omits the scope when there is no filter", () => {
    expect(describeRule({ window: "5m", groupBy: ["sourceIp"], condition: { gte: 3 }, filter: {} })).toBe("Fires on 3 or more flows per source IP within 5m.");
  });
});
