# Sentinel — Design System and UX Specification

## 1. Design direction

**"Calm command center."** A mature evolution of the current dark-glass look: keep the dark, technical identity and the violet accent, but remove decoration that competes with data. Reference quality: Linear, Vercel dashboard, Datadog, Arc.

Principles:
1. **Data first.** Cards and tables are solid surfaces. Glass/blur is reserved for the top bar and non-critical hero areas.
2. **Hierarchy through type, spacing, and contrast, not glow.** Glow only for live status and the primary action.
3. **Density with air.** Dense tables, generous page rhythm. Offer a compact density toggle.
4. **One accent.** Violet by default; the user may pick cyan or emerald. Severity colours are separate and fixed.
5. **Motion explains.** Animate state change and spatial relationships, never for ornament. Respect `prefers-reduced-motion`.
6. **Overlays are opaque.** Dropdowns, popovers, drawers, dialogs, command palette use solid surface tokens (lesson learned from the bleed-through bug).

## 2. Tokens

Implemented as CSS variables on `:root` (light) and `[data-theme="dark"]`, exposed through Tailwind. **Components never use raw hex.**

### 2.1 Dark theme (default)

| Token | Value | Use |
|---|---|---|
| `--bg-0` | `#070910` | Page background behind everything |
| `--bg-1` | `#0B0F19` | App background |
| `--surface-1` | `#111726` | Cards, tables |
| `--surface-2` | `#172033` | Raised: popovers, drawers, inputs |
| `--surface-3` | `#1E2A42` | Hover / selected rows |
| `--border-subtle` | `rgba(255,255,255,0.06)` | Dividers |
| `--border` | `rgba(255,255,255,0.10)` | Card/input borders |
| `--border-strong` | `rgba(255,255,255,0.18)` | Focus-adjacent, hover |
| `--text-1` | `#E8EBF4` | Primary text |
| `--text-2` | `#A9B2C7` | Secondary text |
| `--text-3` | `#7C87A3` | Tertiary/placeholder (≥ 4.5:1 on `--bg-1`) |
| `--accent` | `#8B5CF6` | Primary actions, active nav, focus ring |
| `--accent-fg` | `#A78BFA` | Accent used as text/icon on dark |
| `--accent-soft` | `rgba(139,92,246,0.14)` | Accent backgrounds |

### 2.2 Light theme

`--bg-1 #F6F7FB`, `--surface-1 #FFFFFF`, `--surface-2 #F0F2F8`, `--surface-3 #E8ECF5`, `--border #D9DEEA`, `--text-1 #0F172A`, `--text-2 #475569`, `--text-3 #64748B`, `--accent #7C3AED`, `--accent-fg #6D28D9`. Verify AA for every pair.

### 2.3 Accent presets
Violet `#8B5CF6` (default), Cyan `#22D3EE`, Emerald `#34D399`. Each preset defines `--accent`, `--accent-fg`, `--accent-soft`. Charts' first series follows the accent; severity never does.

### 2.4 Severity and status (fixed, theme-independent hue)

| Level | Colour | Icon | Label |
|---|---|---|---|
| Critical | `#F43F5E` | `ShieldAlert` | CRITICAL |
| High | `#FB923C` | `AlertTriangle` | HIGH |
| Medium | `#FACC15` | `AlertCircle` | MEDIUM |
| Low | `#38BDF8` | `Info` | LOW |
| Info | `#94A3B8` | `Dot` | INFO |
| Success / Safe | `#34D399` | `CheckCircle2` | OK |

Rules: always icon + text + colour; badge = tinted background (14% alpha) + solid border-left or text in the level colour; text on tints must pass 4.5:1.

Source-kind badges: `LIVE` (emerald, pulsing dot, pausable), `REPLAY` (cyan), `IMPORTED` (slate), `DEMO` (amber, dashed border).

### 2.5 Typography

- **UI/body:** Inter (variable). **Mono:** JetBrains Mono (IPs, ports, hashes, JSON, code). Both self-hosted (no runtime Google Fonts request in production). `font-feature-settings: "tnum"` for all numerics.
- Optional display face (Sora) allowed only on the login/marketing hero, not in the app.

