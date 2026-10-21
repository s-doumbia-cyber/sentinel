import type { Types } from "mongoose";
import { objectIdSchema, updateMemberRoleBodySchema, type Role } from "@sentinel/shared";
import { z } from "zod";
import type { AppConfig } from "../../config/index.js";
import { AppError } from "../../lib/errors.js";
import { ah, authOf, parsed, validate } from "../../lib/http.js";
import { PolicyRouter } from "../../lib/routes.js";
import { Membership, User, type MembershipDoc } from "../../models/identity.js";
import { auditFromRequest } from "../audit/audit.service.js";

const LAST_OWNER = "An organisation must keep at least one Owner";

/**
 * Two Owners demoting or removing each other at the same moment could both pass a
 * count-then-act check. Re-counting after the change and undoing it closes that gap.
 */
async function ensureAnOwnerRemains(orgId: Types.ObjectId, undo: () => Promise<unknown>): Promise<void> {
  if ((await Membership.countDocuments({ orgId, role: "Owner" })) > 0) return;
  await undo();
  throw AppError.conflict(LAST_OWNER);
}

export function memberRoutes(config: AppConfig): PolicyRouter {
  const r = new PolicyRouter(config);

  r.route(
    "get",
    "/members",
    "members:read",
    ah(async (req, res) => {
      const { orgId } = authOf(req);
      const memberships = await Membership.find({ orgId }).sort({ createdAt: 1 }).lean();
      const users = await User.find({ _id: { $in: memberships.map((m) => m.userId) } })
        .select("name email createdAt")
        .lean();
      const byId = new Map(users.map((u) => [String(u._id), u]));
      res.json({
        items: memberships.flatMap((m) => {
          const u = byId.get(String(m.userId));
          return u ? [{ userId: String(u._id), name: u.name, email: u.email, role: m.role, joinedAt: m.createdAt }] : [];
        }),
      });
    }),
  );

  // Registered before /members/:userId so "leave" is never read as a user id.
  r.route(
    "post",
    "/members/leave",
    "self",
    ah(async (req, res) => {
      const ctx = authOf(req);
      const mine = await Membership.findOne({ orgId: ctx.orgId, userId: ctx.userId }).lean<MembershipDoc>();
      if (!mine) throw AppError.notFound("Member");
      if (mine.role === "Owner" && (await Membership.countDocuments({ orgId: ctx.orgId, role: "Owner" })) <= 1) {
        throw AppError.conflict("You are the only Owner. Make another member Owner before leaving.");
      }
      // Audit first: once the membership is gone the request no longer belongs to this org.
      await auditFromRequest(req, "member.leave", { type: "user", id: String(ctx.userId) }, { role: mine.role });
      await Membership.deleteOne({ orgId: ctx.orgId, userId: ctx.userId });
      await ensureAnOwnerRemains(ctx.orgId, () => Membership.create({ orgId: ctx.orgId, userId: ctx.userId, role: mine.role }));
      res.status(204).end();
    }),
  );

  r.route(
    "patch",
    "/members/:userId",
    "members:manage",
    validate("params", z.object({ userId: objectIdSchema })),
    validate("body", updateMemberRoleBodySchema),
    ah(async (req, res) => {
      const ctx = authOf(req);
      const { userId } = parsed<{ userId: string }>(req, "params");
      const { role } = parsed<{ role: Role }>(req, "body");
      const target = await Membership.findOne({ orgId: ctx.orgId, userId });
      if (!target) throw AppError.notFound("Member");
      // Only an Owner may grant or remove the Owner role.
      if ((role === "Owner" || target.role === "Owner") && ctx.role !== "Owner") {
        throw AppError.forbidden("Only an Owner can change Owner roles");
      }
      if (target.role === "Owner" && role !== "Owner") {
        const owners = await Membership.countDocuments({ orgId: ctx.orgId, role: "Owner" });
        if (owners <= 1) throw AppError.conflict(LAST_OWNER);
      }
      const previous = target.role as Role;
      if (previous === role) {
        res.json({ userId, role });
        return;
      }
      target.role = role;
      await target.save();
      await ensureAnOwnerRemains(ctx.orgId, () => Membership.updateOne({ orgId: ctx.orgId, userId }, { $set: { role: previous } }));
      await auditFromRequest(req, "member.role_change", { type: "user", id: userId }, { from: previous, to: role });
      res.json({ userId, role });
    }),
  );

  r.route(
    "delete",
    "/members/:userId",
    "members:manage",
    validate("params", z.object({ userId: objectIdSchema })),
    ah(async (req, res) => {
      const ctx = authOf(req);
      const { userId } = parsed<{ userId: string }>(req, "params");
      if (userId === String(ctx.userId)) throw AppError.validation("Use “Leave organisation” to remove yourself");
      const target = await Membership.findOne({ orgId: ctx.orgId, userId }).lean<MembershipDoc>();
      if (!target) throw AppError.notFound("Member");
      if (target.role === "Owner" && ctx.role !== "Owner") throw AppError.forbidden("Only an Owner can remove an Owner");
      if (target.role === "Owner" && (await Membership.countDocuments({ orgId: ctx.orgId, role: "Owner" })) <= 1) {
        throw AppError.conflict(LAST_OWNER);
      }
      await Membership.deleteOne({ orgId: ctx.orgId, userId });
      await ensureAnOwnerRemains(ctx.orgId, () => Membership.create({ orgId: ctx.orgId, userId, role: target.role }));
      // Access ends on the next request: every request re-checks the membership. The account itself stays.
      await auditFromRequest(req, "member.remove", { type: "user", id: userId }, { role: target.role });
      res.status(204).end();
    }),
  );

  return r;
}
