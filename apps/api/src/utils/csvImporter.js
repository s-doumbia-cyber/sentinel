import fs from "fs";
import path from "path";
import { parse } from "csv-parse";
import { NetworkFlow } from "../models/NetworkFlow.js";
import { Dataset } from "../models/Dataset.js";

// Shared CICIDS2017-style CSV -> MongoDB import pipeline, used by both the
// CLI script (scripts/import-csv.js) and the browser upload endpoint
// (routes/datasetRoutes.js), so the two paths never drift out of sync.

const BATCH_SIZE = 2000;

function normalizeKey(key) {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const FIELD_ALIASES = {
  sourceIp: ["sourceip", "srcip"],
  sourcePort: ["sourceport", "srcport"],
  destinationIp: ["destinationip", "dstip"],
  destinationPort: ["destinationport", "dstport"],
  protocol: ["protocol"],
  timestamp: ["timestamp"],
  flowDuration: ["flowduration"],
  totalFwdBytes: ["totallengthoffwdpackets"],
  totalBwdBytes: ["totallengthofbwdpackets"],
  avgPacketSize: ["averagepacketsize", "packetlengthmean"],
  label: ["label"],
};

function buildFieldMap(headerRow) {
  const normalizedHeaders = headerRow.map(normalizeKey);
  const map = {};
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    const idx = normalizedHeaders.findIndex((h) => aliases.includes(h));
    if (idx !== -1) map[field] = headerRow[idx];
  }
  return map;
}

function normalizeLabel(rawLabel) {
  const l = (rawLabel || "").toLowerCase();
  if (l.includes("benign")) return "Normal";
  if (l.includes("ddos")) return "DDoS";
  if (l.includes("portscan")) return "PortScan";
  if (l.includes("ftp")) return "FTPPatator";
  if (l.includes("ssh")) return "SSHPatator";
  if (l.includes("bot")) return "Botnet";
  if (l.includes("heartbleed")) return "Heartbleed";
  if (l.includes("goldeneye") || l.includes("hulk")) return "DoSHulk";
  if (l.includes("slowloris") || l.includes("slowhttptest")) return "DoSSlowloris";
  if (l.includes("sql")) return "SQLInjection";
  if (l.includes("xss")) return "XSS";
  if (l.includes("web attack") || l.includes("brute force")) return "WebAttack";
  if (l.includes("infiltration")) return "Infiltration";
  return null; // unknown label — the caller skips the row rather than guessing
}

const SEVERITY_BY_LABEL = {
  DDoS: "critical",
  Botnet: "critical",
  Heartbleed: "critical",
  SQLInjection: "high",
  Infiltration: "high",
  DoSHulk: "high",
  WebAttack: "high",
  XSS: "high",
  SSHPatator: "medium",
  FTPPatator: "medium",
  DoSSlowloris: "medium",
  PortScan: "low",
  Normal: "safe",
};

function parseProtocol(raw) {
  const n = String(raw).trim();
  if (n === "6") return "TCP";
  if (n === "17") return "UDP";
  if (n.toUpperCase() === "TCP" || n.toUpperCase() === "UDP" || n.toUpperCase() === "ICMP") return n.toUpperCase();
  return "ICMP";
}

function parseTimestamp(raw) {
  const match = String(raw).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return new Date();
  const [, month, day, year, hour, minute, second] = match;
  return new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second || 0));
}

/**
 * Streams `filePath` (a CICIDS2017-style CSV) into the NetworkFlow collection.
 * @param {string} filePath - absolute path to the CSV on disk
 * @param {string} sourceType - one of CICIDS2017 | UNSW-NB15 | KDD99 | CSE-CIC-IDS2018 | Custom
 * @param {string} [displayName] - name to store on the Dataset record (defaults to the file's basename)
 * @param {(rowsInserted: number) => void} [onProgress] - optional progress callback
 */
