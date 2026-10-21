import { randomBytes } from "node:crypto";
import rateLimit from "express-rate-limit";
import mongoose, { type Types } from "mongoose";
import {
  acceptInviteNewAccountBodySchema,
  createInviteBodySchema,
  inviteTokenBodySchema,
  objectIdSchema,
  type CreateInviteBody,
  type InviteStatus,
  type Role,
} from "@sentinel/shared";
import { z } from "zod";
import type { AppConfig } from "../../config/index.js";
import { hashPassword, sha256 } from "../../lib/crypto.js";
import { AppError } from "../../lib/errors.js";
import { accountOf, ah, authOf, parsed, validate } from "../../lib/http.js";
import { PolicyRouter } from "../../lib/routes.js";
import { Membership, Org, User } from "../../models/identity.js";
import { Invite, type InviteDoc } from "../../models/invites.js";
import { auditFromRequest, writeAudit } from "../audit/audit.service.js";
import { setRefreshCookie } from "../auth/auth.routes.js";
import { issueTokens, listMyOrgs, toUserResponse } from "../auth/auth.service.js";

/** Same answer for unknown, used, revoked and expired links: a token holder learns nothing more. */
const INVALID = () => AppError.notFound("Invitation");

export function inviteStatus(i: Pick<InviteDoc, "acceptedAt" | "revokedAt" | "expiresAt">, now = new Date()): InviteStatus {
  if (i.acceptedAt) return "accepted";
  if (i.revokedAt) return "revoked";
  return i.expiresAt <= now ? "expired" : "pending";
}

function usable(tokenHash: string) {
  return { tokenHash, acceptedAt: null, revokedAt: null, expiresAt: { $gt: new Date() } };
}

/**
 * Marks the invitation used before anything is created, so two concurrent accepts
 * cannot both succeed. `undo` puts it back when the account step fails.
 */
async function claimInvite(token: string, userId: Types.ObjectId | null) {
  const invite = await Invite.findOneAndUpdate(usable(sha256(token)), { $set: { acceptedAt: new Date(), acceptedBy: userId } }, { new: true }).lean<InviteDoc>();
  if (!invite) throw INVALID();
  return {
    invite,
    undo: () => Invite.updateOne({ _id: invite._id }, { $set: { acceptedAt: null, acceptedBy: null } }),
  };
}

export interface InviteRouteOptions {
  /** Requests per window on the public invitation endpoints (lowered in tests). */
  rateLimit: { windowMs: number; max: number };
}

