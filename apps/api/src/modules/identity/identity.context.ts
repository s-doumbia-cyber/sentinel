import type { Types } from "mongoose";
import { addressScope, IDENTITY_SOURCE_LABEL, severityRank, SEVERITIES, type IdentitySource, type Severity } from "@sentinel/shared";
import { IdentityImport, IdentityObservation } from "../../models/context.js";
import { Alert } from "../../models/tenant.js";

const SEVERITY_BY_RANK = Object.fromEntries(SEVERITIES.map((s) => [severityRank(s), s])) as Record<number, Severity>;
const MAX_RECORDS = 200;
// Case-insensitive equality without building a regex from user input.
const CASE_INSENSITIVE = { locale: "en", strength: 2 } as const;

export interface IdentityRecord {
  id: string;
  ip: string;
  username: string | null;
  hostname: string | null;
  mac: string | null;
  source: IdentitySource;
  sourceLabel: string;
  validFrom: string;
  validTo: string | null;
  importName: string | null;
}

type RawRecord = {
  _id: Types.ObjectId;
  importId: Types.ObjectId;
  ip: string;
  username?: string | null;
  hostname?: string | null;
  mac?: string | null;
  source: string;
  validFrom: Date;
  validTo?: Date | null;
};

async function toRecords(orgId: Types.ObjectId, rows: RawRecord[]): Promise<IdentityRecord[]> {
  const importIds = [...new Set(rows.map((r) => String(r.importId)))];
  const imports = importIds.length ? await IdentityImport.find({ orgId, _id: { $in: importIds } }).select("name").lean() : [];
  const names = new Map(imports.map((i) => [String(i._id), i.name]));
  return rows.map((r) => ({
    id: String(r._id),
    ip: r.ip,
    username: r.username ?? null,
    hostname: r.hostname ?? null,
    mac: r.mac ?? null,
    source: r.source as IdentitySource,
    sourceLabel: IDENTITY_SOURCE_LABEL[r.source as IdentitySource] ?? r.source,
    validFrom: r.validFrom.toISOString(),
    validTo: r.validTo ? r.validTo.toISOString() : null,
    // The import can be deleted later; its records go with it, so a missing name is unexpected but survivable.
    importName: names.get(String(r.importId)) ?? null,
  }));
}

/** Every imported identity record for one address, newest first: who or what held it over time. */
export async function identityHistoryForAddress(orgId: Types.ObjectId, ip: string) {
  const rows = await IdentityObservation.find({ orgId, ip }).sort({ validFrom: -1, _id: -1 }).limit(MAX_RECORDS + 1).lean<RawRecord[]>();
  return { ip, records: await toRecords(orgId, rows.slice(0, MAX_RECORDS)), truncated: rows.length > MAX_RECORDS };
}

export const LOOKUP_CAVEATS = [
  "These records say which address an account or device held, according to the source that exported them.",
  "An alert during one of these windows involves the address, not necessarily this account: hosts, NAT and VPN concentrators can be shared.",
  "Point-in-time records (no end) only cover the moment they were logged.",
];

/**
 * User and device context (axis 3): which addresses an account, hostname or MAC
 * held according to imported records, and which alerts involved those addresses
 * during those windows. Nothing here is inferred from traffic.
 */
export async function lookupIdentity(orgId: Types.ObjectId, q: string) {
  const term = q.trim();
  const rows = await IdentityObservation.find({ orgId, $or: [{ username: term }, { hostname: term }, { mac: term.toLowerCase() }] })
    .collation(CASE_INSENSITIVE)
    .sort({ validFrom: -1, _id: -1 })
    .limit(MAX_RECORDS + 1)
    .lean<RawRecord[]>();
  const kept = rows.slice(0, MAX_RECORDS);
  const records = await toRecords(orgId, kept);
  const lower = term.toLowerCase();
  const matchedOn = (["username", "hostname", "mac"] as const).filter((f) => kept.some((r) => (r[f] ?? "").toLowerCase() === lower));

  const byIp = new Map<string, IdentityRecord[]>();
  for (const r of records) byIp.set(r.ip, [...(byIp.get(r.ip) ?? []), r]);
  const addresses = await Promise.all(
    [...byIp.entries()].map(async ([ip, recs]) => {
      const windows = recs.map((r) => ({ from: new Date(r.validFrom), to: new Date(r.validTo ?? r.validFrom), recordId: r.id }));
      const alerts = await Alert.find({
        orgId,
        $and: [
          { $or: [{ srcIp: ip }, { dstIp: ip }] },
          { $or: windows.map((w) => ({ firstSeen: { $lte: w.to }, lastSeen: { $gte: w.from } })) },
        ],
      })
        .select("type severityRank status firstSeen lastSeen srcIp dstIp")
        .sort({ lastSeen: -1 })
        .limit(50)
        .lean();
      return {
        ip,
        scope: addressScope(ip),
        records: recs.length,
        from: new Date(Math.min(...windows.map((w) => w.from.getTime()))).toISOString(),
        to: new Date(Math.max(...windows.map((w) => w.to.getTime()))).toISOString(),
        alerts: alerts.map((a) => ({
          id: String(a._id),
          type: a.type,
          severity: SEVERITY_BY_RANK[a.severityRank] ?? "info",
          status: a.status,
          role: a.srcIp === ip ? "source" : "target",
          firstSeen: a.firstSeen,
          lastSeen: a.lastSeen,
          // Which records' windows the alert overlaps: the analyst can check each one.
          duringRecords: windows.filter((w) => a.firstSeen <= w.to && a.lastSeen >= w.from).map((w) => w.recordId),
        })),
      };
    }),
  );
  return { query: term, matchedOn, records, addresses, truncated: rows.length > MAX_RECORDS, caveats: LOOKUP_CAVEATS };
}
