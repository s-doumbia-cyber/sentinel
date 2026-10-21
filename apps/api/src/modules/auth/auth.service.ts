import { randomBytes } from "node:crypto";
import type { Request } from "express";
import mongoose, { type Types } from "mongoose";
import type { Role } from "@sentinel/shared";
import type { AppConfig } from "../../config/index.js";
import {
  hashPassword,
  isLegacyHash,
  newRefreshSecret,
  parseRefreshToken,
  safeEqualHex,
  sha256,
  signAccessToken,
  signMfaToken,
  verifyPassword,
} from "../../lib/crypto.js";
import { AppError } from "../../lib/errors.js";
import { AuthSession, Membership, Org, User, normalizeAccent, normalizeLanguage } from "../../models/identity.js";
import { writeAudit } from "../audit/audit.service.js";

/** Two tabs refreshing at the same moment must not be mistaken for token theft. */
const ROTATION_GRACE_MS = 10_000;
const MAX_ROTATED_HASHES = 50;

export interface IssuedTokens {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: Date;
}

interface UserLike {
  _id: Types.ObjectId;
  name: string;
  email: string;
  preferences?: {
    emailAlerts?: boolean | null;
    pushAlerts?: boolean | null;
    language?: string | null;
    accentColor?: string | null;
    theme?: string | null;
    density?: string | null;
  } | null;
  mfa?: { enabled?: boolean | null } | null;
}

export function toUserResponse(user: UserLike) {
  const prefs = user.preferences ?? {};
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    mfaEnabled: Boolean(user.mfa?.enabled),
    preferences: {
      emailAlerts: prefs.emailAlerts ?? true,
      pushAlerts: prefs.pushAlerts ?? true,
      language: normalizeLanguage(prefs.language),
      accentColor: normalizeAccent(prefs.accentColor),
      // Light is the default identity; dark only when explicitly chosen.
      theme: prefs.theme === "dark" || prefs.theme === "system" ? prefs.theme : "light",
      density: prefs.density === "compact" ? "compact" : "comfortable",
    },
  };
}

export async function listMyOrgs(userId: Types.ObjectId | string) {
  const memberships = await Membership.find({ userId }).sort({ createdAt: 1 }).lean();
  const orgs = await Org.find({ _id: { $in: memberships.map((m) => m.orgId) } }).lean();
  const byId = new Map(orgs.map((o) => [String(o._id), o]));
  return memberships.flatMap((m) => {
    const org = byId.get(String(m.orgId));
    return org ? [{ id: String(org._id), name: org.name, slug: org.slug, role: m.role as Role }] : [];
  });
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${base || "org"}-${randomBytes(3).toString("hex")}`;
}

export async function issueTokens(config: AppConfig, userId: Types.ObjectId, req: Request): Promise<IssuedTokens> {
  const secret = newRefreshSecret();
  const refreshExpiresAt = new Date(Date.now() + config.auth.refreshTtlDays * 86_400_000);
  const session = await AuthSession.create({
    userId,
    refreshTokenHash: sha256(secret),
    userAgent: (req.header("user-agent") ?? "").slice(0, 500),
    ip: req.ip ?? "",
    expiresAt: refreshExpiresAt,
  });
  return {
    accessToken: signAccessToken(
      { sub: String(userId), sid: String(session._id) },
      config.auth.accessSecret,
      config.auth.accessTtlSeconds,
    ),
    expiresIn: config.auth.accessTtlSeconds,
    refreshToken: `${String(session._id)}.${secret}`,
    refreshExpiresAt,
  };
}

export async function register(
  config: AppConfig,
  req: Request,
  input: { name: string; email: string; password: string; orgName?: string | undefined },
) {
  if (await User.exists({ email: input.email })) throw AppError.conflict("An account with this email already exists");
  const user = await User.create({ name: input.name, email: input.email, passwordHash: await hashPassword(input.password) });
  const org = await Org.create({ name: input.orgName ?? `${input.name}'s workspace`, slug: slugify(input.orgName ?? input.name) });
  await Membership.create({ orgId: org._id, userId: user._id, role: "Owner" });
  await writeAudit(req, { orgId: org._id, actorId: user._id, action: "auth.register", target: { type: "user", id: String(user._id) } });
  const tokens = await issueTokens(config, user._id, req);
  return { user, tokens };
}

let dummyHash: Promise<string> | null = null;

/**
 * Password step of sign-in. With MFA on, it returns a 5-minute challenge token
 * instead of a session; `finishLogin` runs once the second factor is verified.
 */
