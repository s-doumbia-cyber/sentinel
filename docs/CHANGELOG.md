# Changelog

All notable changes. Dates are UTC.

## 2026-10-21

### Day-wise validation in the training CLI
- `split.holdout` (`by: file` or a CSV column, explicit names / globs or a seeded fraction) keeps whole
  capture days out of training; the shipped model is tested on them. `metrics.json` (`heldOut`), the
  model card and the registry summary carry per-class precision / recall / F1 / support, per-group
  macro-F1 and warnings: a class absent from the held-out side gets no estimate, a class that appears
  only there is excluded and counted, and a pattern that matches nothing is an error. pytest coverage.

### One-command demo (roadmap 6.1)
- `docker compose --profile demo up --build` adds `ml-train-demo` (trains the sample model into the stack's
  volume unless one exists) and `demo-seed` (runs the compiled `seed-demo` once against the stack's own
  MongoDB; random credentials printed once to its log; a second run reports "already exists"). The seed gets
  `--require-host <name>` and refuses any other database host. The API image now carries `data/demo`.
- Not verified end to end: Docker Desktop was not running, so `docker compose up` was not run; the compose file
  was validated with `docker compose config` and the compiled seed script was run twice on a throwaway MongoDB.

### Novelty detection: "unusual behaviour" (roadmap 5.7)
- Flows get `scored.novelty` (score, threshold, above-threshold) when the active model has a novelty detector,
  and `scored.unusualBehaviour` when the score is above the threshold and the classifier said Normal or was
  below the review threshold. The class verdict is never changed and no alert is raised. Shown as a badge in
  the Flows list, a section in the flow drawer, `?unusual=true` on `GET /flows` and the Flows page, and on the
  Models page next to the held-out results. Tests: flagging rule, class unchanged, no alert, models without a
  detector, badge.

### Model drift and analyst feedback (roadmap 1.9)
- Drift job: `POST /models/:version/drift` (Analyst and above; window 1 h to 30 days, default 24 h) samples
  flows that model version scored recently (`$sample`, at most 20,000, at least 200 required, otherwise no
  report), bins them with the model's training-time reference histogram and stores the PSI per feature in
  an append-only `drift_reports` collection; audited as `model.drift_check`. `GET /models/:version/drift`
  returns the latest report and history. Old models without a reference answer 409 "retrain".
- `GET /models/:version/feedback`: analyst verdicts (true positive / false positive / benign / not reviewed)
  per model version and alert type, labelled as reviewed-only, not precision.
- Models page: Monitoring panel (level shown as text and icon, top features with glossary labels, class mix,
  empty and error states). PSI unit-tested on a synthetic shift; API tests with an in-memory MongoDB.
- Shared-file notes: new index on flows (`scored.modelVersion`, `scored.scoredAt`), new `DriftReport` model.

### Re-apply alert noise settings to existing alerts
- `POST /detection/reapply` (Owner / Admin, background job, 202) rebuilds an organisation's alerts and
  incidents from the stored verdicts and rule hits under the current minimum confidence, allowlist, review
  threshold and rules; `GET /detection/reapply` returns whether it runs, what a run would rebuild and keep,
  and the last outcome. Flows and verdicts are untouched. Alerts an analyst triaged (verdict or analyst
  status), incidents a person created or worked on (status, assignee, notes, actions, report) and every alert
  inside such an incident are kept as they are and their evidence is not counted twice; everything else is
  rebuilt. Idempotent; runs as the durable `reapply` job and is refused while scoring or another rebuild is queued or running. Audited (`detection.reapply`,
  `detection.reapply_done` / `_failed`). Settings → Detection gets a confirm dialog that states the counts.
  Tests on an in-memory MongoDB (rebuild, idempotence, analyst work kept, roles, org isolation, locking) and a
  component test.

### Feature glossary (roadmap 1.6)
- `packages/shared/src/featureGlossary.json`: a plain-language label, unit and one-sentence meaning for
  each of the 44 `cicids2017-v1` features. The "why" bars in the alert and flow drawers now read
  "Packets per second · value 812 packets/s" with the model feature name still shown and an unknown
  name falling back to itself. Tests: every schema feature has an entry, units match the schema JSON,
  labels are distinct, values format with units.

