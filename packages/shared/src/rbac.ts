/**
 * Role matrix. The API enforces it in its single `authorize()` policy module;
 * the web app may read it only to hide controls (cosmetic, never security).
 */
export const ROLES = ["Owner", "Admin", "Analyst", "Viewer"] as const;
export type Role = (typeof ROLES)[number];

export const ACTIONS = [
  "flows:read",
  "stats:read",
  "datasets:read",
  "datasets:import",
  "datasets:delete",
  "scoring:run",
  "incidents:read",
  "incidents:write",
  "incidents:delete",
  "models:read",
  "models:manage",
  "members:read",
  "members:manage",
  "audit:read",
  "rules:read",
  "rules:test",
  "rules:manage",
  "alerts:read",
  "alerts:write",
  "detections:run",
  "assets:read",
  "assets:write",
  "identity:read",
  "identity:manage",
] as const;
export type Action = (typeof ACTIONS)[number];

const ALL: readonly Role[] = ROLES;
const WRITERS: readonly Role[] = ["Owner", "Admin", "Analyst"];
const ADMINS: readonly Role[] = ["Owner", "Admin"];

export const PERMISSIONS: Record<Action, readonly Role[]> = {
  "flows:read": ALL,
  "stats:read": ALL,
  "datasets:read": ALL,
  "datasets:import": WRITERS,
  "datasets:delete": ADMINS,
  "scoring:run": WRITERS,
  "incidents:read": ALL,
  "incidents:write": WRITERS,
  "incidents:delete": ADMINS,
  "models:read": ALL,
  "models:manage": ADMINS,
  "members:read": ALL,
  "members:manage": ADMINS,
  "audit:read": ADMINS,
  "rules:read": ALL,
  // Replays a rule over stored flows: read-only but costly, so not for Viewers.
  "rules:test": WRITERS,
  "rules:manage": ADMINS,
  "alerts:read": ALL,
  "alerts:write": WRITERS,
  "detections:run": WRITERS,
  "assets:read": ALL,
  "assets:write": WRITERS,
  // Usernames and device names are personal data: not shown to Viewers.
  "identity:read": WRITERS,
  "identity:manage": ADMINS,
};

export function can(role: Role, action: Action): boolean {
  return PERMISSIONS[action].includes(role);
}
