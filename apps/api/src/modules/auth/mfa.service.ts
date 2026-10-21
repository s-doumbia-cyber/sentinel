import { randomBytes } from "node:crypto";
import type { Types } from "mongoose";
import { generateSecret, generateURI, verify } from "otplib";
import QRCode from "qrcode";
import { sha256 } from "../../lib/crypto.js";
import { AppError } from "../../lib/errors.js";
import type { SecretBox } from "../../lib/secrets.js";
import { User } from "../../models/identity.js";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const RECOVERY_CODE_COUNT = 10;
/** An enrolment not confirmed within this time must start again. */
const PENDING_TTL_MS = 15 * 60 * 1000;
/** Codes from the previous or next 30 s step are accepted (clock drift). */
const EPOCH_TOLERANCE_S = 30;
export const MFA_MAX_FAILURES = 5;
export const MFA_LOCK_MS = 15 * 60 * 1000;

/** "ABCDE-FGHIJ": 50 bits of entropy each, enough for a hash without a slow KDF. */
export function newRecoveryCodes(): string[] {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const bytes = randomBytes(10);
    const chars = [...bytes].map((b) => BASE32[b & 31]).join("");
    return `${chars.slice(0, 5)}-${chars.slice(5)}`;
  });
}

export function hashRecoveryCode(code: string): string {
  return sha256(`sentinel-recovery:${code.toUpperCase().replace(/[\s-]/g, "")}`);
}

export type MfaFactor = "totp" | "recovery";

export class MfaService {
  constructor(
    private readonly box: SecretBox,
    private readonly issuer = "Sentinel",
  ) {}

  /** Stores a new pending seed (sealed) and returns what the authenticator app needs. */
  async beginSetup(userId: Types.ObjectId, email: string) {
    const secret = generateSecret();
    await User.updateOne({ _id: userId }, { $set: { "mfa.pendingSecretEnc": this.box.seal(secret), "mfa.pendingCreatedAt": new Date() } });
    const otpauthUri = generateURI({ issuer: this.issuer, label: email, secret });
    return { secret, otpauthUri, qrDataUrl: await QRCode.toDataURL(otpauthUri, { errorCorrectionLevel: "M", margin: 1, width: 220 }) };
  }

  /**
   * Accepts a TOTP code once: the time step is stored with a compare-and-set, so the
   * same code (or an older one) is refused even when two requests race.
   */
  private async consumeTotp(userId: Types.ObjectId, sealed: string, lastTimeStep: number, code: string): Promise<boolean> {
    const result = await verify({ secret: this.box.open(sealed), token: code, epochTolerance: EPOCH_TOLERANCE_S, afterTimeStep: lastTimeStep });
    // The union also covers HOTP results; only TOTP ones carry a time step.
    if (!result.valid || !("timeStep" in result)) return false;
    const stored = await User.updateOne(
      { _id: userId, "mfa.lastTimeStep": { $lt: result.timeStep } },
      { $set: { "mfa.lastTimeStep": result.timeStep } },
    );
    return stored.modifiedCount === 1;
  }

  /** Confirms enrolment with a first code; returns the recovery codes (shown once). */
  async enable(userId: Types.ObjectId, code: string): Promise<string[]> {
    const user = await User.findById(userId).select("mfa").lean();
    if (!user) throw AppError.unauthenticated();
    if (user.mfa?.enabled) throw AppError.conflict("Two-factor authentication is already on");
    const pending = user.mfa?.pendingSecretEnc;
    const startedAt = user.mfa?.pendingCreatedAt;
    if (!pending || !startedAt || Date.now() - startedAt.getTime() > PENDING_TTL_MS) {
      throw AppError.conflict("Start the set-up again: the QR code expired after 15 minutes");
    }
    if (!(await this.consumeTotp(userId, pending, user.mfa?.lastTimeStep ?? 0, code))) {
      throw AppError.validation("That code is not valid. Check the time on your phone and try the next code.", [{ path: "code", message: "Invalid code" }]);
    }
    const codes = newRecoveryCodes();
    await User.updateOne(
      { _id: userId },
      {
        $set: {
          "mfa.enabled": true,
          "mfa.secretEnc": pending,
          "mfa.enabledAt": new Date(),
          "mfa.pendingSecretEnc": null,
          "mfa.pendingCreatedAt": null,
          "mfa.recoveryCodeHashes": codes.map(hashRecoveryCode),
          "mfa.failedAttempts": 0,
          "mfa.lockedUntil": null,
        },
      },
    );
    return codes;
  }

