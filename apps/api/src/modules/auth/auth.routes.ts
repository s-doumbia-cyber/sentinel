import type { CookieOptions, Response } from "express";
import rateLimit from "express-rate-limit";
import mongoose from "mongoose";
import {
  changePasswordBodySchema,
  loginBodySchema,
  objectIdSchema,
  registerBodySchema,
  updateMeBodySchema,
} from "@sentinel/shared";
import { z } from "zod";
import type { AppConfig } from "../../config/index.js";
import { hashPassword, verifyPassword } from "../../lib/crypto.js";
import { AppError } from "../../lib/errors.js";
import { ah, authOf, parsed, validate } from "../../lib/http.js";
import { PolicyRouter } from "../../lib/routes.js";
import { requireCsrfHeader } from "../../middleware/auth.js";
import { AuthSession, Membership, Org, User } from "../../models/identity.js";
import { CONTEXT_MODELS } from "../../models/context.js";
import { ValidationRun } from "../../models/validation.js";
import { AuditLog, TENANT_MODELS } from "../../models/tenant.js";
import { auditFromRequest } from "../audit/audit.service.js";
import * as auth from "./auth.service.js";

export const REFRESH_COOKIE = "sentinel_rt";
const COOKIE_PATH = "/api/v1/auth";

export interface AuthRouteOptions {
  /** Requests per window for login/register; lowered in tests to exercise the limiter. */
  authRateLimit: { windowMs: number; max: number };
}

function cookieOptions(expires?: Date): CookieOptions {
  // Secure is always on: browsers accept Secure cookies on http://localhost.
  return { httpOnly: true, secure: true, sameSite: "strict", path: COOKIE_PATH, ...(expires ? { expires } : {}) };
}

export function setRefreshCookie(res: Response, token: string, expires: Date) {
  res.cookie(REFRESH_COOKIE, token, cookieOptions(expires));
}

function clearRefreshCookie(res: Response) {
  res.clearCookie(REFRESH_COOKIE, cookieOptions());
}

function readRefreshCookie(cookies: unknown): string | undefined {
  const value = (cookies as Record<string, unknown> | undefined)?.[REFRESH_COOKIE];
  return typeof value === "string" ? value : undefined;
}

