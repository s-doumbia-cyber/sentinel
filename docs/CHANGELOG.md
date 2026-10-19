# Changelog

All notable changes. Dates are UTC.

## 2026-10-20

### Foundation (Phase 0)
- Imported the legacy `cyber-dashboard` (without `node_modules`, `dist/`, build info or `.env`) into a
  new git repository; npm workspaces monorepo (`apps/api`, `apps/web`, `packages/shared`, `services/ml`,
  `services/collector` placeholder); root `.gitignore`, `.gitattributes`, `.env.example` files.
- `packages/shared`: attack taxonomy, anchored label normaliser (unknown → `null`; fixes GoldenEye
  being mapped to DoSHulk), severity and MITRE maps, `cicids2017-v1` feature schema (JSON shared with
  Python), RBAC matrix, zod contracts, label test vectors shared with the Python port.
- API rewritten in TypeScript: zod config that fails fast, pino with request ids, `AppError` and the
  error envelope, `/api/v1`, cursor pagination.
- Multi-tenancy: orgs and memberships, `orgId` on flows / datasets / incidents / audit log, a Mongoose
  guard that rejects any unscoped query, cross-org access → 404, per-org `X-Org-Id` switching.
- Auth: argon2id (legacy bcrypt upgraded at login), 15-minute access JWT kept in memory, opaque
  refresh token in an httpOnly / Secure / SameSite=Strict cookie with rotation and reuse detection,
  CSRF header on cookie endpoints, login rate limit, password minimum 12 characters.
- Single `authorize()` policy declared on every route; role × route matrix test.
- Append-only `audit_log` written by every mutation.
- Docker Compose (mongo, ml, api, web/nginx with strict CSP) with healthchecks; GitHub Actions workflow.

### Detection (Phase 1)
- Dataset labels are stored in `groundTruthLabel` only; flows stay `pending` until a model scores them.
  The random `seed.js` and the fabricated incident generator are gone.
- CSV import validates the header first, rejects invalid rows without placeholders (no more `0.0.0.0`
  or "now" timestamps), parses CICIDS2017 day/month/year timestamps, records file SHA-256.
- ML service (FastAPI): `/health`, `/models`, `/predict`, `/reload`; feature validation, schema
  mismatch and scikit-learn version mismatch refused; SHAP explanations.
- Training CLI: stratified splits, group-aware holdout, class-weight study, LR / RF / HGB, macro-F1
  selection with a critical-recall floor, artefacts with model card and library versions.
- Scoring service with per-org active model per schema; stats from verdicts; evaluation endpoint
  comparing verdicts with ground truth; training-overlap warning.
- Legacy data migration script (dry run by default, tested, never run on a real database here).

### UI (early Phase 4)
- New React UI on design tokens (dark/light, accents, density), Radix primitives, TanStack Query:
  Command Center, Flows (with "why" drawer), Datasets, Models, Incidents, Team, Audit log, Settings.
- Removed mock data, decorative effects, client-side "monitor", `axios`, `framer-motion`, `jspdf`, `xlsx`.

### Security
- `csv-parse` 7 and `react-router` 7: `npm audit --omit=dev` reports no vulnerabilities.