| Style | Size / line | Weight | Use |
|---|---|---|---|
| Display | 32 / 40 | 600 | Page hero (rare) |
| H1 | 24 / 32 | 600 | Page title |
| H2 | 20 / 28 | 600 | Section |
| H3 | 16 / 24 | 600 | Card title |
| Body | 14 / 22 | 400 | Default |
| Small | 13 / 20 | 400 | Table cells, help |
| Caption | 12 / 16 | 500 | Labels, badges, axis |
| Mono | 13 / 20 | 450 | Data identifiers |
| KPI | 28-32 / 36 | 600 tabular | Big numbers |

Letter-spacing −0.01em on H1/H2/KPI; +0.04em uppercase on captions.

### 2.6 Spacing, radius, elevation, motion

- **Spacing:** 4 px base: 4, 8, 12, 16, 20, 24, 32, 48, 64.
- **Radius:** sm 6 (badges, inputs), md 8 (buttons), lg 12 (cards), xl 16 (modals, large panels), full (pills, avatars).
- **Elevation:** e0 none; e1 `0 1px 2px rgba(0,0,0,.35)`; e2 popover `0 8px 24px rgba(0,0,0,.45)`; e3 modal `0 24px 64px rgba(0,0,0,.55)`. In light theme use lighter equivalents.
- **Motion:** `fast 120ms`, `base 200ms`, `slow 320ms`; easing `cubic-bezier(0.2, 0, 0, 1)` (enter), `cubic-bezier(0.4, 0, 1, 1)` (exit). Count-up numbers ≤ 600 ms and only on first load. Staggered list entrance ≤ 40 ms per item, max 8 items. Under `prefers-reduced-motion`, replace with opacity fades.

### 2.7 Iconography
Lucide only, 16 px in controls, 20 px in nav, 1.75 stroke. Never mix icon sets.

## 3. App shell

- **Left rail** 248 px expanded / 64 px collapsed. Groups: **Monitor** (Command Center, Alerts, Live), **Investigate** (Incidents, Investigate), **Detect** (Detections, Models), **Manage** (Sources, Integrations, Reports, Team, Audit, Settings). Active item: accent-soft background + 2 px accent bar. Admin-only items hidden for lower roles.
- **Top bar** 56 px: org switcher · breadcrumb/title · **global time range** · search / `Ctrl+K` · live status pill (ingest rate + source health) · notifications · user menu.
- **Content:** max-width 1440, 24 px gutters, 12-column grid, 16-24 px gaps.
- **Mobile (< 768 px):** bottom tab bar (Overview, Alerts, Incidents, Live, More); top bar condensed; tables become card lists; filters in a bottom sheet.
- **Breakpoints:** 640 / 768 / 1024 / 1280 / 1536.

## 4. Global UX patterns

- **URL is state:** time range, filters, sort, selected row, tab. Back button and shared links always work.
- **Command palette (cmdk):** navigate, jump to IP/alert/incident, run actions ("Create incident", "Toggle theme", "Switch org"). Recent items. Opaque `surface-2`, backdrop dim only.
- **Keyboard:** `G then O/A/I/L` go to pages, `J/K` move in lists, `Enter` open, `E` dismiss, `I` incident, `F` false positive, `/` focus search, `?` shortcuts overlay. All discoverable via tooltips.
- **Saved views:** any filtered table can be saved per user, shown as tabs above the table.
- **Notifications centre:** real events (new critical alert, SLA near breach, source offline, model drift); mark read; deep-links.
- **Onboarding:** an empty org shows a 3-step checklist (connect a source → activate a model → invite a teammate) with real status ticks; no fake zeros.
- **Optimistic updates** with rollback toast for status changes and drag and drop.
- **Toasts:** bottom-right, 4 s, actionable ("Undo"), max 3 stacked, `aria-live=polite`.
- **Destructive actions:** confirm dialog stating the exact consequence; typed confirmation for irreversible org-level actions.

## 5. Component library

