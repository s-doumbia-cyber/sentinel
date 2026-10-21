import { Router, type RequestHandler } from "express";
import type { Action } from "@sentinel/shared";
import type { ZodType, ZodTypeDef } from "zod";
import type { AppConfig } from "../config/index.js";
import { authorize, requireAuth } from "../middleware/auth.js";
import { validatorSchemas, type Part } from "./http.js";

/**
 * `public`: no authentication (login, register, health).
 * `self`: any authenticated member acting on their own account.
 * `account`: authenticated, even without any membership (accepting an invitation).
 * An `Action`: checked against the role matrix by `authorize()`.
 */
export type Policy = "public" | "self" | "account" | Action;
type Method = "get" | "post" | "patch" | "put" | "delete";

export interface RouteInfo {
  method: Method;
  path: string;
  policy: Policy;
  mutating: boolean;
  /** zod schemas the route validates (from `validate()`), for the OpenAPI document. */
  schemas: Partial<Record<Part, ZodType<unknown, ZodTypeDef, unknown>>>;
}

/**
 * Thin wrapper over an Express router that forces every route to declare its
 * policy, and records it so tests can assert the role × route matrix.
 */
export class PolicyRouter {
  readonly router = Router();
  readonly routes: RouteInfo[] = [];

  constructor(
    private readonly config: AppConfig,
    private readonly prefix = "",
  ) {}

  route(method: Method, path: string, policy: Policy, ...handlers: RequestHandler[]): this {
    const guards: RequestHandler[] = [];
    if (policy !== "public") guards.push(requireAuth(this.config, { allowNoOrg: policy === "account" }));
    if (policy !== "public" && policy !== "self" && policy !== "account") guards.push(authorize(policy));
    this.router[method](path, ...guards, ...handlers);
    const schemas: RouteInfo["schemas"] = {};
    for (const h of handlers) {
      const v = validatorSchemas.get(h);
      if (v) schemas[v.part] = v.schema;
    }
    this.routes.push({ method, path: `${this.prefix}${path}`, policy, mutating: method !== "get", schemas });
    return this;
  }
}
