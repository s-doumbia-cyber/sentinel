import type { AnyBulkWriteOperation, Types } from "mongoose";
import { addressScope, estimateDeviceType, MIN_SERVICE_FLOWS } from "@sentinel/shared";
import type { Logger } from "../../lib/logger.js";
import { Asset, AssetEvent, type AssetEventKind } from "../../models/context.js";
import { Flow } from "../../models/tenant.js";

const MAX_SERVICES = 25;
// Bounds the stored baseline for very busy servers; diffs beyond it are not recorded.
const MAX_SERVICE_KEYS = 500;

interface SideAgg {
  _id: string;
  flows: number;
  first: Date;
  last: Date;
  kinds: string[];
  peers: string[];
}

interface ServiceAgg {
  _id: { ip: string; port: number; protocol: string };
  flows: number;
  first: Date;
  last: Date;
}

interface Previous {
  ip: string;
  active: boolean;
  serviceKeys?: string[];
  estimateLabel?: string | null;
}

interface NewEvent {
  orgId: Types.ObjectId;
  ip: string;
  kind: AssetEventKind;
  ts: Date;
  eventTime: Date | null;
  actorId: null;
  detail: Record<string, unknown>;
}

const serviceKey = (s: ServiceAgg) => `${s._id.protocol}/${s._id.port}`;

/**
 * Rebuilds the org's asset inventory from its flows. Counters are recomputed
 * (not incremented), so the job is idempotent; analyst notes and tags survive.
 * Assets with no remaining flow are kept but marked inactive. Differences with
 * the previous inventory are appended to `asset_events`, so the inventory has a
 * history even though each refresh rebuilds it.
 */
