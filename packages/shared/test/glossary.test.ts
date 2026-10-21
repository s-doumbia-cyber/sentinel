import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CICIDS2017_V1_FEATURES, FEATURE_GLOSSARY_NAMES, featureGlossaryEntry, formatFeatureValue } from "../src/index.js";

describe("feature glossary", () => {
  it("has a plain-language entry for every cicids2017-v1 feature and nothing else", () => {
    for (const name of CICIDS2017_V1_FEATURES) {
      const e = featureGlossaryEntry(name);
      expect(e, name).not.toBeNull();
      expect(e?.label.length, name).toBeGreaterThan(3);
      expect(e?.meaning.endsWith("."), name).toBe(true);
    }
    expect([...FEATURE_GLOSSARY_NAMES].sort()).toEqual([...CICIDS2017_V1_FEATURES].sort());
  });

  it("uses the same unit as the feature schema the ML service reads", () => {
    const path = fileURLToPath(new URL("../src/feature-schemas/cicids2017-v1.json", import.meta.url));
    const schema = JSON.parse(readFileSync(path, "utf-8")) as { features: { name: string; unit: string }[] };
    for (const f of schema.features) expect(featureGlossaryEntry(f.name)?.unit, f.name).toBe(f.unit);
  });

  it("gives every feature a distinct label, so two bars never read the same", () => {
    const labels = FEATURE_GLOSSARY_NAMES.map((n) => featureGlossaryEntry(n)?.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("returns null for an unknown feature instead of inventing a label", () => {
    expect(featureGlossaryEntry("sentinel-native-only")).toBeNull();
  });

  it("formats values with their units", () => {
    expect(formatFeatureValue("Flow Packets/s", 812.4)).toBe("812 packets/s");
    expect(formatFeatureValue("Flow Duration", 1_500_000)).toBe("1.5 s");
    expect(formatFeatureValue("Flow Duration", 2_500)).toBe("2.5 ms");
    expect(formatFeatureValue("Flow Duration", 12)).toBe("12 µs");
    expect(formatFeatureValue("SYN Flag Count", 1)).toBe("1");
    expect(formatFeatureValue("Down/Up Ratio", 0.5)).toBe("0.5");
    expect(formatFeatureValue("Flow Bytes/s", null)).toBe("missing (imputed)");
  });
});
