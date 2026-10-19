import { objectIdSchema, updateMemberRoleBodySchema, type Role } from "@sentinel/shared";
import { z } from "zod";
import type { AppConfig } from "../../config/index.js";
import { AppError } from "../../lib/errors.js";
import { ah, authOf, parsed, validate } from "../../lib/http.js";
import { PolicyRouter } from "../../lib/routes.js";
import { Membership, User } from "../../models/identity.js";
import { auditFromRequest } from "../audit/audit.service.js";

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
        if (owners <= 1) throw AppError.conflict("An organisation must keep at least one Owner");
      }
      const previous = target.role;
      target.role = role;
      await target.save();
      await auditFromRequest(req, "member.role_change", { type: "user", id: userId }, { from: previous, to: role });
      res.json({ userId, role });
    }),
  );

  return r;
}
