import type { Schema } from "mongoose";

const QUERY_OPS = [
  "find",
  "findOne",
  "findOneAndUpdate",
  "findOneAndDelete",
  "findOneAndReplace",
  "countDocuments",
  "updateOne",
  "updateMany",
  "deleteOne",
  "deleteMany",
  "replaceOne",
  "distinct",
] as const;

export class TenantScopeError extends Error {
  constructor(model: string, op: string) {
    super(`Tenant scope missing: ${model}.${op} was called without an orgId filter`);
    this.name = "TenantScopeError";
  }
}

/**
 * Makes a missing `orgId` impossible by construction for tenant collections
 * (docs/ARCHITECTURE.md §7): every Mongoose query and aggregation must filter
 * on `orgId`, otherwise it throws before reaching MongoDB. Migrations and test
 * cleanup use the raw driver collection on purpose, which bypasses this.
 */
export function tenantGuard(schema: Schema, modelName: string): void {
  for (const op of QUERY_OPS) {
    schema.pre(op, function guard() {
      const filter = this.getFilter() as Record<string, unknown>;
      if (filter.orgId === undefined || filter.orgId === null) throw new TenantScopeError(modelName, op);
    });
  }
  schema.pre("estimatedDocumentCount", function guard() {
    throw new TenantScopeError(modelName, "estimatedDocumentCount");
  });
  schema.pre("aggregate", function guard() {
    const first = this.pipeline()[0] as { $match?: Record<string, unknown> } | undefined;
    if (!first?.$match || first.$match.orgId === undefined || first.$match.orgId === null) {
      throw new TenantScopeError(modelName, "aggregate");
    }
  });
}
