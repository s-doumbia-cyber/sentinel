# Running Sentinel on Windows (PowerShell)

Every command below was run on Windows 11 with PowerShell on 2026-10-20, against a throwaway
MongoDB database. Where a step could not be re-run that day, the guide says so.

## 1. Prerequisites

| Tool | Version checked | Notes |
|---|---|---|
| Node.js | 24.18.0 (22 or later required; 20 is end-of-life) | includes npm 11.16.0 |
| Python | 3.14.6 (3.11 or later required) | for the ML service |
| MongoDB | 7.0 Community | local service on `127.0.0.1:27017`, or Docker |
| Git | any recent | |

If PowerShell refuses to run `npm` ("running scripts is disabled"), type `npm.cmd` instead of `npm`,
as every command here does.

## 2. Install

From the repository folder:

```powershell
npm.cmd install
npm.cmd run ml:install          # creates services/ml/.venv and installs the ML service
npm.cmd run ml:train:sample     # trains the small benchmark model into services/ml/artifacts/
```

`ml:train:sample` trains a toy model on 990 rows of one CICIDS2017 capture (BENIGN vs DDoS). It is
there to exercise the pipeline, not to detect attacks on your network (see the README limitations).

## 3. Configure (required once)

The API does not start without a configuration: it stops with `JWT_ACCESS_SECRET is required`.

```powershell
Copy-Item apps/api/.env.example apps/api/.env
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Open `apps/api/.env` in an editor and set:

| Variable | Value |
|---|---|
| `JWT_ACCESS_SECRET` | the random string printed by the `node -e` command |
| `MONGO_URI` | `mongodb://127.0.0.1:27017/sentinel` (or another database name) |
| `ML_SERVICE_URL` | `http://127.0.0.1:8000` |
| `CORS_ORIGINS` | `http://localhost:5173` (already the example value) |

Leave `ML_SERVICE_TOKEN` empty for local use, or set the same value of 16+ characters on both the
API and the ML service. Never commit `.env` (it is git-ignored).

To try Sentinel without touching your usual database, point `MONGO_URI` at a new database name
(for example `mongodb://127.0.0.1:27017/sentinel_demo`). You can also override it for one
PowerShell session only: `$env:MONGO_URI = 'mongodb://127.0.0.1:27017/sentinel_demo'` before
starting the API. Variables set this way take precedence over `.env`.

## 4. Start

Two PowerShell windows, both in the repository folder:

```powershell
npm.cmd run ml:serve            # window 1: ML service on http://127.0.0.1:8000
```

```powershell
npm.cmd run dev                 # window 2: API on http://localhost:4000 and web on http://localhost:5173
```

Open **http://localhost:5173**. Use `localhost`, not `127.0.0.1`: the API only accepts the origins
listed in `CORS_ORIGINS`.

Check that everything is up (expected: `{"status":"ok","mongo":"ok","ml":"ok"}`):

```powershell
(Invoke-WebRequest -UseBasicParsing http://localhost:5173/api/v1/readyz).Content
```

Without the ML service the app still works: `ml` reads `unreachable`, flows stay unscored, and rules
still raise alerts.

## 5. Accounts

**There is no built-in or default account.** Two ways in:

- **Create your own:** open http://localhost:5173/register, fill in name, email, an optional
  organisation name and a password of at least 12 characters, then "Create workspace". You become
  the Owner of a new, empty organisation.
- **Demo workspace (synthetic data):** creates one organisation and three real accounts in the
  database named by `MONGO_URI`.

  ```powershell
  npm.cmd run seed:demo                 # dry run: shows the target database and what it would create
  npm.cmd run seed:demo -- --yes        # creates it and prints the three accounts once
  ```

  The accounts are `owner@sentinel-demo.test` (Owner), `analyst@sentinel-demo.test` (Analyst) and
  `viewer@sentinel-demo.test` (Viewer). Their passwords are random and appear only in that output:
  copy them then. They are stored only as argon2id hashes and cannot be recovered. Running the
  command again changes nothing. To seed another database: `npm.cmd run seed:demo -- --mongo-uri
  mongodb://127.0.0.1:27017/sentinel_demo --yes`; the API must use the same `MONGO_URI` to show it.

  The demo contains 585 synthetic flows tagged DEMO (office traffic, a port scan, then an SSH brute
  force from `10.0.0.66`), the two rule alerts, the correlated incident, assets and five identity
  records. No model scores them until you activate one on the Models page.

## 6. A five-minute tour (demo workspace, signed in as the Analyst)

1. **Alerts** → open *SSHPatator*: observed / inferred / unknown, the DHCP attribution and its limits.
2. Mark it *True positive*, then follow the incident link.
3. **Incident** → *Attack timeline* (facts vs hypotheses), *Response* (tick `10.0.0.66`, generate a
   simulation: nothing is applied), *Report*, *Investigation log*, *Trace* (from import to report).
4. **Assets** → `10.0.0.20`: services, labelled estimate, identity records, history.
5. **Identity sources** → look up `UNMANAGED-66`: the addresses it held and the alerts in those windows.
6. **Validation** → test `R-BRUTEFORCE-SSH-01` on the demo dataset (the run says DEMO data proves nothing).

## 7. Tests

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test                    # shared, API (in-memory MongoDB) and web unit tests
npm.cmd run ml:test             # ML service (pytest)
npm.cmd run e2e:install         # once: downloads Chromium for Playwright (about 720 MB on disk)
npm.cmd run test:e2e            # browser tests on their own throwaway stack (ports 4310 and 5310)
```

The test suites never use your database: unit and API tests run on an in-memory MongoDB, and the
e2e suite starts its own API with `.env` loading disabled.

## 8. Docker (optional)

```powershell
Copy-Item .env.example .env      # set JWT_ACCESS_SECRET and ML_SERVICE_TOKEN
docker compose --profile train run --rm ml-train
docker compose up --build        # http://localhost:8080
```

This path was verified earlier on 2026-10-20 (`npm run smoke` passed against it). It could not be
re-run when this guide was last checked because Docker Desktop was not running on the machine.

## 9. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `JWT_ACCESS_SECRET is required` | `apps/api/.env` missing or incomplete: step 3. |
| `running scripts is disabled on this system` | Use `npm.cmd` instead of `npm`. |
| Sign-in fails with a CSRF or origin error | Open `http://localhost:5173`, not `http://127.0.0.1:5173`. |
| Flows stay "not scored" | No active model, or the ML service is not running (`ml:serve`). |
| `Port 5173 is in use` | Another dev server is running; stop it or use the URL Vite prints. |
| Data from the old `cyber-dashboard` is invisible | It needs `npm.cmd run migrate:legacy` (dry run first; back up before `--apply`). |
