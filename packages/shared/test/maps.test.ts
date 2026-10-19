import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CICIDS2017_V1_FEATURES, extractFeatures, parseFeatureValue } from "../src/features.js";
import { MITRE_BY_CLASS } from "../src/mitre.js";
import { ACTIONS, PERMISSIONS, ROLES, can } from "../src/rbac.js";
import { DEFAULT_SEVERITY_BY_CLASS, maxSeverity } from "../src/severity.js";
import { ATTACK_CLASSES } from "../src/taxonomy.js";

describe("severity map", () => {
  it("covers every class and follows the spec", () => {
    for (const cls of ATTACK_CLASSES) expect(DEFAULT_SEVERITY_BY_CLASS[cls]).toBeDefined();
    expect(DEFAULT_SEVERITY_BY_CLASS.DDoS).toBe("critical");
    expect(DEFAULT_SEVERITY_BY_CLASS.PortScan).toBe("low");
    expect(DEFAULT_SEVERITY_BY_CLASS.SSHPatator).toBe("medium");
    expect(DEFAULT_SEVERITY_BY_CLASS.SQLInjection).toBe("high");
  });

  it("takes the max for hybrid decisions", () => {
    expect(maxSeverity("low", "critical", "medium")).toBe("critical");
    expect(maxSeverity()).toBe("info");
  });
});

describe("MITRE map", () => {
  it("maps every malicious class and marks mappings as suggested", () => {
    for (const cls of ATTACK_CLASSES.filter((c) => c !== "Normal")) {
      const m = MITRE_BY_CLASS[cls];
      expect(m, cls).toBeDefined();
      expect(m?.suggested).toBe(true);
    }
    expect(MITRE_BY_CLASS.Normal).toBeUndefined();
    expect(MITRE_BY_CLASS.PortScan?.techniqueId).toBe("T1046");
    expect(MITRE_BY_CLASS.Infiltration?.techniqueId).toBeNull();
  });
});

describe("RBAC matrix", () => {
  it("defines every action for at least the Owner", () => {
    for (const action of ACTIONS) expect(PERMISSIONS[action]).toContain("Owner");
  });

  it("never lets a Viewer mutate", () => {
    const mutations = ACTIONS.filter((a) => !a.endsWith(":read"));
    for (const action of mutations) expect(can("Viewer", action), action).toBe(false);
  });

  it("lets every role read flows", () => {
    for (const role of ROLES) expect(can(role, "flows:read")).toBe(true);
  });
});

describe("cicids2017-v1 feature schema", () => {
  it("matches the JSON consumed by the Python ML service", () => {
    const path = fileURLToPath(new URL("../src/feature-schemas/cicids2017-v1.json", import.meta.url));
    const json = JSON.parse(readFileSync(path, "utf-8")) as { features: { name: string }[] };
    expect(json.features.map((f) => f.name)).toEqual([...CICIDS2017_V1_FEATURES]);
  });

  it("has no duplicate names and excludes identifiers", () => {
    expect(new Set(CICIDS2017_V1_FEATURES).size).toBe(CICIDS2017_V1_FEATURES.length);
    for (const id of ["Source IP", "Destination IP", "Timestamp", "Flow ID", "Label"]) {
      expect(CICIDS2017_V1_FEATURES).not.toContain(id);
    }
  });

  it("parses non-finite values as null, never as 0", () => {
    expect(parseFeatureValue("Infinity")).toBeNull();
    expect(parseFeatureValue("NaN")).toBeNull();
    expect(parseFeatureValue("")).toBeNull();
    expect(parseFeatureValue(" 12.5 ")).toBe(12.5);
    expect(parseFeatureValue("0")).toBe(0);
  });

  it("reports missing feature columns", () => {
    const { features, missing } = extractFeatures({ "Flow Duration": "10" }, "cicids2017-v1");
    expect(features["Flow Duration"]).toBe(10);
    expect(missing).toHaveLength(CICIDS2017_V1_FEATURES.length - 1);
  });
});
