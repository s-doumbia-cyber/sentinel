import { objectIdSchema } from "@sentinel/shared";
import { z } from "zod";
import type { AppConfig } from "../../config/index.js";
import { AppError } from "../../lib/errors.js";
import { ah, authOf, parsed, validate } from "../../lib/http.js";
import { PolicyRouter } from "../../lib/routes.js";
import { Incident } from "../../models/tenant.js";
import { GRAPH_LIMITS, buildGraph, type GraphQuery } from "./graph.service.js";

const when = z.string().datetime({ offset: true }).transform((v) => new Date(v));
const graphQuery = z
  .object({
    from: when.optional(),
    to: when.optional(),
    depth: z.coerce.number().int().min(1).max(2).default(1),
    maxNodes: z.coerce.number().int().min(2).max(GRAPH_LIMITS.maxNodes).default(GRAPH_LIMITS.defaultNodes),
    maxEdges: z.coerce.number().int().min(1).max(GRAPH_LIMITS.maxEdges).default(GRAPH_LIMITS.defaultEdges),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: "`from` must not be after `to`", path: ["from"] });
type GraphParams = z.infer<typeof graphQuery>;

const toQuery = (seeds: string[], p: GraphParams, fallback?: { from: Date | null; to: Date | null }): GraphQuery => ({
  seeds,
  from: p.from ?? fallback?.from ?? null,
  to: p.to ?? fallback?.to ?? null,
  depth: p.depth as 1 | 2,
  maxNodes: p.maxNodes,
  maxEdges: p.maxEdges,
});

/** Context around one address, drawn from stored flows and alerts. Read-only; org scope comes from the token. */
export function entityRoutes(config: AppConfig): PolicyRouter {
  const r = new PolicyRouter(config);

  r.route(
    "get",
    "/entities/ip/:value/graph",
    "assets:read",
    validate("params", z.object({ value: z.string().ip() })),
    validate("query", graphQuery),
    ah(async (req, res) => {
      const { value } = parsed<{ value: string }>(req, "params");
      res.json(await buildGraph(authOf(req).orgId, toQuery([value], parsed<GraphParams>(req, "query"))));
    }),
  );

  // The same graph seeded with every address on an incident, over its activity window unless a range is given.
  r.route(
    "get",
    "/incidents/:id/graph",
    "incidents:read",
    validate("params", z.object({ id: objectIdSchema })),
    validate("query", graphQuery),
    ah(async (req, res) => {
      const { orgId } = authOf(req);
      const { id } = parsed<{ id: string }>(req, "params");
      const incident = await Incident.findOne({ orgId, _id: id }).select("entities sourceIp firstSeen lastSeen").lean();
      if (!incident) throw AppError.notFound("Incident");
      const seeds = [...new Set([incident.sourceIp, ...(incident.entities ?? []).map((e) => e.value)])].filter((ip): ip is string => Boolean(ip)).slice(0, 20);
      res.json(await buildGraph(orgId, toQuery(seeds, parsed<GraphParams>(req, "query"), { from: incident.firstSeen ?? null, to: incident.lastSeen ?? null })));
    }),
  );

  return r;
}
