import fs from "fs";
import { Dataset } from "../models/Dataset.js";
import { NetworkFlow } from "../models/NetworkFlow.js";
import { importCsvFile } from "../utils/csvImporter.js";

export async function listDatasets(req, res, next) {
  try {
    const datasets = await Dataset.find().sort({ createdAt: -1 }).lean();
    res.json(datasets);
  } catch (err) {
    next(err);
  }
}

// Runs the import synchronously within the request for simplicity; for very
// large files (200MB+) a production version would enqueue a background job
// and let the client poll /api/datasets for the "Processing" -> "Processed"
// status flip instead of holding the HTTP connection open.
export async function uploadDataset(req, res, next) {
  if (!req.file) {
    return res.status(400).json({ message: "No file uploaded. Send a multipart/form-data field named 'file'." });
  }
  try {
    const sourceType = req.body.sourceType || "Custom";
    const { rowCount, insertedCount, skippedCount, skippedUnknownLabelCount, attackCount, dataset } = await importCsvFile(
      req.file.path,
      sourceType,
      req.file.originalname
    );
    res.status(201).json({ rowCount, insertedCount, skippedCount, skippedUnknownLabelCount, attackCount, dataset });
  } catch (err) {
    next(err);
  } finally {
    fs.unlink(req.file.path, () => {}); // clean up the temp upload regardless of outcome
  }
}

// Admin-only: removes the Dataset record AND every NetworkFlow it imported,
// so the dashboard's totals stay consistent rather than leaving orphaned
// flows pointing at a dataset that no longer exists.
export async function deleteDataset(req, res, next) {
  try {
    const dataset = await Dataset.findById(req.params.id);
    if (!dataset) return res.status(404).json({ message: "Dataset not found" });

    const { deletedCount } = await NetworkFlow.deleteMany({ datasetId: dataset._id });
    await dataset.deleteOne();

    res.json({ message: "Dataset deleted", flowsDeleted: deletedCount });
  } catch (err) {
    next(err);
  }
}
