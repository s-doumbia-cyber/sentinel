import { statsQuerySchema, type StatsQuery } from "@sentinel/shared";
import { z } from "zod";
import type { AppConfig } from "../../config/index.js";
import { ah, authOf, parsed, validate } from "../../lib/http.js";
import { PolicyRouter } from "../../lib/routes.js";
import { BREAKDOWN_FIELDS, TOP_KINDS, breakdown, evaluation, overview, timeseries, top, type BreakdownBy, type TopKind } from "./stats.service.js";

const breakdownQuery = statsQuerySchema.extend({
  by: z.enum(Object.keys(BREAKDOWN_FIELDS) as [BreakdownBy, ...BreakdownBy[]]),
});
const topQuery = statsQuerySchema.extend({
  kind: z.enum(TOP_KINDS),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export function statsRoutes(config: AppConfig): PolicyRouter {
  const r = new PolicyRouter(config);

  r.route(
    "get",
    "/stats/overview",
    "stats:read",
    validate("query", statsQuerySchema),
    ah(async (req, res) => {
      res.json(await overview(authOf(req).orgId, parsed<StatsQuery>(req, "query")));
    }),
  );

  r.route(
    "get",
    "/stats/breakdown",
    "stats:read",
    validate("query", breakdownQuery),
    ah(async (req, res) => {
      const q = parsed<StatsQuery & { by: BreakdownBy }>(req, "query");
      res.json({ by: q.by, items: await breakdown(authOf(req).orgId, q, q.by) });
    }),
  );

  r.route(
    "get",
    "/stats/timeseries",
    "stats:read",
    validate("query", statsQuerySchema),
    ah(async (req, res) => {
      res.json(await timeseries(authOf(req).orgId, parsed<StatsQuery>(req, "query")));
    }),
  );

  r.route(
    "get",
    "/stats/top",
    "stats:read",
    validate("query", topQuery),
    ah(async (req, res) => {
      const q = parsed<StatsQuery & { kind: TopKind; limit: number }>(req, "query");
      res.json({ kind: q.kind, items: await top(authOf(req).orgId, q, q.kind, q.limit) });
    }),
  );

  r.route(
    "get",
    "/stats/evaluation",
    "stats:read",
    validate("query", statsQuerySchema),
    ah(async (req, res) => {
      res.json(await evaluation(authOf(req).orgId, parsed<StatsQuery>(req, "query")));
    }),
  );

  return r;
}
