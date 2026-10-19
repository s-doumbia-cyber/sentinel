# Sentinel — Cybersecurity Threat Analysis Dashboard

A dark cyberpunk / glassmorphism SOC platform for exploring, analyzing and visualizing cyberattack datasets.

```
cyber-dashboard/
├── docs/       ← full documentation (architecture, design system, API/schema, deliverables, report guidance)
├── frontend/   ← React + TypeScript + Vite + Tailwind
├── backend/    ← Node.js + Express + MongoDB API + real CSV importer + tests
└── docker-compose.yml  ← optional one-command launch (Mongo + backend + frontend)
```

## What's real vs. what's a placeholder (read this first)

| Page | Data source |
|---|---|
| Dashboard, Analytics, Threat Intelligence, Attack Explorer, Datasets, Incidents, Reports | **Real** — queried live from MongoDB via the Express API |
| Real-Time Monitor | **Real data, simulated cadence** — replays actual imported flows on a timer (a browser app cannot sniff live network packets; see `docs/05-report-guidance.md` for how to explain this in your report) |
| Machine Learning | **Real** once you run `python ml/train_model.py` — three real scikit-learn classifiers (Random Forest, Gradient Boosting, Logistic Regression) compared on genuine multi-class attack prediction, trained on your imported data. Shows setup instructions until then. |
| Settings | **Real** — name and preferences persist to your MongoDB account via `PATCH /api/auth/me` |
| Login / Register | **Real** — real bcrypt + JWT auth against MongoDB, with Zod input validation |

## Step 1 — Install MongoDB locally (Windows)

