import { z } from "zod";

export const registerSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  email: z.string().trim().email("Invalid email address").max(255),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
});

export const loginSchema = z.object({
  email: z.string().trim().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().min(8, "New password must be at least 8 characters").max(200),
});

// Express middleware factory: validates req.body against a Zod schema,
// returns a clean 400 with field-level messages on failure, and replaces
// req.body with the parsed (trimmed/coerced) data on success.
export function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        message: "Invalid request body",
        errors: result.error.issues.map((issue) => ({ field: issue.path.join("."), message: issue.message })),
      });
    }
    req.body = result.data;
    next();
  };
}
