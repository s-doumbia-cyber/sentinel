import { Router } from "express";
import { listUsers, updateUserRole } from "../controllers/userController.js";
import { requireAuth, requireRole } from "../middlewares/auth.js";

const router = Router();

router.use(requireAuth);
router.get("/", requireRole("Admin"), listUsers);
router.patch("/:id/role", requireRole("Admin"), updateUserRole);

export default router;