### Drift reference and novelty detector (ML service)
- Every trained model now stores `reference.json`, a compact 10-bin histogram per feature of the rows
  it was fitted on (`GET /models/{version}/reference`); the drift check compares recent flows to it.
- Optional IsolationForest on benign training rows (`novelty.enabled`), threshold at a benign-score
  quantile, saved as `novelty.joblib`. `/predict` adds `novelty` next to the verdict; the model card
  reports the benign false-positive rate and the share of each attack class above the threshold.
  It is never mapped to an attack class. pytest coverage.

### Performance (roadmap 5.4, partial)
- Minute rollups answer every stats endpoint exactly (rollups for whole minutes, raw flows for the
  partial minutes at range ends, raw fallback while a rebuild is pending); header
  `X-Sentinel-Stats-Source` says which path answered. Scoring status uses index counts.
- `npm run bench -w @sentinel/api` times the endpoints on a throwaway mongod with synthetic flows.
  3 M flows: stats endpoints 7–23× faster (0.4–3.5 s p50), still above the 300 ms target; see
  `docs/PERFORMANCE.md`.

### API docs and observability (roadmap 5.6, 5.8)
- OpenAPI 3.0 generated from the route policies and zod schemas at `/api/docs/openapi.json`, and a
  script-free reference page at `/api/docs`.
- Optional Prometheus `/metrics` (requests and latency by route template, queue depth, dependency
  status, memory), behind `METRICS_ENABLED` and an optional token; `/readyz` reports Redis.

### Retention, system page and security pass (roadmap 5.3, 5.5)
- Per-org data retention (off by default, Owner only) with a dry-run preview, an audited purge job and a
  daily sweep; alerts linked to incidents, incidents, the audit log and import records are kept.
- System page (Owners / Admins): service health, failed background jobs with retry, retention.
- `docs/SECURITY_ASVS.md`: OWASP ASVS L1 checklist with evidence and open gaps.
- Hardening: `Cache-Control: no-store` on API responses, upload content sniffing (binary and non-UTF-8
  files refused) and multipart limits, password-change rate limit, MFA material redacted from logs,
  extra nginx headers (`object-src 'none'`, Permissions-Policy, COOP).

### Two-factor authentication (roadmap 5.2)
- TOTP enrolment from Settings → Security (password re-check, QR code or manual key, first code confirms),
  10 one-time recovery codes shown once, disable and regenerate behind the password.
- Sign-in asks for the code after the password; a code is never accepted twice; 5 wrong codes lock the
  factor for 15 minutes; endpoints rate-limited per IP and account. Enabling signs out other sessions.
- Seeds sealed with AES-256-GCM (`ENCRYPTION_KEY`, optional); recovery codes hashed; neither is exported.
- Login answers unknown emails as slowly as wrong passwords.

### Team invitations and member management (roadmap 5.1)
- Owners / Admins create single-use invitation links (1-14 days, one email, token stored as SHA-256 and
  shown once, sent in the URL fragment). Only Owners can invite or revoke Owners.
- `/accept-invite` page: new people create their account from the invitation; existing accounts accept
  while signed in with the invited email. Public endpoints are rate-limited and answer the same 404 for
  unknown, used, revoked and expired links.
- Remove a member and leave an organisation, with last-Owner safeguards that survive concurrent changes.
- Audit actions `invite.create`, `invite.revoke`, `invite.accept`, `member.remove`, `member.leave`.

### Durable jobs (roadmap 1.5)
- Imports, scoring, detections and the asset refresh run as BullMQ jobs on Redis when `REDIS_URL` is set,
  with 3 attempts, exponential backoff and a dead-letter list (`failed_jobs`); without Redis the same
  handlers run in-process with the same retry policy, so tests and the e2e suite need no service.
- Alert evidence is claimed in the same write as the model verdict and settled once per claim key:
  a job that crashes, is retried or stalls (worker killed) neither loses nor double-counts flows.
  Rule hit keys are checked atomically inside the alert update.
