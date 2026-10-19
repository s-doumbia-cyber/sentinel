# Sentinel — Target Architecture

## 1. Overview

```
 ┌────────────┐   flows (HTTPS, API key)   ┌───────────────┐
 │ Collector  │ ─────────────────────────▶ │               │   score    ┌────────────┐
 │ live/pcap/ │                            │   API (Node)  │ ─────────▶ │ ML service │
 │ replay     │ ◀── heartbeat/ack ──────── │  Express + TS │ ◀───────── │  FastAPI   │
 └────────────┘                            │               │  labels,   └────────────┘
                                           │  ┌─────────┐  │  SHAP
 ┌────────────┐   REST + SSE (cookie JWT)  │  │ Workers │  │
 │  Web (SPA) │ ◀────────────────────────▶ │  │ BullMQ  │  │ ───▶ Webhooks / Slack / Email
 └────────────┘                            │  └────┬────┘  │
                                           └───┬───────┬───┘
                                               │       │
                                        ┌──────▼──┐ ┌──▼─────┐
                                        │ MongoDB │ │ Redis  │ queues, pub/sub, cache
                                        └─────────┘ └────────┘
```

## 2. Services

| Service | Responsibility | Notes |
|---|---|---|
| `apps/web` | SPA: all UI | Static build served by nginx in Docker |
| `apps/api` | REST, SSE, auth, RBAC, ingest, orchestration | Stateless; scale horizontally |
| API workers (same codebase, different entrypoint) | Scoring jobs, correlation, rollups, notifications, retention purge | BullMQ on Redis |
| `services/ml` | Model registry, inference (`/predict`), explanations, training CLI | Loads active model per feature schema |
| `services/collector` | Capture or replay, flow extraction, batching, retry | Runs on the monitored network; talks only to `/ingest` + `/heartbeat` |
| MongoDB | System of record | Time-series collection for flows (or capped rollups) |
| Redis | Queues, pub/sub for SSE fan-out, rate-limit counters, cache | |

## 3. Data flow

1. **Ingest.** Collector `POST /api/v1/ingest/flows` (gzip, ≤ 1000 flows, `Idempotency-Key`). API authenticates the key, validates with zod, stamps `orgId`, `sourceId`, `sourceKind`, writes raw flows, enqueues a scoring job. Responds `202` quickly.
2. **Score.** Worker batches flows by `featureSchema`, calls ML `/predict` (with `explain` only for flows above a pre-threshold to save cost), and runs the rules engine on the same batch. Stores verdicts on the flow (`scored`).
3. **Alert.** For flows with non-benign verdict (or `needs_review`), create or update an alert using `dedupeKey = hash(orgId, srcIp, dstIp, type, window)`. Store `explanation`.
4. **Correlate.** Correlator job groups alerts by entity within the window, creates or updates incidents, appends timeline events, recomputes severity/MITRE strip/SLA.
5. **Notify.** Publish `alert.created` / `incident.updated` to Redis pub/sub → SSE fan-out to connected browsers; enqueue integration deliveries (webhook/Slack/email) with retry.
6. **Roll up.** A job maintains `flow_rollups_1m` and `alert_rollups_1m` (counts by label/severity/proto/source kind, bytes). Dashboards read rollups, never raw flows.

## 4. Data model (MongoDB)

All tenant collections include `orgId` and have indexes leading with `orgId`.