Build on **Radix UI primitives** with Tailwind, in `apps/web/src/components/ui` (shadcn/ui pattern). Each component has: all states (default, hover, focus-visible, active, disabled, loading, error), keyboard behaviour, a11y labels, and a Storybook-style demo page at `/dev/components` (dev only).

| Component | Spec highlights |
|---|---|
| Button | primary / secondary / ghost / danger; sm / md / lg; loading spinner keeps width; icon-only requires `aria-label` |
| Input, Select, Combobox, Checkbox, Switch, RadioGroup, DateRangePicker | 36 px height (32 compact); inline validation messages; Switch off/on states clearly distinct |
| DataTable | TanStack Table + virtualization; sticky header; column resize/visibility/reorder; row selection with bulk bar; density toggle; cursor pagination; skeleton rows; empty & error states; CSV export; row click opens drawer; keyboard row navigation |
| KpiCard | label, value, delta vs previous period (arrow + %), sparkline, optional info tooltip, whole card is a link to the filtered list |
| ChartCard | title, subtitle (units + range), legend, tooltip, "view data" table toggle, text summary for screen readers |
| Badge / StatusPill / SeverityBadge / SourceKindBadge | tokens from §2.4 |
| EntityChip | monospace IP with copy button; hover card (first/last seen, alerts count) ; click → entity page |
| Timeline | vertical, icon per event kind, relative time with absolute tooltip, grouped by day |
| FeatureContributionChart | diverging horizontal bars (increases vs decreases the alert score), plain-language labels, value shown |
| MitreChip | technique id + name, "suggested" tag, links to the knowledge base entry |
| Drawer / Dialog / Popover / Tooltip / DropdownMenu | Radix; solid `surface-2`; focus trap; Esc closes |
| Tabs, Breadcrumbs, Stepper, Accordion | standard |
| CommandPalette | cmdk |
| Skeleton, EmptyState, ErrorState | EmptyState: icon, one-line explanation, primary action; ErrorState: what failed, retry, request id |
| KanbanBoard | dnd-kit; column counts; drop highlight; keyboard drag support; disabled for Viewer |
| GraphView | Cytoscape.js or react-force-graph; edge width = flow count; node colour = max severity; zoom/pan; minimap optional; click = pivot; "reset layout" |
| Gauge / Meter | model confidence, SLA remaining |
| CodeBlock | mono, copy, syntax tint for JSON/CLI snippets (blocklist output) |

## 6. Data visualisation rules

- One palette order for categorical series (accent first, then fixed colour-blind-safe sequence); severity charts use severity tokens only.
- **No 3D. No pie/donut above 6 slices** (use horizontal bars). Donuts only for part-to-whole with ≤ 5 parts and a centre label.
- Label units and time zone on axes; show the time range in the subtitle; log scale toggle for heavy-tailed counts.
- Tooltips solid (`surface-2`), show exact values and timestamp.
- Every chart has: loading skeleton, empty state ("No alerts in this range"), error state, and a text summary (e.g. "Alerts peaked at 14:20 with 312").
- Large series are downsampled server-side (LTTB) before reaching the browser.
- Colour is never the only differentiator (patterns/labels for accessibility on stacked charts).

## 7. Page specifications (wireframes in words)

**Command Center.** Row 1: 6 KPI cards. Row 2 (8/4 cols): stacked alert volume over time · "Needs attention" list (SLA near breach, unassigned P1, sources offline). Row 3 (4/4/4): attack mix bars · top attacking entities · top targeted ports. Row 4 (6/6): ATT&CK tactic strip · model health card (version, macro-F1, drift status). Empty org → onboarding checklist replaces rows 2-4.

**Alerts.** Header: title, saved-view tabs, time range, "Create incident" (bulk). Filter bar (severity, type, status, source kind, IP search). DataTable: select, severity, type + MITRE chip, src → dst (EntityChips), confidence meter, source kind, status, age. Row click opens right drawer with detail (same content as the full page). Bulk bar appears on selection.

**Alert detail.** Left (8 cols): summary line, evidence flows table, **"Why this fired"** (FeatureContributionChart + glossary text), model/rule provenance. Right (4 cols): status/assignee, verdict buttons, MITRE, recommended steps, related alerts, "Open entity". Footer: audit trail.