- A retried import removes the rows of its interrupted attempt first (no duplicates).
- `GET /jobs/status`, `GET /jobs/failed` and an audited `POST /jobs/failed/:id/retry` (Owner / Admin).
- `/readyz` reports Redis; Compose gains a `redis` service (healthcheck, `noeviction`, volume) and an
  uploads volume; `src/worker.ts` runs workers without HTTP (`RUN_WORKERS=false` on the API).
- CI starts a Redis service for the BullMQ integration tests (skipped locally without
  `SENTINEL_TEST_REDIS_URL`).

### Investigation UI and reports
- **Entity graph** (ROADMAP 3.4, 4.10): `GET /entities/ip/:value/graph` and `GET /incidents/:id/graph`
  (bounded, org-scoped, aggregated directed edges with flow counts, model-flagged counts and alert
  markers; truncation reported). `GraphView` (Cytoscape, lazy loaded) on the asset page and on a new
  *Graph* tab of the incident page, with pan / zoom (mouse, touch, keyboard), click-to-open, a list
  alternative, range and reach in the URL, no animation under `prefers-reduced-motion`.
- **Command palette and shortcuts** (4.4, 4.7): cmdk on Ctrl/Cmd+K (pages for the role, address by IP,
  alert / incident / flow by id, theme, shortcut list), `?` overlay, G then a letter for every page,
  and E / F / I in the alert panel through the existing API calls.
- **Incident board** (4.9): dnd-kit drag and drop with mouse, long press and keyboard, screen-reader
  announcements, optimistic update with rollback through the audited incident update, read-only for
  Viewers. Columns wrap instead of scrolling sideways.
- **Reports** (3.7): `GET /reports/executive` (same functions as the dashboard, so the same range gives
  the same numbers), time to triage, quality on labelled data, provenance, limitations; server-side PDFs
  with pdfkit for the executive and the incident report (audited); Reports page with the period in
  the URL and an HTML preview mirroring the PDF. `GET /alerts/summary` accepts `from` / `to`.
- Defects found by the new Playwright journeys and fixed: a resting mouse hijacking keyboard drags,
  dnd-kit skipping columns when the board scrolled sideways, a graph that filled the canvas with two
  nodes, graph controls overflowing at 375 px, the shortcut list not reachable by keyboard.
