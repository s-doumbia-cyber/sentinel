import type { Request } from "express";
import rateLimit from "express-rate-limit";
import mongoose from "mongoose";
import { mfaEnableBodySchema, mfaLoginBodySchema, passwordConfirmBodySchema } from "@sentinel/shared";
import type { z } from "zod";
import type { AppConfig } from "../../config/index.js";
import { verifyMfaToken, verifyPassword } from "../../lib/crypto.js";
import { AppError } from "../../lib/errors.js";
import { ah, authOf, parsed, validate } from "../../lib/http.js";
import { PolicyRouter } from "../../lib/routes.js";
import { AuthSession, User } from "../../models/identity.js";
import { auditFromRequest, writeAudit } from "../audit/audit.service.js";
import { setRefreshCookie } from "./auth.routes.js";
import { finishLogin, listMyOrgs, toUserResponse } from "./auth.service.js";
import type { MfaService } from "./mfa.service.js";

export interface MfaRouteOptions {
  mfa: MfaService;
  /** Attempts per window on the code endpoints (lowered in tests). */
  rateLimit: { windowMs: number; max: number };
}

async function requirePassword(req: Request, password: string): Promise<void> {
  const user = await User.findById(authOf(req).userId).select("passwordHash").lean();
  if (!user) throw AppError.unauthenticated();
  if (!(await verifyPassword(user.passwordHash, password))) {
    throw AppError.validation("Password is incorrect", [{ path: "password", message: "Incorrect password" }]);
  }
}

/** Login-time events have no active org yet: they go to the user's first org, like auth.login. */
async function auditAccountEvent(req: Request, userId: mongoose.Types.ObjectId, action: string, meta: Record<string, unknown>) {
  const first = (await listMyOrgs(userId))[0];
  if (!first) return;
  await writeAudit(req, { orgId: new mongoose.Types.ObjectId(first.id), actorId: userId, action, target: { type: "user", id: String(userId) }, meta });
}

export function mfaRoutes(config: AppConfig, options: MfaRouteOptions): PolicyRouter {
  const r = new PolicyRouter(config);
  const { mfa } = options;
  const limited = (key: (req: Request) => string) =>
    rateLimit({
      windowMs: options.rateLimit.windowMs,
      limit: options.rateLimit.max,
      standardHeaders: "draft-7",
      legacyHeaders: false,
      keyGenerator: key,
      handler: (req, res) => {
        res.status(429).json({ error: { code: "RATE_LIMITED", message: "Too many attempts. Try again later.", requestId: req.id } });
      },
    });
  // Keyed per account as well as per IP: the per-account lock in MfaService is the backstop across processes.
  const signInLimiter = limited((req) => `${req.ip}|${verifyMfaToken(String(req.body?.mfaToken ?? ""), config.auth.accessSecret) ?? ""}`);
  const selfLimiter = limited((req) => `self|${String(req.auth?.userId ?? req.ip)}`);

  r.route(
    "post",
    "/auth/mfa/verify",
    "public",
    signInLimiter,
    validate("body", mfaLoginBodySchema),
    ah(async (req, res) => {
      const body = parsed<z.infer<typeof mfaLoginBodySchema>>(req, "body");
      const sub = verifyMfaToken(body.mfaToken, config.auth.accessSecret);
      if (!sub || !mongoose.isValidObjectId(sub)) throw AppError.unauthenticated("The sign-in step expired. Enter your password again.");
      const userId = new mongoose.Types.ObjectId(sub);
      const { factor, recoveryCodesLeft } = await mfa.verifySignIn(userId, body);
      if (factor === "recovery") await auditAccountEvent(req, userId, "auth.mfa_recovery_used", { recoveryCodesLeft });
      const { user, orgs, tokens } = await finishLogin(config, req, userId, { factor: "password+" + factor });
      setRefreshCookie(res, tokens.refreshToken, tokens.refreshExpiresAt);
      res.json({ accessToken: tokens.accessToken, expiresIn: tokens.expiresIn, user: toUserResponse(user), orgs, recoveryCodesLeft });
    }),
  );

  r.route(
    "get",
    "/auth/mfa",
    "self",
    ah(async (req, res) => {
      const user = await User.findById(authOf(req).userId).select("mfa").lean();
      if (!user) throw AppError.unauthenticated();
      res.json({
        enabled: Boolean(user.mfa?.enabled),
        enabledAt: user.mfa?.enabledAt ?? null,
        recoveryCodesLeft: user.mfa?.enabled ? (user.mfa.recoveryCodeHashes?.length ?? 0) : 0,
      });
    }),
  );

  r.route(
    "post",
    "/auth/mfa/setup",
    "self",
    selfLimiter,
    validate("body", passwordConfirmBodySchema),
    ah(async (req, res) => {
      const { userId } = authOf(req);
      await requirePassword(req, parsed<{ password: string }>(req, "body").password);
      const user = await User.findById(userId).select("email mfa.enabled").lean();
      if (!user) throw AppError.unauthenticated();
      if (user.mfa?.enabled) throw AppError.conflict("Two-factor authentication is already on");
      const setup = await mfa.beginSetup(userId, user.email);
      await auditFromRequest(req, "auth.mfa_setup", { type: "user", id: String(userId) });
      // The seed is shown for enrolment only; afterwards it is never returned again.
      res.json(setup);
    }),
  );

  r.route(
    "post",
    "/auth/mfa/enable",
    "self",
    selfLimiter,
    validate("body", mfaEnableBodySchema),
    ah(async (req, res) => {
      const { userId, sessionId } = authOf(req);
      const recoveryCodes = await mfa.enable(userId, parsed<{ code: string }>(req, "body").code);
      // Sessions opened with the password alone end; this device stays signed in.
      const revoked = await AuthSession.updateMany(
        { userId, _id: { $ne: sessionId }, revokedAt: null },
        { $set: { revokedAt: new Date(), revokedReason: "mfa_enabled" } },
      );
      await auditFromRequest(req, "auth.mfa_enabled", { type: "user", id: String(userId) }, { otherSessionsSignedOut: revoked.modifiedCount });
      res.json({ recoveryCodes });
    }),
  );

  r.route(
    "post",
    "/auth/mfa/disable",
    "self",
    selfLimiter,
    validate("body", passwordConfirmBodySchema),
    ah(async (req, res) => {
      const { userId } = authOf(req);
      await requirePassword(req, parsed<{ password: string }>(req, "body").password);
      const user = await User.findById(userId).select("mfa.enabled").lean();
      if (!user?.mfa?.enabled) throw AppError.conflict("Two-factor authentication is already off");
      await mfa.disable(userId);
      await auditFromRequest(req, "auth.mfa_disabled", { type: "user", id: String(userId) });
      res.status(204).end();
    }),
  );

  r.route(
    "post",
    "/auth/mfa/recovery-codes",
    "self",
    selfLimiter,
    validate("body", passwordConfirmBodySchema),
    ah(async (req, res) => {
      const { userId } = authOf(req);
      await requirePassword(req, parsed<{ password: string }>(req, "body").password);
      const recoveryCodes = await mfa.regenerateRecoveryCodes(userId);
      await auditFromRequest(req, "auth.mfa_recovery_regenerated", { type: "user", id: String(userId) });
      res.json({ recoveryCodes });
    }),
  );

  return r;
}
