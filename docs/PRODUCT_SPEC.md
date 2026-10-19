# Sentinel — Product Specification

## 1. Vision and positioning

**Sentinel: explainable threat detection and triage for small security teams.**

Large SIEMs are powerful, expensive and slow to set up. Small teams (SMBs, universities, small MSSPs, student SOCs) need three things: *see what is happening on the network, know why an alert fired, and know what to do next.* Sentinel does exactly that, deploys with one command, and is honest about what its models can and cannot do.

### Differentiators
1. **Explainable alerts**: every alert shows the features that drove the decision (SHAP contributions) and the rule or model version that produced it.
2. **Honest provenance**: every record is tagged LIVE / REPLAY / IMPORTED / DEMO; every model has a model card with per-class metrics and known limits.
3. **Analyst workflow, not just charts**: queue, triage, incident correlation, timeline, MITRE ATT&CK context, response guidance.
4. **Lab-validated**: detection is validated on traffic captured in the owner's own lab, not only on a 2017 benchmark.
5. **One-command deploy**: `docker compose up` gives the full stack.

### Honest competitive position

| | Splunk / Sentinel / QRadar | Elastic Security / Wazuh | Sentinel |
|---|---|---|---|
| Breadth of data sources | Very high | High | Network flows (focused) |
| Setup effort | Days to weeks | Hours to days | Minutes |
| Cost | High | Free to moderate (self-run effort) | Free self-host |
| Alert explainability | Limited | Limited | Core feature |
| Target team | Enterprise SOC | Technical teams | Small teams, education, demos |

Sentinel does **not** claim to replace an enterprise SIEM. It is a focused, explainable network-detection product.

## 2. Personas

| Persona | Goals | Key screens |
|---|---|---|
| **Analyst (Tier 1)** — Amira | Clear the alert queue fast, understand why each alert fired, escalate or dismiss with confidence | Alerts, Alert detail, Incidents, Live monitor |
| **Security lead / Admin** — Daniel | See posture at a glance, manage team and sources, trust the model, report upward | Command Center, Models lab, Sources, Team, Reports, Audit log |
| **Evaluator** (professor, hiring manager, expo judge) | Understand the product in 5 minutes, see it work live, judge engineering quality | Command Center, Live monitor, Incident detail, Models lab, README |

## 3. Product principles

1. Answer *what / why / so what* on every screen.
2. Fewer clicks to the evidence: any IP, alert or incident is one click from its full context.
3. Calm by default: no decorative glow or motion that competes with data.
4. Never hide uncertainty: show confidence, support, and data source.
5. Everything the UI shows must exist in the backend.

## 4. Scope

**In scope:** network-flow telemetry, ML + rules detection, alerts, incidents, investigation, live stream, models lab, response guidance and blocklist export, integrations (webhook/Slack/email), reports, multi-tenant orgs, RBAC, API keys, audit log, i18n (EN/FR/HI), responsive triage on mobile.

**Out of scope:** endpoint agents, log parsing of arbitrary sources, billing/payments, threat-intel feed subscriptions, automatic active blocking.

**Stretch:** MFA (TOTP), OIDC SSO, anomaly/novelty detection (IsolationForest), PCAP download of an alert's flows, scheduled PDF email.

## 5. Features and acceptance criteria

### F1. Organisations, access and keys
- Users belong to one or more orgs with a role per org: Owner, Admin, Analyst, Viewer.
- Invite by email link (token, expiry 7 days); accept creates or links the account.
- API keys: create (shown once), list (prefix, scopes, last used), revoke. Scopes `ingest`, `read`.
- Org switcher in the top bar; all data is org-scoped.
- **AC:** a Viewer cannot mutate anything (server returns 403, tested); cross-org access attempts return 404; revoked key fails within 5 s; audit log records every change.

### F2. Data sources
- **Collector** (Python) in three modes: `live` (network interface), `pcap` (file), `replay` (dataset replay with speed control). Sends batches to `/api/v1/ingest/flows` with an API key.
- **Imports**: CSV upload (CICIDS-style) and PCAP upload (processed by the collector pipeline).
- Sources page lists each source with status (online / stale / offline), last seen, rate, version, kind badge.
- **AC:** collector heartbeat visible within 10 s; backpressure (429) handled by the collector with retry; duplicate batches are ignored via idempotency key; a malformed row is rejected with a precise error and counted, not silently dropped.

