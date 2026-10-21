import { objectIdSchema } from "@sentinel/shared";
import type { Response } from "express";
import { z } from "zod";
import type { AppConfig } from "../../config/index.js";
import { AppError } from "../../lib/errors.js";
import { ah, authOf, parsed, validate } from "../../lib/http.js";
import { PolicyRouter } from "../../lib/routes.js";
import { Incident } from "../../models/tenant.js";
import { auditFromRequest } from "../audit/audit.service.js";
import { recordIncidentEvent } from "../incidents/events.js";
import type { LeanIncident } from "../incidents/incident.dto.js";
import { buildIncidentReport } from "../incidents/report.service.js";
import { executiveDocument, incidentDocument } from "./blocks.js";
import { buildExecutiveReport } from "./executive.service.js";
import { renderPdf } from "./pdf.js";

const when = z.string().datetime({ offset: true }).transform((v) => new Date(v));
const rangeQuery = z
  .object({ from: when.optional(), to: when.optional() })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: "`from` must not be after `to`", path: ["from"] });
type RangeQuery = z.infer<typeof rangeQuery>;

const day = (d: Date | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "incident";

function sendPdf(res: Response, filename: string, pdf: Buffer) {
  res.status(200);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  // Reports hold investigation detail: never cached by a shared proxy.
  res.setHeader("Cache-Control", "no-store");
  res.send(pdf);
}

/** Org-level report (JSON for the page, PDF for download) and the incident report as PDF. */
export function reportRoutes(config: AppConfig): PolicyRouter {
  const r = new PolicyRouter(config);

  r.route(
    "get",
    "/reports/executive",
    "stats:read",
    validate("query", rangeQuery),
    ah(async (req, res) => {
      res.json(await buildExecutiveReport(authOf(req).orgId, parsed<RangeQuery>(req, "query")));
    }),
  );

  // POST because it produces a document: generating one is written to the audit log, like the incident report.
  r.route(
    "post",
    "/reports/executive/pdf",
    "stats:read",
    validate("query", rangeQuery),
    ah(async (req, res) => {
      const { orgId } = authOf(req);
      const range = parsed<RangeQuery>(req, "query");
      const report = await buildExecutiveReport(orgId, range);
      const pdf = await renderPdf(executiveDocument(report));
      await auditFromRequest(req, "report.executive_pdf", { type: "org", id: String(orgId) }, { from: report.meta.range.from, to: report.meta.range.to, bytes: pdf.length });
      sendPdf(res, `sentinel-executive-report-${day(range.from) ?? "start"}_${day(range.to) ?? "now"}.pdf`, pdf);
    }),
  );

  r.route(
    "post",
    "/incidents/:id/report/pdf",
    "incidents:read",
    validate("params", z.object({ id: objectIdSchema })),
    ah(async (req, res) => {
      const { orgId, role, userId } = authOf(req);
      const { id } = parsed<{ id: string }>(req, "params");
      const incident = await Incident.findOne({ orgId, _id: id }).lean<LeanIncident>();
      if (!incident) throw AppError.notFound("Incident");
      const generatedAt = new Date();
      const report = await buildIncidentReport(orgId, role, incident, generatedAt);
      const pdf = await renderPdf(incidentDocument(report));
      await recordIncidentEvent(req, orgId, incident._id, "report_generated", { generatedAt: generatedAt.toISOString(), by: String(userId), format: "pdf" });
      sendPdf(res, `sentinel-incident-${slug(incident.title)}-${String(incident._id).slice(-6)}.pdf`, pdf);
    }),
  );

  return r;
}
