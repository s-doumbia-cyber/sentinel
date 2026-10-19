import { Router } from "express";
import { getModelMetrics } from "../controllers/mlController.js";
import { requireAuth } from "../middlewares/auth.js";

const router = Router();

router.use(requireAuth);
router.get("/metrics", getModelMetrics);

export default router;
