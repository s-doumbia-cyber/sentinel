import jwt from "jsonwebtoken";
import { User } from "../models/User.js";
import { Session } from "../models/Session.js";

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Missing or malformed Authorization header" });
  }
  const token = header.split(" ")[1];
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(payload.sub).select("-passwordHash");
    if (!user) return res.status(401).json({ message: "User no longer exists" });

    // tokenVersion mismatch means "log out everywhere" was triggered since
    // this token was issued — reject even though the JWT signature is valid.
    if (payload.tokenVersion !== user.tokenVersion) {
      return res.status(401).json({ message: "Session has been logged out on all devices. Please sign in again." });
    }

    const session = await Session.findOne({ jti: payload.jti, user: user._id });
    if (!session || session.revoked) {
      return res.status(401).json({ message: "This session has been revoked. Please sign in again." });
    }
    session.lastSeenAt = new Date();
    session.save().catch(() => {}); // best-effort, never block the request on this

    req.user = user;
    req.sessionJti = payload.jti;
    next();
  } catch {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: "Insufficient permissions" });
    }
    next();
  };
}
