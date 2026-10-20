import { randomBytes } from "node:crypto";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import multer from "multer";
import { objectIdSchema } from "@sentinel/shared";
import { z } from "zod";
import type { AppConfig } from "../../config/index.js";
import { AppError } from "../../lib/errors.js";
import { ah, authOf, parsed, validate } from "../../lib/http.js";
import { PolicyRouter } from "../../lib/routes.js";
import { IdentityImport, IdentityObservation } from "../../models/context.js";
import { auditFromRequest } from "../audit/audit.service.js";
import { identityHistoryForAddress, lookupIdentity } from "./identity.context.js";
import { attributeAddress, importIdentityCsv } from "./identity.service.js";

const MAX_IDENTITY_BYTES = 20 * 1024 * 1024;
const isoDate = z.string().datetime({ offset: true });

export function identityRoutes(config: AppConfig): PolicyRouter {
  const r = new PolicyRouter(config);
  const upload = multer({
    storage: multer.diskStorage({
      destination: tmpdir(),
      filename: (_req, _file, cb) => cb(null, `sentinel-identity-${randomBytes(12).toString("hex")}.csv`),
    }),
    limits: { fileSize: MAX_IDENTITY_BYTES, files: 1 },
    fileFilter: (_req, file, cb) => {
      if (path.extname(file.originalname).toLowerCase() !== ".csv") return cb(new AppError("UNSUPPORTED_MEDIA", 415, "Only .csv files are accepted"));
      cb(null, true);
    },
  });

  r.route(
    "get",
    "/identity/imports",
    "identity:read",
    ah(async (req, res) => {
      const { orgId } = authOf(req);
      const items = await IdentityImport.find({ orgId }).sort({ createdAt: -1 }).limit(100).lean();
      res.json({
        items: items.map((i) => ({
          id: String(i._id),
          name: i.name,
          fileSha256: i.fileSha256,
          rowsRead: i.rowsRead,
          rowsInserted: i.rowsInserted,
          invalidRows: i.invalidRows,
          invalidSamples: i.invalidSamples,
          sources: i.sources,
          createdAt: (i as { createdAt?: Date }).createdAt,
        })),
      });
    }),
  );

  r.route(
    "post",
    "/identity/imports",
    "identity:manage",
    upload.single("file"),
    ah(async (req, res) => {
      const { orgId, userId } = authOf(req);
      if (!req.file) throw AppError.validation("No file uploaded. Send multipart/form-data with a field named 'file'.");
      try {
        const imp = await importIdentityCsv(orgId, userId, req.file.path, path.basename(req.file.originalname).slice(0, 255));
        await auditFromRequest(req, "identity.import", { type: "identity_import", id: String(imp._id) }, {
          name: imp.name,
          rows: imp.rowsInserted,
          invalid: imp.invalidRows,
          sources: imp.sources,
        });
        res.status(201).json({ id: String(imp._id), name: imp.name, rowsRead: imp.rowsRead, rowsInserted: imp.rowsInserted, invalidRows: imp.invalidRows, invalidSamples: imp.invalidSamples, sources: imp.sources });
      } finally {
        await unlink(req.file.path).catch(() => undefined);
      }
    }),
  );

  r.route(
    "delete",
    "/identity/imports/:id",
    "identity:manage",
    validate("params", z.object({ id: objectIdSchema })),
    ah(async (req, res) => {
      const { orgId } = authOf(req);
      const { id } = parsed<{ id: string }>(req, "params");
      const imp = await IdentityImport.findOne({ orgId, _id: id }).lean();
      if (!imp) throw AppError.notFound("Identity import");
      const { deletedCount } = await IdentityObservation.deleteMany({ orgId, importId: imp._id });
      await IdentityImport.deleteOne({ orgId, _id: imp._id });
      await auditFromRequest(req, "identity.import_delete", { type: "identity_import", id }, { name: imp.name, recordsDeleted: deletedCount });
      res.json({ recordsDeleted: deletedCount });
    }),
  );

  r.route(
    "get",
    "/identity/attribution",
    "identity:read",
    validate("query", z.object({ ip: z.string().ip(), from: isoDate, to: isoDate })),
    ah(async (req, res) => {
      const { orgId } = authOf(req);
      const q = parsed<{ ip: string; from: string; to: string }>(req, "query");
      const from = new Date(q.from);
      const to = new Date(q.to);
      if (to < from) throw AppError.validation("to must not be before from");
      res.json(await attributeAddress(orgId, q.ip, from, to));
    }),
  );

  r.route(
    "get",
    "/identity/addresses/:ip",
    "identity:read",
    validate("params", z.object({ ip: z.string().ip() })),
    ah(async (req, res) => {
      const { orgId } = authOf(req);
      res.json(await identityHistoryForAddress(orgId, parsed<{ ip: string }>(req, "params").ip));
    }),
  );

  r.route(
    "get",
    "/identity/lookup",
    "identity:read",
    validate("query", z.object({ q: z.string().trim().min(1).max(128) })),
    ah(async (req, res) => {
      const { orgId } = authOf(req);
      const { q } = parsed<{ q: string }>(req, "query");
      const result = await lookupIdentity(orgId, q);
      // Searching for a person or device across all records is profiling: who looked up whom is audited.
      await auditFromRequest(req, "identity.lookup", { type: "identity", id: null }, { query: result.query, records: result.records.length });
      res.json(result);
    }),
  );

  return r;
}
