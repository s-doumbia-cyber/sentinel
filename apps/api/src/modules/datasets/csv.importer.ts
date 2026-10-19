import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open } from "node:fs/promises";
import { parse } from "csv-parse";
import { parse as parseSync } from "csv-parse/sync";
import type { Types } from "mongoose";
import {
  FEATURES_BY_SCHEMA,
  extractFeatures,
  normalizeLabel,
  type AttackClass,
  type FeatureSchemaId,
  type SourceKind,
} from "@sentinel/shared";
import { AppError } from "../../lib/errors.js";
import type { Logger } from "../../lib/logger.js";
import { Dataset, Flow, type DatasetDoc } from "../../models/tenant.js";
import {
  buildFieldMap,
  dedupeHeaders,
  parseIp,
  parsePort,
  parseProtocol,
  parseTimestamp,
  type IdentifierField,
} from "./csv.parsing.js";

const BATCH_SIZE = 2000;
const MAX_SAMPLES = 20;
const REQUIRED_IDENTIFIERS: IdentifierField[] = [
  "sourceIp",
  "destinationIp",
  "sourcePort",
  "destinationPort",
  "protocol",
  "timestamp",
];
export const SCHEMA_FOR_SOURCE_TYPE = { CICIDS2017: "cicids2017-v1" } as const satisfies Record<string, FeatureSchemaId>;
export type SupportedSourceType = keyof typeof SCHEMA_FOR_SOURCE_TYPE;

export interface HeaderCheck {
  headers: string[];
  fieldMap: Partial<Record<IdentifierField, string>>;
  hasLabel: boolean;
}

async function readFirstLine(filePath: string): Promise<string> {
  const handle = await open(filePath, "r");
  try {
    const buf = Buffer.alloc(64 * 1024);
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
    const text = buf.subarray(0, bytesRead).toString("utf-8").replace(/^\uFEFF/, "");
    const end = text.search(/\r?\n/);
    if (end === -1 && bytesRead === buf.length) throw AppError.unprocessable("CSV header line is longer than 64 KB");
    return end === -1 ? text : text.slice(0, end);
  } finally {
    await handle.close();
  }
}

/**
 * Validates the header before any row is stored, so an unsupported file fails
 * fast with the exact missing columns instead of producing unusable flows.
 */
export async function checkCsvHeader(filePath: string, schema: FeatureSchemaId): Promise<HeaderCheck> {
  const line = await readFirstLine(filePath);
  if (!line.trim()) throw AppError.unprocessable("The file is empty or has no header row");
  if (line.includes("\0")) throw AppError.unprocessable("The file is not a text CSV");
  let row: string[];
  try {
    row = (parseSync(line, { relax_column_count: true }) as string[][])[0] ?? [];
  } catch {
    throw AppError.unprocessable("The header row is not valid CSV");
  }
  const headers = dedupeHeaders(row);
  const fieldMap = buildFieldMap(headers);
  const missingIds = REQUIRED_IDENTIFIERS.filter((f) => !fieldMap[f]);
  const missingFeatures = (FEATURES_BY_SCHEMA[schema] ?? []).filter((f) => !headers.includes(f));
  if (missingIds.length || missingFeatures.length) {
    throw AppError.unprocessable(
      `This CSV does not match the ${schema} schema (CICFlowMeter / CICIDS2017 columns expected)`,
      [
        ...missingIds.map((f) => ({ path: "header", message: `Missing identifier column: ${f}` })),
        ...missingFeatures.map((f) => ({ path: "header", message: `Missing feature column: ${f}` })),
      ],
    );
  }
  return { headers, fieldMap, hasLabel: Boolean(fieldMap.label) };
}

function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(filePath)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("hex")))
      .on("error", reject);
  });
}

export interface ImportInput {
  orgId: Types.ObjectId;
  userId: Types.ObjectId | null;
  filePath: string;
  name: string;
  fileBytes: number;
  sourceType: SupportedSourceType;
  sourceKind: Extract<SourceKind, "IMPORTED" | "DEMO">;
}

export async function createDatasetRecord(input: ImportInput): Promise<DatasetDoc> {
  const doc = await Dataset.create({
    orgId: input.orgId,
    name: input.name,
    sourceType: input.sourceType,
    sourceKind: input.sourceKind,
    featureSchema: SCHEMA_FOR_SOURCE_TYPE[input.sourceType],
    fileBytes: input.fileBytes,
    uploadedBy: input.userId,
    status: "Processing",
  });
  return doc.toObject();
}

/**
 * Streams a CICIDS2017-style CSV into flows. Dataset labels go to
 * `groundTruthLabel` only; every flow starts `pending` until a model scores
 * it. Invalid rows are counted and sampled, never filled with placeholders.
 */
