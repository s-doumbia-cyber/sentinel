import { describe, expect, it } from "vitest";
import { cidrContains, normalizeCidr, parseCidr } from "../src/net.js";

describe("CIDR matching", () => {
  it("matches IPv4 ranges and single addresses", () => {
    const c = parseCidr("172.217.0.0/16");
    expect(c).not.toBeNull();
    expect(cidrContains(c!, "172.217.12.142")).toBe(true);
    expect(cidrContains(c!, "172.218.0.1")).toBe(false);
    expect(cidrContains(parseCidr("72.21.91.29")!, "72.21.91.29")).toBe(true);
    expect(cidrContains(parseCidr("72.21.91.29")!, "72.21.91.30")).toBe(false);
    expect(cidrContains(parseCidr("0.0.0.0/0")!, "8.8.8.8")).toBe(true);
  });

  it("matches IPv6 and never mixes families", () => {
    const c = parseCidr("2001:db8::/32")!;
    expect(cidrContains(c, "2001:db8:1::5")).toBe(true);
    expect(cidrContains(c, "2001:db9::1")).toBe(false);
    expect(cidrContains(c, "10.0.0.1")).toBe(false);
    expect(cidrContains(parseCidr("10.0.0.0/8")!, "::1")).toBe(false);
  });

  it("rejects malformed entries instead of guessing", () => {
    for (const bad of ["", "10.0.0.0/33", "10.0.0.5/24", "10.0.0/24", "300.1.1.1", "10.0.0.0/8/8", "example.com", "10.0.0.0/-1", "2001:db8::/129"]) {
      expect(parseCidr(bad), bad).toBeNull();
    }
    expect(normalizeCidr(" 10.0.0.0/8 ")).toBe("10.0.0.0/8");
    expect(normalizeCidr("2001:DB8::/32")).toBe("2001:db8::/32");
    expect(normalizeCidr("192.168.1.10")).toBe("192.168.1.10/32");
  });
});
