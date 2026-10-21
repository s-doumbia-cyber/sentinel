import type { Types } from "mongoose";
import { SEVERITIES, addressScope, severityRank, type Severity } from "@sentinel/shared";
import { Alert, Flow } from "../../models/tenant.js";

const SEVERITY_BY_RANK = Object.fromEntries(SEVERITIES.map((s) => [severityRank(s), s])) as Record<number, Severity>;

/** Hard ceilings: the response is cursorless, so it must stay small whatever the query asks for. */
export const GRAPH_LIMITS = { maxNodes: 500, maxEdges: 2000, defaultNodes: 150, defaultEdges: 600, frontier: 25 } as const;

export interface GraphQuery {
  seeds: string[];
  from: Date | null;
  to: Date | null;
  depth: 1 | 2;
  maxNodes: number;
  maxEdges: number;
}

export interface GraphMarker {
  count: number;
  maxSeverity: Severity;
}

export interface GraphNode {
  id: string;
  scope: "internal" | "external" | "unknown";
  seed: boolean;
  /** Flows in the returned edges that touch this address (not its lifetime total). */
  flows: number;
  lastSeen: Date | null;
  alerts: GraphMarker | null;
}

export interface GraphEdge {
  source: string;
  target: string;
  flows: number;
  /** Flows whose model verdict is not Normal. Verdicts, never dataset labels. */
  maliciousFlows: number;
  firstSeen: Date;
  lastSeen: Date;
  alerts: GraphMarker | null;
}

export interface GraphResponse {
  seeds: string[];
  range: { from: Date | null; to: Date | null };
  limits: { maxNodes: number; maxEdges: number; depth: 1 | 2 };
  nodes: GraphNode[];
  edges: GraphEdge[];
  truncated: { nodes: boolean; edges: boolean };
  generatedAt: Date;
}

interface PairRow {
  _id: { s: string; d: string };
  flows: number;
  malicious: number;
  first: Date;
  last: Date;
}

const key = (s: string, d: string) => `${s}\u0000${d}`;

function timeFilter(q: GraphQuery): Record<string, unknown> {
  if (!q.from && !q.to) return {};
  return { timestamp: { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) } };
}

/** Aggregates flows touching `ips` into directed (source → destination) pairs, busiest first. */
async function pairsTouching(orgId: Types.ObjectId, ips: string[], q: GraphQuery, limit: number): Promise<PairRow[]> {
  return Flow.aggregate<PairRow>([
    { $match: { orgId, ...timeFilter(q), $or: [{ sourceIp: { $in: ips } }, { destinationIp: { $in: ips } }] } },
    {
      $group: {
        _id: { s: "$sourceIp", d: "$destinationIp" },
        flows: { $sum: 1 },
        malicious: { $sum: { $cond: [{ $and: [{ $eq: ["$scoreStatus", "scored"] }, { $ne: ["$scored.label", "Normal"] }] }, 1, 0] } },
        first: { $min: "$timestamp" },
        last: { $max: "$timestamp" },
      },
    },
    { $sort: { flows: -1, "_id.s": 1, "_id.d": 1 } },
    { $limit: limit },
  ]).allowDiskUse(true);
}

/**
 * Builds the bounded neighbourhood of one or more addresses from stored flows. Edges are aggregated
 * per direction; alert markers come from the org's alerts (analyst-dismissed ones excluded) whose
 * activity overlaps the time range. Everything is scoped to `orgId`.
 */
