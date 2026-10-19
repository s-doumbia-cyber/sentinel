import { Router } from "express";
import multer from "multer";
import os from "os";
import { deleteDataset, listDatasets, uploadDataset } from "../controllers/datasetController.js";
import { requireAuth, requireRole } from "../middlewares/auth.js";

const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB — CICIDS2017 day-files run up to ~280MB
});

const router = Router();

router.use(requireAuth);
router.get("/", listDatasets);
router.post("/upload", requireRole("Analyst", "Admin"), upload.single("file"), uploadDataset);
router.delete("/:id", requireRole("Admin"), deleteDataset);

export default router;
