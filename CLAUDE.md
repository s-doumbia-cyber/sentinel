# CLAUDE.md — Sentinel

> Permanent project memory for Claude Code. Read it fully before touching code.
> Detailed specs live in `docs/`. The work plan lives in `ROADMAP.md`.

## 1. What Sentinel is

Sentinel is an **explainable threat-detection and triage platform for small security teams** (SMBs, universities, small MSSPs that cannot afford Splunk, Microsoft Sentinel or QRadar). It ingests network-flow telemetry, scores it with a served ML model plus a rules engine, explains every alert, correlates alerts into incidents, and guides analysts through response.

It is also the owner's flagship portfolio project and a **project-expo entry**. It must be:
- **Demonstrably real**: run an attack from a lab VM and see a Sentinel alert within seconds.
- **Visually excellent**: Linear / Vercel / Datadog level of polish, not a student template.
- **Technically credible** to a hiring manager or an enterprise security buyer: tested, secure, documented, one-command deployable.

Owner: Souleymane Doumbia (BCA student, cybersecurity). The owner chats in French, but **all code, docs, UI copy, comments and commit messages are in English** unless a task says otherwise.

## 2. Read these first

| File | Purpose |
|---|---|
| `ROADMAP.md` | Phases, tasks, acceptance criteria. Tick boxes as you finish. |
| `docs/PRODUCT_SPEC.md` | What to build and why (features F1-F14, personas, NFRs). |
| `docs/ARCHITECTURE.md` | Target architecture, data model, API, security, deployment. |
| `docs/ML_AND_DETECTION.md` | ML pipeline, rules engine, explainability, lab dataset, honesty rules. |
| `docs/DESIGN_SYSTEM.md` | Tokens, typography, components, page layouts, UX rules. |
| `docs/KICKOFF_PROMPT.md` | The prompt the owner pastes to start work. |

If documents conflict, precedence is: `ROADMAP.md` > `ARCHITECTURE.md` > `PRODUCT_SPEC.md` > `DESIGN_SYSTEM.md`. Flag the conflict to the owner in your summary.

## 3. Non-negotiable principles

1. **Honest data.** No fabricated numbers, no mock data in production code paths. Every flow carries a `sourceKind`: `LIVE` (collector), `REPLAY` (dataset replay), `IMPORTED` (CSV/PCAP import). The UI always shows it. Demo seed data is labelled `DEMO`.
2. **Detection must be real.** An alert's verdict comes from the model or a rule, **never** copied from a dataset label. Dataset labels live in `groundTruthLabel`, used only for evaluation.
3. **Report ML honestly.** Always show macro-F1, per-class precision/recall/F1 and support. Never accuracy alone. Show model version, training data, training date and library versions.
4. **Unknown stays unknown.** Unrecognised labels or values are skipped or flagged and logged, never defaulted into a category.
5. **Secure by default.** See section 9.
6. **Every feature ships with tests and with empty / loading / error states.**
7. **Overlays are opaque.** See Lessons Learned.
8. **Do not expand scope silently.** If a task needs a new dependency, a schema change, or touches another phase, say so in your summary.
9. **Never claim what the system cannot do.** A browser cannot sniff packets; the collector can. Label limitations in the UI and docs.

## 4. Target stack

| Layer | Choice |
|---|---|
| Web | React 18, TypeScript (strict), Vite, Tailwind, Radix UI primitives (shadcn/ui pattern), TanStack Query + TanStack Table (+ virtualization), React Router, react-hook-form + zod, cmdk (command palette), ECharts or Recharts for charts, Cytoscape.js or react-force-graph for entity graphs, Framer Motion (subtle), i18next |
| API | Node 20, TypeScript (strict), Express, zod, pino, BullMQ + Redis (queues), SSE for realtime, OpenAPI generated from zod |
| ML service | Python 3.11+, FastAPI, scikit-learn, pandas, shap, joblib, pytest |
| Collector | Python, nfstream (live and pcap) or equivalent, requests/httpx |
| Data | MongoDB (keep), Redis (queues, pub/sub, cache) |
| Packaging | npm workspaces monorepo, Docker Compose, GitHub Actions |

Do not add major dependencies beyond this list without saying so and justifying.

## 5. Target repo layout

```
sentinel/
  apps/web/              React app
  apps/api/              Express API (TypeScript)
  services/ml/           FastAPI inference + training CLI
  services/collector/    Python flow collector (live / pcap / replay)
  packages/shared/       zod schemas, types, attack taxonomy, MITRE map, severity map
  lab/                   lab attack scripts + protocol (docs/ML_AND_DETECTION.md)
  docs/
  docker-compose.yml
  CLAUDE.md  ROADMAP.md
```
The current repo has `frontend/` and `backend/` (JavaScript). Phase 0 migrates it.

