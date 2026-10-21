# Running Sentinel on Windows (PowerShell)

Every command below was run on Windows 11 with PowerShell on 2026-10-20 against an isolated
MongoDB database (a separate `mongod` on port 27018), never against existing data: install (§2),
configuration (§3, with the `.env` built exactly as described), start (§4), the health check, the
demo seed (§5, dry run then `--yes`), sign-in with a generated account and registration of a new
account. Where a step could not be re-run that day, the guide says so.

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

Each `ml:train:sample` run writes a new, timestamped model folder; older ones stay until you delete
them (the folder is git-ignored).

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

  The dry run prints the target database (`Target database: mongodb://host:port/name`, without
  credentials): check it before adding `--yes`.

  **Getting the credentials.** The `--yes` run prints a block titled *Sign-in details* with three
  lines: role, email, password. That output is the only place the passwords ever appear: copy them
  into your password manager right away. The accounts are `owner@sentinel-demo.test` (Owner),
  `analyst@sentinel-demo.test` (Analyst) and `viewer@sentinel-demo.test` (Viewer); the passwords
  are random and stored only as argon2id hashes, so they cannot be recovered or reset by the script.
  Running the command again changes nothing (it reports that the demo exists). If you lose the
  passwords, point `MONGO_URI` (or `--mongo-uri`) at a new database name and run the seed there. To seed another database: `npm.cmd run seed:demo -- --mongo-uri
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

## 8. Your own CICIDS2017 download

Checked on 2026-10-20 with the eight `*.pcap_ISCX.csv` day files (the *GeneratedLabelledFlows /
TrafficLabelling* version, about 1.2 GB, 3.1 million rows) kept in `C:\Users\<you>\Downloads\Traffic-DataSet`,
on an isolated database. That version has source / destination IPs and timestamps, so Sentinel can
import it as flows; the *MachineLearningCVE* version (no IPs) can train a model but cannot be imported.
Nothing needs copying into the repository.

**Train the benchmark model** (about 5 minutes on a 16-thread laptop with 32 GB RAM):

```powershell
services\ml\.venv\Scripts\python.exe -m sentinel_ml.train --config services/ml/configs/cicids-full.example.yaml --csv "C:\Users\<you>\Downloads\Traffic-DataSet\*.csv"
```

The run caps large classes at 50,000 rows, drops 601,648 duplicate rows and the 288,602 empty rows
of the Thursday web-attacks file, and writes `services/ml/artifacts/cicids-bench-<date>/` with its
model card. Result of the checked run: macro-F1 0.896 on its test split; WebAttack 0.69 and XSS 0.53;
Heartbleed, Infiltration and SQL injection have fewer than 30 test rows (marked unstable); on source
IPs never seen in training, 2.7 % of benign flows were flagged. Restart `npm.cmd run ml:serve` so the
Models page lists it, read the model card, then activate it (Owner / Admin).

**Import the flows** into a workspace (use a dedicated database or organisation; the slug is shown
in Settings):

```powershell
Get-ChildItem "C:\Users\<you>\Downloads\Traffic-DataSet\*.csv" | ForEach-Object { npm.cmd run import:csv -- --org <your-org-slug> $_.FullName }
```

Measured: about 2,100 rows per second (286,467 rows in 136 s), so roughly 25 minutes for the eight
files; about 1 GB of MongoDB storage. Empty and malformed rows are rejected and counted, never
guessed. A command-line import does not start detection: then open **Alerts → Run detections**
and **Models → Score pending flows**. Scoring with explanations ran at about 300 flows per second
(456,833 flows in about 25 minutes), so expect about 2.5 hours for all 2.83 million flows.

**What to expect.** The model was trained on these same files, so the per-flow evaluation looks
excellent (PortScan 0.999) but is not an independent estimate. Alerts are noisier: in the check,
about 1 % of benign flows were classified as attacks, which produced hundreds of model alerts and
dozens of correlated incidents involving CDN and Google addresses. The starter rule
`R-SLOWHTTP-01` also fired on long benign HTTPS sessions. Use **Validation** to measure each rule
and model, and treat CICIDS2017 as a benchmark, not as your network.

**Reducing the noise** (Settings → Detection, Owner / Admin). Measured on the same 456,833 scored
flows (Thursday web attacks and Friday port scan), re-alerted from scratch on an isolated database:

| Settings | Model alerts | Rule alerts | Incidents | Alerts from the known attacker addresses |
|---|---|---|---|---|
| Defaults (minimum confidence 0, empty allowlist) | 1,615 | 8 | 73 | 43 |
| Minimum confidence 90 % + `172.217.0.0/16` allowlisted | 564 | 8 | 27 | 33 |

The minimum confidence removed about two thirds of the alerts but also 10 of the 43 alerts on real
attacker traffic, which the model had scored with low confidence: a threshold trades misses for
quiet, so check **Validation** before raising it. Kept-out verdicts stay on their flows and are
counted on the Detection tab. Do not allowlist what you have not checked: in this dataset the
largest source of false positives, `205.174.x.x`, is also the attackers' public address, so trusting
it would hide the attacks. Saved changes apply to evidence processed afterwards; to apply them to alerts that already exist, use **Rebuild alerts with the saved settings** at the bottom of the same tab (Owner / Admin). It deletes and rebuilds only alerts and incidents nobody has worked on, from the verdicts and rule hits already stored; triaged alerts, assigned or commented incidents and every flow verdict stay as they are. It runs in the background and is recorded in the audit log (`detection.reapply`, `detection.reapply_done`). Do not import data while it runs.

The starter rule `R-SLOWHTTP-01` was also tightened after replaying all eight days through the rule
engine: 161 hits before, 15 after, with the 8 hits on real slow-HTTP attack flows kept. Workspaces
created earlier get the new version automatically unless someone edited the rule (see the audit log,
action `rule.upgrade`).

## 9. Docker (optional)

```powershell
Copy-Item .env.example .env      # set JWT_ACCESS_SECRET and ML_SERVICE_TOKEN
docker compose --profile train run --rm ml-train
docker compose up --build        # http://localhost:8080
```

**One command, with the demo workspace:** `docker compose --profile demo up --build`, then
`docker compose --profile demo logs demo-seed` shows the Owner / Analyst / Viewer sign-in details,
printed once on the first run (copy them; a later run only reports that the demo exists). Open
http://localhost:8080. The profile trains the sample model into the stack's own volume and seeds the
DEMO data into the stack's own MongoDB (`demo-seed` is started with `--require-host mongo` and refuses
any other database); it never reads or writes the MongoDB on your machine. The model is trained but
not activated: activate it on the Models page. To start over: `docker compose --profile demo down -v`.
The compose file was validated with `docker compose config` and the seed ran from the compiled image
layout against a throwaway database (twice: created, then "already exists"); `docker compose up`
itself was not run because Docker Desktop was not running on 2026-10-21.

This path was verified earlier on 2026-10-20 (`npm run smoke` passed against it). It could not be
re-run when this guide was last checked because Docker Desktop was not running on the machine.

## 10. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `JWT_ACCESS_SECRET is required` | `apps/api/.env` missing or incomplete: step 3. |
| `running scripts is disabled on this system` | Use `npm.cmd` instead of `npm`. |
| Sign-in fails with a CSRF or origin error | Open `http://localhost:5173`, not `http://127.0.0.1:5173`. |
| Flows stay "not scored" | No active model, or the ML service is not running (`ml:serve`). |
| `Port 5173 is in use` | Another dev server is running; stop it or use the URL Vite prints. |
| Data from the old `cyber-dashboard` is invisible | It needs `npm.cmd run migrate:legacy` (dry run first; back up before `--apply`). |