**Incidents.** Toggle Board / Table. Board columns Open · Investigating · Contained · Resolved · Closed with WIP counts; cards show priority, severity, title, entities, assignee avatar, SLA ring. Table view with sortable columns and saved views.

**Incident detail.** Header (title, status select, priority, assignee, SLA). Tabs: **Timeline** (default) · Evidence · Entities & graph · Report. Right rail: MITRE stage strip, recommended actions (guidance + "Generate blocklist"), related incidents. Comment composer with @mentions and Markdown.

**Investigate (entity).** Header: IP, tags, first/last seen, risk summary. Tabs: Overview (stats + alert history chart) · Flows · Peers (GraphView) · Incidents · Notes. Filters follow the global time range.

**Live monitor.** Top: source-kind legend, ingest rate meter, pause/resume, severity filter, sound toggle (off by default). Main: streaming list (virtualized, newest on top, row flash on arrival ≤ 400 ms). Side: live counters by severity. Empty state explains how to start a collector or replay.

**Detections.** Tabs: Rules (table + editor drawer + "test over last 24 h") · Severity map · MITRE mapping. Changes show a diff before saving and write audit.

**Models lab.** Left: versions list with status chips. Main: selected model card (metrics tables, confusion matrix heatmap, calibration, latency), compare mode, drift panel, feedback panel, activate button (Admin).

**Sources.** Cards/table: name, kind badge, status dot, last seen, rate, version; "Add source" opens a wizard that shows the exact collector command with a freshly minted API key (shown once).

**Integrations.** Cards per type; configuration drawer; test button; delivery log table with retry state.

**Reports.** Builder: report type, range, sections toggles; live preview (HTML mirroring the PDF) before export; footer always shows sources, model version, generated-at UTC.

**Team / Audit / Settings.** Team table with role selects and invites; Audit log table with filters and export; Settings tabs: Profile, Security (password, sessions, MFA), Preferences (theme, density, language, accent), Organisation, API keys, Data & retention.

**Login / Register.** Split layout: left brand panel (calm animated network backdrop, reduced-motion safe), right form. Password strength meter, show/hide, clear errors.

## 8. Accessibility checklist (per PR)

- All interactive elements reachable and operable by keyboard; visible `:focus-visible` ring (2 px accent, 2 px offset).
- Contrast ≥ 4.5:1 (text) and ≥ 3:1 (UI components/graphics) in both themes.
- Landmarks (`header`, `nav`, `main`), skip-to-content link, headings in order.
- Form fields have labels and described errors; error summary on submit.
- Live regions for toasts and streaming counters (throttled).
- Charts: text summary + data-table toggle.
- Touch targets ≥ 40 px on mobile.
- Tested with a screen reader on at least login, alerts, and incident detail.

## 9. Content and microcopy

- Tone: precise, calm, no hype, no jargon without a tooltip. Sentence case. Verbs on buttons ("Create incident", not "Submit").
- Errors say what happened and what to do; include request id for support.
- Times: user timezone with UTC on hover; relative for < 24 h; ISO in exports.
- Numbers: locale-aware; abbreviate above 10k (12.4k) with exact value on hover.
- Honest labels: "Replayed data", "Suggested mapping", "Estimate (low sample)".

## 10. i18n

`i18next` with namespaces per feature; EN default, FR and HI complete for UI chrome and the knowledge base titles; no hard-coded strings in components (lint rule); locale-aware dates/numbers via `Intl`; layouts tolerate +40% text length; Devanagari font fallback (Noto Sans Devanagari).

## 11. Implementation notes

- Tailwind theme reads CSS variables; `cn()` helper with `tailwind-merge` to avoid class-order conflicts.
- Theme, density and accent persisted server-side (user preferences) with a no-flash inline script setting `data-theme` before paint.
- Route-level code splitting; charts lazy-loaded; icons imported individually.
- A `/dev/components` page documents every component and token (dev only), and Playwright visual snapshots guard against regressions on key pages.
