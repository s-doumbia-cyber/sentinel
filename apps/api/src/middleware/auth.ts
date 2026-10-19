import type { Request, RequestHandler } from "express";
import mongoose from "mongoose";
import { can, type Action, type Role } from "@sentinel/shared";
import type { AppConfig } from "../config/index.js";
import { verifyAccessToken } from "../lib/crypto.js";
import { AppError } from "../lib/errors.js";
import { ah, authOf } from "../lib/http.js";
import { AuthSession, Membership } from "../models/identity.js";

const { isValidObjectId, Types } = mongoose;

/**
 * Verifies the in-memory access token (Authorization: Bearer) and resolves the
 * active org from `X-Org-Id`, validated against the caller's memberships.
 * Without the header, the caller's oldest membership is used.
 */
export function requireAuth(config: AppConfig): RequestHandler {
  return ah(async (req, _res, next) => {
    const header = req.header("authorization");
    if (!header?.startsWith("Bearer ")) throw AppError.unauthenticated();
    const claims = verifyAccessToken(header.slice(7), config.auth.accessSecret);
    if (!claims || !isValidObjectId(claims.sub) || !isValidObjectId(claims.sid)) {
      throw AppError.unauthenticated("Invalid or expired access token");
    }

    // A revoked session invalidates its access tokens immediately, not after 15 minutes.
    const session = await AuthSession.findOne({
      _id: claims.sid,
      userId: claims.sub,
      revokedAt: null,
      expiresAt: { $gt: new Date() },
    }).lean();
    if (!session) throw AppError.unauthenticated("Session has ended. Please sign in again.");

    const requestedOrg = req.header("x-org-id");
    if (requestedOrg !== undefined && !isValidObjectId(requestedOrg)) throw AppError.validation("Invalid X-Org-Id header");
    const membership = requestedOrg
      ? await Membership.findOne({ userId: claims.sub, orgId: requestedOrg }).lean()
      : await Membership.findOne({ userId: claims.sub }).sort({ createdAt: 1 }).lean();
    if (!membership) {
      // Same answer whether the org exists or not.
      throw requestedOrg ? AppError.notFound("Organisation") : AppError.forbidden("You are not a member of any organisation");
    }

    req.auth = {
      userId: new Types.ObjectId(claims.sub),
      sessionId: new Types.ObjectId(claims.sid),
      orgId: membership.orgId,
      role: membership.role as Role,
    };
    next();
  });
}

/** The single policy check every protected route declares (docs/ARCHITECTURE.md §7). */
export function authorize(action: Action): RequestHandler {
  return (req, _res, next) => {
    const { role } = authOf(req);
    if (!can(role, action)) return next(AppError.forbidden());
    next();
  };
}

/**
 * Cookie-authenticated endpoints (refresh, logout) need CSRF protection on top
 * of SameSite=Strict: a custom header cannot be sent cross-origin without a
 * CORS preflight, which the allow-list rejects.
 */
export function requireCsrfHeader(config: AppConfig): RequestHandler {
  return (req: Request, _res, next) => {
    if (req.header("x-sentinel-csrf") !== "1") {
      return next(new AppError("CSRF_FAILED", 403, "Missing CSRF header"));
    }
    const origin = req.header("origin");
    if (origin && !config.corsOrigins.includes(origin)) {
      return next(new AppError("CSRF_FAILED", 403, "Origin not allowed"));
    }
    next();
  };
}
