import type { AnyBulkWriteOperation, Types } from "mongoose";
import { addressScope } from "@sentinel/shared";
import type { Logger } from "../../lib/logger.js";
import { Asset } from "../../models/context.js";
import { Flow } from "../../models/tenant.js";

const MAX_SERVICES = 25;

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

/**
 * Rebuilds the org's asset inventory from its flows. Counters are recomputed
 * (not incremented), so the job is idempotent; analyst notes and tags survive.
 * Assets with no remaining flow are kept but marked inactive.
 */
export async function refreshAssets(orgId: Types.ObjectId, logger?: Logger): Promise<{ assets: number; inactive: number }> {
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

  const [asSource, asDestination, services] = await Promise.all([
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
  ]);

  type Acc = { first: Date; last: Date; src: number; dst: number; kinds: Set<string>; peers: Set<string>; services: ServiceAgg[] };
  const byIp = new Map<string, Acc>();
  const acc = (ip: string, first: Date, last: Date): Acc => {
    let a = byIp.get(ip);
    if (!a) {
      a = { first, last, src: 0, dst: 0, kinds: new Set(), peers: new Set(), services: [] };
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
    if (a && a.services.length < MAX_SERVICES) a.services.push(s);
  }

  const ops: AnyBulkWriteOperation[] = [...byIp.entries()].map(([ip, a]) => ({
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
          sourceKinds: [...a.kinds].sort(),
          services: a.services.map((s) => ({ port: s._id.port, protocol: s._id.protocol, flows: s.flows, firstSeen: s.first, lastSeen: s.last })),
          active: true,
          refreshedAt: started,
        },
        $setOnInsert: { notes: "", tags: [] },
      },
      upsert: true,
    },
  }));
  for (let i = 0; i < ops.length; i += 1000) await Asset.bulkWrite(ops.slice(i, i + 1000), { ordered: false });
  const stale = await Asset.updateMany(
    { orgId, refreshedAt: { $lt: started } },
    { $set: { active: false, flowsAsSource: 0, flowsAsDestination: 0, services: [], distinctPeers: 0, refreshedAt: started } },
  );
  logger?.info({ orgId: String(orgId), assets: ops.length, inactive: stale.modifiedCount }, "Asset inventory refreshed");
  return { assets: ops.length, inactive: stale.modifiedCount };
}
