# 01 — Architecture

## 1. Complete Folder Architecture

```
cyber-dashboard/
├── docs/                          # This documentation set
│   ├── 01-architecture.md
│   ├── 02-design-system.md
│   ├── 03-api-and-schema.md
│   └── 04-deliverables.md
├── frontend/                      # React + TypeScript + Vite SPA
│   ├── index.html
│   ├── package.json
│   ├── vite.config.ts
│   ├── tailwind.config.ts         # Centralized design tokens
│   ├── tsconfig.json
│   └── src/
│       ├── main.tsx                # App bootstrap (Router + AuthProvider)
│       ├── App.tsx                 # Route table
│       ├── index.css               # Global styles + glass/neon utility classes
│       ├── theme/tokens.ts         # Raw color/font constants for non-Tailwind use
│       ├── types/index.ts          # Shared TypeScript domain types
│       ├── data/mockData.ts        # Deterministic mock data generator (demo mode)
│       ├── services/api.ts         # Axios instance talking to the Express backend
│       ├── contexts/AuthContext.tsx
│       ├── hooks/useCountUp.ts
│       ├── router/
│       │   ├── ProtectedRoute.tsx
│       ├── components/
│       │   ├── layout/             # Sidebar, Navbar, DashboardLayout
│       │   ├── background/         # ParticleBackground canvas
│       │   ├── ui/                 # GlassCard, KpiCard, SeverityBadge, GlowButton,
│       │   │                       # PageHeader, FilterDrawer
│       │   └── charts/             # AttackTrendChart, AttackTypeDonut, ProtocolRadar,
│       │                           # TopPortsBar
│       └── pages/
│           ├── auth/Login.tsx, Register.tsx
│           ├── Dashboard.tsx
│           ├── Analytics.tsx
│           ├── ThreatIntelligence.tsx
│           ├── AttackExplorer.tsx
│           ├── RealTimeMonitor.tsx
│           ├── Incidents.tsx
│           ├── Reports.tsx
│           ├── Datasets.tsx
│           ├── MachineLearning.tsx
│           └── Settings.tsx
└── backend/                       # Node.js + Express + MongoDB API
    ├── package.json
    ├── .env.example
    └── src/
        ├── server.js               # App bootstrap, middleware, route mounting
        ├── config/db.js            # Mongoose connection
        ├── models/                 # User, NetworkFlow, Incident, Dataset
        ├── controllers/            # authController, flowController, incidentController
        ├── routes/                 # authRoutes, flowRoutes, incidentRoutes
        ├── middlewares/             # auth (JWT), errorHandler
        ├── utils/generateToken.js
        └── scripts/seed.js          # Demo data seeding script
```

## 2. Backend Architecture

The backend is a layered Express API:

- **Routes** define the URL surface and attach the `requireAuth` middleware where a session is required.
- **Controllers** hold request/response logic and call into Mongoose models. They never touch `req`/`res` beyond parsing input and shaping output — all query-building for filters lives in small pure helper functions (see `buildFilter` in `flowController.js`) so the same filter logic is reused across the KPI, breakdown, timeline, and listing endpoints.
- **Models** are Mongoose schemas with indexes on the fields analysts filter/sort by most (`timestamp`, `sourceIp`, `destinationIp`, `destinationPort`, `label`, `severity`, `isAttack`).
- **Middlewares** centralize cross-cutting concerns: JWT verification (`auth.js`) and a single `errorHandler` so every controller can just `next(err)` instead of repeating try/catch response logic.

Request flow for a typical read, e.g. `GET /api/flows/kpis?attackType=DDoS`:

```
Client (Axios) → Express → helmet/cors/rateLimit → requireAuth
   → flowController.getKpis → buildFilter(query) → Mongoose aggregate → JSON response
```

## 3. Frontend Architecture

The frontend is a single-page app built with Vite. Route-level pages live under `src/pages`, each composing shared primitives from `src/components/ui` and `src/components/charts`. Cross-cutting concerns (auth session, API client) live in `src/contexts` and `src/services`.