| Collection | Key fields | Indexes |
|---|---|---|
| `orgs` | name, slug, settings{timezone, retentionDays, correlationWindowMin}, createdAt | `slug` unique |
| `users` | email, name, passwordHash (argon2id), mfa{enabled, secretEnc}, locale, createdAt | `email` unique |
| `memberships` | orgId, userId, role (Owner/Admin/Analyst/Viewer) | `{orgId,userId}` unique |
| `invites` | orgId, email, role, tokenHash, expiresAt, acceptedAt | `tokenHash`, TTL on `expiresAt` |
| `api_keys` | orgId, name, prefix, hash, scopes[], lastUsedAt, revokedAt, createdBy | `prefix` unique |
| `sessions` | userId, familyId, jti, userAgent, ip, expiresAt, revokedAt | `{userId,revokedAt}`, TTL |
| `sources` | orgId, kind (collector/import/replay), name, status, lastSeenAt, version, ratePerMin | `{orgId,name}` |
| `flows` | orgId, sourceId, **sourceKind**, ts, srcIp, dstIp, srcPort, dstPort, proto, **featureSchema**, features{…}, groundTruthLabel?, scored{modelVersion,label,confidence,probs}, ruleHits[] | `{orgId,ts}`, `{orgId,srcIp,ts}`, `{orgId,dstIp,ts}`, `{orgId,scored.label,ts}` |
| `alerts` | orgId, ts, srcIp, dstIp, dstPort, type, severity, confidence, sources[], modelVersion, ruleIds[], explanation{topFeatures[]}, status, verdict?, incidentId?, dedupeKey, count, firstSeen, lastSeen | `{orgId,status,ts}`, `{orgId,dedupeKey}` unique, `{orgId,srcIp}` |
| `incidents` | orgId, title, severity, priority, status, assigneeId, entities[], alertIds[], mitre[], firstSeen, lastSeen, sla{dueAt,breachedAt} | `{orgId,status,lastSeen}` |
| `incident_events` | orgId, incidentId, ts, actor (user/system), kind, payload | `{incidentId,ts}` |
| `entities` | orgId, type, value, firstSeen, lastSeen, counters, tags[], notes | `{orgId,type,value}` unique |
| `rules` | orgId, key, name, enabled, definition, severity, version, updatedBy | `{orgId,key}` unique |
| `models` | name, version, schema, status, metrics, artifactUri, sha256, trainedAt, libVersions, trainedOn | `{schema,status}` |
| `feedback` | orgId, alertId, verdict, userId, ts | `{orgId,alertId}` |
| `integrations` | orgId, type, configEnc, events[], enabled | `{orgId,type}` |
| `deliveries` | orgId, integrationId, event, status, attempts, lastError, ts | `{orgId,ts}`, TTL 30d |
| `notifications` | orgId, userId, kind, payload, readAt | `{userId,readAt,ts}` |
| `saved_views` | orgId, userId, page, name, query | `{userId,page}` |
| `audit_log` | orgId, ts, actorId, action, target, meta, ip | `{orgId,ts}` (append-only via API) |
| `flow_rollups_1m` / `alert_rollups_1m` | orgId, bucket, counts by label/severity/proto/sourceKind, bytes | `{orgId,bucket}` |
| `datasets` | existing import records, plus orgId | |

Retention: raw `flows` purged after `retentionDays` (default 30) by an idempotent job; rollups kept 13 months.

## 5. API design

- Base `/api/v1`, JSON, OpenAPI at `/api/docs`. Auth: browser = access JWT (Authorization header) + refresh cookie; collector = API key (`Authorization: Bearer sk_live_<prefix>_<secret>`).
- Org context: derived from the authenticated membership (active org stored server-side per session / validated header `X-Org-Id` against memberships).

| Group | Endpoints |
|---|---|
| Auth | `POST /auth/register` `POST /auth/login` `POST /auth/refresh` `POST /auth/logout` `POST /auth/logout-all` `POST /auth/change-password` `GET/PATCH /me` `GET /auth/sessions` `DELETE /auth/sessions/:id` `GET /me/export` `DELETE /me` |
| Orgs | `GET /orgs` `POST /orgs` `GET/PATCH /orgs/:id` `POST /orgs/:id/invites` `POST /invites/:token/accept` `GET/PATCH/DELETE /orgs/:id/members/:userId` |
| API keys | `GET/POST /api-keys` `DELETE /api-keys/:id` |
| Ingest | `POST /ingest/flows` `POST /ingest/heartbeat` `POST /imports/csv` `POST /imports/pcap` |
| Sources | `GET /sources` `GET /sources/:id` `DELETE /sources/:id` |
| Flows | `GET /flows` (cursor) `GET /flows/:id` |
| Stats | `GET /stats/overview` `GET /stats/timeseries` `GET /stats/breakdown?by=` `GET /stats/top?kind=attackers|subnets|ports|targets` |
| Alerts | `GET /alerts` `GET /alerts/:id` `PATCH /alerts/:id` (status, verdict) `POST /alerts/bulk` |
| Incidents | `GET /incidents` `POST /incidents` `GET /incidents/:id` `PATCH /incidents/:id` `POST /incidents/:id/comments` `GET /incidents/:id/events` `GET /incidents/:id/report.pdf` |
| Entities | `GET /entities/:type/:value` `GET /entities/:type/:value/graph` `PATCH /entities/:type/:value` (tags, notes) |
| Detection | `GET/POST /rules` `PATCH/DELETE /rules/:id` `POST /rules/:id/test` |
| Models | `GET /models` `GET /models/:id` `POST /models/:id/activate` `GET /models/:id/card` `GET /models/drift` `GET /feedback/export` |
| Integrations | `GET/POST /integrations` `PATCH/DELETE /integrations/:id` `POST /integrations/:id/test` `GET /deliveries` |
| Response | `POST /response/blocklist` (returns generated snippets) |
| Reports | `GET /reports/executive` `POST /reports/export` |
| Realtime | `GET /stream` (SSE: `alert.created`, `incident.updated`, `source.status`, `ingest.rate`) |
| Admin | `GET /audit` `GET /system/health` `POST /system/retention/run` |
| Ops | `GET /healthz` `GET /readyz` `GET /metrics` (optional) |

Conventions: see `CLAUDE.md` §8. Errors use the envelope; list endpoints return `{ items, nextCursor }`.

## 6. Realtime (SSE)

- Single endpoint `/stream`, cookie-authenticated, org-scoped. Redis pub/sub fan-out so multiple API instances work.
- Events carry an incrementing `id`; clients reconnect with `Last-Event-ID`; server keeps a short replay buffer (e.g. last 500 events per org) in Redis.
- Heartbeat comment every 15 s to keep proxies open.

