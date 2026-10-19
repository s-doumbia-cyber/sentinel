import { randomBytes } from "node:crypto";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Types } from "mongoose";
import multer from "multer";
import { objectIdSchema } from "@sentinel/shared";
import { z } from "zod";
import type { AppConfig } from "../../config/index.js";
import { AppError } from "../../lib/errors.js";
import { ah, authOf, parsed, validate } from "../../lib/http.js";
import type { BackgroundJobs } from "../../lib/jobs.js";
import type { Logger } from "../../lib/logger.js";
import { PolicyRouter } from "../../lib/routes.js";
import { Dataset, Flow, type DatasetDoc } from "../../models/tenant.js";
import { auditFromRequest } from "../audit/audit.service.js";
import { SCHEMA_FOR_SOURCE_TYPE, checkCsvHeader, createDatasetRecord, runCsvImport } from "./csv.importer.js";

type DatasetLike = Omit<DatasetDoc, "groundTruthCounts"> & { groundTruthCounts?: Map<string, number> | Record<string, number> | null };

export function toDatasetResponse(d: DatasetLike) {
  const counts = d.groundTruthCounts instanceof Map ? Object.fromEntries(d.groundTruthCounts) : (d.groundTruthCounts ?? {});
  return {
    id: String(d._id),
    name: d.name,
    sourceType: d.sourceType,
    sourceKind: d.sourceKind,
    featureSchema: d.featureSchema,
    status: d.status,
    fileSha256: d.fileSha256 ?? null,
    fileBytes: d.fileBytes,
    rowsRead: d.rowsRead,
    rowsInserted: d.rowsInserted,
    skipped: d.skipped,
    unknownLabelRows: d.unknownLabelRows,
    unlabelledRows: d.unlabelledRows,
    unknownLabels: d.unknownLabels,
    invalidSamples: d.invalidSamples,
    groundTruthCounts: counts as Record<string, number>,
    timeRange: d.timeRange,
    error: d.error ?? null,
    createdAt: (d as unknown as { createdAt: Date }).createdAt,
    completedAt: d.completedAt ?? null,
  };
}

const importBody = z.object({ sourceType: z.enum(["CICIDS2017"]).default("CICIDS2017") });
const idParams = z.object({ id: objectIdSchema });

export interface DatasetRouteDeps {
  jobs: BackgroundJobs;
  logger: Logger;
  /** Called after a successful import so new flows get scored. */
  onImported: (orgId: Types.ObjectId) => void;
}

export function datasetRoutes(config: AppConfig, deps: DatasetRouteDeps): PolicyRouter {
  const r = new PolicyRouter(config);
  const upload = multer({
    storage: multer.diskStorage({
      destination: tmpdir(),
      // Generated name: the client's filename never touches the filesystem path.
      filename: (_req, _file, cb) => cb(null, `sentinel-upload-${randomBytes(12).toString("hex")}.csv`),
    }),
    limits: { fileSize: config.uploadMaxBytes, files: 1, fields: 5 },
    fileFilter: (_req, file, cb) => {
      if (path.extname(file.originalname).toLowerCase() !== ".csv") {
        cb(new AppError("UNSUPPORTED_MEDIA", 415, "Only .csv files are accepted"));
        return;
      }
      cb(null, true);
    },
  });

  r.route(
    "get",
    "/datasets",
    "datasets:read",
    ah(async (req, res) => {
      const datasets = await Dataset.find({ orgId: authOf(req).orgId }).sort({ createdAt: -1 }).limit(200).lean();
      res.json({ items: datasets.map((d) => toDatasetResponse(d as unknown as DatasetLike)) });
    }),
  );

  r.route(
    "get",
    "/datasets/:id",
    "datasets:read",
    validate("params", idParams),
    ah(async (req, res) => {
      const { id } = parsed<{ id: string }>(req, "params");
      const d = await Dataset.findOne({ orgId: authOf(req).orgId, _id: id }).lean();
      if (!d) throw AppError.notFound("Dataset");
      res.json(toDatasetResponse(d as unknown as DatasetLike));
    }),
  );

  r.route(
    "post",
    "/imports/csv",
    "datasets:import",
    upload.single("file"),
    ah(async (req, res) => {
      const ctx = authOf(req);
      const file = req.file;
      if (!file) throw AppError.validation("No file uploaded. Send multipart/form-data with a field named 'file'.");
      let handedOff = false;
      try {
        const body = importBody.safeParse(req.body ?? {});
        if (!body.success) throw AppError.validation("Unsupported sourceType: only CICIDS2017 CSV exports are supported");
        const header = await checkCsvHeader(file.path, SCHEMA_FOR_SOURCE_TYPE[body.data.sourceType]);
        const input = {
          orgId: ctx.orgId,
          userId: ctx.userId,
          filePath: file.path,
          name: path.basename(file.originalname).slice(0, 255),
          fileBytes: file.size,
          sourceType: body.data.sourceType,
          sourceKind: "IMPORTED" as const,
        };
        const dataset = await createDatasetRecord(input);
        await auditFromRequest(req, "dataset.import", { type: "dataset", id: String(dataset._id) }, {
          name: input.name,
          bytes: file.size,
        });
        deps.jobs.run(`import:${String(dataset._id)}`, async () => {
          try {
            await runCsvImport(dataset._id, input, header, deps.logger);
            deps.onImported(ctx.orgId);
          } finally {
            await unlink(file.path).catch(() => undefined);
          }
        });
        handedOff = true;
        res.status(202).json(toDatasetResponse(dataset));
      } finally {
        if (!handedOff) await unlink(file.path).catch(() => undefined);
      }
    }),
  );

  r.route(
    "delete",
    "/datasets/:id",
    "datasets:delete",
    validate("params", idParams),
    ah(async (req, res) => {
      const { orgId } = authOf(req);
      const { id } = parsed<{ id: string }>(req, "params");
      const dataset = await Dataset.findOne({ orgId, _id: id });
      if (!dataset) throw AppError.notFound("Dataset");
      if (dataset.status === "Processing") throw AppError.conflict("This dataset is still importing; wait for it to finish");
      const { deletedCount } = await Flow.deleteMany({ orgId, datasetId: dataset._id });
      await Dataset.deleteOne({ orgId, _id: dataset._id });
      await auditFromRequest(req, "dataset.delete", { type: "dataset", id }, { name: dataset.name, flowsDeleted: deletedCount });
      res.json({ flowsDeleted: deletedCount });
    }),
  );

  return r;
}
