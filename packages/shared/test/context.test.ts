import { describe, expect, it } from "vitest";
import { addressScope, estimateDeviceType, gradeAttribution, identityRowSchema } from "../src/context.js";

describe("addressScope", () => {
  it.each([
    ["10.1.2.3", "internal"],
    ["172.16.0.1", "internal"],
    ["172.32.0.1", "external"],
    ["192.168.10.50", "internal"],
    ["8.8.8.8", "external"],
    ["100.64.1.1", "internal"],
    ["fd00::1", "internal"],
    ["2001:4860::8888", "external"],
    ["not-an-ip", "unknown"],
  ])("%s is %s", (ip, scope) => expect(addressScope(ip)).toBe(scope));
});

describe("estimateDeviceType", () => {
  it("labels services as an estimate with its basis", () => {
    const e = estimateDeviceType([{ port: 443, protocol: "TCP", flows: 40 }, { port: 80, protocol: "TCP", flows: 12 }], 0);
    expect(e).toMatchObject({ label: "Web server", confidence: "low", source: "port-heuristic" });
    expect(e?.basis).toContain("TCP/443");
  });
  it("prefers the most specific hint", () => {
    expect(estimateDeviceType([{ port: 88, protocol: "TCP", flows: 9 }, { port: 443, protocol: "TCP", flows: 9 }], 0)?.label).toMatch(/Kerberos/);
  });
  it("ignores single probes and falls back to client or unknown", () => {
    expect(estimateDeviceType([{ port: 22, protocol: "TCP", flows: 1 }], 5)?.label).toMatch(/Client/);
    expect(estimateDeviceType([{ port: 22, protocol: "TCP", flows: 1 }], 0)).toBeNull();
  });
});

describe("identity rows", () => {
  const ok = { ip: "10.0.0.5", start: "2026-10-20T08:00:00Z", end: "2026-10-20T18:00:00Z", source: "dhcp", hostname: "LAPTOP-42" };
  it("accepts a valid row and normalises empty fields to null", () => {
    expect(identityRowSchema.parse({ ...ok, username: "", mac: "" })).toMatchObject({ username: null, mac: null, hostname: "LAPTOP-42" });
  });
  it("rejects rows without an identity, with bad dates or an unknown source", () => {
    expect(identityRowSchema.safeParse({ ...ok, hostname: "" }).success).toBe(false);
    expect(identityRowSchema.safeParse({ ...ok, end: "2026-10-19T00:00:00Z" }).success).toBe(false);
    expect(identityRowSchema.safeParse({ ...ok, source: "geoip" }).success).toBe(false);
    expect(identityRowSchema.safeParse({ ...ok, mac: "zz:zz" }).success).toBe(false);
  });
});

describe("gradeAttribution", () => {
  const window = { from: new Date("2026-10-20T10:00:00Z"), to: new Date("2026-10-20T10:05:00Z") };
  it("is high only for a session-level source covering the whole window", () => {
    expect(gradeAttribution({ source: "vpn", validFrom: new Date("2026-10-20T09:00:00Z"), validTo: new Date("2026-10-20T12:00:00Z") }, window).confidence).toBe("high");
    expect(gradeAttribution({ source: "dhcp", validFrom: new Date("2026-10-20T09:00:00Z"), validTo: new Date("2026-10-20T12:00:00Z") }, window).confidence).toBe("medium");
    expect(gradeAttribution({ source: "vpn", validFrom: new Date("2026-10-20T10:03:00Z"), validTo: new Date("2026-10-20T12:00:00Z") }, window).confidence).toBe("medium");
    expect(gradeAttribution({ source: "manual", validFrom: new Date("2026-10-20T09:00:00Z"), validTo: null }, { from: new Date("2026-10-20T09:00:00Z"), to: new Date("2026-10-20T09:00:00Z") }).confidence).toBe("low");
  });
  it("never matches a record outside the window", () => {
    const g = gradeAttribution({ source: "auth", validFrom: new Date("2026-10-19T00:00:00Z"), validTo: new Date("2026-10-19T01:00:00Z") }, window);
    expect(g.confidence).toBe("low");
    expect(g.reasons[0]).toMatch(/does not overlap/);
  });
});
