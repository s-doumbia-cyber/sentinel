import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ["Analyst", "Admin", "Viewer"], default: "Analyst" },
    // Bumped on "log out everywhere" — every JWT carries the tokenVersion it
    // was issued with, so incrementing this instantly invalidates every
    // previously-issued token without needing a token blocklist.
    tokenVersion: { type: Number, default: 0 },
    preferences: {
      emailAlerts: { type: Boolean, default: true },
      pushAlerts: { type: Boolean, default: true },
      language: { type: String, enum: ["English", "Français", "हिन्दी (Hindi)"], default: "English" },
      accentColor: { type: String, enum: ["violet", "cyan", "pink"], default: "violet" },
    },
  },
  { timestamps: true }
);

userSchema.methods.comparePassword = function comparePassword(candidate) {
  return bcrypt.compare(candidate, this.passwordHash);
};

userSchema.statics.hashPassword = function hashPassword(plain) {
  return bcrypt.hash(plain, 12);
};

export const User = mongoose.model("User", userSchema);
