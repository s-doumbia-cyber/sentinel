export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_MEDIA"
  | "RATE_LIMITED"
  | "CSRF_FAILED"
  | "REFRESH_REUSE_DETECTED"
  | "ML_UNAVAILABLE"
  | "UNPROCESSABLE"
  | "INTERNAL_ERROR";

/** Typed application error, turned into the error envelope by the central handler. */
export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly status: number,
    message: string,
    public readonly details?: unknown[],
  ) {
    super(message);
    this.name = "AppError";
  }

  static validation(message: string, details?: unknown[]) {
    return new AppError("VALIDATION_ERROR", 400, message, details);
  }
  static unauthenticated(message = "Authentication required") {
    return new AppError("UNAUTHENTICATED", 401, message);
  }
  static forbidden(message = "You do not have permission to perform this action") {
    return new AppError("FORBIDDEN", 403, message);
  }
  /** Also used for cross-org access so other tenants' resources are indistinguishable from missing ones. */
  static notFound(what = "Resource") {
    return new AppError("NOT_FOUND", 404, `${what} not found`);
  }
  static conflict(message: string) {
    return new AppError("CONFLICT", 409, message);
  }
  static unprocessable(message: string, details?: unknown[]) {
    return new AppError("UNPROCESSABLE", 422, message, details);
  }
}
