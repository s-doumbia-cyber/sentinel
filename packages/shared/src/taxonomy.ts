/**
 * Canonical attack taxonomy (docs/ML_AND_DETECTION.md §3).
 * `Normal` is benign traffic. Lab classes are appended here when added.
 */
export const ATTACK_CLASSES = [
  "Normal",
  "DDoS",
  "DoSHulk",
  "DoSSlowloris",
  "DoSGoldenEye",
  "FTPPatator",
  "SSHPatator",
  "PortScan",
  "Botnet",
  "Infiltration",
  "WebAttack",
  "XSS",
  "SQLInjection",
  "Heartbleed",
] as const;

export type AttackClass = (typeof ATTACK_CLASSES)[number];

export const BENIGN_CLASS: AttackClass = "Normal";

const CLASS_SET: ReadonlySet<string> = new Set(ATTACK_CLASSES);

export function isAttackClass(value: unknown): value is AttackClass {
  return typeof value === "string" && CLASS_SET.has(value);
}

export function isMalicious(value: AttackClass): boolean {
  return value !== BENIGN_CLASS;
}

/**
 * Where a flow came from. The UI must always show it, and REPLAY must never be
 * presented as LIVE (docs/ML_AND_DETECTION.md §12).
 */
export const SOURCE_KINDS = ["LIVE", "REPLAY", "IMPORTED", "DEMO"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/** Feature schemas: each model is trained on exactly one, and only scores flows of that schema. */
export const FEATURE_SCHEMA_IDS = ["cicids2017-v1", "sentinel-native-v1"] as const;
export type FeatureSchemaId = (typeof FEATURE_SCHEMA_IDS)[number];
