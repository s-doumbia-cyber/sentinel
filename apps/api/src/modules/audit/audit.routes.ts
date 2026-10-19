import { z } from "zod";
import type { AppConfig } from "../../config/index.js";
import { ah, authOf, parsed, validate } from "../../lib/http.js";
import { PolicyRouter } from "../../lib/routes.js";
import { User } from "../../models/identity.js";
import { AuditLog } from "../../models/tenant.js";
import { decodeCursor, encodeCursor } from "../flows/flow.filters.js";

const auditQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(200).optional(),
  action: z.string().regex(/^[a-z_.]{1,60}$/).optional(),
});

export function auditRoutes(config: AppConfig): PolicyRouter {
  const r = new PolicyRouter(config);

  r.route(
    "get",
    "/audit",
    "audit:read",
    validate("query", auditQuery),
    ah(async (req, res) => {
      const { orgId } = authOf(req);
      const q = parsed<z.infer<typeof auditQuery>>(req, "query");
      const filter: Record<string, unknown> = { orgId };
      if (q.action) filter.action = q.action;
      if (q.cursor) {
        const c = decodeCursor(q.cursor);
        filter.$or = [{ ts: { $lt: c.t } }, { ts: c.t, _id: { $lt: c.id } }];
      }
      const rows = await AuditLog.find(filter).sort({ ts: -1, _id: -1 }).limit(q.limit + 1).lean();
      const page = rows.slice(0, q.limit);
      const actors = await User.find({ _id: { $in: page.map((e) => e.actorId).filter(Boolean) } }).select("name").lean();
      const names = new Map(actors.map((u) => [String(u._id), u.name]));
      const last = page.at(-1);
      res.json({
        items: page.map((e) => ({
          id: String(e._id),
          ts: e.ts,
          actor: e.actorId ? { id: String(e.actorId), name: names.get(String(e.actorId)) ?? "Former member" } : null,
          action: e.action,
          target: e.target,
          meta: e.meta,
          ip: e.ip,
          requestId: e.requestId,
        })),
        nextCursor: rows.length > q.limit && last ? encodeCursor(last.ts, last._id) : null,
      });
    }),
  );

  return r;
}