### F3. Detection engine
- **ML**: the active model for the flow's feature schema scores each flow (label, confidence, class probabilities).
- **Rules**: editable threshold rules (port-scan, brute-force, flood). See `docs/ML_AND_DETECTION.md`.
- **Hybrid decision**: severity = max(model severity, rule severity); alert lists all sources.
- Low confidence → alert state `needs_review` instead of a hard verdict.
- Dedupe/suppression: same (src, dst, type) within a window increments `count` on one alert.
- **AC:** end-to-end test: ingest a labelled attack sample → alert appears with correct type, confidence, explanation; benign sample produces no alert; changing a rule threshold changes behaviour without redeploy.

### F4. Alerts
- Queue with filters (severity, type, status, source kind, IP, time range), saved views, bulk actions (dismiss, mark false positive, create incident, assign).
- Alert detail: summary, evidence flow(s), **why this fired** (top feature contributions as a bar chart with plain-language labels), model/rule provenance, MITRE ATT&CK chip (flagged "suggested"), recommended next steps, analyst verdict buttons (true positive / false positive / benign).
- Verdicts feed the feedback loop (F9).
- **AC:** triage of 25 alerts is possible using the keyboard only (J/K navigate, E dismiss, I incident, F false positive); verdict persists and appears in the audit log; explanation sums match the model output within tolerance (tested).

### F5. Incidents
- Automatic correlation: alerts from the same source entity within a configurable window (default 15 min) merge into one incident; severity escalates with distinct kill-chain stages (e.g. PortScan then Brute Force then Botnet).
- Statuses: Open → Investigating → Contained → Resolved → Closed (false positive). Priority P1-P4. Assignee. SLA timer by severity with breach indicator.
- Detail page: header, **timeline** (alerts added, status changes, comments, actions), entities involved, MITRE stage strip, evidence tab, comments with @mentions, recommended actions, "Export incident report (PDF)".
- Board view (drag and drop with dnd-kit) and table view.
- **AC:** two correlated alerts produce one incident, not two (tested); every status change creates a timeline event and an audit entry; SLA breach is computed server-side.

### F6. Investigation (entity pages)
- Click any IP, anywhere, to open an entity page: first/last seen, alert history, flow stats, ports contacted, peers (graph), related incidents, analyst notes and tags.
- Graph view: attacker → victim edges sized by flow count, coloured by severity; click to pivot; filters by time and type.
- **AC:** entity page loads in under 1 s for an IP with 100k flows (rollups/indexes); graph renders 500 nodes at 60 fps pan/zoom.

### F7. Live monitor
- SSE stream of alerts and ingest rate. Each row shows the source-kind badge. Pause/resume, rate meter, severity filter, optional sound for critical (muted by default, user opt-in).
- **AC:** end-to-end latency from collector send to UI row is under 2 s at p95 in the demo setup; the stream reconnects with `Last-Event-ID` without duplicates; REPLAY traffic is never labelled LIVE.

### F8. Command Center (overview)
- KPI row with period-over-period delta and sparkline: alerts, open incidents, mean time to acknowledge, ingest rate, sources online, model health.
- Alert volume over time (stacked by severity), top attacking entities, attack mix, top targeted ports, ATT&CK tactic strip, "needs attention" list (SLA near breach, unassigned P1).
- Global time range picker (presets plus custom) stored in the URL.
- **AC:** every number is clickable and lands on the filtered list that produced it; empty org shows an onboarding checklist, not zeros.

### F9. Models lab
- Registry: versions, schema id, status (candidate / active / archived), training date, data, library versions.
- Comparison view: macro-F1, per-class PR, confusion matrix, calibration, latency; side-by-side of two versions.
- **Model card** (auto-generated): intended use, data, metrics, limits (e.g. tiny-support classes), cross-dataset results.
- Drift panel: per-feature PSI vs training distribution; alert when PSI > 0.2.
- Feedback panel: analyst-labelled count, false-positive rate by class; "export labelled data".
- Activating a model requires Admin and writes audit.
- **AC:** switching the active model changes scoring of subsequent flows and is reflected in alert provenance; a model with mismatched library version shows a clear warning.

