import type { AnyBulkWriteOperation, Types } from "mongoose";
import { DEFAULT_SEVERITY_BY_CLASS, FEATURE_SCHEMA_IDS, type AttackClass, type FeatureSchemaId } from "@sentinel/shared";
import { AppError } from "../../lib/errors.js";
import type { Logger } from "../../lib/logger.js";
import { Org } from "../../models/identity.js";
import { Flow, type FlowDoc } from "../../models/tenant.js";
import type { AlertService, ModelVerdictEvidence } from "../alerts/alert.service.js";
import { loadAlertPolicy, policyFromSettings, type AlertPolicy } from "../alerts/policy.js";
import { MlContractError, isKnownClass, type MlClient } from "../models/ml.client.js";

const BATCH = 500;

export interface SchemaRunResult {
  schema: FeatureSchemaId;
  status: "scored" | "no_active_model" | "nothing_pending" | "ml_unavailable" | "contract_error";
  modelVersion: string | null;
  scored: number;
  errored: number;
  message?: string;
}

/**
 * "Unusual behaviour": far from the benign traffic the model learned (novelty
 * above its threshold) AND not recognised as a known attack with confidence.
 * Known attacks are also far from benign traffic, so novelty alone would flag
 * every one of them. The class label is never changed by this.
 */
export function isUnusualBehaviour(novelty: { aboveThreshold: boolean } | undefined, label: string, confidence: number, reviewThreshold: number): boolean {
  return Boolean(novelty?.aboveThreshold) && (label === "Normal" || confidence < reviewThreshold);
}

export function activeModelsOf(org: { settings?: { activeModels?: unknown } | null } | null): Record<string, string> {
  const m = org?.settings?.activeModels;
  if (!m) return {};
  return m instanceof Map ? Object.fromEntries(m as Map<string, string>) : (m as Record<string, string>);
}

/**
 * Scores pending flows with the org's active model for each feature schema.
 * A flow is never scored by a model of another schema, and without an active
 * model it stays `pending` (docs/ML_AND_DETECTION.md §2, §12.5).
 * Updates only match `scoreStatus: "pending"`, so re-running is idempotent.
 */
export class ScoringService {
  private readonly running = new Set<string>();

  constructor(
    private readonly ml: MlClient,
    private readonly logger: Logger,
    private readonly alerts: AlertService,
  ) {}

  isRunning(orgId: Types.ObjectId): boolean {
    return this.running.has(String(orgId));
  }

  async scorePending(orgId: Types.ObjectId): Promise<SchemaRunResult[]> {
    const key = String(orgId);
    if (this.running.has(key)) return [];
    this.running.add(key);
    try {
      const org = await Org.findById(orgId).lean();
      if (!org) throw AppError.notFound("Organisation");
      const active = activeModelsOf(org);
      const policy = policyFromSettings(org.settings);
      const results: SchemaRunResult[] = [];
      for (const schema of FEATURE_SCHEMA_IDS) {
        const pending = await Flow.countDocuments({ orgId, scoreStatus: "pending", featureSchema: schema });
        const version = active[schema] ?? null;
        if (!pending) results.push({ schema, status: "nothing_pending", modelVersion: version, scored: 0, errored: 0 });
        else if (!version) results.push({ schema, status: "no_active_model", modelVersion: null, scored: 0, errored: 0 });
        else results.push(await this.scoreSchema(orgId, schema, version, policy));
      }
      return results;
    } finally {
      this.running.delete(key);
    }
  }

