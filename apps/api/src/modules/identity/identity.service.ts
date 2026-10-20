import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parse } from "csv-parse/sync";
import type { Types } from "mongoose";
import {
  ATTRIBUTION_HELP,
  IDENTITY_SOURCE_LABEL,
  addressScope,
  gradeAttribution,
  identityRowSchema,
  type AttributionCandidate,
  type IdentitySource,
} from "@sentinel/shared";
import { AppError } from "../../lib/errors.js";
import { IdentityImport, IdentityObservation, type IdentityImportDoc } from "../../models/context.js";

const REQUIRED = ["ip", "start", "source"];
const ALLOWED = new Set([...REQUIRED, "end", "username", "hostname", "mac"]);
const MAX_SAMPLES = 20;

/**
 * Imports identity records (VPN, DHCP, auth, EDR, directory) from a CSV the
 * organisation exported from its own systems. Each row keeps its source and
 * validity window; invalid rows are counted and sampled, never guessed.
 */
export async function importIdentityCsv(
  orgId: Types.ObjectId,
  userId: Types.ObjectId,
  filePath: string,
  name: string,
): Promise<IdentityImportDoc> {
  const buf = await readFile(filePath);
  let records: Record<string, string>[];
  try {
    records = parse(buf, { columns: (h: string[]) => h.map((c) => c.trim().toLowerCase()), skip_empty_lines: true, bom: true, trim: true });
  } catch {
    throw AppError.unprocessable("The file is not valid CSV");
  }
  const headers = Object.keys(records[0] ?? {});
  const missing = REQUIRED.filter((h) => !headers.includes(h));
  const unknown = headers.filter((h) => !ALLOWED.has(h));
  if (!records.length || missing.length) {
    throw AppError.unprocessable("Identity CSV must have the columns ip,start,source and at least one of username,hostname,mac", [
      ...missing.map((m) => ({ path: "header", message: `Missing column: ${m}` })),
    ]);
  }
  if (unknown.length) {
    throw AppError.unprocessable("Unknown columns in identity CSV", unknown.map((u) => ({ path: "header", message: `Unknown column: ${u}` })));
  }

  const imp = await IdentityImport.create({
    orgId,
    name,
    fileSha256: createHash("sha256").update(buf).digest("hex"),
    rowsRead: records.length,
    importedBy: userId,
  });
  const docs: Record<string, unknown>[] = [];
  const samples: string[] = [];
  const sources = new Set<string>();
  records.forEach((rec, i) => {
    const r = identityRowSchema.safeParse(rec);
    if (!r.success) {
      if (samples.length < MAX_SAMPLES) samples.push(`row ${i + 1}: ${r.error.issues[0]?.message ?? "invalid"}`);
      return;
    }
    sources.add(r.data.source);
    docs.push({
      orgId,
      importId: imp._id,
      ip: r.data.ip,
      username: r.data.username,
      hostname: r.data.hostname,
      mac: r.data.mac?.toLowerCase() ?? null,
      source: r.data.source,
      validFrom: new Date(r.data.start),
      validTo: r.data.end ? new Date(r.data.end) : null,
    });
  });
  for (let i = 0; i < docs.length; i += 2000) await IdentityObservation.insertMany(docs.slice(i, i + 2000), { ordered: false });
  await IdentityImport.updateOne(
    { orgId, _id: imp._id },
    { $set: { rowsInserted: docs.length, invalidRows: records.length - docs.length, invalidSamples: samples, sources: [...sources].sort() } },
  );
  const saved = await IdentityImport.findOne({ orgId, _id: imp._id }).lean();
  if (!saved) throw new Error("Identity import vanished");
  return saved as IdentityImportDoc;
}

export interface Attribution {
  ip: string;
  scope: "internal" | "external" | "unknown";
  window: { from: string; to: string };
  /** Identity sources this org has imported at least once. */
  connectedSources: { source: IdentitySource; label: string }[];
  candidates: AttributionCandidate[];
  /** Several different identities for the same address and window: shared host, NAT or VPN concentrator. */
  ambiguous: boolean;
  caveats: string[];
  help: string[];
}

const BASE_CAVEATS = [
  "An IP address alone does not identify a person or a group.",
  "VPN, NAT, proxies and shared hosts can place many people behind one address.",
  "A record names an account or a device, not the human using it.",
];

/**
 * Explains who or what held an address during a time window, using only the
 * identity records the org imported. With no matching record the answer is
 * "unknown", together with the integrations that would help.
 */
export async function attributeAddress(orgId: Types.ObjectId, ip: string, from: Date, to: Date): Promise<Attribution> {
  const [records, connected] = await Promise.all([
    IdentityObservation.find({
      orgId,
      ip,
      validFrom: { $lte: to },
      $or: [{ validTo: { $gte: from } }, { validTo: null, validFrom: { $gte: from } }],
    })
      .sort({ validFrom: -1 })
      .limit(50)
      .lean(),
    IdentityObservation.distinct("source", { orgId }),
  ]);
  const candidates: AttributionCandidate[] = records.map((r) => {
    const g = gradeAttribution({ source: r.source as IdentitySource, validFrom: r.validFrom, validTo: r.validTo ?? null }, { from, to });
    return {
      username: r.username ?? null,
      hostname: r.hostname ?? null,
      mac: r.mac ?? null,
      source: r.source as IdentitySource,
      validFrom: r.validFrom.toISOString(),
      validTo: r.validTo ? r.validTo.toISOString() : null,
      confidence: g.confidence,
      reasons: g.reasons,
    };
  });
  const identities = new Set(candidates.map((c) => c.username ?? c.hostname ?? c.mac));
  const scope = addressScope(ip);
  const caveats = [...BASE_CAVEATS];
  if (scope === "external") caveats.push("External address: it belongs to someone else's network; geolocation or reputation would not prove identity either.");
  return {
    ip,
    scope,
    window: { from: from.toISOString(), to: to.toISOString() },
    connectedSources: (connected as IdentitySource[]).sort().map((s) => ({ source: s, label: IDENTITY_SOURCE_LABEL[s] })),
    candidates,
    ambiguous: identities.size > 1,
    caveats,
    help: candidates.length ? [] : [...ATTRIBUTION_HELP],
  };
}
