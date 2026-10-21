import type { Types } from "mongoose";

type MapLike<T> = Record<string, T> | Map<string, T>;

/** Structural view of a lean flow document (Mongoose's lean types flatten Maps inconsistently). */
export interface LeanFlow {
  _id: Types.ObjectId;
  timestamp: Date;
  sourceIp: string;
  destinationIp: string;
  sourcePort: number;
  destinationPort: number;
  protocol: string;
  flowDurationMs?: number | null;
  packetLength?: number | null;
  totalPackets?: number | null;
  totalBytes?: number | null;
  sourceKind: string;
  featureSchema: string;
  datasetId?: Types.ObjectId | null;
  groundTruthLabel?: string | null;
  rawLabel?: string | null;
  scoreStatus: string;
  scoreError?: string | null;
  features?: MapLike<number | null> | null;
  scored?: {
    modelVersion: string;
    label: string;
    confidence: number;
    severity: string;
    needsReview: boolean;
    novelty?: { score?: number | null; threshold?: number | null; aboveThreshold?: boolean | null } | null;
    unusualBehaviour?: boolean | null;
    scoredAt: Date;
    probabilities?: MapLike<number> | null;
    topFeatures?: { name?: string | null; contribution?: number | null; value?: number | null }[] | null;
  } | null;
}

function plain<T>(value: MapLike<T> | null | undefined): Record<string, T> | null {
  if (!value) return null;
  return value instanceof Map ? Object.fromEntries(value) : value;
}

/** Public shape of a flow. `groundTruthLabel` and `scored` are deliberately separate fields. */
export function toFlowResponse(f: LeanFlow, opts: { withFeatures?: boolean } = {}) {
  return {
    id: String(f._id),
    timestamp: f.timestamp,
    sourceIp: f.sourceIp,
    destinationIp: f.destinationIp,
    sourcePort: f.sourcePort,
    destinationPort: f.destinationPort,
    protocol: f.protocol,
    flowDurationMs: f.flowDurationMs ?? null,
    packetLength: f.packetLength ?? null,
    totalPackets: f.totalPackets ?? null,
    totalBytes: f.totalBytes ?? null,
    sourceKind: f.sourceKind,
    featureSchema: f.featureSchema,
    datasetId: f.datasetId ? String(f.datasetId) : null,
    groundTruthLabel: f.groundTruthLabel ?? null,
    rawLabel: f.rawLabel ?? null,
    scoreStatus: f.scoreStatus,
    scoreError: f.scoreError ?? null,
    scored: f.scored
      ? {
          modelVersion: f.scored.modelVersion,
          label: f.scored.label,
          confidence: f.scored.confidence,
          severity: f.scored.severity,
          needsReview: f.scored.needsReview,
          novelty: f.scored.novelty ? { score: f.scored.novelty.score ?? 0, threshold: f.scored.novelty.threshold ?? 0, aboveThreshold: Boolean(f.scored.novelty.aboveThreshold) } : null,
          unusualBehaviour: Boolean(f.scored.unusualBehaviour),
          scoredAt: f.scored.scoredAt,
          probabilities: plain(f.scored.probabilities ?? null),
          topFeatures: (f.scored.topFeatures ?? []).map((t) => ({ name: t.name ?? "", contribution: t.contribution ?? 0, value: t.value ?? null })),
        }
      : null,
    ...(opts.withFeatures ? { features: plain(f.features ?? null) } : {}),
  };
}
