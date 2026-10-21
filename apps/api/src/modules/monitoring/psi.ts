/**
 * Population stability index (PSI) between a training-time reference histogram
 * and recent data binned with the same edges (docs/ML_AND_DETECTION.md §9).
 *
 *   PSI = sum_i (q_i - p_i) * ln((q_i + e) / (p_i + e))
 *
 * p = reference share of bin i, q = current share, e a small smoothing term so
 * an empty bin does not give an infinite score. Common reading: < 0.1 stable,
 * 0.1 - 0.2 moderate change, >= 0.2 significant change. PSI measures that the
 * input distribution moved; it does not say the model got worse.
 */
export const PSI_EPSILON = 1e-4;
export const PSI_MODERATE = 0.1;
export const PSI_SIGNIFICANT = 0.2;

export type DriftLevel = "stable" | "moderate" | "significant";

export function driftLevel(psi: number): DriftLevel {
  return psi >= PSI_SIGNIFICANT ? "significant" : psi >= PSI_MODERATE ? "moderate" : "stable";
}

/** Index of the bin a value falls into: bin i is (edges[i-1], edges[i]], open at both ends (same as numpy searchsorted "left"). */
export function binIndex(value: number, edges: readonly number[]): number {
  let lo = 0;
  let hi = edges.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (value <= (edges[mid] as number)) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** Counts of the finite values per bin; null / NaN / infinity are left out (reported as "missing"). */
export function binCounts(values: readonly (number | null | undefined)[], edges: readonly number[]): number[] {
  const counts = new Array<number>(edges.length + 1).fill(0);
  for (const v of values) {
    if (typeof v === "number" && Number.isFinite(v)) {
      const i = binIndex(v, edges);
      counts[i] = (counts[i] ?? 0) + 1;
    }
  }
  return counts;
}

/** PSI of current bin counts against reference proportions; null when there is nothing to compare. */
export function psi(referenceProportions: readonly number[], currentCounts: readonly number[]): number | null {
  const total = currentCounts.reduce((a, b) => a + b, 0);
  if (!total || referenceProportions.length !== currentCounts.length || !referenceProportions.length) return null;
  let sum = 0;
  for (let i = 0; i < currentCounts.length; i++) {
    const p = referenceProportions[i] as number;
    const q = (currentCounts[i] as number) / total;
    sum += (q - p) * Math.log((q + PSI_EPSILON) / (p + PSI_EPSILON));
  }
  return sum;
}
