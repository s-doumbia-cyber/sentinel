import type { ErrorRequestHandler, RequestHandler } from "express";
import mongoose from "mongoose";
import { MulterError } from "multer";
import { AppError } from "../lib/errors.js";
import type { Logger } from "../lib/logger.js";

export const notFound: RequestHandler = (req, _res, next) => {
  next(new AppError("NOT_FOUND", 404, `Route not found: ${req.method} ${req.path}`));
};

function toAppError(err: unknown): AppError | null {
  if (err instanceof AppError) return err;
  if (err instanceof mongoose.Error.CastError) return AppError.validation(`Invalid value for ${err.path}`);
  if (err instanceof mongoose.Error.ValidationError) {
    return AppError.validation(
      "Validation failed",
      Object.values(err.errors).map((e) => ({ path: e.path, message: e.message })),
    );
  }
  if (err instanceof MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") return new AppError("PAYLOAD_TOO_LARGE", 413, "File is too large");
    return AppError.validation(`Upload error: ${err.message}`);
  }
  if (typeof err === "object" && err !== null) {
    const e = err as { type?: string; code?: number; status?: number };
    if (e.type === "entity.too.large") return new AppError("PAYLOAD_TOO_LARGE", 413, "Request body is too large");
    if (e.type === "entity.parse.failed") return AppError.validation("Malformed JSON body");
    if (e.code === 11000) return AppError.conflict("A record with the same unique value already exists");
  }
  return null;
}

/** Single place that produces the error envelope (CLAUDE.md §8). */
export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (err, req, res, _next) => {
    const appErr = toAppError(err);
    if (!appErr) {
      logger.error({ err, requestId: req.id, path: req.path }, "Unhandled error");
      res.status(500).json({
        error: { code: "INTERNAL_ERROR", message: "Internal server error", requestId: req.id },
      });
      return;
    }
    if (appErr.status >= 500) logger.error({ err, requestId: req.id }, appErr.message);
    res.status(appErr.status).json({
      error: {
        code: appErr.code,
        message: appErr.message,
        ...(appErr.details ? { details: appErr.details } : {}),
        requestId: req.id,
      },
    });
  };
}