  async disable(userId: Types.ObjectId): Promise<void> {
    await User.updateOne(
      { _id: userId },
      {
        $set: {
          "mfa.enabled": false,
          "mfa.secretEnc": null,
          "mfa.enabledAt": null,
          "mfa.pendingSecretEnc": null,
          "mfa.pendingCreatedAt": null,
          "mfa.recoveryCodeHashes": [],
          "mfa.failedAttempts": 0,
          "mfa.lockedUntil": null,
        },
      },
    );
  }

  async regenerateRecoveryCodes(userId: Types.ObjectId): Promise<string[]> {
    const codes = newRecoveryCodes();
    const res = await User.updateOne({ _id: userId, "mfa.enabled": true }, { $set: { "mfa.recoveryCodeHashes": codes.map(hashRecoveryCode) } });
    if (!res.matchedCount) throw AppError.conflict("Two-factor authentication is off");
    return codes;
  }

  /**
   * Second step of sign-in. Five wrong answers lock the factor for 15 minutes,
   * per account and across processes (the lock is stored on the user).
   */
  async verifySignIn(userId: Types.ObjectId, input: { code?: string | undefined; recoveryCode?: string | undefined }): Promise<{ factor: MfaFactor; recoveryCodesLeft: number }> {
    const user = await User.findById(userId).select("mfa").lean();
    if (!user?.mfa?.enabled || !user.mfa.secretEnc) throw AppError.unauthenticated("Sign in again");
    if (user.mfa.lockedUntil && user.mfa.lockedUntil > new Date()) {
      throw new AppError("RATE_LIMITED", 429, "Too many wrong codes. Try again in 15 minutes.");
    }
    let factor: MfaFactor | null = null;
    if (input.code && (await this.consumeTotp(userId, user.mfa.secretEnc, user.mfa.lastTimeStep ?? 0, input.code))) factor = "totp";
    if (input.recoveryCode) {
      // $pull removes the code atomically: a recovery code works once, even under concurrency.
      const used = await User.updateOne({ _id: userId, "mfa.recoveryCodeHashes": hashRecoveryCode(input.recoveryCode) }, { $pull: { "mfa.recoveryCodeHashes": hashRecoveryCode(input.recoveryCode) } });
      if (used.modifiedCount === 1) factor = "recovery";
    }
    if (!factor) {
      const failed = await User.findOneAndUpdate({ _id: userId }, { $inc: { "mfa.failedAttempts": 1 } }, { new: true }).select("mfa.failedAttempts").lean();
      if ((failed?.mfa?.failedAttempts ?? 0) >= MFA_MAX_FAILURES) {
        await User.updateOne({ _id: userId }, { $set: { "mfa.lockedUntil": new Date(Date.now() + MFA_LOCK_MS), "mfa.failedAttempts": 0 } });
      }
      throw AppError.unauthenticated("Invalid code");
    }
    const after = await User.findOneAndUpdate({ _id: userId }, { $set: { "mfa.failedAttempts": 0, "mfa.lockedUntil": null } }, { new: true })
      .select("mfa.recoveryCodeHashes")
      .lean();
    return { factor, recoveryCodesLeft: after?.mfa?.recoveryCodeHashes?.length ?? 0 };
  }
}