  private async scoreSchema(orgId: Types.ObjectId, schema: FeatureSchemaId, version: string, policy: AlertPolicy): Promise<SchemaRunResult> {
    const threshold = policy.needsReviewThreshold;
    const result: SchemaRunResult = { schema, status: "scored", modelVersion: version, scored: 0, errored: 0 };
    for (;;) {
      const flows = await Flow.find({ orgId, scoreStatus: "pending", featureSchema: schema })
        .sort({ _id: 1 })
        .limit(BATCH)
        .select("_id features timestamp sourceIp destinationIp destinationPort")
        .lean<Pick<FlowDoc, "_id" | "features" | "timestamp" | "sourceIp" | "destinationIp" | "destinationPort">[]>();
      if (!flows.length) return result;
      let response;
      try {
        response = await this.ml.predict({
          schema,
          modelVersion: version,
          explain: true,
          flows: flows.map((f) => ({
            id: String(f._id),
            features: (f.features instanceof Map ? Object.fromEntries(f.features) : (f.features ?? {})) as Record<string, number | null>,
          })),
        });
      } catch (err) {
        if (err instanceof MlContractError) {
          // A contract error would repeat forever on the same flows: record it on them instead.
          await Flow.updateMany(
            { orgId, _id: { $in: flows.map((f) => f._id) }, scoreStatus: "pending" },
            { $set: { scoreStatus: "error", scoreError: err.message.slice(0, 500) } },
          );
          this.logger.warn({ orgId: String(orgId), schema, err: err.message }, "ML contract error while scoring");
          return { ...result, status: "contract_error", errored: result.errored + flows.length, message: err.message };
        }
        this.logger.warn({ orgId: String(orgId), err }, "ML service unavailable; flows stay pending");
        return { ...result, status: "ml_unavailable", message: err instanceof Error ? err.message : String(err) };
      }

      const now = new Date();
      const byId = new Map(response.results.map((r) => [r.id, r]));
      const ops: AnyBulkWriteOperation[] = flows.map((f) => {
        const r = byId.get(String(f._id));
        const filter = { orgId, _id: f._id, scoreStatus: "pending" };
        if (!r) return { updateOne: { filter, update: { $set: { scoreStatus: "error", scoreError: "No result returned by the ML service" } } } };
        if (!isKnownClass(r.label)) {
          // Unknown stays unknown: never mapped to a known class.
          return { updateOne: { filter, update: { $set: { scoreStatus: "error", scoreError: `Model returned unknown class ${r.label}` } } } };
        }
        const label = r.label as AttackClass;
        return {
          updateOne: {
            filter,
            update: {
              $set: {
                scoreStatus: "scored",
                scoreError: null,
                scored: {
                  modelVersion: response.modelVersion,
                  label,
                  confidence: r.confidence,
                  probabilities: r.probabilities,
                  severity: DEFAULT_SEVERITY_BY_CLASS[label],
                  needsReview: r.confidence < threshold,
                  ...(r.novelty ? { novelty: r.novelty } : {}),
                  unusualBehaviour: isUnusualBehaviour(r.novelty, label, r.confidence, threshold),
                  topFeatures: (r.topFeatures ?? []).map((t) => ({ name: t.name, contribution: t.contribution, value: t.value })),
                  scoredAt: now,
                },
              },
            },
          },
        };
      });
      const write = await Flow.bulkWrite(ops, { ordered: false });
      // Malicious verdicts become (or join) alerts right away.
      const evidence: ModelVerdictEvidence[] = flows.flatMap((f) => {
        const r = byId.get(String(f._id));
        if (!r || !isKnownClass(r.label) || r.label === "Normal") return [];
        return [
          {
            flowId: f._id,
            timestamp: f.timestamp,
            sourceIp: f.sourceIp,
            destinationIp: f.destinationIp,
            destinationPort: f.destinationPort,
            label: r.label as AttackClass,
            confidence: r.confidence,
            modelVersion: response.modelVersion,
          },
        ];
      });
      await this.alerts.recordModelVerdicts(orgId, policy, evidence);
      const errored = ops.filter((o) => "updateOne" in o && (o.updateOne.update as { $set: { scoreStatus: string } }).$set.scoreStatus === "error").length;
      result.errored += errored;
      result.scored += write.modifiedCount - errored;
      if (write.modifiedCount === 0) return result; // nothing changed: another run took these flows
    }
  }

  /**
   * Folds already-scored malicious flows that never produced an alert (scored
   * before alerting existed, or migrated) into alerts. Idempotent via `alertedAt`.
   */
  async alertUnalerted(orgId: Types.ObjectId, datasetId?: Types.ObjectId, policyOverride?: AlertPolicy): Promise<number> {
    const policy = policyOverride ?? (await loadAlertPolicy(orgId));
    let created = 0;
    for (;;) {
      const flows = await Flow.find({
        orgId,
        ...(datasetId ? { datasetId } : {}),
        scoreStatus: "scored",
        "scored.label": { $ne: "Normal" },
        alertedAt: null,
      })
        .sort({ _id: 1 })
        .limit(BATCH)
        .select("_id timestamp sourceIp destinationIp destinationPort scored")
        .lean();
      if (!flows.length) return created;
      created += await this.alerts.recordModelVerdicts(
        orgId,
        policy,
        flows.flatMap((f) =>
          f.scored
            ? [
                {
                  flowId: f._id,
                  timestamp: f.timestamp,
                  sourceIp: f.sourceIp,
                  destinationIp: f.destinationIp,
                  destinationPort: f.destinationPort,
                  label: f.scored.label as AttackClass,
                  confidence: f.scored.confidence,
                  modelVersion: f.scored.modelVersion,
                },
              ]
            : [],
        ),
      );
    }
  }
}
