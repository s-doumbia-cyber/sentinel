# Sentinel — Roadmap

> Tick `[x]` as tasks finish. Each phase has a **gate**: do not start the next phase until the gate is met.
> Work one task at a time. Small commits. Update `docs/CHANGELOG.md`.
> Order rationale: tenancy and TypeScript first (retrofitting is painful), real detection before UI polish (the UI must reflect real data), then live ingestion, then workflow, then the UI rebuild on stable contracts.

---

## Phase 0 — Foundation (monorepo, TypeScript, tenancy, security baseline)

**Goal:** a clean base every later phase builds on, with the existing features still working.

- [x] **0.1 Repo hygiene.** `.gitignore` for `.env`, `dist/`, `node_modules/`, model artefacts, captures. Add `.env.example`. If `.env` was ever committed, document secret rotation. *AC: `git status` clean of secrets; README states setup.* ✅ *2026-10-20: new git repo, .env never committed, root and API .env.example, README setup.*
- [x] **0.2 Monorepo.** npm workspaces: `apps/web`, `apps/api`, `packages/shared`, `services/ml`, `services/collector` (empty scaffolds). Cross-platform scripts. *AC: `npm install && npm run dev` works on Windows PowerShell.* ✅ *2026-10-20: `npm install` + `npm run dev` verified from PowerShell (API 4000, web 5173, proxy). Collector is a README placeholder.*
- [x] **0.3 Tooling.** ESLint, Prettier, TypeScript strict, Vitest, Husky/lint-staged (optional), GitHub Actions (lint, typecheck, test). *AC: CI green on a PR.* ✅ *2026-10-20: ESLint (flat), TS strict, Vitest; `.github/workflows/ci.yml` runs typecheck, lint, tests and build on Node 22 and 24, a blocking production `npm audit`, pytest, the Playwright + axe e2e suite and the Docker build, on `ubuntu-24.04`. Green on `main` (run #1, 780d5b5) and on pull request s-doumbia-cyber/sentinel#1 (run #2, 4832bd3, all five jobs in 3 min 26 s; run #3, 3ce30fd, green again). Prettier is installed but not enforced; Husky / lint-staged not added (optional).*
- [x] **0.4 Shared package.** zod schemas, attack taxonomy, severity map, MITRE map, label normaliser (ported from `csvImporter.js` with its tests). *AC: unit tests incl. the unknown-label → `null` case.* ✅ *65 tests incl. unknown → null and shared vectors also run by Python.*
- [x] **0.5 API to TypeScript.** Port routes → controllers → services → repositories incrementally; central `config` (zod), pino logger, `AppError` + error envelope, request ids. *AC: all existing API tests pass in TS; no `any` without comment.* ✅ *Legacy tests rewritten against the TS API (register, login, me, preferences, KPIs, breakdowns, top attackers/subnets, pagination now cursor-based); 49 tests green; no `any`.*
- [x] **0.6 Multi-tenancy.** `orgs`, `memberships`; `orgId` on every tenant collection; repository layer injects `orgId`; migration script assigns existing data to a default org. *AC: tenant-isolation tests (cross-org read/write → 404).* ✅ *Mongoose tenant guard rejects unscoped queries; cross-org read/write → 404 tested; `migrate:legacy` (dry run by default) assigns legacy data to a default org; not run on real data.*
- [x] **0.7 Auth upgrade.** argon2id; access JWT in memory; refresh cookie (httpOnly, Secure, SameSite=Strict) with rotation + reuse detection; remove `sessionStorage` token usage; CSRF protection; login rate-limit. *AC: tests for rotation, reuse detection, logout-all; no token in storage (e2e check).* ✅ *Rotation, reuse detection, logout-all, CSRF, rate limit tested; no token in storage checked by a unit test and by the Playwright journey (web storage empty of tokens, refresh cookie httpOnly / Secure / SameSite=Strict).*
- [x] **0.8 RBAC policy module.** Single `authorize()` with role matrix; every route declares a policy. *AC: matrix test table (role × route) green.* ✅ *Role × route matrix test over every declared route.*
- [x] **0.9 Audit log.** Append-only audit for all mutations. *AC: test that each mutating route writes one entry.* ✅ *Test asserts one entry per mutating route; Mongoose hooks make it append-only.*
- [x] **0.10 Docker Compose base.** `mongo`, `redis`, `api`, `web` with healthchecks. *AC: `docker compose up --build` serves the app.* ✅ *`docker compose up --build` served the app and passed `npm run smoke` (2026-10-20). Redis deferred until BullMQ (1.5).*

**Gate 0:** existing functionality intact, TS strict, CI green, tenancy and auth tests green, no secrets in repo.

---

## Phase 1 — Real detection core

**Goal:** Sentinel actually detects. No more copied labels.

- [x] **1.1 Stop faking predictions.** Import stores `groundTruthLabel`; `scored` empty until scored. Remove random `seed.js`. *AC: no code path sets a verdict from a dataset label.* ✅ *Import stores `groundTruthLabel`; `scored` empty until scored; seed.js removed.*
- [x] **1.2 ML service scaffold.** FastAPI with `/health`, `/models`, `/predict`, `/reload`; schema validation; `python_requires>=3.11`; Dockerfile; pytest. *AC: contract tests pass.* ✅ *pytest contract tests (46 tests total).*
- [x] **1.3 Training pipeline v2 (benchmark model).** Config-driven CLI per `docs/ML_AND_DETECTION.md` §4: stratified + group-aware splits, imbalance study, LR / RF / HistGradientBoosting, macro-F1 selection, artefacts + `env.json` + model card. *AC: reproducible run produces artefact dir; metrics include macro-F1 and per-class table with support.* ✅ *Runs from CSV; Mongo source, SMOTE and threshold tuning not done yet (see services/ml/README.md).*
- [x] **1.4 Model registry.** `models` collection, list/activate endpoints (Admin), reload ML service on activation, version-mismatch warning. *AC: activating a model changes scoring of the next batch (tested).* ✅ *Registry = artefact directory + per-org active model (decision below); activation test proves the next batch uses the new model; version mismatch warns or blocks.*
- [x] **1.5 Scoring worker.** BullMQ job: batch flows by schema → `/predict` → store `scored`. Retries and dead-letter. *AC: kill/restart worker mid-run; no flow lost or double-scored (idempotent).* ✅ *2026-10-21: imports, scoring, detections and asset refresh are BullMQ jobs when `REDIS_URL` is set (in-process fallback with the same retry policy otherwise); 3 attempts with exponential backoff, dead letters in `failed_jobs` with an Admin view and audited retry; Compose `redis` service with healthcheck; optional worker-only process. Alert evidence is claimed in the same write as the verdict and settled once per claim key, so a retried or stalled job neither loses nor double-counts (tests: crash before / after the alert update, never-retried claims, import retried after a crash, and a real worker process killed with SIGKILL against Redis 8.0.5, taken over by another worker).*
- [ ] **1.6 Explainability.** SHAP top-5 contributions for non-benign/low-confidence flows; `featureGlossary.json`. *AC: reconstruction test within tolerance.* ⏳ *SHAP top-5 for non-benign / low-confidence flows with reconstruction tests done; featureGlossary.json (plain-language labels) not done.*
- [x] **1.7 Rules engine.** JSON rule DSL, sliding windows in Redis, starter rules, `/rules/:id/test`. *AC: unit tests for each starter rule with positive and negative fixtures.* ✅ *2026-10-20: zod rule DSL, 5 starter rules, streaming sliding-window evaluator, `POST /rules/:id/test`; 18 unit tests with positive and negative fixtures per starter rule. Windows are in-memory over event-time-sorted flows, not Redis (decision below).*
- [x] **1.8 Alerts.** Create/dedupe alerts from model + rules; `needs_review` for low confidence; alert API. *AC: ingest labelled sample → expected alert; benign sample → none; duplicate burst → one alert with `count`.* ✅ *2026-10-20: alerts from model + rules, dedupe (10-min bucket) with `count`, hybrid severity, `needs_review` below the org threshold, alert API; integration tests: attack sample → DDoS alert, benign → none, 25-flow burst → one alert count 25, idempotent re-run.*
- [ ] **1.9 Models lab backend.** Metrics, model card, drift job (PSI), feedback endpoints. *AC: drift job unit-tested on synthetic shift.* ⏳ *Model metrics and card served; drift job and feedback not started.*

**Gate 1:** end-to-end test passes: CSV import of a held-out sample → scored → alerts with explanations. Model card exists. No fabricated metrics anywhere.

---

## Phase 2 — Live ingestion and the lab dataset

**Goal:** real traffic in, real alerts out, with measured latency.

- [ ] **2.1 Ingest API.** `POST /ingest/flows` with API-key auth, zod validation, gzip, idempotency keys, 429 backpressure, `POST /ingest/heartbeat`. *AC: load test ≥ 1,500 flows/s on a laptop; duplicate batch ignored.*
- [ ] **2.2 API keys.** Create (shown once), list, revoke; HMAC hash storage; scopes. *AC: revoked key rejected within 5 s; tests.*
- [ ] **2.3 Collector.** `services/collector` with `live`, `pcap`, `replay` modes, batching, retry/backoff, heartbeat, native feature extraction (`sentinel-native-v1`) with unit tests against a known PCAP. *AC: PCAP of a scripted nmap scan produces expected flow count and feature values.*
- [ ] **2.4 Sources.** Sources API and status computation (online/stale/offline). *AC: stopping the collector flips status within 30 s.*
- [ ] **2.5 SSE stream.** `/stream` with Redis pub/sub, `Last-Event-ID` resume, replay buffer. *AC: reconnect yields no gaps or duplicates (tested).*
- [ ] **2.6 Lab setup and scripts.** `lab/` folder with topology guide, benign generators, attack scripts that log to `attack_runs.csv`, auto-labeller. *AC: README lets the owner reproduce the lab; labelling script has tests.*
- [ ] **2.7 Lab dataset and lab model.** Collect per protocol §11; train `sentinel-native-v1` model; cross-dataset evaluation table (CICIDS→lab, lab→lab) in the model card. *AC: held-out *runs* macro-F1 reported honestly, including weak classes.*
- [ ] **2.8 Latency measurement.** Script measuring collector-send → SSE-receive. *AC: p95 < 2 s recorded in README.*

**Gate 2:** from a Kali VM, `nmap` against the lab server produces an alert visible via SSE in under 2 s p95; numbers recorded.

---

## Phase 3 — Incidents, investigation, response

**Goal:** the analyst workflow.

- [ ] **3.1 Entities.** Entity upsert on ingest/alert; entity API; notes/tags. *AC: tests.* ⏳ *2026-10-20: IP assets rebuilt from flows after every import (idempotent aggregation, stale → inactive), `GET/PATCH /assets`, notes/tags kept across rebuilds, 4 integration tests. Only IP entities: user/host/domain entities and upsert on live ingest are not done.*
- [x] **3.2 Correlation.** Window-based grouping into incidents; severity escalation by kill-chain stage; MITRE strip. *AC: two related alerts → one incident (tested); config window respected.* ✅ *2026-10-20: same source within the org's `correlationWindowMinutes` (default 15) → one incident, +1 severity for ≥2 kill-chain stages, joins an open incident, serialized per org; tests for grouping, no grouping, joining and a 90-minute org window. The grouping is labelled a hypothesis. MITRE shown per step on the attack timeline (no separate strip).*
- [ ] **3.3 Incident API and events.** Status workflow, priority, assignee, SLA timers (server-computed), comments with mentions, timeline events. *AC: every change creates event + audit.* ⏳ *2026-10-20: append-only `incident_events` (created, correlated, alerts linked, status/priority/severity/assignee/title changes, notes, recorded actions, simulations, reports), each mirrored in `audit_log`, tested. SLA timers and mentions not done.*
- [ ] **3.4 Graph endpoint.** `/entities/:type/:value/graph` with bounded size and time range. *AC: 500-node response under 500 ms.*
- [x] **3.5 Response guidance.** Knowledge-base content per attack type; blocklist generator (iptables/nftables/CSV) with syntax tests; "simulate apply". *AC: generated rules validated by tests.* ✅ *2026-10-20: versioned knowledge base for every malicious class (confirm / contain / references), iptables/ip6tables, nftables and CSV generators with syntax and comment-injection tests; simulations are logged and marked `applied: false`. Sentinel has no enforcement integration and says so.*
- [ ] **3.6 Integrations.** Webhooks (HMAC-signed), Slack, email; delivery log; retry with backoff. *AC: failure-path tests.*
- [ ] **3.7 Reports backend.** Executive/incident reports data layer; server-side PDF; CSV/XLSX. *AC: report numbers equal dashboard numbers for same range (tested).* ⏳ *2026-10-20: incident report data layer (facts, hypotheses, entities with graded identity, response, investigation log, provenance, limitations), tested; printed to PDF by the browser. Executive report, server-side PDF and CSV/XLSX not done.*

**Gate 3:** full analyst journey works via API and tests: alert → incident → comment → status → report → webhook.

---

## Phase 4 — Frontend rebuild (design system + pages)

**Goal:** a visibly premium, accessible UI on stable contracts. Follow `docs/DESIGN_SYSTEM.md` exactly.

- [ ] **4.1 Design system foundation.** Tokens (CSS vars), Tailwind theme, fonts self-hosted, `cn()`, theme/density/accent, no-flash script. `/dev/components` page. *AC: contrast checks pass in both themes.* ⏳ *Tokens, themes, accents, density, self-hosted fonts, cn(), no-flash script done; /dev/components page and automated contrast checks missing.*
- [ ] **4.2 Core components.** Button, inputs, DataTable (virtualized, saved views), KpiCard, ChartCard, badges, EntityChip, Timeline, Drawer/Dialog/Popover, Toasts, Skeleton/Empty/Error. *AC: every component has all states + keyboard behaviour.*
- [ ] **4.3 App shell.** Rail, top bar, org switcher, global time range (URL state), notifications, user menu, mobile tab bar. *AC: usable at 375 px.* ⏳ *Rail, top bar, org switcher, user menu, mobile tab bar (checked at 375 px); global time range and notifications missing.*
- [ ] **4.4 Command palette and shortcuts.** cmdk, shortcut overlay, G-then-key navigation. *AC: all primary actions reachable by keyboard.*
- [ ] **4.5 Auth screens and onboarding.** Login/register, invite acceptance, checklist for empty orgs. *AC: no fake zeros on empty orgs.* ⏳ *Login/register done; onboarding checklist replaces zeros for empty orgs; invites missing.*
- [ ] **4.6 Command Center.** Per spec §7. *AC: every KPI links to the list that produced it.* ⏳ *KPIs link to the filtered flow list; volume chart, verdict mix, top sources/ports, model health; ATT&CK strip and needs-attention list missing (no alerts yet).*
- [ ] **4.7 Alerts + Alert detail.** Queue, drawer, bulk actions, keyboard triage, "Why this fired", verdicts. *AC: 25 alerts triaged keyboard-only.* ⏳ *Alerts queue (URL filters, J/K/Enter), drawer with why-it-fired, triage status and verdicts done; saved views and E/I/F shortcuts missing. 2026-10-20: drawer separates observed / inferred / unknown, shows graded attribution and provenance; incident creation from one alert or a selection added. Keyboard-only triage of 25 alerts not verified.*
- [ ] **4.8 Live monitor.** SSE list (virtualized), source badges, pause, filters, optional sound. *AC: 1,000 rows/min without jank.*
- [ ] **4.9 Incidents.** Board (dnd-kit) + table; detail with timeline, evidence, entities graph, report. *AC: drag and drop works with mouse and keyboard; rollback on failure.* ⏳ *2026-10-20: table + board (click to open), incident page with overview, attack timeline (facts vs hypotheses), investigation log, response tab and printable report, checked in a browser at desktop and 375 px. Drag and drop and the entities graph not done.*
- [ ] **4.10 Investigate.** Entity pages and GraphView. *AC: 500-node graph at 60 fps pan/zoom.* ⏳ *2026-10-20: asset pages (observed services, labelled device estimate, identity, activity, peers, alerts, notes). GraphView not done.*
- [ ] **4.11 Detections, Models lab, Sources, Integrations.** Per spec §7. *AC: model activation and rule test flows work end-to-end.* ⏳ *Models lab and Rules page (list, enable, JSON edit, test) done; severity map / MITRE tabs, sources and integrations not built.*
- [ ] **4.12 Reports, Team, Audit, Settings.** Including API keys UI, sessions, MFA placeholder (stretch). *AC: all settings genuinely persist.* ⏳ *Team, audit, settings (profile, preferences persisted server-side, password, sessions, export, delete) done; reports, API keys missing.*
- [ ] **4.13 i18n.** EN/FR/HI for all UI chrome; lint rule against hard-coded strings. *AC: switching language translates every static string.*
- [ ] **4.14 Accessibility and visual QA.** Axe checks in Playwright, screen-reader pass on login/alerts/incident detail, visual snapshots. *AC: no serious Axe violations.* ⏳ *2026-10-20: `npm run test:e2e` runs axe (WCAG 2.1 A/AA) on sign-in, 17 app pages, the alert drawer and the report in the light theme, and on 10 pages in the dark theme: no serious or critical violation after fixing five real defects (see CHANGELOG). Screen-reader pass and visual snapshots not done, so not ticked.*

**Gate 4:** UI passes accessibility checks, mobile triage works, no mock data remains in `apps/web`.

---

## Phase 5 — Product-grade polish

- [ ] **5.1 Multi-org UX.** Org creation, invites, member management, role changes (with audit). 
- [ ] **5.2 MFA (TOTP)** *(stretch)* with recovery codes.
- [ ] **5.3 Retention and purge** jobs, system health page.
- [ ] **5.4 Performance pass.** Rollup collections, caching, indexes; benchmark script; targets in `docs/PRODUCT_SPEC.md` §6 met and recorded.
- [ ] **5.5 Security pass.** CSP, CSRF review, dependency audit, ASVS L1 checklist doc, secrets review, upload hardening.
- [ ] **5.6 Observability.** Structured logs, `/healthz`, `/readyz`, optional `/metrics`.
- [ ] **5.7 Novelty detection** *(stretch)* IsolationForest "unknown behaviour".
- [ ] **5.8 OpenAPI docs** published at `/api/docs`.

**Gate 5:** benchmarks recorded, security checklist complete, docs match behaviour.

---

## Phase 6 — Expo and pitch package

- [ ] **6.1 `docker compose --profile demo up`** seeds org, role users, honest replay source, trained sample model; everything tagged DEMO/REPLAY. ⏳ *2026-10-20: `npm run seed:demo` creates the org, Owner / Analyst / Viewer accounts and the synthetic DEMO scenario (tested, run on a throwaway database). No Compose profile, no replay source and no model activation yet.*
- [ ] **6.2 Demo script** (5 minutes) in `docs/DEMO.md`, rehearsed; fallback steps if the live attack fails.
- [ ] **6.3 Backup video** (2-3 min) recorded from a clean run.
- [ ] **6.4 README.** Architecture diagram, screenshots/GIFs, quick start, benchmarks, honest limitations, roadmap.
- [ ] **6.5 Evaluation report.** Model cards, cross-dataset table, latency/throughput numbers, lab dataset card.
- [ ] **6.6 One-page pitch.** Problem, audience, differentiators, comparison table, next steps.
- [ ] **6.7 Release.** Tag `v1.0.0`, GitHub release notes, LICENSE decision.

**Gate 6:** a stranger can clone, run one command, and follow `DEMO.md` successfully.

---

## Supplementary objectives (owner brief, 2026-10-20)

Added on top of the phases above, not replacing them. Ticked only when verified.

- [x] **A1 Evidence-based investigation.** Alert analysis separates *observed* (stored data + source), *inferred* (model, rule, heuristic) and *unknown*, each with its basis. ✅ *API test + component test; checked in the browser on the demo scenario.*
- [x] **A2 VPN and attribution.** Observed IP and its limits always shown; identity only from imported VPN / DHCP / auth / EDR / directory / manual records, with source, validity window, graded confidence, ambiguity flag and caveats; "unknown" plus what would help otherwise. ✅ *CSV import of identity records; live connectors to VPN, AD or EDR are not built (see Decisions).*
- [x] **A3 Device and user context.** Device type estimated from accepted services, always labelled low-confidence with its basis; "unknown" otherwise, with what would help. ✅ *Asset pages show the estimate and every identity record for the address over time; an audited account / hostname / MAC lookup lists addresses held and alerts in those windows (API tests, e2e, browser). No OS fingerprinting: it would need the collector or an EDR export.*
- [x] **A4 Analyst path.** Alert → analysis → triage verdict → incident (correlated, from alerts or manual) → attack timeline → investigation log → report, persisted and audited. ✅ *API tests + browser walkthrough on the demo scenario.*
- [x] **A5 Visual identity.** Light ivory theme by default, dark high-contrast text, pine / ocean / plum accents, severity colours reserved for alerts, short purposeful motion that respects `prefers-reduced-motion`; dark theme kept. ✅ *Token pairs computed ≥ 4.5:1; checked at desktop and 375 px. Automated contrast tests (4.1) still missing.*
- [x] **A6 Scenario correlation.** See 3.2; timeline in event time with facts and hypotheses (basis + limits); MITRE labelled "suggested", never proof. ✅
- [x] **A7 Detection validation.** Reproducible runs of a model version or a rule version on a labelled dataset: per-class precision / recall / F1 / support, FP and FN samples (with SHAP for models), dataset SHA-256, training-overlap check, author and time, immutable records, notes on what the score does not prove. ✅ *API tests; browser run on the demo data. No lab or second public dataset imported yet, so no independent benchmark exists (2.7).*
- [x] **A8 Asset inventory over time.** ✅ *Inventory, first/last seen, activity per time bucket, peers, notes, and an append-only change history recorded at each refresh (services, estimate, inactive / reactivated, note edits) without scan noise or duplicates (API test incl. concurrent refreshes, e2e, browser).*
- [x] **A9 Prudent response.** Recommendations, simulations and analyst-reported actions are three separate things in the API, UI and report; Sentinel never claims to block, isolate or change a firewall. ✅ *Executed actions require a real integration that does not exist yet.*
- [x] **A10 Traceability.** ✅ *Audit log covers imports, detections, triage, incident changes, simulations, reports, identity imports and lookups, validation runs and asset edits; alert detail shows its provenance and history; the incident *Trace* (also in the report) links dataset import (hash, importer), identity imports used, detection (rules / models), triage, investigation, response and report in recorded order (API test, e2e, browser). Secrets are never logged. Ingestion is file import only until the collector (Phase 2).*

---

## Decisions log (append as you go)

| Date | Decision | Reason |
|---|---|---|
| 2026-10-20 | Legacy code imported from `cyber-dashboard (2).zip` into a fresh git repo (zip kept, git-ignored). | The working folder was not a repository; history starts from an honest baseline commit. |
| 2026-10-20 | Flows keep the legacy collection `networkflows` and field names (`sourceIp`, `destinationIp`, `timestamp`...) instead of ARCHITECTURE's `flows`/`srcIp`. | Lets `migrate:legacy` update millions of rows in place instead of copying them. **Conflict with ARCHITECTURE.md §4, flagged.** |
| 2026-10-20 | No global `models` collection: the ML service's artefact directory is the registry, and each org stores its active model per schema in `orgs.settings.activeModels`. | A global activation would let one tenant's Admin change another tenant's detection. **Conflict with ARCHITECTURE.md §4 / ML §4.9, flagged.** |
| 2026-10-20 | Refresh tokens are opaque (`<sessionId>.<secret>`), SHA-256 stored, rotated on every refresh, with a 10 s grace for the just-rotated token. | Reuse detection without false positives when two tabs refresh at once. |
| 2026-10-20 | Registering creates a new org with the user as Owner; invites come later (5.1). | Multi-tenancy needs an org from the first login. |
| 2026-10-20 | Password minimum 12 characters. | OWASP ASVS 2.1.1 (the legacy rule was 8). |
| 2026-10-20 | `Destination Port` is excluded from `cicids2017-v1` features; `Fwd Header Length` (duplicated column) too. | Limits shortcut learning on the testbed's fixed ports; known CICIDS duplicate-column error. |
| 2026-10-20 | `DoS Slowhttptest` maps to `DoSSlowloris`. | The taxonomy has one slow-request DoS class; documented in the normaliser. |
| 2026-10-20 | CICIDS2017 timestamps are parsed day/month/year and stored as recorded (UTC, no conversion); the 12-hour clock ambiguity is documented, not guessed. | The legacy parser read month/day and fell back to "now" on failure. |
| 2026-10-20 | Rows with an unknown dataset label are imported (they are real traffic) with `groundTruthLabel = null` and counted; rows with invalid identifiers are rejected and sampled. | Detection should not drop traffic because a label is unknown; evaluation never uses unknown labels. Training (Python) still drops them. |
| 2026-10-20 | Background work (imports, scoring) runs in-process (`BackgroundJobs`); Redis/BullMQ deferred to task 1.5, so Compose has no Redis service yet. | No queue consumer exists yet; adding an unused service would mislead. |
| 2026-10-20 | Explanations: SHAP `TreeExplainer` for tree models (probability space for random forests, log-odds for gradient boosting), coefficient × standardised value for logistic regression. | Matches ML §6; `shap` 0.54 installs on Python 3.14 and 3.12. |
| 2026-10-20 | ML Docker image sets `OMP_NUM_THREADS=1`. | OpenMP threads busy-spun forever after model selection inside the container (observed 2026-10-20). |
| 2026-10-20 | Accent presets are violet / cyan / emerald (legacy "pink" maps to violet); filled buttons use a darker `--accent-solid`. | DESIGN_SYSTEM §2.3; white on #8B5CF6 is 4.2:1, below WCAG AA for 14 px text. **Small deviation from §2.1, flagged.** |
| 2026-10-20 | Native `<select>` styled with tokens instead of a Radix Select. | Platform keyboard and screen-reader behaviour; not a hand-rolled dropdown. |
| 2026-10-20 | Pages without a backend (live monitor, threat intel, analytics, reports) were removed from the UI rather than shown as placeholders. | "Everything the UI shows must exist in the backend" (PRODUCT_SPEC §3). |
| 2026-10-20 | Legacy auto-generated incidents are flagged `legacyAutoGenerated`, not deleted; legacy `seed.js` flows are not migrated (stay invisible). | Never delete user data without consent; never present fabricated data as real. |
| 2026-10-20 | Rule sliding windows run in memory over flows streamed in event-time order (per-group deque), not in Redis. | No Redis in the stack yet; event-time evaluation also works for imported historical data. **Deviation from ML §7 / ROADMAP 1.7 wording, flagged.** Revisit with live ingest (2.1). |
| 2026-10-20 | Alerts dedupe on sha256(org, src, dst, type, 10-minute bucket); `count` = model-flagged flows + rule hits. | ARCHITECTURE §3.3 leaves the window open; 10 minutes groups a burst without merging unrelated days. |
| 2026-10-20 | Model evidence is claimed per flow (`alertedAt` + `alertClaim`) before it is counted: at-most-once. | Fixes a real double count between scoring and the backfill job; a crash between claim and update loses that evidence until durable queues (1.5). |
| 2026-10-20 | Rule hits carry deterministic hit keys stored on the alert, so re-running detections never double-counts. | "Run detections" and re-imports must be safe to repeat. |
| 2026-10-20 | Starter rules are seeded per org on first use and cannot be deleted (disable instead); custom rules can. | Re-seeding would otherwise resurrect deleted starters. |
| 2026-10-20 | Analyst statuses (acknowledged, dismissed, resolved) are never overwritten by new evidence; a FP/benign verdict dismisses, a TP verdict acknowledges. | The analyst's decision wins; new evidence still increments `count`. |
| 2026-10-20 | Default theme is light ivory with natural accents (pine / ocean / plum); legacy accents map to pine; dark theme kept as an option. | Owner brief (2026-10-20). **Conflict with DESIGN_SYSTEM.md (dark-first, violet / cyan / emerald), flagged; DESIGN_SYSTEM.md updated.** |
| 2026-10-20 | Identity comes only from imported records (CSV: ip, start, end, source, username / hostname / mac). Confidence: high only for VPN / auth / EDR records covering the whole activity window, medium when partial or device-level (DHCP), low for manual or non-overlapping records. | An IP never proves identity; live VPN / AD / EDR connectors need the owner's systems and consent. |
| 2026-10-20 | Identity data (usernames, hostnames) is readable by Analysts and above (`identity:read`); imports and deletions by Owners / Admins (`identity:manage`). Viewers see "restricted", also in reports they generate. | Personal data, need-to-know. |
| 2026-10-20 | Correlation: alerts from the same source, each within the org's `correlationWindowMinutes` (default 15) of the previous one, form one incident; severity +1 when two or more kill-chain stages are involved. | Simple, explainable, testable; labelled a hypothesis in the UI. |
| 2026-10-20 | Device type is computed on read from accepted services (≥ 3 flows per port) and always labelled a low-confidence estimate. | Heuristic changes apply everywhere at once; ports are conventions, not proof. |
| 2026-10-20 | Incident events are append-only (`incident_events`) and separate from the audit log; the attack timeline uses event time, the investigation log wall-clock time. | Two different questions: what happened on the network vs what the team did. |
| 2026-10-20 | Validation runs are immutable records; rule runs score flows inside the windows that fired (an approximation, stated in the run). | Traceable results; rules fire on groups, labels exist per flow. |
| 2026-10-20 | Incident report rendered by the browser (print / save as PDF) instead of a server-side PDF. | No new dependency; server-side PDF stays open in 3.7. |
| 2026-10-20 | E2E suite (`e2e/`, Playwright + axe, owner-approved) starts its own API on an in-memory MongoDB with `.env` loading disabled, on ports 4310 / 5310, never reusing a running server; no ML service, so every alert in it comes from a rule. | A test run must never reach a developer database or depend on a trained model. |
| 2026-10-20 | `cn()` uses `extendTailwindMerge` with the custom font sizes and shadows. | tailwind-merge read `text-small` as a colour and dropped `text-accent-contrast`: dark text on every filled button (2.5:1), found by axe. |
| 2026-10-20 | Account / device lookups are audited (`identity.lookup`, with the query); per-address identity views are not. | Searching a person across all records is profiling; viewing the identity of an address under investigation is routine. |
| 2026-10-20 | Asset history is diffed at each inventory refresh against stored `serviceKeys` / `estimateLabel`; ports with fewer than 3 flows are ignored; inactive assets keep their last known state. | The inventory is rebuilt from flows, so history must be derived; scans would otherwise flood it. |
| 2026-10-20 | `seed:demo` uses reserved `.test` addresses and random passwords printed once; it never resets or deletes, and refuses when the demo exists. | Real, honest demo accounts without default credentials or destructive behaviour. |
| 2026-10-20 | Empty values in `.env` mean "not set". | `.env.example` ships `ML_SERVICE_TOKEN=` empty; the documented setup failed validation. |
| 2026-10-20 | Minimum Node is 22 (engines, CI matrix 22 / 24, Docker base `node:22-bookworm-slim`). | Node 20 reached end of life in April 2026. **CLAUDE.md §4 said Node 20; updated and flagged.** |
| 2026-10-20 | CI: production `npm audit --audit-level=high` blocks; `pip-audit` only warns until Python dependencies are pinned; actions use the current majors (checkout / setup-node / setup-python / upload-artifact v7, cache v6). | Security rule "dependency audit in CI" without failing on unpinnable ranges. |
| 2026-10-20 | Alert noise controls: `modelAlertMinConfidence` (default 0 = off) and `alertAllowlist` per org; suppressed verdicts are claimed with `alertSuppressed` so the backfill never reprocesses them; settings apply to evidence processed after saving, existing alerts are not rewritten. | Hundreds of benign CICIDS2017 flows became alerts; the analyst needs a documented, audited way to tune it without losing verdicts. |
| 2026-10-20 | The allowlist matches either endpoint of a flow, for model and rule alerts alike. | Benign noise involved trusted servers on either side; the UI warns that trusting an address also hides real attacks involving it. |
| 2026-10-20 | Starter rules carry a list of previous defaults (`STARTER_RULE_UPGRADES`); an org's copy is upgraded only while its definition equals the previous default exactly. | Improve defaults for everyone without overwriting an analyst's changes. |
| 2026-10-20 | Demo data is synthetic, generated by a deterministic script (`npm run demo:data`), imported with `--demo`, and validation runs on DEMO datasets say the score proves nothing. | Honest demo without downloading or fabricating "real" captures. |
| 2026-10-21 | BullMQ queues on Redis when `REDIS_URL` is set; otherwise the same handlers run in-process with the same retry policy (3 attempts, exponential backoff) and dead letters. Workers run in the API process by default (`RUN_WORKERS`), or in `src/worker.ts` with a shared `UPLOAD_DIR`. Supersedes the 2026-10-20 in-process decision. | Tests and e2e need no external service; Compose gets durability. |
| 2026-10-21 | Alert evidence is now at-least-once with idempotent counting instead of at-most-once: the claim (`alertClaim` + `alertClaimedAt`) is written with the verdict; settling applies each (claim, alert) group once (`claimKeys` on the alert) before marking flows `alertedAt`. Retries reuse the job id as claim prefix; a dead-letter retry takes over the failed job's claims (`resumeOf`); claims older than 10 minutes are settled by any run. Rule hit keys are now checked inside the update filter (atomic). | A crash between claim and alert update used to lose evidence (2026-10-20 trade-off). |
| 2026-10-21 | A retried import deletes the rows of its interrupted attempt before re-reading the file; the upload is removed after success or the last attempt, so a dead-letter retry of an import asks for a new upload. | Re-import without duplicates; no unbounded growth of the upload directory. |
| 2026-10-21 | `/api/v1/jobs/status` reports only the caller's org (busy kinds, failed jobs); global queue depths are an operator metric (`/metrics`). | Queue depth across tenants is information about other customers. |