- Dependencies (owner-approved): cytoscape, cmdk, @dnd-kit/*, pdfkit. Alerts get a `{orgId, dstIp}` index.
- Not done: CSV / XLSX exports, frame-rate measurement of a 500-node graph, screen-reader pass,
  i18n of the new copy (English only, as briefed).

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

### Detection rules and alerts (roadmap 1.7, 1.8)
- JSON threshold-rule DSL in `packages/shared` with five starter rules (port scan, SSH/FTP brute force,
  SYN flood, slow HTTP); streaming sliding-window evaluator; rule CRUD, versioning, audit and a test
  endpoint that never creates alerts.
- Alerts from model verdicts and rule hits: dedupe with `count`, hybrid severity, `needs_review` below
  the confidence threshold, evidence flows, best SHAP explanation, triage status and analyst verdicts.
- Fixed a double count when the scoring job and the detection backfill ran concurrently.
- UI: Alerts page (filters in the URL, drawer with why-it-fired and triage) and Rules page (describe,
  enable, edit JSON, test); Active alerts KPI on the Command Center.

### Investigation, attribution, response and validation (owner brief, 2026-10-20)
- Alert detail separates observed / inferred / unknown statements with their basis, and shows
  provenance (dataset SHA-256, model and rule versions) and change history.
- Asset inventory rebuilt from flows after each import: services, peers, activity, alerts, notes and
  tags; device type as a labelled low-confidence estimate. Rare ports are grouped (often scans).
- Identity sources: CSV import of VPN / DHCP / auth / EDR / directory / manual records with hash and
  rejected-row samples; graded attribution (source, window, confidence, ambiguity, caveats, "unknown"
  plus what would help). Analysts and above can read identity data; Owners / Admins import it.
- Correlation of alerts into incidents (same source, org window, kill-chain escalation), incidents from
  selected alerts, append-only incident events mirrored in the audit log, attack timeline (facts vs
  hypotheses), knowledge base, blocklist simulations (never applied), analyst-reported actions,
  printable incident report.
- Validation runs for model and rule versions with per-class metrics, FP / FN samples, dataset hash,
  training-overlap check and notes (DEMO datasets are called out as proving nothing).
- New light ivory identity (pine / ocean / plum accents, dark theme kept), purposeful motion that
  respects reduced motion; mobile "More" menu so every page is reachable at 375 px.
- Synthetic DEMO scenario generator (`npm run demo:data`) with matching identity records.
- Fixed in browser review: evidence plural, local-vs-UTC wording, a stray tab scrollbar and grid
  overflow at phone width.

### Alert noise controls
- Settings → Detection: minimum model confidence for alerts (verdicts below it stay on their flows,
  marked `below_min_confidence`) and an allowlist of trusted addresses / networks with a reason
  (no model or rule alert when either endpoint matches; flows marked `allowlisted`). Counts of
  kept-out verdicts are shown; changes are audited (`detection.settings_update`). IPv4 / IPv6 CIDR
  matching in `packages/shared` rejects ambiguous entries such as `10.0.0.5/24`.
- Starter rule `R-SLOWHTTP-01` now requires ports 80 / 8080 and at most 10 bytes from the server.
  Replayed over the eight CICIDS2017 days with the real evaluator: 161 hits → 15, the 8 hits on
  slow-HTTP attack flows kept. Orgs whose copy still equals the old default are upgraded (version
  +1, audited as `rule.upgrade` with the reason); customised copies are never touched.

### Continuous integration
- CI workflow: Node 22 and 24 matrix (typecheck, lint, tests, build, blocking production audit),
  ML pytest with a report-only pip-audit, Playwright + axe e2e with cached browsers and MongoDB
  binaries and a failure report artefact, Docker build; concurrency cancels superseded runs.
- Minimum Node raised to 22 (Node 20 is end-of-life): `engines`, Docker base images, docs.
- First GitHub run green on all five jobs; runners pinned to `ubuntu-24.04` before `ubuntu-latest` moves to Ubuntu 26.
- CI green on a pull request (#1): roadmap 0.3 done.
- README states the real CI result and lists plainly what is not built or connected; the Windows
  guide was re-run end to end on an isolated database and explains how to get the demo credentials.

### Context over time, traceability and a real demo workspace
- Asset history (`asset_events`, append-only): first observed, new or vanished services (ignoring
  ports with fewer than 3 flows), estimate changes, inactive / seen again, analyst note edits.
  Refreshes are serialized per organisation; assets built before this version start their history
  explicitly instead of inventing changes. An unknown device type now says what would help.
- Identity context: every record for an address over time, and an account / hostname / MAC lookup
  listing the addresses it held and the alerts on them during those windows (literal,
  case-insensitive match; Analysts and above; each lookup audited as `identity.lookup`).
- Incident trace (`GET /incidents/:id/trace`, *Trace* tab, and in the report): dataset imports with
  hash and importer, identity imports used, alert creation with rules / models, triage changes,
  incident events, response and report, in recorded order.
- `npm run seed:demo`: dry run by default, `--yes` creates an isolated demo organisation with Owner /
  Analyst / Viewer accounts and random passwords printed once; refuses if it exists.
- Fixed: copying `apps/api/.env.example` and setting the secret did not start the API (the empty
  `ML_SERVICE_TOKEN=` failed validation). Empty values now mean "not set"; covered by a test.
- `docs/WINDOWS_GUIDE.md`: verified install, configuration, start, accounts, tour and tests.

### End-to-end and accessibility tests
- `e2e/` workspace with Playwright and axe (`npm run test:e2e`): analyst journey on the DEMO scenario,
  token storage and cookie flags, mobile layout at 375 px, WCAG 2.1 A/AA checks in light and dark
  themes. Runs on its own in-memory MongoDB; passes from Bash and PowerShell.
- Accessibility fixes found by the suite: `cn()` dropped `text-accent-contrast` on filled buttons
  (tailwind-merge did not know the custom font sizes; contrast 2.5:1), the organisation switcher's
  accessible name did not contain its visible text, reference links relied on colour alone, and
  scrollable tables and code blocks were not reachable by keyboard.

### Security
- `csv-parse` 7 and `react-router` 7: `npm audit --omit=dev` reports no vulnerabilities.