### F10. Response and integrations
- Webhooks (HMAC-signed), Slack, email; subscribe per event (alert.created, incident.created/updated, sla.breach, source.offline).
- **Blocklist export**: generate reviewed rule snippets (iptables / nftables / CSV) for selected IPs. No automatic blocking. A "simulate apply" shows what would change.
- Delivery log with retry status.
- **AC:** failed webhook retries with backoff and surfaces in the delivery log; signature verifiable with documented algorithm; generated rules are syntactically valid (tested).

### F11. Reports
- Executive summary (dynamic text from real data), incident report, weekly digest; export PDF (server-rendered), CSV, XLSX.
- Every report footer states data sources, time range, model version, generated-at (UTC).
- **AC:** report numbers match the dashboard for the same range (tested); PDF renders without clipped content.

### F12. Global UX
- Command palette (Ctrl/Cmd+K): navigate, search IPs/alerts/incidents, run actions.
- Keyboard shortcuts overlay (`?`). Saved views. Notification centre (real). Onboarding checklist (connect source, activate model, invite teammate). Theme (dark default, light), density (comfortable/compact), accent presets. i18n EN / FR / HI for all UI chrome.
- **AC:** palette reachable from every page; language switch translates all static UI strings (no hard-coded English in components); light theme passes contrast checks.

### F13. Administration
- Audit log (filter by actor/action/time, export), data retention setting with purge job, system health page (queue depth, ingest rate, ML latency, DB size), team management, org settings.
- **AC:** audit entries are append-only via API; retention purge is idempotent and logged.

### F14. Knowledge base
- Per attack type: what it is, why it matters, how to confirm, how to contain, references. Static, versioned content, linked from alerts and incidents. Mappings marked "suggested".
- **AC:** every alert type has an entry; links resolve.

## 6. Non-functional requirements

| Area | Requirement |
|---|---|
| Performance | Dashboard endpoints p95 < 300 ms at 5M flows (rollups); list endpoints p95 < 800 ms; ingest ≥ 1,500 flows/s sustained on a laptop (batch 500, includes scoring); web LCP < 2.5 s; initial JS < 250 KB gzip with route splitting |
| Reliability | Ingest is at-least-once with idempotency; queue survives API restart; graceful shutdown |
| Security | See `CLAUDE.md` §9 and `docs/ARCHITECTURE.md` §7; OWASP ASVS L1 checklist in CI docs |
| Accessibility | WCAG 2.2 AA; full keyboard operation; charts have text summaries |
| Responsiveness | Triage (alerts, incident detail, notifications) fully usable on a phone; admin screens desktop-first |
| i18n | EN, FR, HI; dates and numbers localised; UTC shown on hover |
| Observability | Structured logs with request ids; `/healthz`, `/readyz`; optional `/metrics` |
| Quality | CI green: lint, typecheck, unit, integration, e2e smoke; coverage ≥ 70% on API services |

## 7. Expo and pitch package (deliverables)

1. **Live demo script (5 minutes):** open Command Center (empty and calm) → start attack from Kali (`nmap`, then `hydra`) → alert appears in Live monitor → click alert, show "why it fired" → incident auto-correlates → assign, comment, contain → export report.
2. **Backup video** (2-3 min) recorded from a clean run.
3. **README** with architecture diagram, screenshots, benchmarks, honest limitations.
4. **One-page pitch:** problem, who it is for, differentiators, comparison table, roadmap.
5. **Model card and evaluation report** (including lab results and cross-dataset generalisation).

## 8. Glossary

- **Flow:** a bidirectional summary of packets between two endpoints (5-tuple plus statistics).
- **Feature schema:** the named, ordered, typed set of features a model expects.
- **Source kind:** LIVE, REPLAY, IMPORTED or DEMO.
- **Entity:** an IP (later host/user) that alerts and flows attach to.
- **Needs review:** an alert whose model confidence is below threshold.