## 7. Security architecture

- **AuthN:** argon2id; access JWT 15 min (memory); refresh token rotation with family reuse detection (revoke family on reuse); login rate-limit by IP and by email with exponential backoff; optional TOTP MFA.
- **AuthZ:** role matrix enforced in a single `authorize(action, resource)` policy module; every route declares its policy; tests assert 401/403/404 paths. Tenant filter injected by a repository layer so a missing `orgId` is impossible by construction.
- **Transport/browser:** HTTPS (reverse proxy in prod), helmet, strict CSP (no inline scripts), CORS allow-list, `SameSite=Strict` cookies, CSRF protection for cookie-authenticated mutations.
- **Secrets:** env only, validated; integration secrets encrypted at rest (AES-256-GCM with key from env); API keys stored as HMAC hashes.
- **Input:** zod on every boundary; payload size limits; CSV/PCAP upload limits, content sniffing, processed off the request thread; no path traversal (generated filenames).
- **Webhooks:** HMAC-SHA256 signature header with timestamp (replay window 5 min).
- **Supply chain:** lockfile, `npm audit` / `pip-audit` in CI, Dependabot.
- **Audit:** every mutation writes `audit_log` with actor, action, target, ip.
- **Privacy:** data export and account deletion (existing) preserved; org-level retention.

## 8. Performance and scaling

- Dashboards read **rollups**, not raw flows. Raw flow queries are always bounded by time and `orgId` and use cursor pagination.
- Distinct counts use rollup HyperLogLog-style approximations or bounded windows, never unbounded `distinct()`.
- Scoring in batches of 200-1000; ML service uses vectorised prediction; explanations computed only for non-benign.
- Redis cache for hot aggregates (TTL 15-60 s) invalidated by rollup job.
- Load test script (autocannon or k6) committed; results recorded in the README.

## 9. Observability

- pino JSON logs with `requestId`, `orgId`, `userId`; log levels by env.
- `/healthz` (process up), `/readyz` (Mongo, Redis, ML reachable).
- Optional Prometheus `/metrics`: ingest rate, queue depth, scoring latency, SSE clients, rule hits.
- System health page in the UI shows the same signals for Admins.

## 10. Testing strategy

| Level | Tooling | Must cover |
|---|---|---|
| Unit | Vitest, pytest | rules engine, correlation logic, MITRE mapping, severity mapping, label normalisation, rollup maths, blocklist generators |
| API integration | Supertest + mongodb-memory-server | auth flows, RBAC matrix, tenant isolation, ingest idempotency, alert dedupe, incident correlation |
| ML | pytest | predict contract, schema validation, explanation sanity, model-card generation, version-mismatch handling |
| E2E | Playwright | login → ingest sample → alert in live monitor → open → create incident → change status → export report |
| Load | autocannon / k6 | ingest ≥ 1,500 flows/s; dashboard p95 targets |
| Security | CI | npm audit, pip-audit, header checks |

## 11. CI/CD and deployment

- **GitHub Actions:** install, lint, typecheck, unit, integration (Mongo + Redis services), build, Docker build; Playwright on `main`; dependency audit (non-blocking warning).
- **Docker Compose:** services `mongo`, `redis`, `api`, `worker`, `ml`, `web`; optional profile `collector`; profile `demo` seeds an org, role users, replay source and a trained sample model.
- Health checks and `depends_on: condition: service_healthy`. Named volumes. `.env.example` is the single source of required variables.

## 12. Configuration (env)

`NODE_ENV`, `PORT`, `MONGO_URI`, `REDIS_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `API_KEY_HMAC_SECRET`, `ENCRYPTION_KEY`, `CORS_ORIGINS`, `ML_SERVICE_URL`, `SMTP_*` (optional), `RETENTION_DEFAULT_DAYS`, `LOG_LEVEL`. All validated at boot; missing/weak secrets in production abort startup.

## 13. Migration plan from the current code

| Current | Target | Action |
|---|---|---|
| `backend/` JS | `apps/api` TS | Port incrementally (routes → controllers → services → repositories); keep tests green throughout |
| `frontend/` | `apps/web` | Rebuild shell and pages on the new design system; reuse chart/data logic where sound |
| `csvImporter.js` | `apps/api` import service + shared label taxonomy | Keep the defensive behaviour and tests; set `prediction` empty and store `groundTruthLabel` |
| `seed.js` | `seed:demo` | Replace random data with honest replay of a real sample, tagged DEMO |
| `ml/train_model.py` | `services/ml` training CLI + registry | Persist model artefacts and model cards; macro-F1 selection |
| Token in `sessionStorage` | httpOnly refresh cookie + in-memory access token | Phase 0 |
| Single tenant | `orgId` everywhere | Phase 0 (do it before adding features) |
| `dist/`, `.env` in tree | `.gitignore` | Phase 0 |
