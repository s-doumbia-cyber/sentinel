# 04 — Deliverables: Wireframes, Features, Components, Security, Responsive Strategy

## 8. UI Wireframe Description (per page)

**Dashboard (homepage)** — Page header with title + export action. Below it, a 4-column (2 on mobile) grid of 8 glass KPI cards, each with a label, animated count-up value, trend arrow, and a small gradient-filled sparkline. Beneath that, a 2/3 + 1/3 split: a large attack-vs-normal trend area chart, and an attack-type donut. A final row splits a protocol radar chart against a "latest detected attacks" glass list with severity badges.

**Analytics** — Header with a right-aligned filter-drawer trigger. A 2-column grid: attack-category bar chart (angled labels) and the traffic timeline area chart. Below, top-targeted-ports horizontal bar chart beside a category-share donut.

**Threat Intelligence** — A 2/3 "Most Dangerous Countries" horizontal progress-bar ranking beside a 1/3 severity-distribution donut. Below, top-target-ports bar chart beside a protocol donut.

**Attack Explorer** — Header with row count, CSV export button, and filter drawer. A single wide glass panel containing: search input, sortable column headers (click to sort, arrow indicator), striped/hover rows with monospace IP/port text and severity badges, and pagination controls.

**Real-Time Monitor** — "Live" pulse badge in the header. Three small stat cards (flows today, active alerts, sensors online). Below, a scrolling glass panel of incoming flow rows that animate in from the left every ~1.8s. Critical/high events additionally trigger a bottom-right toast with a pink glow border.

**Incidents** — Header with a "New incident" gradient button. Four-column kanban (Open / Investigating / Resolved / Closed), each column a vertical stack of compact glass incident cards showing ID, priority pill, title, source IP, severity badge, and assignee.

**Reports** — Header with three export actions (Excel/CSV/PDF). An "Executive Summary" wide panel with generated prose. Below, a 2/3 timeline chart beside a 1/3 category donut, mirroring what would appear in the exported PDF.

**Datasets** — Header with an "Upload dataset" button. A responsive 2-column grid of dataset cards: icon + filename + status pill, then a 3-column stat block (rows/columns/attack types), then upload date.

**Machine Learning** — 4-column metric cards (Accuracy/Precision/Recall/F1) as large gradient-text percentages. Below, a confusion-matrix 2×2 color-coded grid beside an ROC curve line chart. A final full-width feature-importance horizontal bar chart.

**Settings** — 2-column grid of glass sections: Profile (avatar + edit action), Appearance (dark-mode toggle, explained as always-on by design), Notifications (email/push toggles), Language (select), and a full-width API Configuration panel with read-only base URL/key fields.

**Login / Register** — Centered glass card (max-width 384px) over a near-black background with two slowly-pulsing blurred gradient orbs. Logo mark, heading, form fields with left-aligned icons, gradient submit button, and a link to the other auth page.

## 9. Feature Descriptions

- **Auto-adapting schema support** — the backend's `Dataset.detectedSchema` field and the flow model's `raw` passthrough are designed so uploading any of the four supported datasets (CICIDS2017, UNSW-NB15, KDD99, CSE-CIC-IDS2018) doesn't require a schema migration; only the ingestion script needs a per-format column mapper.
- **Server-computed KPIs** — the 8 homepage KPIs are aggregated in MongoDB (`getKpis`), not computed client-side, so they stay accurate at millions of rows.
- **Unified severity model** — every attack type maps to one of 6 severities consistently across flows, incidents, and UI badges, so color-coding is meaningful everywhere it appears.
- **Simulated real-time feed** — `RealTimeMonitor` polls a rotating pool of pre-generated flows on a client interval as a stand-in for a future WebSocket feed, so the live-monitoring UX can be fully built and demoed before the streaming backend exists.

## 10. Suggested Reusable Components (with prop interfaces)

```ts
// GlassCard — base panel primitive used by nearly every card in the app
interface GlassCardProps {
  children: ReactNode;
  className?: string;
  delay?: number;   // stagger animation delay in seconds
  hover?: boolean;  // enable hover glow/border transition
}

// KpiCard — animated KPI with sparkline
interface KpiCardProps {
  kpi: {
    id: string;
    label: string;
    value: number;
    format: "number" | "percent" | "bytes" | "ms";
    trend: number;
    sparkline: number[];
    accent: "violet" | "pink" | "cyan";
  };
  delay?: number;
}

// SeverityBadge
interface SeverityBadgeProps {
  severity: "critical" | "high" | "medium" | "low" | "info" | "safe";
}

// GlowButton
interface GlowButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: "primary" | "ghost";
}

// PageHeader
interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}

// FilterDrawer — collapsible glass panel triggered by a button
interface FilterDrawerProps {
  children: ReactNode; // FilterField rows
}
```

## 11. Security Best Practices

- Passwords hashed with **bcrypt**, 12 salt rounds, never stored or logged in plaintext.
- **JWT** auth with a configurable expiry (`JWT_EXPIRES_IN`), verified on every protected route via the `requireAuth` middleware; invalid/expired tokens return `401` uniformly.
- **helmet** sets standard security headers; **cors** is restricted to the configured `CLIENT_ORIGIN` rather than left open.
- **express-rate-limit** caps requests per IP on the whole `/api` surface to blunt brute-force and scraping attempts; the docs note applying a stricter limiter specifically to `/api/auth/login` in production.
- Role-based authorization is scaffolded (`requireRole`) so `Admin`-only actions (e.g. dataset deletion, user management) can be locked down without touching route logic.
- Input is validated at the controller boundary (required-field checks on register/login); a schema-validation library (e.g. Zod or Joi) is the recommended next step before production use.
- Secrets (`JWT_SECRET`, `MONGO_URI`) are read from environment variables via `dotenv` and never committed — `.env` is git-ignored, `.env.example` documents the required shape.
- MongoDB queries are built through Mongoose's query builder / aggregation pipeline exclusively (no raw string concatenation), which avoids NoSQL injection via operator injection on user-supplied filter values.

## 12. Responsive Design Strategy

- Tailwind's default breakpoints (`sm`, `md`, `lg`, `xl`) drive all layout changes; the sidebar collapses to icon-only width above `md` and hides entirely below it in the current build (a mobile drawer/hamburger trigger is the natural next addition).
- KPI and card grids step down progressively: 4 columns → 2 columns → 1 column (e.g. `grid-cols-2 lg:grid-cols-4`), so dense dashboards stay legible on tablets and phones.
- Charts render inside `ResponsiveContainer` (Recharts), so they reflow to their parent's width automatically rather than overflowing on narrow viewports.
- The data table (`AttackExplorer`) wraps in a horizontally scrollable container on narrow screens rather than compressing columns unreadably.
- Auth pages use a single centered card with a `max-w-sm` cap, which behaves identically well from a small phone up to a desktop monitor without extra breakpoints.
