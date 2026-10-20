import type { Types } from "mongoose";
import { can, estimateDeviceType, severityRank, SEVERITIES, type Severity } from "@sentinel/shared";
import { z } from "zod";
import type { AppConfig } from "../../config/index.js";
import { AppError } from "../../lib/errors.js";
import { ah, authOf, parsed, validate } from "../../lib/http.js";
import { PolicyRouter } from "../../lib/routes.js";
import { Asset, AssetEvent, type AssetDoc } from "../../models/context.js";
import { Alert, Flow, Incident } from "../../models/tenant.js";
import { auditFromRequest } from "../audit/audit.service.js";
import { decodeCursor, encodeCursor } from "../flows/flow.filters.js";
import { attributeAddress } from "../identity/identity.service.js";
import { userNames } from "../incidents/incident.dto.js";

const SEVERITY_BY_RANK = Object.fromEntries(SEVERITIES.map((s) => [severityRank(s), s])) as Record<number, Severity>;
const ipParams = z.object({ ip: z.string().ip() });
const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(200).optional(),
  q: z.string().trim().max(64).regex(/^[0-9a-fA-F.:]*$/, "Search by address").optional(),
  scope: z.enum(["internal", "external"]).optional(),
  role: z.enum(["server", "client"]).optional(),
  includeInactive: z.enum(["true"]).optional(),
});
const historyQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(200).optional(),
});

type LeanAsset = AssetDoc;

export function toAssetResponse(a: LeanAsset, alertCount?: number) {
  return {
    ip: a.ip,
    scope: a.scope,
    firstSeen: a.firstSeen,
    lastSeen: a.lastSeen,
    flowsAsSource: a.flowsAsSource,
    flowsAsDestination: a.flowsAsDestination,
    distinctPeers: a.distinctPeers,
    distinctServices: a.distinctServices ?? a.services.length,
    services: a.services,
    sourceKinds: a.sourceKinds,
    // Computed on read so heuristic changes apply to every asset at once; always an estimate.
    deviceEstimate: estimateDeviceType(
      a.services.map((s) => ({ port: s.port ?? 0, protocol: s.protocol ?? "", flows: s.flows ?? 0 })),
      a.flowsAsSource,
    ),
    notes: a.notes,
    tags: a.tags,
    active: a.active,
    refreshedAt: a.refreshedAt,
    ...(alertCount !== undefined ? { activeAlerts: alertCount } : {}),
  };
}

export interface AssetRouteDeps {
  scheduleAssetRefresh: (orgId: Types.ObjectId) => void;
}