## 6. Commands (target)

```
npm install                 # all workspaces
npm run dev                 # api + web (+ ml via docker compose)
npm run typecheck | lint | test
npm run test:e2e            # Playwright
npm run seed:demo           # honest demo data, tagged DEMO
docker compose --profile demo up --build
cd services/ml && pip install -e ".[dev]" && pytest
```
Scripts must be cross-platform (Windows PowerShell and Linux): no bash-only one-liners in `package.json`; use `cross-env`, `rimraf`, or Node scripts.

## 7. Coding standards

- TypeScript `strict`; no `any` without a comment explaining why. Share types via `packages/shared`.
- Validate **all** external input with zod at the boundary (HTTP bodies, query strings, env, queue payloads, collector payloads).
- Config comes from a single validated `config` module (zod); the app fails fast on a bad env.
- Errors: throw typed `AppError` (code, status, message); one central handler produces the response envelope. No `console.log`; use pino with request ids.
- Async/await only; no unhandled promises. Small functions; one responsibility per module; no file over ~300 lines without reason.
- Tests: Vitest (unit), Supertest + mongodb-memory-server (API integration), pytest (ML), Playwright (e2e on key flows). New logic ships with tests.
- Commits: Conventional Commits (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`), small and focused.
- Comments explain *why*, not *what*.

## 8. API conventions

- Base path `/api/v1`. JSON only. OpenAPI generated from zod schemas, served at `/api/docs`.
- Error envelope: `{ "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [...], "requestId": "..." } }`.
- Cursor pagination: `?limit=50&cursor=...` returning `{ items, nextCursor }`. No offset pagination on large collections.
- Time ranges: ISO-8601 `from` / `to`. Filters are query params.
- **Tenant scoping is derived from the authenticated context, never trusted from the client.** Every query includes `orgId`.
- Ingest endpoints are idempotent (`Idempotency-Key`) and return `429` with `Retry-After` under backpressure.

## 9. Security rules

- Passwords: argon2id. Access token: JWT, 15 min, kept in memory. Refresh token: `httpOnly` + `Secure` + `SameSite=Strict` cookie with rotation and reuse detection. **Do not store tokens in `sessionStorage` / `localStorage`** (the current code does; Phase 0 fixes it).
- API keys: shown once, stored as HMAC-SHA256 hash plus a visible prefix, scoped (`ingest`, `read`), revocable, with `lastUsedAt`.
- RBAC enforced server-side per org (Owner, Admin, Analyst, Viewer). UI hiding is cosmetic only.
- Rate-limit auth and ingest. helmet + strict CSP. CORS allow-list. No wildcard origins.
- Never log secrets, tokens, or full API keys. Never commit `.env`. **Never read or print `.env` contents.**
- Every mutating action writes to `audit_log`.
- Dependency audit in CI. Follow OWASP ASVS Level 1 as a minimum checklist.

## 10. UI rules (summary; full detail in `docs/DESIGN_SYSTEM.md`)

- Use design tokens only (CSS variables via Tailwind); no raw hex colours inside components.
- Build on Radix primitives; no hand-rolled dropdowns, dialogs, or tooltips.
- Server state in TanStack Query; filters and time range live in the **URL**.
- Every view has designed loading (skeleton), empty, and error states.
- Keyboard accessible, WCAG AA contrast, `prefers-reduced-motion` respected.
- Severity is never conveyed by colour alone (icon + label too).

## 11. How to work

1. Start of a session: read `ROADMAP.md`, pick the next unchecked task, restate its acceptance criteria.
2. For multi-file changes: write a short plan first, then implement in small commits.
3. Before saying "done": run `typecheck`, `lint`, `test`; verify acceptance criteria; tick the box in `ROADMAP.md`; add a line to `docs/CHANGELOG.md`.
4. Ambiguity: choose the most reasonable interpretation, note the assumption in your summary, proceed. Ask only if a wrong guess would waste over an hour.
5. **Ask before** destructive actions (dropping databases, `git reset --hard`, deleting directories) and before adding major dependencies.
6. Keep a "Decisions" list at the bottom of `ROADMAP.md` for choices a future session needs to know.

## 12. Definition of Done

- Acceptance criteria met and demonstrated (screenshot, curl output, or test).
- Tests added and passing; typecheck and lint clean.
- Loading / empty / error states present; keyboard and responsive behaviour checked.
- No mock data, no TODO left in shipped paths, no secrets.
- Docs and changelog updated.

## 13. Current state of the codebase (at kickoff)

**Real and reusable:** JWT auth with revocable sessions, RBAC middleware, Zod validation on auth routes, flow aggregation endpoints (KPIs, breakdowns, timeline, top attackers/subnets/ports), CSV import pipeline (`csvImporter.js`) with defensive label handling, dataset upload, incidents auto-generated from top attackers, kanban drag and drop, real notifications from incidents, Team page, preference persistence, replay monitor, Vitest + Supertest + mongodb-memory-server tests, Dockerfiles, docker-compose.

**Known gaps / fake or weak (to be fixed by the roadmap):**
- **No detection.** `prediction` is set equal to the dataset label at import. The trained model is **not persisted** (only a metrics JSON). No inference endpoint.
- No live ingestion, no collector, no alerting integrations, no webhooks.
- Single-tenant; no organisations.
- Tokens stored in `sessionStorage` (XSS exposure).
- Backend is JavaScript, not TypeScript. Frontend still contains `data/mockData.ts` generators and constants.
- `seed.js` generates random flows with random "predictions" (must be removed or replaced by an honest demo seed).
- Settings "API Configuration" card is a placeholder; language selector does not translate the UI.
- Reports: Excel/PDF are generated client-side with minimal content.
- `dist/` and `.env` exist in the working tree: both must be git-ignored.

### 13b. State after the 2026-10-20 session

The legacy code was migrated: `apps/api` (TypeScript, tenancy, rotating refresh cookie, RBAC, audit),
`apps/web` (rebuilt on the design system), `packages/shared`, `services/ml` (FastAPI, training CLI,
SHAP). Labels are ground truth only; verdicts come from the ML service. Ticked roadmap items carry
a ✅ note, partial ones a ⏳ note; read the Decisions log in `ROADMAP.md` before changing the data
model or the model registry. Existing user data needs `npm run migrate:legacy` (dry run first; never
run it without the owner's go-ahead). Commands in §6 work except `seed:demo` and `test:e2e` (not built).
Rules and alerts (1.7, 1.8) exist: rules run per import and on `POST /detections/run`; alerting is
idempotent via `alertedAt`/`alertClaim` on flows and `hitKeys` on alerts — keep it that way.

## 14. Lessons learned (do not repeat these bugs)

1. **Transparent overlays bleed content.** Dropdowns, drawers and popovers with `bg-*/95` plus backdrop blur let bright numbers show through and made text unreadable. Overlays must use a solid surface token.
2. **Framer Motion intercepts `onDragStart` / `onDragEnd`.** Native HTML5 drag and drop on a `motion.div` breaks. Use a plain element or a dnd library (dnd-kit).
3. **`.find().limit()` returns natural (insertion) order.** Training on it silently saw only the first imported file (2 classes instead of 11). Use `$sample` or a proper stratified query.
4. **Header whitespace mismatch.** CICIDS2017 headers have leading spaces. Build the field map from the *same trimmed headers* used as record keys, or every lookup silently misses.
5. **Silent defaults corrupt data.** An unknown label mapped to "Infiltration" produced 700k fake rows. Skip and log instead.
6. **`countDocuments({})` is slow at millions of rows;** use `estimatedDocumentCount()` when unfiltered, and rollup collections for dashboards.
7. **Joblib/pickle models are version-sensitive.** Record the scikit-learn version in model metadata and refuse or warn on mismatch.
8. **Tailwind utility conflicts depend on CSS order,** not class order. Use variants or `cn()` merging, not "last class wins" assumptions.
9. **CICIDS2017 has known label and feature errors** (Engelen et al. 2021, Liu et al. 2022). Document handling and never present benchmark accuracy as production performance.
10. **Models trained on a 2017 testbed do not transfer to other networks.** Hence the lab dataset and the two-schema design in `docs/ML_AND_DETECTION.md`.
11. **CICIDS2017 timestamps are day/month/year.** The legacy parser read month/day ("4/7/2017" became April 7) and silently used "now" when parsing failed.
12. **OpenMP + joblib in the ML container can busy-spin forever.** Keep `OMP_NUM_THREADS=1` in the image unless you re-test training inside Docker.
13. **The Write/Edit tools turn `\uXXXX` escapes into literal characters.** Write escapes in source files with a script when the escape itself matters (e.g. a BOM regex).

## 15. Environment notes

- The owner develops on **Windows 11 + PowerShell**. PowerShell may block `npm.ps1`; scripts and docs should work with `npm.cmd` or a fixed execution policy.
- Local Python is recent (3.14 with very recent scikit-learn). The ML service must declare `python_requires>=3.11`, avoid removed APIs, and store library versions with each model artefact. The Docker image pins its own Python.
- `mongosh` may not be installed: never require it in instructions; use Node/Python scripts.
- The owner has a VMware home lab with Kali Linux. The lab attack protocol (own, isolated network only) is in `docs/ML_AND_DETECTION.md`.