async function rebuild(orgId: Types.ObjectId, logger?: Logger): Promise<{ assets: number; inactive: number; events: number }> {
  const started = new Date();
  const side = (field: "sourceIp" | "destinationIp", peer: "sourceIp" | "destinationIp") =>
    Flow.aggregate<SideAgg>([
      { $match: { orgId } },
      {
        $group: {
          _id: `$${field}`,
          flows: { $sum: 1 },
          first: { $min: "$timestamp" },
          last: { $max: "$timestamp" },
          kinds: { $addToSet: "$sourceKind" },
          // Bounded peer sample: enough to count distinct peers of small networks without unbounded memory.
          peers: { $addToSet: `$${peer}` },
        },
      },
      { $project: { flows: 1, first: 1, last: 1, kinds: 1, peers: { $slice: ["$peers", 1000] } } },
    ]).allowDiskUse(true);

  const [asSource, asDestination, services, previousRows] = await Promise.all([
    side("sourceIp", "destinationIp"),
    side("destinationIp", "sourceIp"),
    Flow.aggregate<ServiceAgg>([
      { $match: { orgId } },
      {
        $group: {
          _id: { ip: "$destinationIp", port: "$destinationPort", protocol: "$protocol" },
          flows: { $sum: 1 },
          first: { $min: "$timestamp" },
          last: { $max: "$timestamp" },
        },
      },
      { $sort: { flows: -1 } },
    ]).allowDiskUse(true),
    Asset.find({ orgId }).select("ip active serviceKeys estimateLabel").lean<Previous[]>(),
  ]);
  const previous = new Map(previousRows.map((p) => [p.ip, p]));

  type Acc = {
    first: Date;
    last: Date;
    src: number;
    dst: number;
    kinds: Set<string>;
    peers: Set<string>;
    services: ServiceAgg[];
    serviceCount: number;
    significant: ServiceAgg[];
  };
  const byIp = new Map<string, Acc>();
  const acc = (ip: string, first: Date, last: Date): Acc => {
    let a = byIp.get(ip);
    if (!a) {
      a = { first, last, src: 0, dst: 0, kinds: new Set(), peers: new Set(), services: [], serviceCount: 0, significant: [] };
      byIp.set(ip, a);
    }
    if (first < a.first) a.first = first;
    if (last > a.last) a.last = last;
    return a;
  };
  for (const r of asSource) {
    const a = acc(r._id, r.first, r.last);
    a.src = r.flows;
    r.kinds.forEach((k) => a.kinds.add(k));
    r.peers.forEach((p) => a.peers.add(p));
  }
  for (const r of asDestination) {
    const a = acc(r._id, r.first, r.last);
    a.dst = r.flows;
    r.kinds.forEach((k) => a.kinds.add(k));
    r.peers.forEach((p) => a.peers.add(p));
  }
  for (const s of services) {
    const a = byIp.get(s._id.ip);
    if (!a) continue;
    a.serviceCount++;
    if (a.services.length < MAX_SERVICES) a.services.push(s);
    // Ports touched once or twice are usually a scan, not a service: kept out of the history.
    if (s.flows >= MIN_SERVICE_FLOWS && a.significant.length < MAX_SERVICE_KEYS) a.significant.push(s);
  }

  const events: NewEvent[] = [];
  const event = (ip: string, kind: AssetEventKind, detail: Record<string, unknown>, eventTime: Date | null = null) =>
    events.push({ orgId, ip, kind, ts: started, eventTime, actorId: null, detail });

  const ops: AnyBulkWriteOperation[] = [...byIp.entries()].map(([ip, a]) => {
    const keys = a.significant.map(serviceKey);
    const estimate = estimateDeviceType(
      a.services.map((s) => ({ port: s._id.port, protocol: s._id.protocol, flows: s.flows })),
      a.src,
    );
    const label = estimate?.label ?? null;
    const prev = previous.get(ip);
    if (!prev) {
      event(ip, "first_observed", { flowsAsSource: a.src, flowsAsDestination: a.dst, services: keys.slice(0, 20), estimate: label }, a.first);
    } else if (prev.serviceKeys === undefined) {
      // Inventory built before history existed: start the history here instead of inventing changes.
      event(ip, "first_observed", { flowsAsSource: a.src, flowsAsDestination: a.dst, services: keys.slice(0, 20), estimate: label, historyStart: true }, a.first);
    } else {
      if (!prev.active) event(ip, "reactivated", { flowsAsSource: a.src, flowsAsDestination: a.dst }, a.first);
      const before = new Set(prev.serviceKeys ?? []);
      const now = new Set(keys);
      for (const s of a.significant) if (!before.has(serviceKey(s))) event(ip, "service_observed", { service: serviceKey(s), flows: s.flows }, s.first);
      for (const k of before) if (!now.has(k)) event(ip, "service_gone", { service: k });
      if ((prev.estimateLabel ?? null) !== label) event(ip, "estimate_changed", { from: prev.estimateLabel ?? null, to: label, basis: estimate?.basis ?? null });
    }
    return {
      updateOne: {
        filter: { orgId, ip },
        update: {
          $set: {
            scope: addressScope(ip),
            firstSeen: a.first,
            lastSeen: a.last,
            flowsAsSource: a.src,
            flowsAsDestination: a.dst,
            distinctPeers: a.peers.size,
            distinctServices: a.serviceCount,
            serviceKeys: keys,
            estimateLabel: label,
            sourceKinds: [...a.kinds].sort(),
            services: a.services.map((s) => ({ port: s._id.port, protocol: s._id.protocol, flows: s.flows, firstSeen: s.first, lastSeen: s.last })),
            active: true,
            refreshedAt: started,
          },
          $setOnInsert: { notes: "", tags: [] },
        },
        upsert: true,
      },
    };
  });
  for (const p of previousRows) if (p.active && !byIp.has(p.ip)) event(p.ip, "became_inactive", { reason: "No stored flow involves this address any more (for example, its dataset was deleted)." });

  for (let i = 0; i < ops.length; i += 1000) await Asset.bulkWrite(ops.slice(i, i + 1000), { ordered: false });
  const stale = await Asset.updateMany(
    { orgId, refreshedAt: { $lt: started } },
    {
      $set: {
        active: false,
        flowsAsSource: 0,
        flowsAsDestination: 0,
        services: [],
        // serviceKeys / estimateLabel keep the last known state, so a reactivation is compared with it.
        distinctServices: 0,
        distinctPeers: 0,
        refreshedAt: started,
      },
    },
  );
  for (let i = 0; i < events.length; i += 2000) await AssetEvent.insertMany(events.slice(i, i + 2000), { ordered: false });
  logger?.info({ orgId: String(orgId), assets: ops.length, inactive: stale.modifiedCount, events: events.length }, "Asset inventory refreshed");
  return { assets: ops.length, inactive: stale.modifiedCount, events: events.length };
}

const chains = new Map<string, Promise<unknown>>();

/**
 * Refreshes are serialized per org: two overlapping rebuilds would diff against
 * the same baseline and record every change twice.
 */
export function refreshAssets(orgId: Types.ObjectId, logger?: Logger): Promise<{ assets: number; inactive: number; events: number }> {
  const key = String(orgId);
  const run = (chains.get(key) ?? Promise.resolve()).catch(() => undefined).then(() => rebuild(orgId, logger));
  chains.set(key, run);
  void run.finally(() => {
    if (chains.get(key) === run) chains.delete(key);
  }).catch(() => undefined);
  return run;
}