export async function login(config: AppConfig, req: Request, input: { email: string; password: string }) {
  const user = await User.findOne({ email: input.email });
  if (!user) {
    // Same work and same message for an unknown email as for a wrong password (no account enumeration by timing).
    dummyHash ??= hashPassword(randomBytes(16).toString("hex"));
    await verifyPassword(await dummyHash, input.password);
    throw AppError.unauthenticated("Invalid email or password");
  }
  if (!(await verifyPassword(user.passwordHash, input.password))) throw AppError.unauthenticated("Invalid email or password");
  if (isLegacyHash(user.passwordHash)) {
    // Transparent upgrade of bcrypt hashes from the legacy backend to argon2id.
    user.passwordHash = await hashPassword(input.password);
    await user.save();
  }
  if (user.mfa?.enabled) {
    return { mfaRequired: true as const, mfaToken: signMfaToken(String(user._id), config.auth.accessSecret), user };
  }
  return { mfaRequired: false as const, ...(await finishLogin(config, req, user._id, { factor: "password" })) };
}

/** Issues the session and records the sign-in, after every required factor passed. */
export async function finishLogin(config: AppConfig, req: Request, userId: Types.ObjectId, meta: Record<string, unknown>) {
  const user = await User.findById(userId).lean();
  if (!user) throw AppError.unauthenticated();
  const orgs = await listMyOrgs(user._id);
  const firstOrg = orgs[0];
  if (firstOrg) {
    await writeAudit(req, {
      orgId: new mongoose.Types.ObjectId(firstOrg.id),
      actorId: user._id,
      action: "auth.login",
      target: { type: "user", id: String(user._id) },
      meta,
    });
  }
  const tokens = await issueTokens(config, user._id, req);
  return { user, orgs, tokens };
}

/**
 * Rotates the refresh token. Presenting a token that was already rotated out
 * (outside the short grace window) revokes the whole session: either the
 * legitimate client or an attacker holds a stolen copy.
 */
export async function refresh(config: AppConfig, token: string | undefined) {
  const parsed = parseRefreshToken(token);
  if (!parsed) throw AppError.unauthenticated("Missing or malformed refresh token");
  const session = await AuthSession.findById(parsed.sessionId);
  if (!session || session.revokedAt || session.expiresAt <= new Date()) {
    throw AppError.unauthenticated("Session has ended. Please sign in again.");
  }
  const presented = sha256(parsed.secret);
  const accessFor = () =>
    signAccessToken({ sub: String(session.userId), sid: String(session._id) }, config.auth.accessSecret, config.auth.accessTtlSeconds);

  if (safeEqualHex(presented, session.refreshTokenHash)) {
    const secret = newRefreshSecret();
    const rotated = await AuthSession.findOneAndUpdate(
      { _id: session._id, refreshTokenHash: session.refreshTokenHash, revokedAt: null },
      {
        $set: { refreshTokenHash: sha256(secret), lastRotatedAt: new Date(), lastSeenAt: new Date() },
        $push: { rotatedHashes: { $each: [presented], $slice: -MAX_ROTATED_HASHES } },
      },
      { new: true },
    );
    if (!rotated) throw AppError.unauthenticated("Session changed concurrently; please retry");
    return {
      accessToken: accessFor(),
      expiresIn: config.auth.accessTtlSeconds,
      refreshToken: `${String(session._id)}.${secret}`,
      refreshExpiresAt: session.expiresAt,
    };
  }

  const lastRotated = session.rotatedHashes.at(-1);
  const withinGrace =
    lastRotated !== undefined &&
    safeEqualHex(presented, lastRotated) &&
    session.lastRotatedAt instanceof Date &&
    Date.now() - session.lastRotatedAt.getTime() < ROTATION_GRACE_MS;
  if (withinGrace) {
    // The concurrent request already received the new cookie; only mint an access token.
    return { accessToken: accessFor(), expiresIn: config.auth.accessTtlSeconds, refreshToken: null, refreshExpiresAt: session.expiresAt };
  }

  if (session.rotatedHashes.some((h) => safeEqualHex(presented, h))) {
    session.revokedAt = new Date();
    session.revokedReason = "refresh_token_reuse";
    await session.save();
    throw new AppError("REFRESH_REUSE_DETECTED", 401, "Refresh token reuse detected; the session was revoked");
  }
  throw AppError.unauthenticated("Invalid refresh token");
}

export async function revokeSessionByRefreshToken(token: string | undefined): Promise<void> {
  const parsed = parseRefreshToken(token);
  if (!parsed) return;
  const session = await AuthSession.findById(parsed.sessionId);
  if (session && !session.revokedAt && safeEqualHex(sha256(parsed.secret), session.refreshTokenHash)) {
    session.revokedAt = new Date();
    session.revokedReason = "logout";
    await session.save();
  }
}
