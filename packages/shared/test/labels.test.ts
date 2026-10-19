import { describe, expect, it } from "vitest";
import { normalizeLabel } from "../src/labels.js";
import { ATTACK_CLASSES } from "../src/taxonomy.js";

describe("normalizeLabel", () => {
  it.each([
    ["BENIGN", "Normal"],
    ["DDoS", "DDoS"],
    ["DoS Hulk", "DoSHulk"],
    ["DoS GoldenEye", "DoSGoldenEye"],
    ["DoS slowloris", "DoSSlowloris"],
    ["DoS Slowhttptest", "DoSSlowloris"],
    ["FTP-Patator", "FTPPatator"],
    ["SSH-Patator", "SSHPatator"],
    ["PortScan", "PortScan"],
    ["Bot", "Botnet"],
    ["Infiltration", "Infiltration"],
    ["Heartbleed", "Heartbleed"],
    ["Web Attack � Brute Force", "WebAttack"],
    ["Web Attack – Brute Force", "WebAttack"],
    ["Web Attack – XSS", "XSS"],
    ["Web Attack � Sql Injection", "SQLInjection"],
    ["  benign  ", "Normal"],
  ])("maps CICIDS2017 label %j to %s", (raw, expected) => {
    expect(normalizeLabel(raw)).toBe(expected);
  });

  it("is the identity on canonical class names", () => {
    for (const cls of ATTACK_CLASSES) expect(normalizeLabel(cls)).toBe(cls);
  });

  it.each(["", "   ", "Unknown", "robot", "ftp-server", "Infiltrator", "DoS", "Web Attack – Phishing"])(
    "returns null for unknown label %j instead of guessing",
    (raw) => {
      expect(normalizeLabel(raw)).toBeNull();
    },
  );

  it("returns null for non-string input", () => {
    expect(normalizeLabel(undefined)).toBeNull();
    expect(normalizeLabel(null)).toBeNull();
    expect(normalizeLabel(42)).toBeNull();
  });
});
