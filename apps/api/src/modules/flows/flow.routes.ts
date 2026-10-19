import { flowQuerySchema, objectIdSchema, type FlowQuery } from "@sentinel/shared";
import { z } from "zod";
import type { AppConfig } from "../../config/index.js";
import { AppError } from "../../lib/errors.js";
import { ah, authOf, parsed, validate } from "../../lib/http.js";
import { PolicyRouter } from "../../lib/routes.js";
import { Flow } from "../../models/tenant.js";
import { toFlowResponse, type LeanFlow } from "./flow.dto.js";
import { buildFlowFilter, decodeCursor, encodeCursor } from "./flow.filters.js";

export function flowRoutes(config: AppConfig): PolicyRouter {
  const r = new PolicyRouter(config);

  r.route(
    "get",
    "/flows",
    "flows:read",
    validate("query", flowQuerySchema),
    ah(async (req, res) => {
      const { orgId } = authOf(req);
      const q = parsed<FlowQuery>(req, "query");
      const filter = buildFlowFilter(orgId, q);
      if (q.cursor) {
        const c = decodeCursor(q.cursor);
        filter.$or = [{ timestamp: { $lt: c.t } }, { timestamp: c.t, _id: { $lt: c.id } }];
      }
      const rows = await Flow.find(filter)
        .select("-features")
        .sort({ timestamp: -1, _id: -1 })
        .limit(q.limit + 1)
        .lean<LeanFlow[]>();
      const page = rows.slice(0, q.limit);
      const last = page.at(-1);
      res.json({
        items: page.map((f) => toFlowResponse(f)),
        nextCursor: rows.length > q.limit && last ? encodeCursor(last.timestamp, last._id) : null,
      });
    }),
  );

  r.route(
    "get",
    "/flows/:id",
    "flows:read",
    validate("params", z.object({ id: objectIdSchema })),
    ah(async (req, res) => {
      const { orgId } = authOf(req);
      const { id } = parsed<{ id: string }>(req, "params");
      const flow = await Flow.findOne({ orgId, _id: id }).lean<LeanFlow>();
      if (!flow) throw AppError.notFound("Flow");
      res.json(toFlowResponse(flow, { withFeatures: true }));
    }),
  );

  return r;
}
