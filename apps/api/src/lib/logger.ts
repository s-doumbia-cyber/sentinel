import pino, { type Logger } from "pino";

/**
 * Structured JSON logger. Redaction is a second line of defence: code must
 * still never pass secrets, tokens or full API keys to the logger.
 */
export function createLogger(level: string): Logger {
  return pino({
    level,
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "res.headers['set-cookie']",
        "*.password",
        "*.passwordHash",
        "*.token",
        "*.accessToken",
        "*.refreshToken",
        "*.mfaToken",
        "*.secret",
        "*.recoveryCode",
        "*.recoveryCodes",
        "*.secretEnc",
        "*.pendingSecretEnc",
      ],
      censor: "[redacted]",
    },
  });
}

export type { Logger };
