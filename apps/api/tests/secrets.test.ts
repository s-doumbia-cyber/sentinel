import { describe, expect, it } from "vitest";
import { SecretBox } from "../src/lib/secrets.js";

describe("SecretBox (AES-256-GCM at rest)", () => {
  const box = new SecretBox("k".repeat(40));

  it("round-trips, never repeats a ciphertext, and hides the plaintext", () => {
    const a = box.seal("JBSWY3DPEHPK3PXP");
    const b = box.seal("JBSWY3DPEHPK3PXP");
    expect(a).not.toBe(b);
    expect(a).not.toContain("JBSWY3DPEHPK3PXP");
    expect(box.open(a)).toBe("JBSWY3DPEHPK3PXP");
  });

  it("refuses a tampered value and another key", () => {
    const sealed = box.seal("secret");
    const parts = sealed.split(".");
    const ct = parts[3] ?? "";
    const flipped = ct.slice(0, -1) + (ct.endsWith("A") ? "B" : "A");
    const tampered = [parts[0], parts[1], parts[2], flipped].join(".");
    expect(() => box.open(tampered)).toThrow();
    expect(() => new SecretBox("z".repeat(40)).open(sealed)).toThrow();
    expect(() => box.open("v0.x.y.z")).toThrow(/Unsupported/);
  });
});