export function authRoutes(config: AppConfig, options: AuthRouteOptions): PolicyRouter {
  const r = new PolicyRouter(config);
  const limiter = rateLimit({
    windowMs: options.authRateLimit.windowMs,
    limit: options.authRateLimit.max,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    // Key on IP and the submitted email, so one attacker cannot lock out every account from one IP cheaply.
    keyGenerator: (req) => `${req.ip}|${typeof req.body?.email === "string" ? req.body.email.toLowerCase() : ""}`,
    handler: (req, res) => {
      res.status(429).json({ error: { code: "RATE_LIMITED", message: "Too many attempts. Try again later.", requestId: req.id } });
    },
  });
  const csrf = requireCsrfHeader(config);

  r.route(
    "post",
    "/auth/register",
    "public",
    limiter,
    validate("body", registerBodySchema),
    ah(async (req, res) => {
      const { user, tokens } = await auth.register(config, req, parsed(req, "body"));
      setRefreshCookie(res, tokens.refreshToken, tokens.refreshExpiresAt);
      res.status(201).json({
        accessToken: tokens.accessToken,
        expiresIn: tokens.expiresIn,
        user: auth.toUserResponse(user),
        orgs: await auth.listMyOrgs(user._id),
      });
    }),
  );

  r.route(
    "post",
    "/auth/login",
    "public",
    limiter,
    validate("body", loginBodySchema),
    ah(async (req, res) => {
      const { user, orgs, tokens } = await auth.login(config, req, parsed(req, "body"));
      setRefreshCookie(res, tokens.refreshToken, tokens.refreshExpiresAt);
      res.json({ accessToken: tokens.accessToken, expiresIn: tokens.expiresIn, user: auth.toUserResponse(user), orgs });
    }),
  );

  r.route(
    "post",
    "/auth/refresh",
    "public",
    csrf,
    ah(async (req, res) => {
      try {
        const result = await auth.refresh(config, readRefreshCookie(req.cookies));
        if (result.refreshToken) setRefreshCookie(res, result.refreshToken, result.refreshExpiresAt);
        res.json({ accessToken: result.accessToken, expiresIn: result.expiresIn });
      } catch (err) {
        clearRefreshCookie(res);
        throw err;
      }
    }),
  );

  r.route(
    "post",
    "/auth/logout",
    "public",
    csrf,
    ah(async (req, res) => {
      await auth.revokeSessionByRefreshToken(readRefreshCookie(req.cookies));
      clearRefreshCookie(res);
      res.status(204).end();
    }),
  );

  r.route(
    "post",
    "/auth/logout-all",
    "self",
    ah(async (req, res) => {
      const { userId } = authOf(req);
      const result = await AuthSession.updateMany(
        { userId, revokedAt: null },
        { $set: { revokedAt: new Date(), revokedReason: "logout_all" } },
      );
      await auditFromRequest(req, "auth.logout_all", { type: "user", id: String(userId) }, { sessions: result.modifiedCount });
      clearRefreshCookie(res);
      res.status(204).end();
    }),
  );

  r.route(
    "post",
    "/auth/change-password",
    "self",
    validate("body", changePasswordBodySchema),
    ah(async (req, res) => {
      const { userId, sessionId } = authOf(req);
      const body = parsed<z.infer<typeof changePasswordBodySchema>>(req, "body");
      const user = await User.findById(userId);
      if (!user) throw AppError.unauthenticated();
      if (!(await verifyPassword(user.passwordHash, body.currentPassword))) {
        throw AppError.validation("Current password is incorrect", [{ path: "currentPassword", message: "Incorrect password" }]);
      }
      user.passwordHash = await hashPassword(body.newPassword);
      await user.save();
      // Keep the current device signed in; sign out every other one.
      await AuthSession.updateMany(
        { userId, _id: { $ne: sessionId }, revokedAt: null },
        { $set: { revokedAt: new Date(), revokedReason: "password_changed" } },
      );
      await auditFromRequest(req, "auth.change_password", { type: "user", id: String(userId) });
      res.json({ message: "Password updated. Other devices have been signed out." });
    }),
  );

  r.route(
    "get",
    "/auth/sessions",
    "self",
    ah(async (req, res) => {
      const { userId, sessionId } = authOf(req);
      const sessions = await AuthSession.find({ userId, revokedAt: null, expiresAt: { $gt: new Date() } })
        .sort({ lastSeenAt: -1 })
        .lean();
      res.json({
        items: sessions.map((s) => ({
          id: String(s._id),
          userAgent: s.userAgent,
          ip: s.ip,
          lastSeenAt: s.lastSeenAt,
          createdAt: s.createdAt,
          current: String(s._id) === String(sessionId),
        })),
      });
    }),
  );

  r.route(
    "delete",
    "/auth/sessions/:id",
    "self",
    validate("params", z.object({ id: objectIdSchema })),
    ah(async (req, res) => {
      const { userId } = authOf(req);
      const { id } = parsed<{ id: string }>(req, "params");
      const session = await AuthSession.findOneAndUpdate(
        { _id: id, userId, revokedAt: null },
        { $set: { revokedAt: new Date(), revokedReason: "revoked_by_user" } },
      );
      if (!session) throw AppError.notFound("Session");
      await auditFromRequest(req, "auth.session_revoke", { type: "session", id });
      res.status(204).end();
    }),
  );

  r.route(
    "get",
    "/me",
    "self",
    ah(async (req, res) => {
      const { userId, orgId, role } = authOf(req);
      const user = await User.findById(userId).lean();
      if (!user) throw AppError.unauthenticated();
      res.json({ user: auth.toUserResponse(user), orgs: await auth.listMyOrgs(userId), activeOrg: { id: String(orgId), role } });
    }),
  );

  r.route(
    "patch",
    "/me",
    "self",
    validate("body", updateMeBodySchema),
    ah(async (req, res) => {
      const { userId } = authOf(req);
      const body = parsed<z.infer<typeof updateMeBodySchema>>(req, "body");
      const set: Record<string, unknown> = {};
      if (body.name) set.name = body.name;
      for (const [k, v] of Object.entries(body.preferences ?? {})) if (v !== undefined) set[`preferences.${k}`] = v;
      const user = await User.findByIdAndUpdate(userId, { $set: set }, { new: true, runValidators: true }).lean();
      if (!user) throw AppError.unauthenticated();
      await auditFromRequest(req, "user.update_profile", { type: "user", id: String(userId) }, { fields: Object.keys(set) });
      res.json({ user: auth.toUserResponse(user) });
    }),
  );

  r.route(
    "get",
    "/me/export",
    "self",
    ah(async (req, res) => {
      const { userId } = authOf(req);
      const user = await User.findById(userId).select("-passwordHash").lean();
      const sessions = await AuthSession.find({ userId }).select("-refreshTokenHash -rotatedHashes").lean();
      res.json({ exportedAt: new Date().toISOString(), account: user, memberships: await auth.listMyOrgs(userId), sessions });
    }),
  );

  r.route(
    "delete",
    "/me",
    "self",
    ah(async (req, res) => {
      const { userId } = authOf(req);
      const memberships = await Membership.find({ userId }).lean();
      // Refuse if this would leave an org with members but no Owner.
      for (const m of memberships.filter((x) => x.role === "Owner")) {
        const [owners, members] = await Promise.all([
          Membership.countDocuments({ orgId: m.orgId, role: "Owner" }),
          Membership.countDocuments({ orgId: m.orgId }),
        ]);
        if (owners === 1 && members > 1) {
          throw AppError.conflict("You are the only Owner of an organisation with other members. Transfer ownership first.");
        }
      }
      // Orgs where this user is the only member are deleted with their data (the user's own workspace).
      for (const m of memberships) {
        if ((await Membership.countDocuments({ orgId: m.orgId })) === 1) {
          // Raw driver calls on purpose: the audit log is append-only through the API.
          for (const model of [...TENANT_MODELS, ...CONTEXT_MODELS, ValidationRun]) await model.collection.deleteMany({ orgId: m.orgId });
          await Org.deleteOne({ _id: m.orgId });
        } else {
          await AuditLog.create({
            orgId: m.orgId,
            actorId: userId,
            action: "member.account_deleted",
            target: { type: "user", id: String(userId) },
            ip: req.ip ?? "",
            requestId: req.id,
          });
        }
      }
      await Membership.deleteMany({ userId });
      await AuthSession.deleteMany({ userId });
      await User.deleteOne({ _id: new mongoose.Types.ObjectId(String(userId)) });
      clearRefreshCookie(res);
      res.status(204).end();
    }),
  );

  return r;
}