Data currently comes from `src/data/mockData.ts`, a deterministic generator that simulates CICIDS2017-style flows so every screen is fully interactive without a live backend connection. Swapping to live data means replacing the mock-data imports in each page with calls to `src/services/api.ts` against the matching backend endpoint (see `docs/03-api-and-schema.md` for the exact route each page should call).

## 4. API Routes

See `docs/03-api-and-schema.md` for the full route table.

## 5. MongoDB Schema

See `docs/03-api-and-schema.md`.

## 6. Component Hierarchy

```
App
└─ Routes
   ├─ /login            → Login
   ├─ /register          → Register
   └─ ProtectedRoute
      └─ DashboardLayout
         ├─ ParticleBackground
         ├─ Sidebar
         ├─ Navbar
         └─ <page outlet>
            ├─ Dashboard         → PageHeader, KpiCard×8, GlassCard, AttackTrendChart,
            │                      AttackTypeDonut, ProtocolRadar, SeverityBadge
            ├─ Analytics         → PageHeader, FilterDrawer, GlassCard, bar/area/donut charts
            ├─ ThreatIntelligence→ PageHeader, GlassCard, TopPortsBar, AttackTypeDonut
            ├─ AttackExplorer    → PageHeader, FilterDrawer, GlassCard (data table), SeverityBadge
            ├─ RealTimeMonitor   → PageHeader, GlassCard, live feed list, toast
            ├─ Incidents         → PageHeader, GlowButton, GlassCard kanban columns
            ├─ Reports           → PageHeader, GlassCard, AttackTrendChart, AttackTypeDonut
            ├─ Datasets          → PageHeader, GlowButton, GlassCard grid
            ├─ MachineLearning   → PageHeader, GlassCard metric cards, confusion matrix,
            │                      ROC LineChart, feature-importance BarChart
            └─ Settings          → PageHeader, GlassCard sections, Toggle
```

## 7. Routing

React Router v6, defined centrally in `src/App.tsx`. `/login` and `/register` are public; everything else is nested under a `ProtectedRoute` that redirects to `/login` when there is no session token. The `DashboardLayout` route element renders the persistent chrome (sidebar/navbar/background) once, with each page rendered into its `<Outlet />`.

## 13. State Management Strategy

- **Local component state** (`useState`) for page-level UI state: filters, pagination, sort order, drawer open/closed. Nothing here needs to be global.
- **React Context** (`AuthContext`) for the one genuinely cross-cutting piece of state: the authenticated session and JWT. It exposes `login`, `register`, `logout`, and the current `user`.
- **Server state** is not cached client-side beyond the request lifecycle; each page fetches what it needs via `src/services/api.ts`. If the app grows, this is the natural point to introduce TanStack Query for caching/revalidation — deliberately not added yet to keep the dependency surface minimal for a portfolio-scale project.
- **No Redux.** The app's state is either local-UI or session-auth; a global store would add ceremony without solving a real problem here.

## 14. Performance Optimizations

- Route-level code is already split naturally by page component; adding `React.lazy` + `Suspense` per route is the next step if bundle size becomes a concern.
- Charts (Recharts) are wrapped in `ResponsiveContainer` and only re-render when their `data` prop changes.
- The `ParticleBackground` canvas runs its animation loop with `requestAnimationFrame` and is cleaned up on unmount to avoid leaking timers when navigating away.
- Mongo indexes (see schema doc) keep the KPI/aggregation endpoints fast even as flow volume grows into the millions of rows, since CICIDS2017 alone is ~2.8M rows across its files.
- Pagination is enforced server-side (`limit` capped at 200) so the client never has to hold a full dataset in memory.

## 15. Future Improvements

- Wire the frontend to the real backend endpoints (currently mock-data driven for a self-contained demo).
- Add a Python microservice (Pandas/Scikit-learn) for real CSV ingestion, schema auto-detection, and model training — the `Dataset` and `ModelMetrics` shapes are already designed to accept that data.
- Add WebSocket/SSE support for a genuinely live Real-Time Monitor instead of the client-side interval simulation.
- Add automated tests (Vitest + React Testing Library on the frontend, Jest + Supertest on the backend).
- Add role-based UI restrictions (Viewer vs Analyst vs Admin) beyond the backend's `requireRole` middleware, which already exists but isn't yet enforced on any route.
