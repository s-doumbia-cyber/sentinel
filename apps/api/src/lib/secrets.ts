import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/**
 * AES-256-GCM for small secrets kept at rest (TOTP seeds). The key is derived with
 * HKDF from ENCRYPTION_KEY (or, when unset, JWT_ACCESS_SECRET, with a startup warning:
 * rotating that secret then makes enrolled authenticators unreadable).
 * Format: `v1.<iv>.<tag>.<ciphertext>` (base64url), so the scheme can change later.
 */
export class SecretBox {
  private readonly key: Buffer;

  constructor(material: string) {
    this.key = Buffer.from(hkdfSync("sha256", material, "sentinel-secret-box", "at-rest-v1", 32));
  }

  seal(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ct = Buffer.concat([cipher.update(plain, "utf-8"), cipher.final()]);
    return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
  }

  open(sealed: string): string {
    const [version, iv, tag, ct] = sealed.split(".");
    if (version !== "v1" || !iv || !tag || !ct) throw new Error("Unsupported secret format");
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf-8");
  }
}
