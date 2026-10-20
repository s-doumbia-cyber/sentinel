import type { Types } from "mongoose";
import { FEATURES_BY_SCHEMA, parseWindow, type FeatureSchemaId, type RuleDefinition } from "@sentinel/shared";
import { AppError } from "../../lib/errors.js";
import { ValidationRun, type ValidationRunDoc } from "../../models/validation.js";
import { Dataset, Flow, Rule } from "../../models/tenant.js";
import { isKnownClass, type MlClient } from "../models/ml.client.js";
import { RuleEvaluator, matchesFilter, type RuleFlow } from "../rules/evaluator.js";
import { definitionOf } from "../rules/rule.service.js";
import { confusion } from "./metrics.js";

export const MAX_VALIDATION_FLOWS = 200_000;
const SAMPLE = 25;
const BATCH = 1000;

export interface ErrorSample {
  flowId: string;
  truth: string;
  predicted: string;
  confidence?: number;
  topFeatures?: { name: string; contribution: number; value: number | null }[];
}

type DatasetLite = { _id: Types.ObjectId; name: string; fileSha256?: string | null; featureSchema: string; sourceKind?: string };

const DEMO_NOTE = "This dataset is tagged DEMO (synthetic data written to exercise the product): the score says nothing about real-world detection.";

async function loadDataset(orgId: Types.ObjectId, datasetId: string): Promise<DatasetLite> {
  const ds = await Dataset.findOne({ orgId, _id: datasetId, status: "Processed" }).select("name fileSha256 featureSchema sourceKind").lean<DatasetLite>();
  if (!ds) throw AppError.notFound("Processed dataset");
  return ds;
}

/**
 * Re-scores a labelled dataset with a chosen model version through the ML
 * service, without touching stored verdicts, and compares with the labels.
 */
export async function validateModel(orgId: Types.ObjectId, userId: Types.ObjectId, ml: MlClient, modelVersion: string, datasetId: string): Promise<ValidationRunDoc> {
  const ds = await loadDataset(orgId, datasetId);
  const model = await ml.getModel(modelVersion);
  if (!model) throw AppError.notFound("Model");
  if (model.schema !== ds.featureSchema) throw AppError.unprocessable(`Model ${modelVersion} expects ${model.schema}; this dataset is ${ds.featureSchema}`);
  const featureNames = FEATURES_BY_SCHEMA[ds.featureSchema as FeatureSchemaId] ?? [];
  const pairs: { truth: string; predicted: string }[] = [];
  const fp: ErrorSample[] = [];
  const fn: ErrorSample[] = [];
  let unlabelled = 0;
  let unknownOutput = 0;
  let lastId: Types.ObjectId | null = null;
  let scanned = 0;
  for (;;) {
    const flows: { _id: Types.ObjectId; features?: unknown; groundTruthLabel?: string | null }[] = await Flow.find({
      orgId,
      datasetId: ds._id,
      ...(lastId ? { _id: { $gt: lastId } } : {}),
    })
      .sort({ _id: 1 })
      .limit(BATCH)
      .select("_id features groundTruthLabel")
      .lean();
    if (!flows.length || scanned >= MAX_VALIDATION_FLOWS) break;
    lastId = flows.at(-1)?._id ?? null;
    scanned += flows.length;
    const labelled = flows.filter((f) => f.groundTruthLabel);
    unlabelled += flows.length - labelled.length;
    if (!labelled.length) continue;
    const response = await ml.predict({
      schema: ds.featureSchema,
      modelVersion,
      explain: true,
      flows: labelled.map((f) => {
        const raw = (f.features instanceof Map ? Object.fromEntries(f.features) : (f.features ?? {})) as Record<string, number | null>;
        return { id: String(f._id), features: Object.fromEntries(featureNames.map((n) => [n, raw[n] ?? null])) };
      }),
    });
    const byId = new Map(response.results.map((r) => [r.id, r]));
    for (const f of labelled) {
      const r = byId.get(String(f._id));
      const truth = f.groundTruthLabel as string;
      if (!r || !isKnownClass(r.label)) {
        unknownOutput++;
        continue;
      }
      pairs.push({ truth, predicted: r.label });
      if (r.label !== truth) {
        const sample = { flowId: String(f._id), truth, predicted: r.label, confidence: r.confidence, topFeatures: r.topFeatures ?? [] };
        // A benign flow flagged as an attack is a false positive; an attack missed or mislabelled is a false negative.
        if (truth === "Normal") {
          if (fp.length < SAMPLE) fp.push(sample);
        } else if (fn.length < SAMPLE) fn.push(sample);
      }
    }
  }
  const result = confusion(pairs);
  const overlap = model.trainedOn.files.some((f) => f.sha256 === ds.fileSha256);
  const notes = [
    overlap
      ? "This dataset was also used to train the model: the result is not an independent estimate."
      : "This dataset file was not among the model's training files (checked by SHA-256). Captures from the same network or day can still be correlated.",
    "Benchmark result on labelled data; it is not a guarantee of performance on another network.",
  ];
  if (ds.sourceKind === "DEMO") notes.unshift(DEMO_NOTE);
  if (unlabelled) notes.push(`${unlabelled} flows without a usable label were excluded.`);
  if (unknownOutput) notes.push(`${unknownOutput} flows got no usable model output and were excluded.`);
  if (scanned >= MAX_VALIDATION_FLOWS) notes.push(`Stopped at the ${MAX_VALIDATION_FLOWS.toLocaleString("en")} flow limit.`);
  const run = await ValidationRun.create({
    orgId,
    kind: "model",
    target: modelVersion,
    targetVersion: null,
    datasetId: ds._id,
    datasetName: ds.name,
    datasetSha256: ds.fileSha256 ?? null,
    trainingOverlap: overlap,
    createdBy: userId,
    flowsScanned: scanned,
    metrics: result,
    falsePositives: fp,
    falseNegatives: fn,
    notes,
  });
  return run.toObject() as ValidationRunDoc;
}

