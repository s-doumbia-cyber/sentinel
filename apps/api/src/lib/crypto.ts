import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import argon2 from "argon2";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

// OWASP Password Storage Cheat Sheet minimum for argon2id.
const ARGON2_OPTIONS = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, ARGON2_OPTIONS);
}

export function isLegacyHash(hash: string): boolean {
  return /^\$2[aby]\$/.test(hash);
}

/** Verifies argon2id hashes, and bcrypt hashes created by the legacy JavaScript backend. */
export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    if (isLegacyHash(hash)) return await bcrypt.compare(plain, hash);
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Opaque refresh token: `<sessionId>.<random secret>`. Only the secret's hash is stored. */
export function newRefreshSecret(): string {
  return randomBytes(32).toString("base64url");
}

export function parseRefreshToken(token: string | undefined): { sessionId: string; secret: string } | null {
  if (!token) return null;
  const match = /^([a-f0-9]{24})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!match?.[1] || !match[2]) return null;
  return { sessionId: match[1], secret: match[2] };
}

export interface AccessClaims {
  sub: string;
  sid: string;
}

export function signAccessToken(claims: AccessClaims, secret: string, ttlSeconds: number): string {
  return jwt.sign({ ...claims, typ: "access" }, secret, { algorithm: "HS256", expiresIn: ttlSeconds });
}

/** Short-lived proof that the password was right, exchanged for tokens once the second factor checks out. */
export function signMfaToken(userId: string, secret: string, ttlSeconds = 300): string {
  return jwt.sign({ sub: userId, typ: "mfa" }, secret, { algorithm: "HS256", expiresIn: ttlSeconds });
}

export function verifyMfaToken(token: string, secret: string): string | null {
  try {
    const payload = jwt.verify(token, secret, { algorithms: ["HS256"] });
    if (typeof payload !== "object" || payload === null) return null;
    const { sub, typ } = payload as Record<string, unknown>;
    return typ === "mfa" && typeof sub === "string" ? sub : null;
  } catch {
    return null;
  }
}

export function verifyAccessToken(token: string, secret: string): AccessClaims | null {
  try {
    const payload = jwt.verify(token, secret, { algorithms: ["HS256"] });
    if (typeof payload !== "object" || payload === null) return null;
    const { sub, sid, typ } = payload as Record<string, unknown>;
    if (typ !== "access" || typeof sub !== "string" || typeof sid !== "string") return null;
    return { sub, sid };
  } catch {
    return null;
  }
}
