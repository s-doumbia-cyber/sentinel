import type { FeatureSchemaId } from "./taxonomy.js";

/**
 * Feature names of `cicids2017-v1`, in model order. The JSON file next to this
 * module is what the Python ML service reads; a test asserts both stay equal.
 */
export const CICIDS2017_V1_FEATURES = [
  "Flow Duration",
  "Total Fwd Packets",
  "Total Backward Packets",
  "Total Length of Fwd Packets",
  "Total Length of Bwd Packets",
  "Fwd Packet Length Max",
  "Fwd Packet Length Min",
  "Fwd Packet Length Mean",
  "Fwd Packet Length Std",
  "Bwd Packet Length Max",
  "Bwd Packet Length Min",
  "Bwd Packet Length Mean",
  "Bwd Packet Length Std",
  "Flow Bytes/s",
  "Flow Packets/s",
  "Flow IAT Mean",
  "Flow IAT Std",
  "Flow IAT Max",
  "Flow IAT Min",
  "Fwd IAT Total",
  "Fwd IAT Mean",
  "Bwd IAT Total",
  "Bwd IAT Mean",
  "Fwd PSH Flags",
  "Fwd Packets/s",
  "Bwd Packets/s",
  "Min Packet Length",
  "Max Packet Length",
  "Packet Length Mean",
  "Packet Length Std",
  "FIN Flag Count",
  "SYN Flag Count",
  "RST Flag Count",
  "PSH Flag Count",
  "ACK Flag Count",
  "URG Flag Count",
  "Down/Up Ratio",
  "Average Packet Size",
  "Init_Win_bytes_forward",
  "Init_Win_bytes_backward",
  "act_data_pkt_fwd",
  "min_seg_size_forward",
  "Active Mean",
  "Idle Mean",
] as const;

export type FeatureVector = Record<string, number | null>;

export const FEATURES_BY_SCHEMA: Partial<Record<FeatureSchemaId, readonly string[]>> = {
  "cicids2017-v1": CICIDS2017_V1_FEATURES,
  // sentinel-native-v1 is frozen in Phase 2 together with the collector.
};

/**
 * Parses a raw CSV cell into a finite number, or `null` when the value is
 * missing or non-finite (CICIDS2017 contains "Infinity" and "NaN" in its rate
 * columns). Null is preserved rather than coerced to 0 so the model pipeline's
 * documented imputation applies instead of a silent default.
 */
export function parseFeatureValue(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Extracts the schema's features from a record keyed by trimmed CSV headers. */
export function extractFeatures(
  record: Record<string, unknown>,
  schema: FeatureSchemaId,
): { features: FeatureVector; missing: string[] } {
  const names = FEATURES_BY_SCHEMA[schema];
  if (!names) throw new Error(`Feature schema ${schema} is not defined yet`);
  const features: FeatureVector = {};
  const missing: string[] = [];
  for (const name of names) {
    if (!(name in record)) {
      missing.push(name);
      continue;
    }
    features[name] = parseFeatureValue(record[name]);
  }
  return { features, missing };
}
