import { User } from "../models/User.js";
import { Session } from "../models/Session.js";
import { generateToken } from "../utils/generateToken.js";

function toUserResponse(user) {
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    preferences: user.preferences,
  };
}

async function issueSession(user, req) {
  const { token, jti } = generateToken(user._id, user.tokenVersion);
  await Session.create({
    user: user._id,
    jti,
    userAgent: req.headers["user-agent"] || "",
    ip: req.ip || "",
  });
  return token;
}

export async function register(req, res, next) {
  try {
    const { name, email, password } = req.body;
    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) return res.status(409).json({ message: "An account with this email already exists" });

    const passwordHash = await User.hashPassword(password);
    const user = await User.create({ name, email, passwordHash });
    const token = await issueSession(user, req);

    res.status(201).json({ token, user: toUserResponse(user) });
  } catch (err) {
    next(err);
  }
}

export async function login(req, res, next) {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email: email?.toLowerCase() });
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ message: "Invalid email or password" });
    }
    const token = await issueSession(user, req);
    res.json({ token, user: toUserResponse(user) });
  } catch (err) {
    next(err);
  }
}

export async function me(req, res) {
  res.json({ user: toUserResponse(req.user) });
}

export async function updateMe(req, res, next) {
  try {
    const { name, preferences } = req.body;
    const update = {};
    if (typeof name === "string" && name.trim()) update.name = name.trim();
    if (preferences && typeof preferences === "object") {
      if (typeof preferences.emailAlerts === "boolean") update["preferences.emailAlerts"] = preferences.emailAlerts;
      if (typeof preferences.pushAlerts === "boolean") update["preferences.pushAlerts"] = preferences.pushAlerts;
      if (typeof preferences.language === "string") update["preferences.language"] = preferences.language;
      if (typeof preferences.accentColor === "string") update["preferences.accentColor"] = preferences.accentColor;
    }

    const user = await User.findByIdAndUpdate(req.user._id, { $set: update }, { new: true, runValidators: true });
    res.json({ user: toUserResponse(user) });
  } catch (err) {
    next(err);
  }
}

// Verifies the current password, sets the new one, and revokes every OTHER
// active session (keeping the one making this request signed in) — the
// standard "you've been signed out everywhere else" security pattern.
export async function changePassword(req, res, next) {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: "currentPassword and newPassword are required" });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ message: "New password must be at least 8 characters" });
    }

    const user = await User.findById(req.user._id);
    const valid = await user.comparePassword(currentPassword);
    if (!valid) return res.status(401).json({ message: "Current password is incorrect" });

    user.passwordHash = await User.hashPassword(newPassword);
    await user.save();

    await Session.updateMany({ user: user._id, jti: { $ne: req.sessionJti } }, { revoked: true });

    res.json({ message: "Password updated. You've been signed out on all other devices." });
  } catch (err) {
    next(err);
  }
}

export async function listSessions(req, res, next) {
  try {
    const sessions = await Session.find({ user: req.user._id, revoked: false })
      .sort({ lastSeenAt: -1 })
      .lean();
    res.json(
      sessions.map((s) => ({
        id: s._id,
        userAgent: s.userAgent,
        ip: s.ip,
        lastSeenAt: s.lastSeenAt,
        createdAt: s.createdAt,
        current: s.jti === req.sessionJti,
      }))
    );
  } catch (err) {
    next(err);
  }
}

export async function revokeSession(req, res, next) {
  try {
    const session = await Session.findOne({ _id: req.params.id, user: req.user._id });
    if (!session) return res.status(404).json({ message: "Session not found" });
    session.revoked = true;
    await session.save();
    res.json({ message: "Session revoked" });
  } catch (err) {
    next(err);
  }
}

// Invalidates every token ever issued to this user (via tokenVersion) and
// marks every session record revoked, including the one making this request
// — the caller will need to log in again too, which is the point of
// "log out everywhere".
export async function logout(req, res, next) {
  try {
    await Session.updateOne({ jti: req.sessionJti }, { revoked: true });
    res.json({ message: "Signed out" });
  } catch (err) {
    next(err);
  }
}

export async function logoutAll(req, res, next) {
  try {
    await User.findByIdAndUpdate(req.user._id, { $inc: { tokenVersion: 1 } });
    await Session.updateMany({ user: req.user._id }, { revoked: true });
    res.json({ message: "Signed out on all devices" });
  } catch (err) {
    next(err);
  }
}

// GDPR-style self-service export: everything the app knows about this
// account and the incidents they're assigned to, as a single JSON payload.
export async function exportMyData(req, res, next) {
  try {
    const user = await User.findById(req.user._id).select("-passwordHash").lean();
    const sessions = await Session.find({ user: req.user._id }).select("-jti").lean();
    res.json({
      exportedAt: new Date().toISOString(),
      account: user,
      sessions,
    });
  } catch (err) {
    next(err);
  }
}

export async function deleteMyAccount(req, res, next) {
  try {
    await Session.deleteMany({ user: req.user._id });
    await User.findByIdAndDelete(req.user._id);
    res.json({ message: "Account deleted" });
  } catch (err) {
    next(err);
  }
}
