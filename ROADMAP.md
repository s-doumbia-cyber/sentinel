# Sentinel — Roadmap

> Tick `[x]` as tasks finish. Each phase has a **gate**: do not start the next phase until the gate is met.
> Work one task at a time. Small commits. Update `docs/CHANGELOG.md`.
> Order rationale: tenancy and TypeScript first (retrofitting is painful), real detection before UI polish (the UI must reflect real data), then live ingestion, then workflow, then the UI rebuild on stable contracts.

---

## Phase 0 — Foundation (monorepo, TypeScript, tenancy, security baseline)

**Goal:** a clean base every later phase builds on, with the existing features still working.

- [ ] **0.1 Repo hygiene.** `.gitignore` for `.env`, `dist/`, `node_modules/`, model artefacts, captures. Add `.env.example`. If `.env` was ever committed, document secret rotation. *AC: `git status` clean of secrets; README states setup.*
- [ ] **0.2 Monorepo.** npm workspaces: `apps/web`, `apps/api`, `packages/shared`, `services/ml`, `services/collector` (empty scaffolds). Cross-platform scripts. *AC: `npm install && npm run dev` works on Windows PowerShell.*
- [ ] **0.3 Tooling.** ESLint, Prettier, TypeScript strict, Vitest, Husky/lint-staged (optional), GitHub Actions (lint, typecheck, test). *AC: CI green on a PR.*
- [ ] **0.4 Shared package.** zod schemas, attack taxonomy, severity map, MITRE map, label normaliser (ported from `csvImporter.js` with its tests). *AC: unit tests incl. the unknown-label → `null` case.*
- [ ] **0.5 API to TypeScript.** Port routes → controllers → services → repositories incrementally; central `config` (zod), pino logger, `AppError` + error envelope, request ids. *AC: all existing API tests pass in TS; no `any` without comment.*
- [ ] **0.6 Multi-tenancy.** `orgs`, `memberships`; `orgId` on every tenant collection; repository layer injects `orgId`; migration script assigns existing data to a default org. *AC: tenant-isolation tests (cross-org read/write → 404).*
- [ ] **0.7 Auth upgrade.** argon2id; access JWT in memory; refresh cookie (httpOnly, Secure, SameSite=Strict) with rotation + reuse detection; remove `sessionStorage` token usage; CSRF protection; login rate-limit. *AC: tests for rotation, reuse detection, logout-all; no token in storage (e2e check).*
- [ ] **0.8 RBAC policy module.** Single `authorize()` with role matrix; every route declares a policy. *AC: matrix test table (role × route) green.*
- [ ] **0.9 Audit log.** Append-only audit for all mutations. *AC: test that each mutating route writes one entry.*
- [ ] **0.10 Docker Compose base.** `mongo`, `redis`, `api`, `web` with healthchecks. *AC: `docker compose up --build` serves the app.*

**Gate 0:** existing functionality intact, TS strict, CI green, tenancy and auth tests green, no secrets in repo.

---

## Phase 1 — Real detection core

**Goal:** Sentinel actually detects. No more copied labels.

- [ ] **1.1 Stop faking predictions.** Import stores `groundTruthLabel`; `scored` empty until scored. Remove random `seed.js`. *AC: no code path sets a verdict from a dataset label.*
- [ ] **1.2 ML service scaffold.** FastAPI with `/health`, `/models`, `/predict`, `/reload`; schema validation; `python_requires>=3.11`; Dockerfile; pytest. *AC: contract tests pass.*
- [ ] **1.3 Training pipeline v2 (benchmark model).** Config-driven CLI per `docs/ML_AND_DETECTION.md` §4: stratified + group-aware splits, imbalance study, LR / RF / HistGradientBoosting, macro-F1 selection, artefacts + `env.json` + model card. *AC: reproducible run produces artefact dir; metrics include macro-F1 and per-class table with support.*
- [ ] **1.4 Model registry.** `models` collection, list/activate endpoints (Admin), reload ML service on activation, version-mismatch warning. *AC: activating a model changes scoring of the next batch (tested).*
- [ ] **1.5 Scoring worker.** BullMQ job: batch flows by schema → `/predict` → store `scored`. Retries and dead-letter. *AC: kill/restart worker mid-run; no flow lost or double-scored (idempotent).*
- [ ] **1.6 Explainability.** SHAP top-5 contributions for non-benign/low-confidence flows; `featureGlossary.json`. *AC: reconstruction test within tolerance.*
- [ ] **1.7 Rules engine.** JSON rule DSL, sliding windows in Redis, starter rules, `/rules/:id/test`. *AC: unit tests for each starter rule with positive and negative fixtures.*
- [ ] **1.8 Alerts.** Create/dedupe alerts from model + rules; `needs_review` for low confidence; alert API. *AC: ingest labelled sample → expected alert; benign sample → none; duplicate burst → one alert with `count`.*
- [ ] **1.9 Models lab backend.** Metrics, model card, drift job (PSI), feedback endpoints. *AC: drift job unit-tested on synthetic shift.*

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

