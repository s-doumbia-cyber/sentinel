import { Router } from "express";
import {
  getAttackBreakdown,
  getKpis,
  getSeverityBreakdown,
  getTimeline,
  getTopAttackers,
  getTopPorts,
  getTopSubnets,
  listFlows,
} from "../controllers/flowController.js";
import { requireAuth } from "../middlewares/auth.js";

const router = Router();

router.use(requireAuth);
router.get("/", listFlows);
router.get("/kpis", getKpis);
router.get("/attack-breakdown", getAttackBreakdown);
router.get("/severity-breakdown", getSeverityBreakdown);
router.get("/timeline", getTimeline);
router.get("/top-ports", getTopPorts);
router.get("/top-attackers", getTopAttackers);
router.get("/top-subnets", getTopSubnets);

export default router;
