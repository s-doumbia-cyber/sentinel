import { Router } from "express";
import { createIncident, deleteIncident, listIncidents, updateIncident } from "../controllers/incidentController.js";
import { requireAuth, requireRole } from "../middlewares/auth.js";

const router = Router();

router.use(requireAuth);
router.get("/", listIncidents);
router.post("/", requireRole("Analyst", "Admin"), createIncident);
router.patch("/:id", requireRole("Analyst", "Admin"), updateIncident);
router.delete("/:id", requireRole("Admin"), deleteIncident);

export default router;