export async function buildGraph(orgId: Types.ObjectId, q: GraphQuery): Promise<GraphResponse> {
  const pairs = new Map<string, PairRow>();
  const add = (rows: PairRow[]) => {
    for (const r of rows) pairs.set(key(r._id.s, r._id.d), r);
  };

  // One extra row tells us whether the edge budget cut something off.
  const first = await pairsTouching(orgId, q.seeds, q, q.maxEdges + 1);
  add(first);
  if (q.depth === 2 && pairs.size <= q.maxEdges) {
    const seedSet = new Set(q.seeds);
    const frontier = [...pairs.values()]
      .flatMap((p) => [p._id.s, p._id.d].map((ip) => ({ ip, flows: p.flows })))
      .filter((n) => !seedSet.has(n.ip))
      .reduce((acc, n) => acc.set(n.ip, (acc.get(n.ip) ?? 0) + n.flows), new Map<string, number>());
    const busiest = [...frontier.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, GRAPH_LIMITS.frontier).map(([ip]) => ip);
    if (busiest.length) add(await pairsTouching(orgId, busiest, q, q.maxEdges + 1));
  }

  const ordered = [...pairs.values()].sort((a, b) => b.flows - a.flows || key(a._id.s, a._id.d).localeCompare(key(b._id.s, b._id.d)));
  const edgesTruncated = ordered.length > q.maxEdges;

  // Admit nodes in order of the busiest edge that reaches them; seeds always stay.
  const admitted = new Set(q.seeds);
  let nodesTruncated = false;
  const kept: PairRow[] = [];
  for (const p of ordered) {
    if (kept.length >= q.maxEdges) break;
    const missing = [p._id.s, p._id.d].filter((ip) => !admitted.has(ip));
    if (admitted.size + missing.length > q.maxNodes) {
      nodesTruncated = true;
      continue;
    }
    for (const ip of missing) admitted.add(ip);
    kept.push(p);
  }

  const ips = [...admitted];
  const alertRows = ips.length
    ? await Alert.find({
        orgId,
        status: { $ne: "dismissed" },
        $or: [{ srcIp: { $in: ips } }, { dstIp: { $in: ips } }],
        ...(q.from ? { lastSeen: { $gte: q.from } } : {}),
        ...(q.to ? { firstSeen: { $lte: q.to } } : {}),
      })
        .select("srcIp dstIp severityRank")
        .lean()
    : [];
  const bump = (m: Map<string, { count: number; rank: number }>, k: string, rank: number) => {
    const cur = m.get(k) ?? { count: 0, rank: -1 };
    m.set(k, { count: cur.count + 1, rank: Math.max(cur.rank, rank) });
  };
  const byNode = new Map<string, { count: number; rank: number }>();
  const byEdge = new Map<string, { count: number; rank: number }>();
  for (const a of alertRows) {
    for (const ip of new Set([a.srcIp, a.dstIp])) if (ip && admitted.has(ip)) bump(byNode, ip, a.severityRank);
    if (a.srcIp && a.dstIp) bump(byEdge, key(a.srcIp, a.dstIp), a.severityRank);
  }
  const marker = (m: { count: number; rank: number } | undefined): GraphMarker | null => (m ? { count: m.count, maxSeverity: SEVERITY_BY_RANK[m.rank] ?? "info" } : null);

  const stats = new Map<string, { flows: number; last: Date | null }>();
  for (const p of kept) {
    for (const ip of [p._id.s, p._id.d]) {
      const cur = stats.get(ip) ?? { flows: 0, last: null };
      stats.set(ip, { flows: cur.flows + p.flows, last: !cur.last || p.last > cur.last ? p.last : cur.last });
    }
  }
  const seedSet = new Set(q.seeds);
  const nodes: GraphNode[] = ips.map((ip) => ({
    id: ip,
    scope: addressScope(ip),
    seed: seedSet.has(ip),
    flows: stats.get(ip)?.flows ?? 0,
    lastSeen: stats.get(ip)?.last ?? null,
    alerts: marker(byNode.get(ip)),
  }));
  nodes.sort((a, b) => Number(b.seed) - Number(a.seed) || b.flows - a.flows || a.id.localeCompare(b.id));
  return {
    seeds: q.seeds,
    range: { from: q.from, to: q.to },
    limits: { maxNodes: q.maxNodes, maxEdges: q.maxEdges, depth: q.depth },
    nodes,
    edges: kept.map((p) => ({
      source: p._id.s,
      target: p._id.d,
      flows: p.flows,
      maliciousFlows: p.malicious,
      firstSeen: p.first,
      lastSeen: p.last,
      alerts: marker(byEdge.get(key(p._id.s, p._id.d))),
    })),
    truncated: { nodes: nodesTruncated, edges: edgesTruncated },
    generatedAt: new Date(),
  };
}
