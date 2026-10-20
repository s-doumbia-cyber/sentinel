# Sentinel — Design System and UX Specification

## 1. Design direction

> **Revised 2026-10-20 (owner brief).** The original direction was dark-first with a violet accent.
> It is replaced by a light, ivory identity; the dark theme stays as an option. Values below are the
> implemented ones (`apps/web/src/index.css`). **This supersedes the earlier dark/violet spec; the
> conflict is recorded in the ROADMAP decisions log.**

**"Clear field notebook."** A calm, readable workspace for long investigations: warm ivory and soft
neutral backgrounds, dark high-contrast text, sober natural accents (pine by default, ocean or plum),
and colour that means something. Reference quality: Linear, Vercel dashboard, Datadog.

Principles:
1. **Data first.** Cards and tables are solid surfaces. No glass, blur, glow or decorative gradients.
2. **Hierarchy through type, spacing and contrast.** Body text ≥ 7:1, secondary ≥ 4.5:1 on every surface it sits on.
3. **Density with air.** Dense tables, generous page rhythm. A compact density toggle exists.
4. **One accent, never a severity.** The accent marks actions, navigation and focus. Severity colours are reserved for alerts and incidents and always come with an icon and a label.
5. **Motion explains.** Short entrance fades and slides for pages, drawers, dialogs and toasts (≤ 320 ms); skeleton shimmer while loading. Under `prefers-reduced-motion` every animation is reduced to an instant change.
6. **Overlays are opaque.** Dropdowns, popovers, drawers, dialogs use solid surface tokens over an opaque-enough scrim (lesson learned from the bleed-through bug).
7. **Say what is known.** Observed facts, inferences and unknowns look different (solid, tinted, dashed); estimates are labelled "estimate" with their basis.

## 2. Tokens

Implemented as CSS variables (RGB triplets so Tailwind can apply alpha) on `:root` / `[data-theme="light"]`
(default) and `[data-theme="dark"]`, exposed through Tailwind. **Components never use raw hex.**

### 2.1 Light theme (default)

| Token | Value | Use |
|---|---|---|
| `--bg-0` | `#F2EEE4` | Navigation rail |
| `--bg-1` | `#FAF8F3` | Page background (ivory) |
| `--surface-1` | `#FFFEFB` | Cards, tables |
| `--surface-2` | `#F7F4ED` | Inputs, drawers, popovers |
| `--surface-3` | `#EDE8DD` | Hover / selected rows |
| `--border-subtle` / `--border` / `--border-strong` | `#ECE7DC` / `#DDD6C8` / `#C3B9A7` | Dividers / cards and inputs / hover |
| `--text-1` | `#1F2421` | Primary text (14.9:1 on ivory) |
| `--text-2` | `#4A524C` | Secondary text (7.6:1) |
| `--text-3` | `#5B635D` | Tertiary text (5.8:1 on ivory, 5.1:1 on `--surface-3`) |
| `--accent` / `--accent-solid` | `#2F6B5E` (pine) | Primary buttons (white text 6.2:1), active nav, focus ring |
| `--accent-fg` | `#265C50` | Accent as text / icon |
| `--accent-soft` | pine at 10 % | Selected backgrounds |
| `--scrim` | `rgba(31,36,33,.32)` | Behind dialogs and drawers |

### 2.2 Dark theme (option, or "match system")

Warm neutrals instead of blue-black: `--bg-0 #111311`, `--bg-1 #161816`, `--surface-1 #1D201D`,
`--surface-2 #242824`, `--surface-3 #2E332E`, borders `rgba(236,234,227,.07/.12/.20)`,
`--text-1 #ECEAE3`, `--text-2 #B9BCB4`, `--text-3 #969B93`, accent pine `#6FB3A2` with dark text on
filled buttons. Every text / surface pair is ≥ 4.5:1.

### 2.3 Accent presets
Pine `#2F6B5E` (default), Ocean `#2D5F8A`, Plum `#6A4C7D` in light; `#6FB3A2`, `#7DAAD6`, `#BEA0D4`
in dark. Each preset defines `--accent`, `--accent-fg`, `--accent-solid`, `--accent-contrast`,
`--accent-soft`. Legacy values (violet, cyan, emerald, pink…) map to pine. Charts' first series
follows the accent; severity never does.

### 2.4 Severity and status (reserved for alerts and incidents)

| Level | Colour (light) | Icon | Label |
|---|---|---|---|
| Critical | `#E11D48` | `ShieldAlert` | CRITICAL |
| High | `#EA580C` | `AlertTriangle` | HIGH |
| Medium | `#CA8A04` | `AlertCircle` | MEDIUM |
| Low | `#0284C7` | `Info` | LOW |
| Info | `#78716C` | `Dot` | INFO |
| Success / Safe | `#15803D` | `CheckCircle2` | OK |

Rules: always icon + text + colour; badge = 15 % tint of the level colour with a darker text step
(`--sevfg-*`) so labels keep 4.5:1 on their tint. Dark theme uses lighter steps of the same hues.

Source-kind badges: `LIVE` (green), `REPLAY` (teal), `IMPORTED` (stone), `DEMO` (amber, dashed border).

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