- [ ] **3.1 Entities.** Entity upsert on ingest/alert; entity API; notes/tags. *AC: tests.*
- [ ] **3.2 Correlation.** Window-based grouping into incidents; severity escalation by kill-chain stage; MITRE strip. *AC: two related alerts → one incident (tested); config window respected.*
- [ ] **3.3 Incident API and events.** Status workflow, priority, assignee, SLA timers (server-computed), comments with mentions, timeline events. *AC: every change creates event + audit.*
- [ ] **3.4 Graph endpoint.** `/entities/:type/:value/graph` with bounded size and time range. *AC: 500-node response under 500 ms.*
- [ ] **3.5 Response guidance.** Knowledge-base content per attack type; blocklist generator (iptables/nftables/CSV) with syntax tests; "simulate apply". *AC: generated rules validated by tests.*
- [ ] **3.6 Integrations.** Webhooks (HMAC-signed), Slack, email; delivery log; retry with backoff. *AC: failure-path tests.*
- [ ] **3.7 Reports backend.** Executive/incident reports data layer; server-side PDF; CSV/XLSX. *AC: report numbers equal dashboard numbers for same range (tested).*

**Gate 3:** full analyst journey works via API and tests: alert → incident → comment → status → report → webhook.

---

## Phase 4 — Frontend rebuild (design system + pages)

**Goal:** a visibly premium, accessible UI on stable contracts. Follow `docs/DESIGN_SYSTEM.md` exactly.

- [ ] **4.1 Design system foundation.** Tokens (CSS vars), Tailwind theme, fonts self-hosted, `cn()`, theme/density/accent, no-flash script. `/dev/components` page. *AC: contrast checks pass in both themes.*
- [ ] **4.2 Core components.** Button, inputs, DataTable (virtualized, saved views), KpiCard, ChartCard, badges, EntityChip, Timeline, Drawer/Dialog/Popover, Toasts, Skeleton/Empty/Error. *AC: every component has all states + keyboard behaviour.*
- [ ] **4.3 App shell.** Rail, top bar, org switcher, global time range (URL state), notifications, user menu, mobile tab bar. *AC: usable at 375 px.*
- [ ] **4.4 Command palette and shortcuts.** cmdk, shortcut overlay, G-then-key navigation. *AC: all primary actions reachable by keyboard.*
- [ ] **4.5 Auth screens and onboarding.** Login/register, invite acceptance, checklist for empty orgs. *AC: no fake zeros on empty orgs.*
- [ ] **4.6 Command Center.** Per spec §7. *AC: every KPI links to the list that produced it.*
- [ ] **4.7 Alerts + Alert detail.** Queue, drawer, bulk actions, keyboard triage, "Why this fired", verdicts. *AC: 25 alerts triaged keyboard-only.*
- [ ] **4.8 Live monitor.** SSE list (virtualized), source badges, pause, filters, optional sound. *AC: 1,000 rows/min without jank.*
- [ ] **4.9 Incidents.** Board (dnd-kit) + table; detail with timeline, evidence, entities graph, report. *AC: drag and drop works with mouse and keyboard; rollback on failure.*
- [ ] **4.10 Investigate.** Entity pages and GraphView. *AC: 500-node graph at 60 fps pan/zoom.*
- [ ] **4.11 Detections, Models lab, Sources, Integrations.** Per spec §7. *AC: model activation and rule test flows work end-to-end.*
- [ ] **4.12 Reports, Team, Audit, Settings.** Including API keys UI, sessions, MFA placeholder (stretch). *AC: all settings genuinely persist.*
- [ ] **4.13 i18n.** EN/FR/HI for all UI chrome; lint rule against hard-coded strings. *AC: switching language translates every static string.*
- [ ] **4.14 Accessibility and visual QA.** Axe checks in Playwright, screen-reader pass on login/alerts/incident detail, visual snapshots. *AC: no serious Axe violations.*

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

- [ ] **6.1 `docker compose --profile demo up`** seeds org, role users, honest replay source, trained sample model; everything tagged DEMO/REPLAY.
- [ ] **6.2 Demo script** (5 minutes) in `docs/DEMO.md`, rehearsed; fallback steps if the live attack fails.
- [ ] **6.3 Backup video** (2-3 min) recorded from a clean run.
- [ ] **6.4 README.** Architecture diagram, screenshots/GIFs, quick start, benchmarks, honest limitations, roadmap.
- [ ] **6.5 Evaluation report.** Model cards, cross-dataset table, latency/throughput numbers, lab dataset card.
- [ ] **6.6 One-page pitch.** Problem, audience, differentiators, comparison table, next steps.
- [ ] **6.7 Release.** Tag `v1.0.0`, GitHub release notes, LICENSE decision.

**Gate 6:** a stranger can clone, run one command, and follow `DEMO.md` successfully.

---

## Decisions log (append as you go)

| Date | Decision | Reason |
|---|---|---|
| | | |
