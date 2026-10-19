import { User } from "../models/User.js";

export async function listUsers(req, res, next) {
  try {
    const users = await User.find().select("-passwordHash").sort({ createdAt: -1 }).lean();
    res.json(users);
  } catch (err) {
    next(err);
  }
}

const VALID_ROLES = ["Analyst", "Admin", "Viewer"];

export async function updateUserRole(req, res, next) {
  try {
    const { role } = req.body;
    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({ message: `role must be one of: ${VALID_ROLES.join(", ")}` });
    }
    if (String(req.params.id) === String(req.user._id) && role !== "Admin") {
      return res.status(400).json({ message: "You can't remove your own Admin role — ask another admin to do it." });
    }
    const user = await User.findByIdAndUpdate(req.params.id, { role }, { new: true }).select("-passwordHash");
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json(user);
  } catch (err) {
    next(err);
  }
}
