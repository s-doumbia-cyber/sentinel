import type { Types } from "mongoose";
import { AppError } from "../../lib/errors.js";
import { DriftReport, Flow } from "../../models/tenant.js";
import type { MlClient, ReferenceHistogram } from "../models/ml.client.js";
import { binCounts, driftLevel, psi, PSI_SIGNIFICANT, type DriftLevel } from "./psi.js";

/** Below this many scored flows a PSI is noise, so no report is made. */
export const MIN_DRIFT_SAMPLE = 200;
export const MAX_DRIFT_SAMPLE = 20_000;

export interface FeatureDrift {
  name: string;
  psi: number;
  level: DriftLevel;
  /** Share of the sampled flows where the feature was missing or non-finite, versus at training. */
  missingCurrent: number;
  missingReference: number;
  values: number;
}

export interface DriftComputation {
  sampleSize: number;
  maxPsi: number;
  level: DriftLevel;
  driftedFeatureCount: number;
  features: FeatureDrift[];
  predictedClassShare: Record<string, number>;
}

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

/**
 * PSI per feature between the reference histogram and a sample of scored flows.
 * Pure: the job below only fetches the sample and stores the result. Features
 * the model never saw (not in the reference) are ignored, never invented.
 */
export function computeDrift(reference: ReferenceHistogram, sample: { features: Record<string, number | null>; label: string }[]): DriftComputation {
  const features: FeatureDrift[] = [];
  for (const [name, ref] of Object.entries(reference.features)) {
    if (!ref.edges.length) continue;
    const counts = binCounts(
      sample.map((s) => s.features[name] ?? null),
      ref.edges,
    );
    const values = counts.reduce((a, b) => a + b, 0);
    const score = psi(ref.proportions, counts);
    if (score === null) continue;
    features.push({
      name,
      psi: round4(score),
      level: driftLevel(score),
      missingCurrent: round4(1 - values / Math.max(sample.length, 1)),
      missingReference: ref.missing,
      values,
    });
  }
  features.sort((a, b) => b.psi - a.psi);
  const maxPsi = features[0]?.psi ?? 0;
  const share: Record<string, number> = {};
  for (const s of sample) share[s.label] = (share[s.label] ?? 0) + 1;
  for (const k of Object.keys(share)) share[k] = round4((share[k] as number) / Math.max(sample.length, 1));
  return {
    sampleSize: sample.length,
    maxPsi,
    level: driftLevel(maxPsi),
    driftedFeatureCount: features.filter((f) => f.psi >= PSI_SIGNIFICANT).length,
    features,
    predictedClassShare: share,
  };
}

export type DriftOutcome =
  | { status: "ok"; reportId: string; windowHours: number; computation: DriftComputation }
  | { status: "insufficient_data"; sampleSize: number; minimum: number; windowHours: number };

/**
 * The drift job: samples flows scored by one model version within the window
 * and compares them with that model's training-time reference. It never
 * retrains, activates or changes anything (docs/ML_AND_DETECTION.md §9).
 */
export class DriftService {
  constructor(private readonly ml: MlClient) {}

  async run(orgId: Types.ObjectId, userId: Types.ObjectId | null, version: string, windowHours: number): Promise<DriftOutcome> {
    const model = await this.ml.getModel(version);
    if (!model) throw AppError.notFound("Model");
    const reference = await this.ml.getReference(version);
    if (!reference) {
      throw AppError.conflict(`Model ${version} has no reference distribution (it was trained before drift checks existed). Retrain it to enable them.`);
    }
    const since = new Date(Date.now() - windowHours * 3_600_000);
    // $sample, not .limit() on natural order: the first imported file would otherwise be the whole sample.
    const rows = await Flow.aggregate<{ features?: Record<string, number | null>; label: string }>([
      { $match: { orgId, scoreStatus: "scored", featureSchema: model.schema, "scored.modelVersion": version, "scored.scoredAt": { $gte: since } } },
      { $sample: { size: MAX_DRIFT_SAMPLE } },
      { $project: { _id: 0, features: 1, label: "$scored.label" } },
    ]);
    const sample = rows.flatMap((r) => (r.features ? [{ features: r.features, label: r.label }] : []));
    if (sample.length < MIN_DRIFT_SAMPLE) {
      return { status: "insufficient_data", sampleSize: sample.length, minimum: MIN_DRIFT_SAMPLE, windowHours };
    }
    const computation = computeDrift(reference, sample);
    const report = await DriftReport.create({
      orgId,
      modelVersion: version,
      schema: model.schema,
      createdBy: userId,
      windowHours,
      referenceRows: reference.rows,
      sampleSize: computation.sampleSize,
      maxPsi: computation.maxPsi,
      level: computation.level,
      driftedFeatureCount: computation.driftedFeatureCount,
      features: computation.features,
      predictedClassShare: computation.predictedClassShare,
      trainingClassShare: reference.classProportions,
    });
    return { status: "ok", reportId: String(report._id), windowHours, computation };
  }
}
