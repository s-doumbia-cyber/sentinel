import { can, objectIdSchema } from "@sentinel/shared";
import { z } from "zod";
import type { AppConfig } from "../../config/index.js";
import { AppError } from "../../lib/errors.js";
import { ah, authOf, parsed, validate } from "../../lib/http.js";
import { PolicyRouter } from "../../lib/routes.js";
import { Incident } from "../../models/tenant.js";
import { buildIncidentTrace } from "./trace.js";

export function incidentTraceRoutes(config: AppConfig): PolicyRouter {
  const r = new PolicyRouter(config);

  r.route(
    "get",
    "/incidents/:id/trace",
    "incidents:read",
    validate("params", z.object({ id: objectIdSchema })),
    ah(async (req, res) => {
      const { orgId, role } = authOf(req);
      const { id } = parsed<{ id: string }>(req, "params");
      const incident = await Incident.findOne({ orgId, _id: id }).select("entities sourceIp").lean();
      if (!incident) throw AppError.notFound("Incident");
      const entityIps = [...new Set([...(incident.entities ?? []).map((e) => e.value), incident.sourceIp])].filter((ip): ip is string => Boolean(ip));
      res.json(await buildIncidentTrace(orgId, incident._id, { identity: can(role, "identity:read"), entityIps }));
    }),
  );

  return r;
}
