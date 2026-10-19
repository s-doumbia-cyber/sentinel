import jwt from "jsonwebtoken";
import crypto from "crypto";

// Every token carries a unique `jti` (matched against a Session document —
// see models/Session.js) and the user's current `tokenVersion`, which
// together are what make individual and "everywhere" logout actually work
// against normally-stateless JWTs.
export function generateToken(userId, tokenVersion = 0) {
  const jti = crypto.randomUUID();
  const token = jwt.sign({ sub: userId, tokenVersion, jti }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  });
  return { token, jti };
}
