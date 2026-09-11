# Production operations — Phase J

Baseline reviewed for this contract: `bacfdb022b403850a41f6a0922c620197cf5233e` (merge of phase I PR #52). No later `master` delta existed when J started.

## Production topology

The supported MVP topology is one HTTPS frontend origin, one HTTPS API origin, MongoDB replica-set compatible persistence, Express behind a known reverse-proxy hop count, and Resend for idempotent lifecycle email. Public business origins remain tenant-owned `publicWeb` trust records and are not converted into global credentialed CORS origins.

The client build must receive `PUBLIC_API_URL=https://<api-origin>/api`. The server receives the same API origin without `/api` as `BACKEND_URL`; `FRONTEND_URL` is the authenticated panel origin. These values must describe one coherent topology.

## Configuration contract

Production is fail-closed. `NODE_ENV=production` requires all server variables below before the application constructs session/runtime dependencies:

| Variable | Production | Contract |
| --- | --- | --- |
| `NODE_ENV` | required operationally | exact `production` activates production validation |
| `PORT` | optional | platform port; defaults to `3000` |
| `MONGO_URI` | required | MongoDB URI, explicit database, non-local; credentials only in secret storage |
| `SESSION_SECRET` | required | dedicated >=32 character non-placeholder secret; must not equal `PASSWORD_MONGO` |
| `PASSWORD_MONGO` | legacy/optional | never a production session-secret fallback |
| `FRONTEND_URL` | required | HTTPS origin only, no credentials/path/query; authenticated panel origin |
| `BACKEND_URL` | required | HTTPS origin only, no credentials/path/query |
| `CORS_ORIGINS` | required | explicit comma-separated HTTPS origins, no wildcard/local; must include `FRONTEND_URL` |
| `TRUST_PROXY_HOPS` | required | integer 1–8 matching the real reverse-proxy chain |
| `RESEND_API_KEY` | required | selected phase-I transactional provider credential |
| `SMTP_FROM_EMAIL` | required | valid sender mailbox/domain accepted by provider |
| `LOG_LEVEL` | optional | defaults to `info` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | optional by deployment | required only when Google OAuth is enabled/used |
| `ENABLE_PAYMENTS` | optional | only exact `true`; payments remain outside MVP launch scope |

Client build contract:

| Variable | Production | Contract |
| --- | --- | --- |
| `PUBLIC_API_URL` | required | absolute HTTPS URL, non-local, no credentials/query/fragment, path exactly `/api` |
| `ASTRO_TELEMETRY_DISABLED` | optional | build/CI preference only; not an authority or runtime secret |

Development/test retain local URL defaults and may use test email transport. Production must never fall back to Ethereal for the phase-I idempotent lifecycle path because startup requires Resend configuration.

Secrets belong only in deployment secret stores. `.env` and `.env.*` are ignored by Git, with only a deliberate `.env.example` exception. Rotate session/provider/database credentials after suspected exposure and during normal credential lifecycle; rotate one authority at a time and verify readiness/smoke after each change. Session-secret rotation invalidates existing sessions and must be treated as an operational change.

## Startup and persistence

1. Validate configuration with the application production validator before deployment.
2. Confirm `MONGO_URI` points at the intended database and a transaction-capable replica set.
3. Run existing cutover/index verification gates before the HTTP listener starts. Existing phase migrations remain authoritative; do not create indexes ad hoc.
4. Production Mongoose runs with `autoIndex=false`. Missing required physical storage/index state must be handled by the existing migration/cutover procedures before deploy.
5. Deploy API, wait for `/health/ready` = 200, then deploy/activate frontend if the release changes URL coupling.
6. Verify publicWeb origin trust and run the controlled smoke.

Database connection failures throw into the startup lifecycle; startup exits through the top-level handler. Logs record coarse categories/codes after redaction and never print Mongo credentials.

### Existing migration / cutover authority

Use the scripts already versioned in `Server/package.json` and `Server/scripts/migrations`; do not introduce a parallel migration mechanism. Relevant production storage procedures include:

- `npm run migration:membership-authority`
- `npm run migration:membership-bookability`
- `npm run migration:availability-tenantization`
- `npm run migration:guest-appointment-capability-storage`
- `npm run migration:public-web-storage`
- `npm run migration:pending-onboarding-storage`
- `npm run migration:tenant-onboarding-account-binding-storage`

Runtime startup verifies availability, guest-capability, publicWeb, membership-bookability and tenant-onboarding storage gates before listening. If a required index/storage invariant is absent, correct it using the owning migration under an authorized change window; do not turn `autoIndex` back on in production as a shortcut.

## CORS, cookies, proxy and publicWeb

`FRONTEND_URL` is the only credentialed panel origin. Production session cookies are `HttpOnly`, `Secure`, and `SameSite=None` for the split frontend/API topology. Dynamic public booking routes and all guest READ/CANCEL/RESCHEDULE challenge/verify routes are credentialless and require fresh `publicWeb` trust. Already-issued READ/CANCEL/RESCHEDULE capabilities are consumed credentiallessly; their bounded capability is the authority, so CORS does not add a stale publicWeb dependency after issuance. Do not add wildcard CORS.

`TRUST_PROXY_HOPS` must equal the number of trusted reverse-proxy hops. A wrong value can make rate limiting key the proxy instead of the client or trust spoofed forwarding headers; therefore production has no implicit hop-count default.

Business public origins continue to be validated/revoked through the existing generation/fencing model. Changing a business origin is a tenant trust mutation and must follow the existing publicWeb procedure; global CORS configuration is not a replacement for that trust record. Lifecycle email manage links remain non-authorizing links under the trusted business origin and contain no capability bearer.

## Rate limiting

The global `/api` limiter remains **200 requests / 15 minutes** per resolved client IP. Dynamic publicWeb trust lookups retain their admission limiter. Guest capability budgets are independent per action and route:

- READ challenge 5 / 15m, verify 10 / 15m, consume 20 / 15m;
- CANCEL challenge 5 / 15m, verify 10 / 15m, consume 10 / 15m;
- RESCHEDULE challenge 5 / 15m, verify 10 / 15m, consume 10 / 15m.

These sit in addition to the global API boundary. Proxy correctness is part of the production contract via `TRUST_PROXY_HOPS`; do not disable limiters or widen CORS to work around proxy configuration.

## Transactional email

Phase I keeps Resend + persisted Mongo outbox + provider idempotency. J does not change retry/idempotency/lifecycle semantics. Production requires `RESEND_API_KEY` and `SMTP_FROM_EMAIL` at startup. Troubleshooting order: verify config presence without printing values, inspect worker/outbox status counts, check provider availability/dashboard, distinguish retryable/ambiguous/terminal failures, and use the existing explicit reconciliation path only when its provider-window preconditions are satisfied.

Never log recipient HTML, bearer/manage authority, challenge/capability secrets, provider Authorization headers or idempotent payload bodies. Delivery failure never changes appointment lifecycle authority.

## Health and readiness

- `GET /health/live` -> `200 {"status":"ok"}` when the process can serve HTTP.
- `GET /health/ready` -> `200 {"status":"ready"}` only when Mongoose is connected and Mongo responds to ping; otherwise `503 {"status":"degraded"}`.

These endpoints intentionally expose no tenant data, environment values, stack traces, versions, credentials or administrative state.

## Logging

Production logs are structured JSON with timestamp and level. The logger redacts sensitive-key fields, bearer material and Mongo credentials. Operational events should prefer stable codes/categories over payload dumps. Required minimum diagnostic classes are startup/config failure, Mongo connectivity, publicWeb/config failure, request/server error, guest communication worker/provider failure and rate-limit anomalies.

## Backup / restore

Authoritative data is the production MongoDB database, including appointments, memberships/configuration, publicWeb trust state, guest verification/capability storage and communication outbox/jobs.

For MVP/pilot: use Atlas automated backups (or an equivalent encrypted provider-managed backup) at least daily, retain at least 7 daily recovery points and keep one longer weekly point during pilot changes. The operator owning MongoDB is responsible for confirming successful backup status.

Restore rehearsal must always target a newly created non-production database/cluster:

1. Record source backup identifier and timestamp.
2. Create/select an isolated restore target whose name cannot resolve to production.
3. Restore the snapshot there; never use the production URI as restore target.
4. Run existing storage/index cutover gates and `/health/ready` against the restored target.
5. Run controlled checks plus the MVP smoke using dedicated fixture data.
6. Verify tenant counts/sampled authoritative records and outbox state against expected snapshot timing.
7. Destroy the rehearsal target after evidence is recorded.

CI performs a safe concrete rehearsal against its isolated Mongo replica set: it inserts a dedicated Phase-J marker into `agenda_ci_test`, executes `mongodump`, restores into `agenda_j_restore_rehearsal`, verifies the marker survived, drops the restore database and removes the source marker. This is non-production evidence only; a real production backup creation/restore remains a separately authorized operation.

## Migration / index deploy procedure

Pre-deploy read-only: confirm exact Git SHA, CI green, config contract, backup availability and current cutover-gate state. Migration/index scripts under `Server/scripts/migrations` are the only approved mutation path. Before any production-mutating migration: capture/verify backup, review script plan/dry-run support and expected storage/index effects, obtain explicit authorization/change window. Apply one migration at a time, rerun its cutover gate, deploy app, verify readiness, smoke, then monitor.

Indexes are not automatically rolled back merely because application code is rolled back. Treat destructive/incompatible index or data changes as separate database change decisions.

## Controlled MVP smoke

`Server/test/jProductionSmoke.test.js` is the reproducible non-production smoke. It uses an isolated test Mongo replica set and dedicated fixture tenant. It verifies:

- liveness and Mongo-backed readiness;
- trusted public service/professional discovery;
- canonical availability;
- booking creation;
- Phase-I communication outbox creation and delivery contract through an injected non-production provider;
- non-authorizing lifecycle manage URL under the trusted public origin;
- guest CANCEL challenge, verification and capability consume from the trusted origin;
- CORS/publicWeb URL coherence.

The test owns and cleans its fixture data. Do not run a mutating smoke against production until separately authorized for that exact tenant/window/provider use.

## Startup / deploy

1. Confirm exact reviewed SHA and green CI.
2. Confirm production configuration exists in secret/config stores without printing values.
3. Confirm current backup/recovery point and storage cutover gates.
4. Execute any separately authorized migration/index work before application activation.
5. Deploy API first; require `/health/live` and `/health/ready` success.
6. Confirm `BACKEND_URL`, `FRONTEND_URL`, `PUBLIC_API_URL`, CORS and cookie behavior are coherent.
7. Deploy/activate frontend.
8. Verify publicWeb trust for the controlled tenant and run only the authorized smoke level.
9. Observe startup, Mongo, worker/outbox and request errors.

## Rollback

Rollback application code when readiness fails, error rate materially increases, auth/session/publicWeb boundaries regress, or critical booking/communication paths fail after deploy. Preserve data first. Roll back the app to the last reviewed green SHA; do not blindly reverse migrations/indexes. Re-run readiness and a safe smoke after rollback. If a schema/index change is not backward-compatible, stop and execute its reviewed database rollback/forward-fix plan rather than improvising.

## Incident triage

- **API down:** check process/startup config failure, listener, platform health, then Mongo reachability.
- **Mongo unavailable:** verify provider status/network/credentials without printing URI; do not bypass readiness.
- **Auth/session failures:** verify `FRONTEND_URL`, `CORS_ORIGINS`, `SESSION_SECRET`, secure cookie delivery and proxy TLS topology.
- **publicWeb/origin failures:** inspect tenant trust generation/origin/fencing; do not globally allow the origin as a shortcut.
- **Guest email failures:** inspect outbox/job states and provider status; preserve idempotency/retry semantics.
- **Outbox backlog/failed jobs:** determine worker health, leases/attempt bounds and provider errors before explicit reconciliation.
- **Provider failure:** keep lifecycle DB authoritative; delivery failure must not mutate appointment lifecycle.
- **Rate-limit anomalies:** validate trusted proxy hop count and client-IP resolution before tuning limits.

## Production mutations still requiring separate authorization

This repository work does not change Railway/Vercel/Atlas/provider configuration, secrets, DNS, production indexes/data, deployment state, production backups or real email delivery. Those actions remain pending until specifically authorized and should be recorded with impact, rollback and verification evidence.