1. Download **MongoDB Community Server** for Windows: https://www.mongodb.com/try/download/community
2. Run the installer, keep the default options, and make sure **"Install MongoDB as a Service"** is checked (it starts automatically with Windows — you won't need to launch it manually).
3. Verify it's running: open PowerShell and run:
   ```powershell
   mongosh
   ```
   If you get a `test>` prompt, MongoDB is running. Type `exit` to leave it.

## Step 2 — Get a dataset

**Option A — the real thing.** Download **CICIDS2017** (free, no account needed) from the official source:
**https://www.unb.ca/cic/datasets/ids-2017.html** → download **`GeneratedLabelledFlows.zip`** (271 MB — this version includes source/destination IPs, ports, protocol and timestamp, which the app needs). Unzip it; you'll get one CSV per day.

**Option B — a small embedded sample, no download needed.** If you (or your professor, on presentation day) already have one full CICIDS2017 CSV, generate a small stratified sample from it once:

```powershell
cd backend
npm run make-sample -- "C:\path\to\Friday-WorkingHours-Afternoon-DDos.pcap_ISCX.csv"
```

This writes `backend/data/sample.csv` (a few MB, a few thousand rows across every attack label in that file) — commit it to your repo, and from then on anyone can run `npm run import -- data/sample.csv` with zero external downloads. Good as a demo fallback if internet/download reliability is a concern on the day of your viva.

## Step 3 — Backend setup

```powershell
cd backend
npm install
copy .env.example .env
```

Open `.env` and set a real `JWT_SECRET` (any long random string). `MONGO_URI` can stay as the default local value.

Import your CSV into MongoDB:

```powershell
npm run import -- "C:\path\to\Friday-WorkingHours-Afternoon-DDos.pcap_ISCX.csv"
```

You'll see a progress counter, and a summary of any rows skipped because their label wasn't recognized (with the exact unrecognized label printed, so you can extend `normalizeLabel()` in `src/utils/csvImporter.js` if needed). A few hundred thousand rows can take a minute or two. Then create a demo login account:

```powershell
npm run seed
```

(This only creates the `analyst@sentinel.io` / `ChangeMe123!` account — it no longer overwrites your imported flows.)

Start the API:

```powershell
npm run dev
```

You should see `Sentinel API listening on port 4000`.

## Step 4 — Frontend setup (separate terminal)

```powershell
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173**, log in with `analyst@sentinel.io` / `ChangeMe123!` (or register a new account). Every page listed as "Real" above will show numbers computed from your actual imported CSV.

## Importing more data later

Re-run `npm run import -- "<path>"` with any other day's CSV to add more flows (each import creates a new `Dataset` record and appends its rows — it doesn't delete previous imports). Or use the **Upload dataset** button on the Datasets page in the app — same result, from the browser, with a progress bar.

To start completely fresh:

```powershell
npm run wipe
```

## Training the Machine Learning models

The Machine Learning page compares three real classifiers trained with scikit-learn on whatever flows are currently in MongoDB — not fabricated numbers, and not a binary attack/normal toy problem: it predicts the actual attack type across every class present in your data, using real CICIDS2017 features (flow timing, byte/packet rates, TCP flag counts...) pulled from the `raw` field every imported flow keeps.

```powershell
cd backend
pip install -r ml\requirements.txt
python ml\train_model.py
```

This trains Random Forest, Gradient Boosting, and Logistic Regression, picks the best by F1 score, and writes `backend/data/model-metrics.json`. Refresh the Machine Learning page to see the model comparison chart, a full multi-class confusion matrix, and feature importance. Re-run any time you import more data to retrain on the larger dataset. Requires Python 3.9+ (`python --version` to check) and pip.

## Running the backend tests

Real integration tests (Vitest + Supertest) against an in-memory MongoDB instance — no need for your real dev database, and nothing here touches your imported data:

```powershell
cd backend
npm install
npm test
```

Covers registration/login validation (Zod), JWT auth enforcement, preference persistence, and the KPI/aggregation endpoints (`getKpis`, `getAttackBreakdown`, `getTopAttackers`, `getTopSubnets`, pagination) against known seeded data.

## Optional — running everything with Docker

A `docker-compose.yml` at the repo root can launch MongoDB, the backend, and the frontend together with one command:

```powershell
docker compose up --build
```

**Recommendation: test this well before your viva, not on the day of it** — it's a convenience for later (e.g. showing containerization skills in your portfolio/report), not something to introduce for the first time right before a presentation. If it works reliably for you, it's a nice one-command demo; if you haven't tried it before, stick with the manual `npm run dev` setup you already know works.

## Improvement roadmap — Waves 1, 2 & 3 done

This project is being improved in planned "waves."

**Wave 1 (foundations):** real filters, RBAC, Team page, password/sessions, accent color, GDPR export/delete.

**Wave 2 (UX & mobile):** mobile hamburger nav, skeleton loaders, real notifications, Real-Time Monitor pause/speed/filter/sound controls, text contrast pass.

**Wave 3 (interactivity):**
- **Cache lifetime extended** to 20 minutes (was 2) — navigating between pages during a normal session no longer keeps re-querying MongoDB
- **Drag-and-drop Incidents kanban** — drag a card between Open/Investigating/Resolved/Closed columns to change its status for real (persists to MongoDB, optimistic UI with rollback on failure); disabled for `Viewer` role accounts, which can't mutate incidents server-side anyway
- **Attack Explorer column visibility** — a Columns menu lets you show/hide any of the 6 table columns, remembered locally between visits
- **Flow detail panel** — click any row in Attack Explorer to open a slide-in panel with every normalized field plus the complete original CICIDS2017 CSV row (all ~80 columns, from the `raw` field every flow already stores)
- **Dashboard date-range filter** — filter the whole homepage (KPIs, timeline, breakdown, recent attacks) to a specific date range
- **Dashboard ML widget** — shows the current best model's F1 score right on the homepage, linking to the full Machine Learning page (renders nothing if no model has been trained yet, rather than a fake number)
- **3 dropdown/drawer transparency bugs fixed** — the notification menu, profile menu, and mobile nav drawer previously used ~95-98% opacity + blur, which let bright glowing dashboard numbers show through and mix with the menu text; they're now fully opaque

Still planned (Wave 4): Attack Explorer multi-select + bulk actions, dataset side-by-side comparison, reorderable KPI cards, Audit Log page.

**After pulling these changes:** no new dependencies — just `npm run dev` on both sides. No re-import needed.

## Tech stack

**Frontend:** React 18, TypeScript, Vite, Tailwind CSS, Framer Motion, React Router, Axios, Recharts, Lucide Icons, xlsx, jsPDF
**Backend:** Node.js, Express, MongoDB (Mongoose), JWT auth, bcrypt, helmet, rate limiting, csv-parse, Zod, Vitest + Supertest + mongodb-memory-server
**ML:** Python, scikit-learn (RandomForest, GradientBoosting, LogisticRegression), pandas, pymongo
**Docs:** See `docs/01-architecture.md` for architecture, `docs/05-report-guidance.md` for how to frame this project's design decisions in your written report/viva.
