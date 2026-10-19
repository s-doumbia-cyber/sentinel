# Sentinel

**Explainable network threat detection and triage for small security teams.**

Sentinel stores network flows, scores them with a served machine-learning model, explains every
verdict, and gives analysts a place to investigate. It is built to be honest about what it does:
every verdict comes from a model you can inspect (never from a dataset label), every record shows
where it came from, and every model ships with per-class results and its known limits.

> **Status (October 2026): early, working foundation.** CSV import, real ML scoring with SHAP
> explanations, model cards, multi-tenant orgs, secure auth, RBAC, audit log and a rebuilt UI work
> end to end and are tested. Live capture, rules, alerts, correlation, integrations and reports
> are **not built yet**; see [ROADMAP.md](ROADMAP.md).

## What works today

| Area | What you can do |
|---|---|
| Import | Upload a CICIDS2017 / CICFlowMeter CSV (or use the CLI for large files). Header checked first; every rejected row counted and sampled; labels kept as ground truth only; flows tagged `IMPORTED`. |
| Detection | The org's active model (per feature schema) scores pending flows through the ML service. No active model → flows stay "not scored". Unknown classes are errors, never mapped. |
| Explanations | Top-5 SHAP contributions per malicious or low-confidence verdict, class probabilities, confidence with a needs-review threshold, MITRE ATT&CK technique marked "suggested". |
| Models | Registry of trained versions with model card, macro-F1, per-class precision/recall/F1/support, holdout on unseen source IPs, library-version checks, per-org activation (Owner/Admin). |
| Evaluation | Live comparison of verdicts with dataset labels in your org (confusion matrix, macro-F1), with a warning when the data was also used for training. |
| Investigation | Flow explorer with URL filters; incidents (table, board, notes, assignee, status). |
| Organisations | Multi-tenant orgs, roles Owner / Admin / Analyst / Viewer enforced server-side, append-only audit log, sessions, data export, account deletion. |

## Architecture

```
 Browser (React SPA) ──/api/v1──▶ API (Node 20, Express, TypeScript) ──▶ MongoDB
                                     │  auth, RBAC, tenancy, import, stats, audit
                                     └──/predict──▶ ML service (FastAPI, scikit-learn, SHAP)
                                                     model registry = services/ml/artifacts/
```

Monorepo (npm workspaces): `apps/web`, `apps/api`, `packages/shared` (taxonomy, label normaliser,
severity and MITRE maps, feature schemas, RBAC matrix, zod contracts), `services/ml`,
`services/collector` (placeholder). Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Quick start on Windows (PowerShell)

Prerequisites: Node.js 20+, Python 3.11+, MongoDB (local install or Docker). If PowerShell blocks
`npm.ps1`, use `npm.cmd` as below.

```powershell
npm.cmd install
Copy-Item apps/api/.env.example apps/api/.env
# Edit apps/api/.env: set MONGO_URI and JWT_ACCESS_SECRET (generate one with the command in the file).
npm.cmd run ml:install          # Python venv for the ML service
npm.cmd run ml:train:sample     # trains the small benchmark model (writes services/ml/artifacts/)
```

Then, in two terminals:

```powershell
npm.cmd run ml:serve            # ML service on http://127.0.0.1:8000
npm.cmd run dev                 # API on http://localhost:4000 and web on http://localhost:5173
```

Open http://localhost:5173 (use `localhost`, not `127.0.0.1`: the CSRF origin check uses the
allow-list in `CORS_ORIGINS`). Create a workspace, import `data/samples/cicids2017-friday-ddos-sample.csv`
on the Datasets page, activate the model on the Models page, and the flows get scored.

Check the whole chain from the command line (creates and then deletes a throwaway account; use a
development database):

```powershell
npm.cmd run smoke
```

## Docker

```powershell
Copy-Item .env.example .env      # set JWT_ACCESS_SECRET and ML_SERVICE_TOKEN
docker compose --profile train run --rm ml-train   # train the sample model inside the pinned ML image
docker compose up --build        # http://localhost:8080
```

MongoDB is not published on the host, so the stack does not collide with a local MongoDB on 27017.

## Coming from the old `cyber-dashboard`

The old JavaScript backend copied each dataset label into the "prediction" and generated incidents
with invented assignees. The new API never reads those fields. Existing data stays untouched and
invisible until you migrate it:

```powershell
npm.cmd run migrate:legacy                  # dry run: prints what would change, writes nothing
npm.cmd run migrate:legacy -- --apply       # back up first (mongodump); idempotent; deletes nothing
```

The migration attaches legacy users to a "Legacy workspace" org (bcrypt passwords keep working and
are upgraded to argon2id at next login), recomputes ground-truth labels and timestamps from the
stored raw rows, moves the copied predictions under `legacy.*`, leaves the random `seed.js` flows
invisible, and flags the invented incidents. Migrated flows are then scored by the active model.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | API + web in watch mode |
| `npm run typecheck` / `lint` / `test` / `build` | all TypeScript workspaces |
| `npm run ml:install` / `ml:train:sample` / `ml:serve` / `ml:test` | ML service (cross-platform) |
| `npm run import:csv -- --org <slug> "<file.csv>"` | import a large CSV from disk (`--demo` tags it DEMO) |
| `npm run migrate:legacy [-- --apply]` | migrate data from the old backend |
| `npm run smoke [-- http://host:port]` | end-to-end check against a running stack |

## Testing

- `packages/shared`: 65 unit tests (label normaliser incl. shared vectors, maps, RBAC matrix, feature schema drift).
- `apps/api`: 49 integration tests on a real in-memory MongoDB: auth (rotation, reuse detection,
  logout-all, CSRF, rate limit, legacy hash upgrade), tenant isolation (cross-org → 404, unscoped
  queries rejected), RBAC role × route matrix, audit per mutation, import, scoring, stats, evaluation,
  migration.
- `apps/web`: API client (in-memory token, single-flight refresh, error envelope).
- `services/ml`: 46 pytest tests (artefacts, honest metrics, predict contract, schema and version
  mismatch, SHAP reconstruction for random forest, gradient boosting and logistic regression).

## Honest limitations

- **No live capture yet.** Flows come from CSV import only. The collector, the native feature
  schema and the lab dataset are Phase 2.
- **The bundled model is a toy benchmark.** Trained on 990 rows of one CICIDS2017 capture (BENIGN vs
  DDoS, one attacker IP): macro-F1 1.00 on a random split but 0.52 on unseen source IPs. It says
  nothing about other attacks or your network. Train on the full dataset for a broader benchmark,
  and remember CICIDS2017 has known label errors and does not transfer to other networks.
- No rules engine, alerts, correlation, SSE stream, integrations, reports, invitations, MFA, i18n,
  command palette or drift monitoring yet.
- Background jobs (import, scoring) run in-process: an API restart interrupts them (interrupted
  imports are marked failed at startup; pending flows can be re-scored with "Score pending flows").
- Dashboards aggregate raw flows; rollups for millions of rows are Phase 5.
- CICIDS2017 timestamps are stored as recorded (no timezone; afternoon files use a 12-hour clock).

## Documentation

[ROADMAP.md](ROADMAP.md) (plan, progress, decisions) · [docs/CHANGELOG.md](docs/CHANGELOG.md) ·
[docs/PRODUCT_SPEC.md](docs/PRODUCT_SPEC.md) · [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) ·
[docs/ML_AND_DETECTION.md](docs/ML_AND_DETECTION.md) · [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md) ·
[services/ml/README.md](services/ml/README.md) · original project docs in `docs/legacy/`.
