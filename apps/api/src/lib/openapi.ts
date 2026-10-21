import { errorEnvelopeSchema } from "@sentinel/shared";
import type { ZodType, ZodTypeDef } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { RouteInfo } from "./routes.js";

type Json = Record<string, unknown>;

/** Routes that take multipart/form-data with one `file` field (no zod body schema). */
const UPLOADS = new Set(["/api/v1/imports/csv", "/api/v1/identity/imports"]);

function toJsonSchema(schema: ZodType<unknown, ZodTypeDef, unknown>): Json {
  // Inline everything: the document stays readable without a component registry.
  const { $schema: _ignored, ...rest } = zodToJsonSchema(schema, { target: "openApi3", $refStrategy: "none" }) as Json;
  return rest;
}

function parameters(where: "query" | "path", schema: ZodType<unknown, ZodTypeDef, unknown> | undefined, pathNames: string[]): Json[] {
  const json = schema ? toJsonSchema(schema) : null;
  const props = (json?.properties ?? {}) as Record<string, Json>;
  const required = new Set((json?.required as string[] | undefined) ?? []);
  const names = where === "path" ? pathNames : Object.keys(props);
  return names.map((name) => ({
    name,
    in: where,
    required: where === "path" ? true : required.has(name),
    schema: props[name] ?? { type: "string" },
    ...(typeof props[name]?.description === "string" ? { description: props[name]?.description } : {}),
  }));
}

/**
 * OpenAPI 3.0 document generated from the routes' declared policies and the zod schemas
 * their `validate()` handlers use: what is documented is what is enforced. Response bodies
 * are not described yet (only the shared error envelope).
 */
export function buildOpenApi(routes: RouteInfo[], info: { version: string }): Json {
  const errorRef = { content: { "application/json": { schema: toJsonSchema(errorEnvelopeSchema) } } };
  const paths: Record<string, Json> = {};
  for (const r of routes) {
    const pathNames = [...r.path.matchAll(/:(\w+)/g)].map((m) => m[1] ?? "");
    const oaPath = r.path.replace(/:(\w+)/g, "{$1}");
    const tag = r.path.replace(/^\/api\/v1\//, "").split("/")[0] ?? "other";
    const op: Json = {
      tags: [tag],
      summary: `${r.method.toUpperCase()} ${r.path}`,
      "x-sentinel-policy": r.policy,
      description:
        r.policy === "public"
          ? "No authentication."
          : r.policy === "self" || r.policy === "account"
            ? "Any signed-in user, on their own account."
            : `Requires the \`${r.policy}\` permission (see packages/shared/src/rbac.ts).`,
      parameters: [...parameters("path", r.schemas.params, pathNames), ...parameters("query", r.schemas.query, [])],
      responses: {
        "2XX": { description: "Success (200, 201 created, 202 queued, or 204 no content)" },
        "400": { description: "Validation error", ...errorRef },
        ...(r.policy !== "public" ? { "401": { description: "Not signed in", ...errorRef }, "403": { description: "Not allowed", ...errorRef } } : {}),
        "404": { description: "Not found (also for other organisations' resources)", ...errorRef },
        "429": { description: "Rate limited", ...errorRef },
      },
      ...(r.policy === "public" ? { security: [] } : {}),
    };
    if (r.schemas.body) op.requestBody = { required: true, content: { "application/json": { schema: toJsonSchema(r.schemas.body) } } };
    else if (UPLOADS.has(r.path)) {
      op.requestBody = {
        required: true,
        content: { "multipart/form-data": { schema: { type: "object", required: ["file"], properties: { file: { type: "string", format: "binary" } } } } },
      };
    }
    paths[oaPath] = { ...(paths[oaPath] ?? {}), [r.method]: op };
  }
  return {
    openapi: "3.0.3",
    info: {
      title: "Sentinel API",
      version: info.version,
      description:
        "Explainable threat detection for small security teams. Browser clients send the in-memory access token as `Authorization: Bearer`; " +
        "`X-Org-Id` selects one of the caller's organisations. Errors use the envelope below. Cookie endpoints (refresh, logout) need `X-Sentinel-CSRF: 1`.",
    },
    servers: [{ url: "/" }],
    components: { securitySchemes: { bearer: { type: "http", scheme: "bearer", bearerFormat: "JWT" } } },
    security: [{ bearer: [] }],
    paths,
  };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

/** A plain, script-free reference page (the API's CSP forbids scripts); styles use a per-response nonce. */
export function renderDocsPage(doc: Json, nonce: string): string {
  const paths = doc.paths as Record<string, Record<string, Json>>;
  const byTag = new Map<string, string[]>();
  for (const [p, ops] of Object.entries(paths)) {
    for (const [method, op] of Object.entries(ops)) {
      const tag = ((op.tags as string[] | undefined) ?? ["other"])[0] ?? "other";
      const body = op.requestBody ? Object.keys(((op.requestBody as Json).content as Json) ?? {}).join(", ") : "";
      const params = ((op.parameters as Json[] | undefined) ?? []).map((x) => `${String(x.name)}${x.required ? "" : "?"}`).join(", ");
      byTag.set(tag, [
        ...(byTag.get(tag) ?? []),
        `<tr><td class="m ${esc(method)}">${esc(method.toUpperCase())}</td><td><code>${esc(p)}</code></td><td><code>${esc(String(op["x-sentinel-policy"]))}</code></td><td>${esc(params)}</td><td>${esc(body)}</td></tr>`,
      ]);
    }
  }
  const sections = [...byTag.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([tag, rows]) => `<h2 id="${esc(tag)}">${esc(tag)}</h2><table><thead><tr><th>Method</th><th>Path</th><th>Policy</th><th>Parameters</th><th>Body</th></tr></thead><tbody>${rows.join("")}</tbody></table>`)
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sentinel API reference</title>
<style nonce="${nonce}">body{font:14px/1.5 system-ui,sans-serif;margin:0 auto;max-width:1100px;padding:24px 16px;color:#1f2a24;background:#fbfaf6}
h1{font-size:24px}h2{font-size:18px;margin-top:32px;text-transform:capitalize}table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #e3e0d6;vertical-align:top}
code{font:12px/1.4 ui-monospace,monospace}.m{font-weight:600;font-size:12px}.get{color:#1d5f8a}.post{color:#2f6b46}.patch{color:#8a5a12}.delete{color:#a3282f}.put{color:#6b3f8a}
@media (prefers-color-scheme:dark){body{background:#111614;color:#e6ece8}th,td{border-color:#2b332f}.get{color:#7cc0ea}.post{color:#86d0a2}.patch{color:#e2b45f}.delete{color:#f08a90}}</style></head>
<body><h1>Sentinel API reference</h1><p>Generated from the route policies and zod schemas the API enforces. Machine-readable: <a href="/api/docs/openapi.json">openapi.json</a> (OpenAPI 3.0).</p>${sections}</body></html>`;
}
