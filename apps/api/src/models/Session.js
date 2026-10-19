import mongoose from "mongoose";

// A real, listable JWT session record — created at login, checked on every
// authenticated request (see middlewares/auth.js), and revocable either
// individually ("log out this device") or all at once ("log out everywhere").
// This is what makes "Active Sessions" in Settings a genuine feature rather
// than a decorative list: JWTs are normally stateless, so without this
// collection there would be nothing real to show or revoke.
const sessionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    jti: { type: String, required: true, unique: true },
    userAgent: { type: String, default: "" },
    ip: { type: String, default: "" },
    lastSeenAt: { type: Date, default: Date.now },
    revoked: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export const Session = mongoose.model("Session", sessionSchema);
