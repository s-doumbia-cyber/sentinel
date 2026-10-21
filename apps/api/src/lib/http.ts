import { randomUUID } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { Types } from "mongoose";
import type { Role } from "@sentinel/shared";
import type { ZodType, ZodTypeDef } from "zod";
import { AppError } from "./errors.js";

/** Authenticated request context. Tenant scope always comes from here, never from the client body. */
export interface AuthContext {
  userId: Types.ObjectId;
  sessionId: Types.ObjectId;
  orgId: Types.ObjectId;
  role: Role;
}

/** The signed-in user, set even when they belong to no org (policy `account`). */
export interface AccountContext {
  userId: Types.ObjectId;
  sessionId: Types.ObjectId;
}

declare module "express-serve-static-core" {
  interface Request {
    id: string;
    auth?: AuthContext;
    account?: AccountContext;
  }
}

/** Returns the auth context or throws; for handlers mounted behind `requireAuth`. */
export function authOf(req: Request): AuthContext {
  if (!req.auth) throw AppError.unauthenticated();
  return req.auth;
}

export function accountOf(req: Request): AccountContext {
  if (!req.account) throw AppError.unauthenticated();
  return req.account;
}

const REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;

export function requestId(): RequestHandler {
  return (req, res, next) => {
    const incoming = req.header("x-request-id");
    req.id = incoming && REQUEST_ID.test(incoming) ? incoming : randomUUID();
    res.setHeader("X-Request-Id", req.id);
    next();
  };
}

/** Forwards rejected promises to the central error handler (Express 4 does not). */
export function ah(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

type Part = "body" | "query" | "params";

/** Parses `req[part]` with zod; the parsed value replaces the raw one. */
export function validate<T>(part: Part, schema: ZodType<T, ZodTypeDef, unknown>): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req[part]);
    if (!result.success) {
      return next(
        AppError.validation(
          `Invalid request ${part}`,
          result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        ),
      );
    }
    // Express 4 exposes req.query as a plain writable property.
    (req as unknown as Record<Part, unknown>)[part] = result.data;
    next();
  };
}

/** Typed accessor for data validated by `validate(part, schema)`. */
export function parsed<T>(req: Request, part: Part): T {
  return (req as unknown as Record<Part, T>)[part];
}