export async function importCsvFile(filePath, sourceType = "CICIDS2017", displayName, onProgress) {
  const dataset = await Dataset.create({
    name: displayName || path.basename(filePath),
    sourceType,
    status: "Processing",
  });

  let fieldMap = null;
  let batch = [];
  let rowCount = 0;
  let insertedCount = 0;
  let skippedCount = 0;
  let skippedUnknownLabelCount = 0;
  let attackCount = 0;
  const attackTypesFound = new Set();
  const unknownLabelsSeen = new Set();

  const parser = fs.createReadStream(filePath).pipe(
    parse({
      columns: (headerRow) => {
        // CICIDS2017's original CSVs are known to sometimes repeat a column
        // name verbatim (e.g. "Fwd Header Length" appearing twice); csv-parse
        // needs unique header names to build row objects correctly, so
        // de-duplicate before anything else.
        const seen = new Map();
        const deduped = headerRow.map((h) => {
          const trimmed = h.trim();
          const count = seen.get(trimmed) || 0;
          seen.set(trimmed, count + 1);
          return count === 0 ? trimmed : `${trimmed}__dup${count}`;
        });

        fieldMap = buildFieldMap(deduped);

        console.log(`[import] Detected ${deduped.length} columns. Mapped fields:`, fieldMap);
        if (!fieldMap.label) {
          console.warn(
            `[import] WARNING: no "Label" column detected in this file's header. ` +
              `Raw header row was: ${JSON.stringify(headerRow)}`
          );
        }
        if (!fieldMap.sourceIp || !fieldMap.destinationIp) {
          console.warn(
            `[import] WARNING: no Source/Destination IP column detected. ` +
              `Raw header row was: ${JSON.stringify(headerRow)}`
          );
        }

        return deduped;
      },
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    })
  );

  async function flushBatch() {
    if (batch.length === 0) return;
    try {
      await NetworkFlow.insertMany(batch, { ordered: false });
      insertedCount += batch.length;
    } catch {
      // Some rows in a batch can fail validation without aborting the whole batch
      // (ordered:false); the rest are already persisted, so we just move on.
    }
    batch = [];
    if (onProgress) onProgress(insertedCount);
  }

  for await (const record of parser) {
    rowCount++;
    if (!fieldMap) continue;

    const get = (field) => (fieldMap[field] ? record[fieldMap[field]] : undefined);
    const rawLabel = get("label");

    // A row with no readable label isn't safely classifiable — inserting it
    // with a guessed default (as an earlier version of this script did)
    // silently corrupts the dataset with fake "Infiltration"/ICMP/0.0.0.0
    // placeholders. Skip it instead and count it, so problems are visible
    // in the import summary rather than hidden in the data.
    if (rawLabel === undefined || rawLabel === "") {
      skippedCount++;
      continue;
    }

    const label = normalizeLabel(rawLabel);
    if (label === null) {
      skippedCount++;
      skippedUnknownLabelCount++;
      if (!unknownLabelsSeen.has(rawLabel)) {
        unknownLabelsSeen.add(rawLabel);
        console.warn(`[import] Unrecognized label skipped: "${rawLabel}"`);
      }
      continue;
    }
    const isAttack = label !== "Normal";
    if (isAttack) {
      attackCount++;
      attackTypesFound.add(label);
    }

    const fwdBytes = Number(get("totalFwdBytes")) || 0;
    const bwdBytes = Number(get("totalBwdBytes")) || 0;
    const avgPacket = Number(get("avgPacketSize")) || Math.round((fwdBytes + bwdBytes) / 2) || 0;

    batch.push({
      datasetId: dataset._id,
      timestamp: get("timestamp") ? parseTimestamp(get("timestamp")) : new Date(),
      sourceIp: get("sourceIp") || "0.0.0.0",
      destinationIp: get("destinationIp") || "0.0.0.0",
      sourcePort: Number(get("sourcePort")) || 0,
      destinationPort: Number(get("destinationPort")) || 0,
      protocol: parseProtocol(get("protocol")),
      flowDurationMs: Math.round((Number(get("flowDuration")) || 0) / 1000),
      packetLength: avgPacket,
      label,
      prediction: label,
      severity: SEVERITY_BY_LABEL[label] || "safe",
      country: null,
      isAttack,
      raw: record,
    });

    if (batch.length >= BATCH_SIZE) await flushBatch();
  }
  await flushBatch();

  dataset.rows = insertedCount;
  dataset.columns = fieldMap ? Object.keys(fieldMap).length : 0;
  dataset.detectedSchema = fieldMap ? Object.values(fieldMap) : [];
  dataset.attackTypesFound = Array.from(attackTypesFound);
  dataset.status = "Processed";
  await dataset.save();

  if (skippedCount > 0) {
    console.warn(
      `[import] Skipped ${skippedCount} rows total (${skippedUnknownLabelCount} due to an unrecognized label` +
        `${unknownLabelsSeen.size ? `: ${Array.from(unknownLabelsSeen).join(", ")}` : ""}).`
    );
  }

  return { rowCount, insertedCount, skippedCount, skippedUnknownLabelCount, attackCount, dataset };
}
