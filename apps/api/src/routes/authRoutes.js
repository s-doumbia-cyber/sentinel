import { Router } from "express";
import {
  changePassword,
  deleteMyAccount,
  exportMyData,
  listSessions,
  login,
  logout,
  logoutAll,
  me,
  register,
  revokeSession,
  updateMe,
} from "../controllers/authController.js";
import { requireAuth } from "../middlewares/auth.js";
import { changePasswordSchema, loginSchema, registerSchema, validateBody } from "../validators/authValidators.js";

const router = Router();

router.post("/register", validateBody(registerSchema), register);
router.post("/login", validateBody(loginSchema), login);
router.get("/me", requireAuth, me);
router.patch("/me", requireAuth, updateMe);
router.post("/change-password", requireAuth, validateBody(changePasswordSchema), changePassword);
router.post("/logout", requireAuth, logout);
router.get("/sessions", requireAuth, listSessions);
router.delete("/sessions/:id", requireAuth, revokeSession);
router.post("/logout-all", requireAuth, logoutAll);
router.get("/export", requireAuth, exportMyData);
router.delete("/me", requireAuth, deleteMyAccount);

export default router;
