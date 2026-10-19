# 03 — API Routes & MongoDB Schema

## API Routes

Base URL: `/api` (proxied by Vite to `http://localhost:4000` in dev — see `frontend/vite.config.ts`).

### Auth — `/api/auth`

Input on `/register`, `/login`, and `/change-password` is validated with Zod (`src/validators/authValidators.js`) — invalid bodies return `400` with a `field`/`message` breakdown before touching the database.

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/register` | none | Create account, returns `{ token, user }`, creates a `Session` record |
| POST | `/login` | none | Authenticate, returns `{ token, user }`, creates a `Session` record |
| GET | `/me` | Bearer JWT | Returns the current session's user |
| PATCH | `/me` | Bearer JWT | Updates name and/or preferences (emailAlerts, pushAlerts, language, accentColor) — genuinely persisted |
| POST | `/change-password` | Bearer JWT | Verifies `currentPassword`, sets `newPassword`, revokes every other active session |
| POST | `/logout` | Bearer JWT | Revokes only the current session |
| POST | `/logout-all` | Bearer JWT | Revokes every session and bumps `tokenVersion`, invalidating all previously issued JWTs at once |
| GET | `/sessions` | Bearer JWT | Lists this user's active (non-revoked) sessions — device, IP, last seen, which one is "current" |
| DELETE | `/sessions/:id` | Bearer JWT | Revokes one specific session (can't revoke the one making the request) |
| GET | `/export` | Bearer JWT | GDPR-style export of the account + its sessions as JSON |
| DELETE | `/me` | Bearer JWT | Permanently deletes the account and its sessions |

### Users — `/api/users` (Admin only)

| Method | Path | Description |
|---|---|---|
| GET | `/` | List every account (id, name, email, role, createdAt) |
| PATCH | `/:id/role` | Change a user's role (`Analyst`/`Admin`/`Viewer`) — can't remove your own Admin role |

### Network Flows / Analytics — `/api/flows`

All routes require `Authorization: Bearer <token>`.

| Method | Path | Description |
|---|---|---|
| GET | `/` | Paginated, filterable, sortable flow listing (Attack Explorer table) |
| GET | `/kpis` | The 8 dashboard KPI values, computed server-side |
| GET | `/attack-breakdown` | Count of flows grouped by attack type (donut/bar charts) |
| GET | `/timeline` | Daily attack vs normal counts (trend chart) |
| GET | `/top-ports` | Top 10 destination ports by attack volume |
| GET | `/top-attackers` | Real internal source IPs ranked by attack volume (Threat Intelligence page) |
| GET | `/top-subnets` | Attack count grouped by source IP's first octet — surfaces a misbehaving subnet |

**Shared query params** (all optional, combinable): `attackType`, `protocol`, `severity`, `sourceIp`, `destinationIp`, `port`, `country`, `from`, `to`. The listing endpoint additionally accepts `page`, `limit` (max 200), `sortBy`, `sortDir`.

### Incidents — `/api/incidents`

| Method | Path | Role required | Description |
|---|---|---|---|
| GET | `/` | any | List incidents, optional `status` / `priority` query filters |
| POST | `/` | Analyst, Admin | Create an incident |
| PATCH | `/:id` | Analyst, Admin | Update status/priority/assignee/notes |
| DELETE | `/:id` | Admin | Remove an incident |

### Datasets — `/api/datasets`

| Method | Path | Role required | Description |
|---|---|---|---|
| GET | `/` | any | List every imported dataset |
| POST | `/upload` | Analyst, Admin | Upload and import a CSV (multipart, field name `file`) |
| DELETE | `/:id` | Admin | Deletes the dataset AND every flow it imported (cascading) |

### Health

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Liveness check, returns uptime |

## MongoDB Schema

### `sessions`

| Field | Type | Notes |
|---|---|---|
| `user` | ObjectId → `users` | indexed |
| `jti` | String | unique — matches the JWT's `jti` claim |
| `userAgent` / `ip` | String | captured at login |
| `lastSeenAt` | Date | updated on every authenticated request |
| `revoked` | Boolean | set by logout, logout-all, or an explicit session revoke |

### `users`

| Field | Type | Notes |
|---|---|---|
| `name` | String | required |
| `email` | String | required, unique, lowercase |
| `passwordHash` | String | bcrypt, 12 salt rounds |
| `role` | Enum | `Analyst` \| `Admin` \| `Viewer` |
| `createdAt` / `updatedAt` | Date | via `timestamps: true` |

### `networkflows`

| Field | Type | Notes |
|---|---|---|
| `datasetId` | ObjectId → `datasets` | which uploaded CSV this row came from |
| `timestamp` | Date | indexed |
| `sourceIp` / `destinationIp` | String | indexed |
| `sourcePort` / `destinationPort` | Number | `destinationPort` indexed |
| `protocol` | Enum | `TCP` \| `UDP` \| `ICMP` |
| `flowDurationMs` | Number | |
| `packetLength` | Number | |
| `label` | Enum | ground-truth class (13 attack types + `Normal`), indexed |
| `prediction` | Enum | model-predicted class, same enum |
| `severity` | Enum | `critical`…`safe`, indexed |
| `country` | String | attribution for Threat Intelligence / World Map |
| `isAttack` | Boolean | indexed, derived from `label !== "Normal"` |
| `raw` | Mixed | original CSV row, kept for lossless re-processing |

Compound index: `{ timestamp: -1, isAttack: 1 }` to keep the timeline/trend aggregations fast at CICIDS2017 scale (~2.8M rows across its files).

### `incidents`

| Field | Type | Notes |
|---|---|---|
| `title` | String | required |
| `attackType` | String | |
| `status` | Enum | `Open` \| `Investigating` \| `Resolved` \| `Closed`, indexed |
| `priority` | Enum | `P1`–`P4` |
| `severity` | Enum | shared severity enum |
| `assignee` | ObjectId → `users` | |
| `sourceIp` | String | |
| `relatedFlows` | [ObjectId → `networkflows`] | |
| `notes` | [{ author, text, createdAt }] | analyst comment thread |

### `datasets`

| Field | Type | Notes |
|---|---|---|
| `name` | String | original filename |
| `sourceType` | Enum | `CICIDS2017` \| `UNSW-NB15` \| `KDD99` \| `CSE-CIC-IDS2018` \| `Custom` |
| `rows` / `columns` | Number | |
| `detectedSchema` | [String] | auto-detected CSV column names |
| `attackTypesFound` | [String] | |
| `status` | Enum | `Processing` \| `Processed` \| `Failed` |
| `uploadedBy` | ObjectId → `users` | |

## Sample requests

```bash
# Login
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"analyst@sentinel.io","password":"ChangeMe123!"}'

# Get KPIs for DDoS only, using the returned token
curl "http://localhost:4000/api/flows/kpis?attackType=DDoS" \
  -H "Authorization: Bearer <token>"
```