export function assetRoutes(config: AppConfig, deps: AssetRouteDeps): PolicyRouter {
  const r = new PolicyRouter(config);

  r.route(
    "get",
    "/assets",
    "assets:read",
    validate("query", listQuery),
    ah(async (req, res) => {
      const { orgId } = authOf(req);
      const q = parsed<z.infer<typeof listQuery>>(req, "query");
      const filter: Record<string, unknown> = { orgId };
      if (!q.includeInactive) filter.active = true;
      if (q.q) filter.ip = { $regex: `^${q.q.replace(/\./g, "\\.")}` };
      if (q.scope) filter.scope = q.scope;
      if (q.role === "server") filter["services.0"] = { $exists: true };
      if (q.role === "client") Object.assign(filter, { "services.0": { $exists: false }, flowsAsSource: { $gt: 0 } });
      if (q.cursor) {
        const c = decodeCursor(q.cursor);
        filter.$or = [{ lastSeen: { $lt: c.t } }, { lastSeen: c.t, _id: { $lt: c.id } }];
      }
      const rows = await Asset.find(filter).sort({ lastSeen: -1, _id: -1 }).limit(q.limit + 1).lean<LeanAsset[]>();
      const page = rows.slice(0, q.limit);
      const ips = page.map((a) => a.ip);
      const counts = await Alert.aggregate<{ _id: string; n: number }>([
        { $match: { orgId, status: { $in: ["open", "needs_review", "acknowledged"] }, $or: [{ srcIp: { $in: ips } }, { dstIp: { $in: ips } }] } },
        { $project: { ips: { $setUnion: [[{ $ifNull: ["$srcIp", "-"] }], [{ $ifNull: ["$dstIp", "-"] }]] } } },
        { $unwind: "$ips" },
        { $group: { _id: "$ips", n: { $sum: 1 } } },
      ]);
      const byIp = new Map(counts.map((c) => [c._id, c.n]));
      const last = page.at(-1);
      res.json({
        items: page.map((a) => toAssetResponse(a, byIp.get(a.ip) ?? 0)),
        nextCursor: rows.length > q.limit && last ? encodeCursor(last.lastSeen, last._id) : null,
        lastRefreshedAt: page[0]?.refreshedAt ?? null,
      });
    }),
  );

  r.route(
    "get",
    "/assets/:ip",
    "assets:read",
    validate("params", ipParams),
    ah(async (req, res) => {
      const { orgId, role } = authOf(req);
      const { ip } = parsed<{ ip: string }>(req, "params");
      const asset = await Asset.findOne({ orgId, ip }).lean<LeanAsset>();
      if (!asset) throw AppError.notFound("Asset");
      const involving = { orgId, $or: [{ srcIp: ip }, { dstIp: ip }] };
      const [alerts, incidents, peersOut, peersIn, activity] = await Promise.all([
        Alert.find(involving).select("-hitKeys -flowIds -ruleHits").sort({ lastSeen: -1 }).limit(20).lean(),
        Incident.find({ orgId, $or: [{ sourceIp: ip }, { "entities.value": ip }] })
          .select("title status severity updatedAt")
          .sort({ updatedAt: -1 })
          .limit(20)
          .lean(),
        Flow.aggregate<{ _id: string; flows: number; last: Date }>([
          { $match: { orgId, sourceIp: ip } },
          { $group: { _id: "$destinationIp", flows: { $sum: 1 }, last: { $max: "$timestamp" } } },
          { $sort: { flows: -1 } },
          { $limit: 10 },
        ]),
        Flow.aggregate<{ _id: string; flows: number; last: Date }>([
          { $match: { orgId, destinationIp: ip } },
          { $group: { _id: "$sourceIp", flows: { $sum: 1 }, last: { $max: "$timestamp" } } },
          { $sort: { flows: -1 } },
          { $limit: 10 },
        ]),
        Flow.aggregate<{ _id: Date; asSource: number; asDestination: number }>([
          { $match: { orgId, $or: [{ sourceIp: ip }, { destinationIp: ip }] } },
          {
            $group: {
              _id: { $dateTrunc: { date: "$timestamp", unit: asset.lastSeen.getTime() - asset.firstSeen.getTime() > 2 * 86_400_000 ? "day" : "minute", binSize: 1 } },
              asSource: { $sum: { $cond: [{ $eq: ["$sourceIp", ip] }, 1, 0] } },
              asDestination: { $sum: { $cond: [{ $eq: ["$destinationIp", ip] }, 1, 0] } },
            },
          },
          { $sort: { _id: 1 } },
          { $limit: 500 },
        ]).allowDiskUse(true),
      ]);
      // Identity data is personal: only roles allowed to read it get the candidates.
      const identity = can(role, "identity:read") ? await attributeAddress(orgId, ip, asset.firstSeen, asset.lastSeen) : null;
      res.json({
        asset: toAssetResponse(asset),
        alerts: alerts.map((a) => ({
          id: String(a._id),
          type: a.type,
          severity: SEVERITY_BY_RANK[a.severityRank] ?? "info",
          status: a.status,
          role: a.srcIp === ip ? "source" : "target",
          count: a.count,
          lastSeen: a.lastSeen,
        })),
        incidents: incidents.map((i) => ({ id: String(i._id), title: i.title, status: i.status, severity: i.severity, updatedAt: (i as { updatedAt?: Date }).updatedAt })),
        peers: {
          outbound: peersOut.map((p) => ({ ip: p._id, flows: p.flows, lastSeen: p.last })),
          inbound: peersIn.map((p) => ({ ip: p._id, flows: p.flows, lastSeen: p.last })),
        },
        activity: activity.map((b) => ({ bucket: b._id, asSource: b.asSource, asDestination: b.asDestination })),
        identity,
        identityRestricted: identity === null,
      });
    }),
  );

  r.route(
    "get",
    "/assets/:ip/history",
    "assets:read",
    validate("params", ipParams),
    validate("query", historyQuery),
    ah(async (req, res) => {
      const { orgId } = authOf(req);
      const { ip } = parsed<{ ip: string }>(req, "params");
      const q = parsed<z.infer<typeof historyQuery>>(req, "query");
      if (!(await Asset.exists({ orgId, ip }))) throw AppError.notFound("Asset");
      const filter: Record<string, unknown> = { orgId, ip };
      if (q.cursor) {
        const c = decodeCursor(q.cursor);
        filter.$or = [{ ts: { $lt: c.t } }, { ts: c.t, _id: { $lt: c.id } }];
      }
      const rows = await AssetEvent.find(filter).sort({ ts: -1, _id: -1 }).limit(q.limit + 1).lean();
      const page = rows.slice(0, q.limit);
      const names = await userNames(page.map((e) => e.actorId));
      const last = page.at(-1);
      res.json({
        items: page.map((e) => ({
          id: String(e._id),
          kind: e.kind,
          ts: e.ts,
          eventTime: e.eventTime ?? null,
          actor: e.actorId ? (names.get(String(e.actorId)) ?? "Deleted user") : null,
          detail: e.detail ?? {},
        })),
        nextCursor: rows.length > q.limit && last ? encodeCursor(last.ts, last._id) : null,
      });
    }),
  );

  r.route(
    "patch",
    "/assets/:ip",
    "assets:write",
    validate("params", ipParams),
    validate(
      "body",
      z
        .object({ notes: z.string().max(5000).optional(), tags: z.array(z.string().trim().min(1).max(40)).max(20).optional() })
        .strict()
        .refine((v) => Object.keys(v).length > 0, "At least one field is required"),
    ),
    ah(async (req, res) => {
      const { orgId } = authOf(req);
      const { ip } = parsed<{ ip: string }>(req, "params");
      const body = parsed<{ notes?: string; tags?: string[] }>(req, "body");
      const before = await Asset.findOne({ orgId, ip }).select("notes tags").lean();
      if (!before) throw AppError.notFound("Asset");
      const asset = await Asset.findOneAndUpdate({ orgId, ip }, { $set: body }, { new: true }).lean<LeanAsset>();
      if (!asset) throw AppError.notFound("Asset");
      await auditFromRequest(req, "asset.update", { type: "asset", id: ip }, { before: { notes: before.notes, tags: before.tags }, after: body });
      // Analyst knowledge is part of the asset's history; the text itself stays in the audit log.
      await AssetEvent.create({ orgId, ip, kind: "notes_updated", actorId: authOf(req).userId, detail: { fields: Object.keys(body).sort() } });
      res.json(toAssetResponse(asset));
    }),
  );

  r.route(
    "post",
    "/assets/refresh",
    "assets:write",
    ah(async (req, res) => {
      const { orgId } = authOf(req);
      await auditFromRequest(req, "assets.refresh", { type: "org", id: String(orgId) });
      deps.scheduleAssetRefresh(orgId);
      res.status(202).json({ started: true });
    }),
  );

  return r;
}
