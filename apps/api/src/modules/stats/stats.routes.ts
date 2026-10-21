import type { Request, Response } from "express";
import type { Types } from "mongoose";
import { statsQuerySchema, type StatsQuery } from "@sentinel/shared";
import { z } from "zod";
import type { AppConfig } from "../../config/index.js";
import { ah, authOf, parsed, validate } from "../../lib/http.js";
import { PolicyRouter } from "../../lib/routes.js";
import { planStats, type StatsPlan } from "./rollup.queries.js";
import { BREAKDOWN_FIELDS, TOP_KINDS, breakdown, evaluation, overview, timeseries, top, type BreakdownBy, type TopKind } from "./stats.service.js";

const breakdownQuery = statsQuerySchema.extend({
  by: z.enum(Object.keys(BREAKDOWN_FIELDS) as [BreakdownBy, ...BreakdownBy[]]),
});
const topQuery = statsQuerySchema.extend({
  kind: z.enum(TOP_KINDS),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export interface StatsRouteDeps {
  /** Queues a rollup rebuild when a read finds them stale (at most one queued or running per org). */
  requestRollup: (orgId: Types.ObjectId) => Promise<void>;
}

export function statsRoutes(config: AppConfig, deps: StatsRouteDeps): PolicyRouter {
  const r = new PolicyRouter(config);
  // Says which path answered: rollups (+ raw partial minutes) or raw flows only.
  const plan = async (req: Request, res: Response, q: StatsQuery): Promise<StatsPlan> => {
    const { orgId } = authOf(req);
    const p = await planStats(orgId, q, () => void deps.requestRollup(orgId).catch(() => undefined));
    res.setHeader("X-Sentinel-Stats-Source", p.source);
    return p;
  };

  r.route(
    "get",
    "/stats/overview",
    "stats:read",
    validate("query", statsQuerySchema),
    ah(async (req, res) => {
      const q = parsed<StatsQuery>(req, "query");
      res.json(await overview(authOf(req).orgId, q, await plan(req, res, q)));
    }),
  );

  r.route(
    "get",
    "/stats/breakdown",
    "stats:read",
    validate("query", breakdownQuery),
    ah(async (req, res) => {
      const q = parsed<StatsQuery & { by: BreakdownBy }>(req, "query");
      res.json({ by: q.by, items: await breakdown(authOf(req).orgId, q, q.by, await plan(req, res, q)) });
    }),
  );

  r.route(
    "get",
    "/stats/timeseries",
    "stats:read",
    validate("query", statsQuerySchema),
    ah(async (req, res) => {
      const q = parsed<StatsQuery>(req, "query");
      res.json(await timeseries(authOf(req).orgId, q, await plan(req, res, q)));
    }),
  );

  r.route(
    "get",
    "/stats/top",
    "stats:read",
    validate("query", topQuery),
    ah(async (req, res) => {
      const q = parsed<StatsQuery & { kind: TopKind; limit: number }>(req, "query");
      res.json({ kind: q.kind, items: await top(authOf(req).orgId, q, q.kind, q.limit, await plan(req, res, q)) });
    }),
  );

  r.route(
    "get",
    "/stats/evaluation",
    "stats:read",
    validate("query", statsQuerySchema),
    ah(async (req, res) => {
      const q = parsed<StatsQuery>(req, "query");
      res.json(await evaluation(authOf(req).orgId, q, await plan(req, res, q)));
    }),
  );

  return r;
}
