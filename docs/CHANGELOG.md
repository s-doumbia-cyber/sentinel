# Changelog

All notable changes. Dates are UTC.

## 2026-10-21

### Day-wise validation in the training CLI
- `split.holdout` (`by: file` or a CSV column, explicit names / globs or a seeded fraction) keeps whole
  capture days out of training; the shipped model is tested on them. `metrics.json` (`heldOut`), the
  model card and the registry summary carry per-class precision / recall / F1 / support, per-group
  macro-F1 and warnings: a class absent from the held-out side gets no estimate, a class that appears
  only there is excluded and counted, and a pattern that matches nothing is an error. pytest coverage.

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
  rebuilt. Idempotent; refused while scoring or another rebuild runs. Audited (`detection.reapply`,
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