export function inviteRoutes(config: AppConfig, options: InviteRouteOptions): PolicyRouter {
  const r = new PolicyRouter(config);
  const limiter = rateLimit({
    windowMs: options.rateLimit.windowMs,
    limit: options.rateLimit.max,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler: (req, res) => {
      res.status(429).json({ error: { code: "RATE_LIMITED", message: "Too many attempts. Try again later.", requestId: req.id } });
    },
  });

  r.route(
    "get",
    "/invites",
    "members:manage",
    ah(async (req, res) => {
      const { orgId } = authOf(req);
      const invites = await Invite.find({ orgId }).sort({ createdAt: -1 }).limit(100).lean<InviteDoc[]>();
      const people = await User.find({ _id: { $in: invites.map((i) => i.createdBy) } }).select("name").lean();
      const names = new Map(people.map((u) => [String(u._id), u.name]));
      const now = new Date();
      res.json({
        items: invites.map((i) => ({
          id: String(i._id),
          email: i.email,
          role: i.role,
          status: inviteStatus(i, now),
          expiresAt: i.expiresAt,
          createdAt: i.createdAt,
          createdBy: names.get(String(i.createdBy)) ?? "Former member",
          acceptedAt: i.acceptedAt ?? null,
          revokedAt: i.revokedAt ?? null,
        })),
      });
    }),
  );

  r.route(
    "post",
    "/invites",
    "members:manage",
    validate("body", createInviteBodySchema),
    ah(async (req, res) => {
      const ctx = authOf(req);
      const body = parsed<CreateInviteBody>(req, "body");
      // Mirrors role changes: only an Owner can hand out the Owner role.
      if (body.role === "Owner" && ctx.role !== "Owner") throw AppError.forbidden("Only an Owner can invite an Owner");
      const existing = await User.findOne({ email: body.email }).select("_id").lean();
      if (existing && (await Membership.exists({ orgId: ctx.orgId, userId: existing._id }))) {
        throw AppError.conflict("This person is already a member of the organisation");
      }
      if (await Invite.exists({ orgId: ctx.orgId, email: body.email, acceptedAt: null, revokedAt: null, expiresAt: { $gt: new Date() } })) {
        throw AppError.conflict("A pending invitation already exists for this email; revoke it to send a new one");
      }
      const token = randomBytes(32).toString("base64url");
      const invite = await Invite.create({
        orgId: ctx.orgId,
        email: body.email,
        role: body.role,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + body.expiresInDays * 86_400_000),
        createdBy: ctx.userId,
      });
      await auditFromRequest(req, "invite.create", { type: "invite", id: String(invite._id) }, {
        email: body.email,
        role: body.role,
        expiresAt: invite.expiresAt.toISOString(),
      });
      // The token is returned once; only its hash is stored.
      res.status(201).json({ id: String(invite._id), email: invite.email, role: invite.role, expiresAt: invite.expiresAt, token });
    }),
  );

  r.route(
    "delete",
    "/invites/:id",
    "members:manage",
    validate("params", z.object({ id: objectIdSchema })),
    ah(async (req, res) => {
      const ctx = authOf(req);
      const { id } = parsed<{ id: string }>(req, "params");
      const invite = await Invite.findOne({ orgId: ctx.orgId, _id: id }).lean<InviteDoc>();
      if (!invite) throw AppError.notFound("Invitation");
      if (invite.role === "Owner" && ctx.role !== "Owner") throw AppError.forbidden("Only an Owner can revoke an Owner invitation");
      const revoked = await Invite.findOneAndUpdate(
        { orgId: ctx.orgId, _id: id, acceptedAt: null, revokedAt: null },
        { $set: { revokedAt: new Date(), revokedBy: ctx.userId } },
      );
      if (!revoked) throw AppError.conflict("This invitation was already accepted or revoked");
      await auditFromRequest(req, "invite.revoke", { type: "invite", id }, { email: invite.email, role: invite.role });
      res.status(204).end();
    }),
  );

  r.route(
    "post",
    "/invites/lookup",
    "public",
    limiter,
    validate("body", inviteTokenBodySchema),
    ah(async (req, res) => {
      const { token } = parsed<{ token: string }>(req, "body");
      const invite = await Invite.findOne(usable(sha256(token))).lean<InviteDoc>();
      if (!invite) throw INVALID();
      const org = await Org.findById(invite.orgId).select("name").lean();
      if (!org) throw INVALID();
      res.json({
        orgName: org.name,
        role: invite.role,
        email: invite.email,
        expiresAt: invite.expiresAt,
        accountExists: Boolean(await User.exists({ email: invite.email })),
      });
    }),
  );

  // New account: the email comes from the invitation, never from the request.
  r.route(
    "post",
    "/invites/accept",
    "public",
    limiter,
    validate("body", acceptInviteNewAccountBodySchema),
    ah(async (req, res) => {
      const body = parsed<z.infer<typeof acceptInviteNewAccountBodySchema>>(req, "body");
      const preview = await Invite.findOne(usable(sha256(body.token))).select("email").lean<InviteDoc>();
      if (!preview) throw INVALID();
      if (await User.exists({ email: preview.email })) {
        throw AppError.conflict("An account already exists for this email. Sign in, then open the invitation link again.");
      }
      const passwordHash = await hashPassword(body.password);
      const { invite, undo } = await claimInvite(body.token, null);
      let userId: Types.ObjectId;
      try {
        const user = await User.create({ name: body.name, email: invite.email, passwordHash });
        userId = user._id;
        await Membership.create({ orgId: invite.orgId, userId, role: invite.role });
      } catch (err) {
        await undo();
        throw err;
      }
      await Invite.updateOne({ _id: invite._id }, { $set: { acceptedBy: userId } });
      await writeAudit(req, {
        orgId: invite.orgId,
        actorId: userId,
        action: "invite.accept",
        target: { type: "invite", id: String(invite._id) },
        meta: { role: invite.role, newAccount: true },
      });
      const user = await User.findById(userId).lean();
      if (!user) throw AppError.unauthenticated();
      const tokens = await issueTokens(config, userId, req);
      setRefreshCookie(res, tokens.refreshToken, tokens.refreshExpiresAt);
      res.status(201).json({
        accessToken: tokens.accessToken,
        expiresIn: tokens.expiresIn,
        user: toUserResponse(user),
        orgs: await listMyOrgs(userId),
        joinedOrgId: String(invite.orgId),
      });
    }),
  );

  // Existing account, signed in: the invitation must have been sent to this account's email.
  r.route(
    "post",
    "/invites/accept-existing",
    "account",
    validate("body", inviteTokenBodySchema),
    ah(async (req, res) => {
      const { userId } = accountOf(req);
      const { token } = parsed<{ token: string }>(req, "body");
      const user = await User.findById(userId).select("email").lean();
      if (!user) throw AppError.unauthenticated();
      const preview = await Invite.findOne(usable(sha256(token))).select("email orgId").lean<InviteDoc>();
      if (!preview) throw INVALID();
      if (preview.email !== user.email) throw AppError.forbidden("This invitation was sent to another email address");
      if (await Membership.exists({ orgId: preview.orgId, userId })) throw AppError.conflict("You are already a member of this organisation");
      const { invite, undo } = await claimInvite(token, userId);
      try {
        await Membership.create({ orgId: invite.orgId, userId, role: invite.role as Role });
      } catch (err) {
        await undo();
        throw err;
      }
      await writeAudit(req, {
        orgId: invite.orgId,
        actorId: new mongoose.Types.ObjectId(String(userId)),
        action: "invite.accept",
        target: { type: "invite", id: String(invite._id) },
        meta: { role: invite.role, newAccount: false },
      });
      res.json({ orgs: await listMyOrgs(userId), joinedOrgId: String(invite.orgId) });
    }),
  );

  return r;
}
