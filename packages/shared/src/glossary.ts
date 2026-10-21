import glossaryJson from "./featureGlossary.json" with { type: "json" };

export interface FeatureGlossaryEntry {
  /** Plain-language name shown to analysts. */
  label: string;
  /** Same unit string as the feature schema JSON. */
  unit: string;
  /** What the statistic measures, in one sentence. Never says whether a value is good or bad. */
  meaning: string;
}

const GLOSSARY = glossaryJson as { schema: string; features: Record<string, FeatureGlossaryEntry> };

/** The glossary entry for a model feature, or null for a name it does not know (shown as the raw name). */
export function featureGlossaryEntry(name: string): FeatureGlossaryEntry | null {
  return GLOSSARY.features[name] ?? null;
}

export const FEATURE_GLOSSARY_NAMES: readonly string[] = Object.keys(GLOSSARY.features);

function trimNumber(n: number, digits: number): string {
  return Number(n.toFixed(digits)).toLocaleString("en-US", { maximumFractionDigits: digits });
}

/** A feature value with its unit; microseconds become µs / ms / s so a duration reads naturally. */
export function formatFeatureValue(name: string, value: number | null): string {
  if (value === null) return "missing (imputed)";
  const unit = featureGlossaryEntry(name)?.unit;
  if (unit === "microseconds") {
    const abs = Math.abs(value);
    if (abs >= 1_000_000) return `${trimNumber(value / 1_000_000, 2)} s`;
    if (abs >= 1_000) return `${trimNumber(value / 1_000, 2)} ms`;
    return `${trimNumber(value, 0)} µs`;
  }
  const digits = Math.abs(value) >= 100 ? 0 : 2;
  const text = trimNumber(value, digits);
  return unit && unit !== "count" && unit !== "ratio" ? `${text} ${unit}` : text;
}