/**
 * Flow-level evaluation of one rule on a labelled dataset: a flow counts as
 * flagged when it passed the rule's filter inside a window where the rule
 * fired for its group. Rules fire on groups, so this is an approximation.
 */
export async function validateRule(orgId: Types.ObjectId, userId: Types.ObjectId, ruleId: string, datasetId: string): Promise<ValidationRunDoc> {
  const ds = await loadDataset(orgId, datasetId);
  const rule = await Rule.findOne({ orgId, _id: ruleId }).lean();
  if (!rule) throw AppError.notFound("Rule");
  const def: RuleDefinition = { ...definitionOf(rule), enabled: true };
  const windowMs = parseWindow(def.window) ?? 0;
  const projection = "timestamp sourceIp destinationIp sourcePort destinationPort protocol totalPackets flowDurationMs features groundTruthLabel";
  const cursorFor = () =>
    Flow.find({ orgId, datasetId: ds._id }).sort({ timestamp: 1, _id: 1 }).limit(MAX_VALIDATION_FLOWS).select(projection).lean().cursor({ batchSize: 2000 });
  const toRuleFlow = (f: Record<string, unknown>): RuleFlow => ({
    id: String(f._id),
    timestamp: f.timestamp as Date,
    sourceIp: f.sourceIp as string,
    destinationIp: f.destinationIp as string,
    sourcePort: f.sourcePort as number,
    destinationPort: f.destinationPort as number,
    protocol: f.protocol as string,
    totalPackets: (f.totalPackets as number | null) ?? null,
    flowDurationMs: (f.flowDurationMs as number | null) ?? null,
    features: (f.features instanceof Map ? Object.fromEntries(f.features) : (f.features as Record<string, number | null> | null)) ?? null,
  });

  // Pass 1: where did the rule fire?
  const ev = new RuleEvaluator(def);
  const windows = new Map<string, [number, number][]>();
  let scanned = 0;
  for await (const f of cursorFor()) {
    scanned++;
    const hit = ev.push(toRuleFlow(f as Record<string, unknown>));
    if (!hit) continue;
    const key = def.groupBy.map((g) => String(hit.group[g])).join("|");
    // The quiet period after a hit is still part of the burst that fired.
    windows.set(key, [...(windows.get(key) ?? []), [hit.windowStart.getTime(), hit.windowEnd.getTime() + windowMs]]);
  }
  // Pass 2: which labelled flows fall in those windows?
  const pairs: { truth: string; predicted: string }[] = [];
  const fp: ErrorSample[] = [];
  const fn: ErrorSample[] = [];
  const positive = def.alertType;
  let unlabelled = 0;
  for await (const raw of cursorFor()) {
    const f = raw as Record<string, unknown>;
    const truthLabel = f.groundTruthLabel as string | null;
    if (!truthLabel) {
      unlabelled++;
      continue;
    }
    const rf = toRuleFlow(f);
    const key = def.groupBy.map((g) => String(rf[g])).join("|");
    const ts = rf.timestamp.getTime();
    const flagged = matchesFilter(def, rf) && (windows.get(key) ?? []).some(([a, b]) => ts >= a && ts <= b);
    const truth = truthLabel === positive ? positive : "Other";
    const predicted = flagged ? positive : "Other";
    pairs.push({ truth, predicted });
    if (flagged && truth !== positive && fp.length < SAMPLE) fp.push({ flowId: rf.id, truth: truthLabel, predicted });
    if (!flagged && truth === positive && fn.length < SAMPLE) fn.push({ flowId: rf.id, truth: truthLabel, predicted: "not flagged" });
  }
  const result = confusion(pairs, [positive, "Other"]);
  const notes = [
    "Rules fire on groups of flows within a window; this flow-level score is an approximation.",
    `"Other" groups every label except ${positive}, including attacks this rule is not meant to catch.`,
    "Benchmark result on labelled data; it is not a guarantee of performance on another network.",
  ];
  if (ds.sourceKind === "DEMO") notes.unshift(DEMO_NOTE);
  if (unlabelled) notes.push(`${unlabelled} flows without a usable label were excluded.`);
  const run = await ValidationRun.create({
    orgId,
    kind: "rule",
    target: def.key,
    targetVersion: rule.version,
    datasetId: ds._id,
    datasetName: ds.name,
    datasetSha256: ds.fileSha256 ?? null,
    trainingOverlap: null,
    createdBy: userId,
    flowsScanned: scanned,
    metrics: result,
    falsePositives: fp,
    falseNegatives: fn,
    notes,
  });
  return run.toObject() as ValidationRunDoc;
}