export async function runCsvImport(datasetId: Types.ObjectId, input: ImportInput, header: HeaderCheck, logger: Logger) {
  const schema = SCHEMA_FOR_SOURCE_TYPE[input.sourceType];
  const { fieldMap } = header;
  const counts = { rowsRead: 0, rowsInserted: 0, invalidRow: 0, insertFailed: 0, unknownLabelRows: 0, unlabelledRows: 0 };
  const groundTruth = new Map<AttackClass, number>();
  const unknownLabels = new Set<string>();
  const invalidSamples: string[] = [];
  let minTs: Date | null = null;
  let maxTs: Date | null = null;
  let batch: Record<string, unknown>[] = [];

  const reject = (reason: string) => {
    counts.invalidRow++;
    if (invalidSamples.length < MAX_SAMPLES) invalidSamples.push(`row ${counts.rowsRead + 1}: ${reason}`);
  };

  const flush = async () => {
    if (!batch.length) return;
    const docs = batch;
    batch = [];
    try {
      await Flow.insertMany(docs, { ordered: false });
      counts.rowsInserted += docs.length;
    } catch (err) {
      const inserted = (err as { insertedDocs?: unknown[] }).insertedDocs?.length ?? 0;
      counts.rowsInserted += inserted;
      counts.insertFailed += docs.length - inserted;
      logger.warn({ err, datasetId: String(datasetId) }, "Some flows failed to insert");
    }
  };

  try {
    const fileSha256 = await sha256File(input.filePath);
    const parser = createReadStream(input.filePath).pipe(
      parse({ columns: (row: string[]) => dedupeHeaders(row), skip_empty_lines: true, relax_column_count: true, bom: true }),
    );
    for await (const record of parser as AsyncIterable<Record<string, string>>) {
      const get = (f: IdentifierField) => (fieldMap[f] ? record[fieldMap[f]] : undefined);
      const sourceIp = parseIp(get("sourceIp"));
      const destinationIp = parseIp(get("destinationIp"));
      const sourcePort = parsePort(get("sourcePort"));
      const destinationPort = parsePort(get("destinationPort"));
      const proto = parseProtocol(get("protocol"));
      const timestamp = parseTimestamp(get("timestamp"));
      if (!sourceIp || !destinationIp) reject("invalid IP address");
      else if (sourcePort === null || destinationPort === null) reject("invalid port");
      else if (!proto) reject("invalid protocol");
      else if (!timestamp) reject(`unparsable timestamp ${JSON.stringify(get("timestamp") ?? "")}`);
      else {
        const rawLabel = header.hasLabel ? (get("label") ?? "").trim() : "";
        let groundTruthLabel: AttackClass | null = null;
        if (!rawLabel) counts.unlabelledRows++;
        else {
          groundTruthLabel = normalizeLabel(rawLabel);
          if (groundTruthLabel) groundTruth.set(groundTruthLabel, (groundTruth.get(groundTruthLabel) ?? 0) + 1);
          else {
            // Kept for detection (it is real traffic) but excluded from evaluation, and reported.
            counts.unknownLabelRows++;
            if (unknownLabels.size < 50 && !unknownLabels.has(rawLabel)) {
              unknownLabels.add(rawLabel);
              logger.warn({ datasetId: String(datasetId), rawLabel }, "Unrecognised dataset label");
            }
          }
        }
        const { features } = extractFeatures(record, schema);
        const fwdPkts = features["Total Fwd Packets"];
        const bwdPkts = features["Total Backward Packets"];
        const fwdBytes = features["Total Length of Fwd Packets"];
        const bwdBytes = features["Total Length of Bwd Packets"];
        const duration = features["Flow Duration"];
        batch.push({
          orgId: input.orgId,
          datasetId,
          sourceKind: input.sourceKind,
          timestamp,
          sourceIp,
          destinationIp,
          sourcePort,
          destinationPort,
          protocol: proto.protocol,
          protocolNumber: proto.protocolNumber,
          flowDurationMs: typeof duration === "number" ? duration / 1000 : null,
          packetLength: features["Average Packet Size"] ?? null,
          totalPackets: typeof fwdPkts === "number" && typeof bwdPkts === "number" ? fwdPkts + bwdPkts : null,
          totalBytes: typeof fwdBytes === "number" && typeof bwdBytes === "number" ? fwdBytes + bwdBytes : null,
          featureSchema: schema,
          features,
          groundTruthLabel,
          rawLabel: rawLabel || null,
          scoreStatus: "pending",
        });
        if (!minTs || timestamp < minTs) minTs = timestamp;
        if (!maxTs || timestamp > maxTs) maxTs = timestamp;
      }
      counts.rowsRead++;
      if (batch.length >= BATCH_SIZE) await flush();
    }
    await flush();
    await Dataset.updateOne(
      { orgId: input.orgId, _id: datasetId },
      {
        $set: {
          status: "Processed",
          fileSha256,
          rowsRead: counts.rowsRead,
          rowsInserted: counts.rowsInserted,
          "skipped.invalidRow": counts.invalidRow,
          "skipped.insertFailed": counts.insertFailed,
          unknownLabelRows: counts.unknownLabelRows,
          unlabelledRows: counts.unlabelledRows,
          unknownLabels: [...unknownLabels],
          invalidSamples,
          groundTruthCounts: Object.fromEntries(groundTruth),
          timeRange: { from: minTs, to: maxTs },
          completedAt: new Date(),
        },
      },
    );
    return counts;
  } catch (err) {
    await flush().catch(() => undefined);
    await Dataset.updateOne(
      { orgId: input.orgId, _id: datasetId },
      {
        $set: {
          status: "Failed",
          error: err instanceof Error ? err.message.slice(0, 500) : "Import failed",
          rowsRead: counts.rowsRead,
          rowsInserted: counts.rowsInserted,
          completedAt: new Date(),
        },
      },
    );
    throw err;
  }
}
