/** Fewer support examples than this get an "unstable estimate" flag (docs/ML_AND_DETECTION.md §12). */
export const UNSTABLE_SUPPORT = 30;

export interface ClassResult {
  label: string;
  precision: number | null;
  recall: number | null;
  f1: number | null;
  support: number;
  predicted: number;
  unstable: boolean;
}

export interface ConfusionResult {
  labels: string[];
  matrix: number[][];
  perClass: ClassResult[];
  macroF1: number | null;
  evaluated: number;
}

/**
 * Per-class precision / recall / F1 with support from (truth, prediction)
 * pairs. Macro-F1 averages classes present in the ground truth only; accuracy
 * is deliberately not reported (CLAUDE.md §3.3).
 */
export function confusion(pairs: { truth: string; predicted: string }[], labelOrder?: string[]): ConfusionResult {
  const labels = labelOrder ?? [...new Set(pairs.flatMap((p) => [p.truth, p.predicted]))].sort();
  const index = new Map(labels.map((l, i) => [l, i]));
  const matrix = labels.map(() => labels.map(() => 0));
  for (const p of pairs) {
    const t = index.get(p.truth);
    const q = index.get(p.predicted);
    if (t === undefined || q === undefined) continue;
    const row = matrix[t];
    if (row) row[q] = (row[q] ?? 0) + 1;
  }
  const perClass = labels.map((label, i) => {
    const tp = matrix[i]?.[i] ?? 0;
    const support = (matrix[i] ?? []).reduce((a, b) => a + b, 0);
    const predicted = matrix.reduce((a, row) => a + (row[i] ?? 0), 0);
    const precision = predicted ? tp / predicted : null;
    const recall = support ? tp / support : null;
    const f1 = precision !== null && recall !== null ? (precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0) : null;
    return { label, precision, recall, f1, support, predicted, unstable: support < UNSTABLE_SUPPORT };
  });
  const present = perClass.filter((c) => c.support > 0);
  return {
    labels,
    matrix,
    perClass,
    macroF1: present.length ? present.reduce((a, c) => a + (c.f1 ?? 0), 0) / present.length : null,
    evaluated: pairs.length,
  };
}
