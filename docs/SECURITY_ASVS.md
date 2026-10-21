# Sentinel — OWASP ASVS Level 1 checklist

> Review date: 2026-10-21. Scope: `apps/api` (Express), `apps/web` (SPA served by nginx in Docker),
> `docker-compose.yml`. The ML service (`services/ml`) and the future collector are out of scope here.
>
> Numbering follows **ASVS 4.0.3** (the version this project's docs reference). ASVS 5.0 (May 2025)
> renumbers and tightens several items; a re-mapping is listed under "Gaps".
>
> Status: **Met** (implemented and covered by a test or a reproducible check), **Partial** (implemented
> with a stated limit), **Gap** (not done), **N/A** (the feature does not exist). "Met" means met for
> what Sentinel does today, not a certification. Nobody external has audited this code.

## Summary

The rows below cover the ASVS 4.0.3 Level 1 requirements that apply to what Sentinel does today;
L1 items about features it does not have (SOAP, GraphQL, OAuth server, password reset by email, ...)
are marked N/A or grouped. The open items are collected in "Gaps to close" at the end.

## V2 Authentication

| ID | Requirement (short) | Status | Where / evidence |
|---|---|---|---|
| 2.1.1 | Passwords ≥ 12 characters | Met | `packages/shared/src/schemas.ts` (`registerBodySchema`, `changePasswordBodySchema`), `account.ts` (invite accept); `apps/api/tests/auth.test.ts` |
| 2.1.2 | Passwords up to 64+ characters allowed | Met | max 200 characters, same schemas |
| 2.1.3 | No truncation | Met | the whole string goes to argon2id (`lib/crypto.ts`) |
| 2.1.4 | Any printable Unicode allowed | Met | no character-class filter in the schemas |
| 2.1.5 | Users can change their password | Met | `POST /auth/change-password`; `auth.test.ts` |
| 2.1.6 | Change requires the current password | Met | same route |
| 2.1.7 | Check against breached passwords | **Gap** | no breached-password list (would need a k-anonymity API or a local list) |
| 2.1.8 | Strength meter | Met | `features/auth/AuthPages.tsx` (`strength`) |
| 2.1.9 | No composition rules | Met | length only |
| 2.1.10 | No periodic rotation | Met | none |
| 2.1.11 | Paste and password managers allowed | Met | plain inputs, `autocomplete` set |
| 2.1.12 | Show / hide password | Met | `PasswordInput` toggle |
| 2.2.1 | Anti-automation | Partial | login/register/invite/MFA rate limits (IP + email or account) and a per-account MFA lock (5 failures → 15 min, stored in MongoDB); `invites.test.ts`, `mfa.test.ts`, `auth.test.ts`. **Limit:** express-rate-limit uses an in-memory store, so limits are per API process. |
| 2.2.2 | Weak authenticators (SMS, email) only as secondary | Met | none used |
| 2.2.3 | Notify on credential changes | **Gap** | no email channel; changes are in the audit log only |
| 2.3.1 | Initial / activation secrets random, short-lived | Met | invitation tokens: 32 random bytes, 1–14 days, single use, stored as SHA-256 (`modules/members/invite.routes.ts`); `invites.test.ts` |
| 2.4.1 | Passwords stored with an approved KDF | Met | argon2id (m=19 MiB, t=2, p=1, OWASP minimum); legacy bcrypt upgraded at login |
| 2.4.2 | Salted | Met | argon2 embeds a random salt |
| 2.5.1–2.5.7 | Credential recovery | N/A | no password reset (no email server). An Owner can remove and re-invite a member; a lost Owner password has no in-app recovery (**documented limitation**) |
| 2.5.6 | Recovery does not reveal the current password | N/A | idem |
| 2.7.x | Out-of-band authenticators | N/A | none |
| 2.8.1 | TOTP time-based codes have a defined lifetime | Met | 30 s steps, ±1 step drift (`modules/auth/mfa.service.ts`) |
| 2.8.3 | Approved algorithms for OTP | Met | RFC 6238 HMAC-SHA1 via otplib (authenticator-app compatible) |
| 2.8.4 | An OTP is used only once | Met | last time step stored with compare-and-set; `mfa.test.ts` "refuses a replayed code" |
| 2.8.5 | Reuse logged and rejected | Partial | rejected; failed attempts counted, but a replay is not a distinct audit event |
| 2.9.x | Cryptographic authenticators | N/A | none |
| 2.10.x | Service authentication | Partial | API → ML service uses a shared token from env (`ML_SERVICE_TOKEN`), optional in development. API keys for collectors (roadmap 2.2) do not exist yet |
| — | Unknown email vs wrong password indistinguishable | Met | same message and same argon2 work (`auth.service.ts` `login`) |

## V3 Session management

| ID | Requirement | Status | Where / evidence |
|---|---|---|---|
| 3.1.1 | No session token in URLs | Met | access token in the `Authorization` header, refresh token in a cookie; invitation tokens in the URL **fragment** and POST bodies only |
| 3.2.1 | New token at authentication | Met | `issueTokens` creates a new session per sign-in |
| 3.2.2 | ≥ 64 bits of entropy | Met | 256-bit refresh secret, HS256 access JWT |
| 3.2.3 | Stored securely in the browser | Met | access token in memory only, refresh in an httpOnly cookie; e2e asserts storage holds no token |
| 3.3.1 | Logout invalidates the session | Met | `POST /auth/logout`; a revoked session invalidates its access tokens on the next request (`requireAuth` checks the session) |
| 3.3.2 | Re-authentication / idle limits | Partial | access 15 min, refresh 7 days absolute (configurable); no idle timeout beyond the access-token lifetime |
| 3.3.3 | Option to end other sessions after a credential change | Met | password change and MFA enable sign out every other session; "Sign out everywhere" |
| 3.3.4 | Users can see and end their sessions | Met | Settings → Security, `GET/DELETE /auth/sessions` |
| 3.4.1 | Cookie `Secure` | Met | always on (`auth.routes.ts` `cookieOptions`) |
| 3.4.2 | Cookie `HttpOnly` | Met | |
| 3.4.3 | Cookie `SameSite` | Met | `Strict` |
| 3.4.4 | `__Host-` prefix | **Gap** | the cookie is path-scoped to `/api/v1/auth` (a `__Host-` cookie must use `Path=/`); trade-off kept, flagged |
| 3.4.5 | Path attribute as narrow as possible | Met | `/api/v1/auth` |
| 3.5.x | Token-based sessions | Met | refresh rotation with reuse detection (`auth.test.ts`), JWT `alg` pinned to HS256, `typ` checked (an MFA challenge token is not an access token, `mfa.test.ts`) |
| 3.7.1 | Re-authentication before sensitive changes | Met / partial | password required for password change, MFA set-up / disable / new recovery codes; **account deletion relies on a typed confirmation only** |

## V4 Access control

| ID | Requirement | Status | Where / evidence |
|---|---|---|---|
| 4.1.1 | Enforced server-side | Met | `authorize()` on every route via `PolicyRouter`; the web app only hides controls |
| 4.1.2 | Attributes not tamperable by users | Met | org and role come from the membership found server-side; `X-Org-Id` is validated against memberships |
| 4.1.3 | Least privilege | Met | role matrix `packages/shared/src/rbac.ts`; Viewers never mutate (`maps.test.ts`) |
| 4.1.5 | Fails securely | Met | missing policy → route cannot be declared; unknown org → 404 |
| 4.2.1 | IDOR protection | Met | Mongoose `tenantGuard` refuses any query without `orgId`; cross-org → 404 (`tenancy-rbac.test.ts`, `jobs.test.ts`, `retention.test.ts`) |
| 4.2.2 | CSRF protection | Met | bearer header on every state-changing API call (not ambient); cookie endpoints need `X-Sentinel-CSRF` + allowed `Origin` + `SameSite=Strict` (`security-headers.test.ts`) |
| 4.3.1 | MFA for administrative interfaces | Partial | TOTP available to everyone, **not enforced** for Owners / Admins (an org-level "require MFA" setting is a follow-up) |
| 4.3.2 | Directory browsing disabled | Met | nginx serves files only, SPA fallback to `index.html` |
| — | Role × route matrix tested | Met | `tenancy-rbac.test.ts` runs every declared route for every role |

## V5 Validation, sanitisation and encoding

| ID | Requirement | Status | Where / evidence |
|---|---|---|---|
| 5.1.1 | HTTP parameter pollution | Met | zod parses query strings to single typed values |
| 5.1.2 | Mass assignment | Met | `.strict()` body schemas; handlers copy named fields only |
| 5.1.3 | Input validation (allow-list) | Met | zod on every body, query, param (`validate()`), env (`config`), queue payloads (re-validated ids in handlers) |
| 5.1.4 | Structured data validated | Met | rule DSL, allowlist CIDRs, CSV rows (invalid rows rejected and sampled, never defaulted) |
| 5.1.5 | Redirects allow-listed | Met | the API never redirects; the SPA redirects only to in-app paths |
| 5.2.1 | HTML sanitised | Met | React escapes text; no `dangerouslySetInnerHTML` in `apps/web` |
| 5.2.2 | Unstructured data sanitised | Met | notes and names are stored and rendered as text |
| 5.2.4–5.2.8 | eval, template, SVG, scriptable content | Met / N/A | none used; QR codes are PNG data URLs generated server-side |
| 5.3.1 | Output encoding per context | Met | JSON responses; React rendering; firewall snippet generators escape comments (`response.test.ts`) |
| 5.3.3 | XSS-safe output | Met | idem, plus CSP `script-src 'self'` |
| 5.3.4 | Database injection | Partial | Mongoose with `strictQuery`, zod-typed inputs (objects cannot reach filters as operators), one regex built from server-generated job ids is escaped (`alert.service.ts`). Not covered by a dedicated injection test suite |
| 5.3.7–5.3.10 | LDAP, OS command, XPath, XML | N/A | none used |
| 5.5.x | Deserialisation | Met / N/A | JSON only, 1 MB body limit; no object deserialisation |

## V7 Error handling and logging

| ID | Requirement | Status | Where / evidence |
|---|---|---|---|
| 7.1.1 | No credentials or session tokens in logs | Met | pino `redact` for authorization, cookies, passwords, tokens, MFA material (`lib/logger.ts`); bodies are not logged |
| 7.1.2 | No other sensitive data in logs | Met | invitation tokens never logged or audited (`invites.test.ts` checks the audit entry) |
| 7.4.1 | Generic error messages with an id | Met | central error handler, envelope with `requestId`, no stack traces (`security-headers.test.ts`) |
| — | Security events audited | Met | append-only `audit_log`: logins (with factor), MFA changes, invitations, membership changes, retention, job retries, every mutation (`audit.test.ts`) |

## V8 Data protection

| ID | Requirement | Status | Where / evidence |
|---|---|---|---|
| 8.2.1 | Anti-caching for sensitive data | Met | `Cache-Control: no-store` on every `/api/v1` response (`security-headers.test.ts`) |
| 8.2.2 | Nothing sensitive in browser storage | Met | only theme / accent / active org id in `localStorage` |
| 8.2.3 | Data cleared after logout | Met | in-memory token dropped, query cache cleared |
| 8.3.1 | Sensitive data in bodies or headers, not URLs | Met | see 3.1.1 |
| 8.3.2 | Users can delete and export their data | Met | `GET /me/export` (no hashes, seeds or recovery hashes, `mfa.test.ts`), `DELETE /me` |
| 8.3.4 | Retention of sensitive data | Partial | per-org retention for flows and alerts with dry-run preview and audited purge (`retention.test.ts`); off by default; audit log, incidents and identity records are never purged automatically |
| — | Secrets at rest | Met | TOTP seeds AES-256-GCM (`lib/secrets.ts`, `secrets.test.ts`); refresh tokens, invitation tokens and recovery codes stored as SHA-256; passwords argon2id |

## V9 Communications

| ID | Requirement | Status | Where / evidence |
|---|---|---|---|
| 9.1.1 | TLS for all client connections | **Gap** | the Compose stack serves HTTP on port 8080; TLS must be terminated by a reverse proxy in front of it (not shipped yet). The refresh cookie is `Secure`, so browsers only send it over HTTPS or to `localhost` |
| 9.2.x | Server-side TLS (to MongoDB, Redis, ML) | Partial | traffic stays inside the Compose network, unencrypted; `rediss://` and MongoDB TLS URIs are accepted when needed |

## V10 Malicious code, V11 Business logic

| ID | Requirement | Status | Where / evidence |
|---|---|---|---|
| 10.3.2 | Dependency integrity | Met | `package-lock.json`, `npm ci` in CI and Docker |
| 10.3.3 | Subdomain / third-party code | Met | no third-party scripts or CDNs; fonts self-hosted |
| 11.1.2 | Business-logic limits | Met | last-Owner protection survives concurrent changes (`invites.test.ts`); invitation single use under concurrency (atomic claim); MFA codes and recovery codes single use |
| 11.1.4 | Anti-automation on costly operations | Partial | global API limit (2,000 / 15 min / IP), imports processed off the request in the job queue, rule tests limited to writers; no per-org quota |

## V12 Files and resources

| ID | Requirement | Status | Where / evidence |
|---|---|---|---|
| 12.1.1 | Size limits | Met | `UPLOAD_MAX_MB` (CSV), 20 MB identity files, 1 MB JSON; multipart limits on files, fields, parts (`lib/uploads.ts`) |
| 12.1.2 | Compressed files | N/A | archives are refused (binary sniffing) |
| 12.2.1 | Content matches the expected type | Met | extension `.csv` **and** content sniffing (no NUL byte, valid UTF-8 in the first 64 KB) **and** header check before any row is stored (`uploads.test.ts`) |
| 12.3.1 | No user-supplied path names | Met | random server-side file names; the original name is stored as text only |
| 12.3.2–12.3.6 | Path / remote file inclusion, SSRF via files | Met | files are only parsed as CSV, never executed or fetched |
| 12.4.1 | Uploads stored outside the web root | Met | OS temp dir or `UPLOAD_DIR` volume; deleted after import |
| 12.4.2 | Antivirus | N/A | uploads are parsed as text and never served back |
| 12.5.x | Download / serving of uploads | N/A | uploads are never served |
| 12.6.1 | SSRF allow-list | Met | outbound calls only to `ML_SERVICE_URL` from validated env |

## V13 API and web service

| ID | Requirement | Status | Where / evidence |
|---|---|---|---|
| 13.1.1 | Same encoding and parsers everywhere | Met | JSON only (`express.json`), multipart on two upload routes |
| 13.1.3 | No sensitive data in API URLs | Met | see 3.1.1 |
| 13.1.4 | Authorisation at the resource level | Met | see V4 |
| 13.2.1 | Only declared HTTP methods | Met | unknown routes → 404 envelope |
| 13.2.2 | JSON schema validation | Met | zod; OpenAPI generated from the same schemas at `/api/docs` |
| 13.2.3 | CSRF on JSON APIs | Met | see 4.2.2; text/plain bodies are not parsed as JSON (`security-headers.test.ts`) |
| 13.3.x / 13.4.x | SOAP, GraphQL | N/A | |

## V14 Configuration

| ID | Requirement | Status | Where / evidence |
|---|---|---|---|
| 14.1.x | Build and deploy reproducible | Met | CI: typecheck, lint, tests (with Redis service), build, Docker build, e2e |
| 14.2.1 | Components up to date / audited | Partial | CI blocks on high production advisories (`npm audit --omit=dev`: 0 on 2026-10-21). **Dev-only advisories remain** (vite 5, vitest 3, tinypool, tailwind 3 chain: 2 critical, several high, all build/test tooling, not shipped). Upgrading vite / vitest majors is a follow-up |
| 14.2.2 | Unneeded features removed | Met | `x-powered-by` off, no sample apps, `/metrics` off by default |
| 14.2.3 | No CDN assets without SRI | Met | everything self-hosted |
| 14.3.2 | Debug off in production | Met | `NODE_ENV=production` in Compose; no stack traces in responses |
| 14.3.3 | No version banners | Met | `server_tokens off` in nginx; no `X-Powered-By` |
| 14.4.1 | Content-Type with charset | Met | Express JSON responses |
| 14.4.3 | CSP | Partial | API: `default-src 'none'`. Web (nginx): `script-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`; **`style-src` allows `'unsafe-inline'`** (charting library sets inline styles) |
| 14.4.4 | `X-Content-Type-Options: nosniff` | Met | API (helmet) and nginx |
| 14.4.5 | HSTS | Met | helmet sends `Strict-Transport-Security` on API responses; effective once served over HTTPS |
| 14.4.6 | Referrer-Policy | Met | API `no-referrer`, web `strict-origin-when-cross-origin` |
| 14.4.7 | Framing forbidden | Met | `frame-ancestors 'none'` + `X-Frame-Options: DENY` |
| 14.5.3 | CORS allow-list | Met | `CORS_ORIGINS`, wildcard refused at startup (`config.test.ts`, `security-headers.test.ts`) |
| 14.1.x secrets | Secrets from env, validated, never committed | Met | zod config fails fast; weak JWT secret refused in production; `.env` git-ignored |
| — | Separate key for data at rest | **Gap (soft)** | `ENCRYPTION_KEY` is optional; when unset, the key is derived from `JWT_ACCESS_SECRET` with a startup warning |

## Gaps to close (ordered)

1. TLS termination in the shipped Compose profile (or a documented Caddy / Traefik example) — 9.1.1.
2. Enforce MFA for Owners / Admins per org — 4.3.1; replay attempts as distinct audit events — 2.8.5.
3. Breached-password check — 2.1.7.
4. Rate-limit store shared across API processes (Redis store) — 2.2.1.
5. Re-authenticate before account deletion — 3.7.1.
6. Upgrade dev tooling with advisories (vite, vitest, tailwind) — 14.2.1.
7. Remove `'unsafe-inline'` from `style-src` — 14.4.3.
8. Re-map this checklist to ASVS 5.0.
