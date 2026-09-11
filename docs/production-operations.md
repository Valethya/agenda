# Production operations — Phase J

Baseline reviewed for this contract: `bacfdb022b403850a41f6a0922c620197cf5233e` (merge of phase I PR #52). No later `master` delta existed when J started.

## Production topology

The supported MVP topology is one HTTPS frontend origin, one HTTPS API origin, MongoDB replica-set compatible persistence, Express behind a known reverse-proxy hop count, and Resend for idempotent lifecycle email. Public business origins remain tenant-owned `publicWeb` trust records and are not converted into global credentialed CORS origins.

## Configuration contract

Production is fail-closed. `NODE_ENV=production` requires all variables below before the application constructs session/runtime dependencies:

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

Development/test retain local URL defaults and may use test email transport. Production must never fall back to Ethereal for the phase-I idempotent lifecycle path because startup requires Resend configuration.

Secrets belong only in deployment secret stores. Do not commit `.env`. Rotate session/provider/database credentials after suspected exposure and during normal credential lifecycle; rotate one authority at a time and verify readiness/smoke after each change. Session-secret rotation invalidates existing sessions and must be treated as an operational change.

## Startup and persistence

1. Validate configuration with the application production validator before deployment.
2. Confirm `MONGO_URI` points at the intended non-production/production database and a transaction-capable replica set.
3. Run existing cutover/index verification gates before the HTTP listener starts. Existing phase migrations remain authoritative; do not create indexes ad hoc.
4. Production Mongoose runs with `autoIndex=false`. Missing required physical storage/index state must be handled by the existing migration/cutover procedures before deploy.
5. Deploy API, wait for `/health/ready` = 200, then deploy/activate frontend if the release changes URL coupling.
6. Verify publicWeb origin trust and run the controlled smoke.

Database connection failures throw into the startup lifecycle; startup exits through the top-level handler. Logs record coarse error codes/messages after redaction and never print Mongo credentials.

## CORS, cookies, proxy and publicWeb

`FRONTEND_URL` is the only credentialed panel origin. Production session cookies are `HttpOnly`, `Secure`, and `SameSite=None` for the split frontend/API topology. Dynamic public booking routes remain credentialless and require fresh `publicWeb` trust. Guest bearer READ remains credentialless and bearer-authorized. Do not add wildcard CORS.

`TRUST_PROXY_HOPS` must equal the number of trusted reverse-proxy hops. A wrong value can make rate limiting key the proxy instead of the client or trust spoofed forwarding headers; therefore production has no implicit hop-count default.

Business public origins continue to be validated/revoked through the existing generation/fencing model. Changing a business origin is a tenant trust mutation and must follow the existing publicWeb procedure; global CORS configuration is not a replacement for that trust record.

## Rate limiting

The existing global `/api` limiter (200 requests / 15 minutes per resolved client IP) remains active. Dynamic publicWeb trust lookups retain their admission limiter. Guest challenge/verification and lifecycle routes remain covered by the existing route/global boundaries. Proxy correctness is part of the production contract via `TRUST_PROXY_HOPS`; do not disable limiters to work around proxy configuration.

## Transactional email

Phase I keeps Resend + persisted Mongo outbox + provider idempotency. J does not change retry/idempotency/lifecycle semantics. Production requires `RESEND_API_KEY` and `SMTP_FROM_EMAIL` at startup. Troubleshooting order: verify config presence without printing values, inspect worker/outbox status counts, check provider availability/dashboard, distinguish retryable/ambiguous/terminal failures, and use the existing explicit reconciliation path only when its provider-window preconditions are satisfied.

Never log recipient HTML, bearer/manage authority, challenge/capability secrets, provider Authorization headers or idempotent payload bodies.

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
5. Run controlled read-only checks plus the MVP smoke using dedicated fixture data.
6. Verify tenant counts/sampled authoritative records and outbox state against expected snapshot timing.
7. Destroy the rehearsal target after evidence is recorded.

A real production backup creation/restore is a separately authorized production operation.

## Migration / index deploy procedure

Pre-deploy read-only: confirm exact Git SHA, CI green, config contract, backup availability and current cutover-gate state. Migration/index scripts under `Server/scripts/migrations` are the only approved mutation path. Before any production-mutating migration: capture/verify backup, review script plan/dry-run support and expected indexes, obtain explicit authorization/change window. Apply one migration at a time, rerun its cutover gate, deploy app, verify readiness, smoke, then monitor.

Indexes are not automatically rolled back merely because application code is rolled back. Treat destructive/incompatible index or data changes as separate database change decisions.

## Controlled MVP smoke

Run only with a dedicated smoke tenant/account/appointment namespace in non-production first. The smoke must verify liveness/readiness, public service/professional discovery, canonical availability, booking creation, guest challenge/verification/access, one selected cancel/reschedule path, communication outbox creation/provider acceptance in the selected environment, and URL/origin coherence. Record created IDs and delete only smoke-owned fixture data during cleanup.

Do not run a mutating smoke against production until separately authorized for that exact tenant/window/provider use.

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

This repository work does not change Railway/Vercel/Atlas/provider configuration, secrets, DNS, production indexes/data, deployment state, backups or real email delivery. Those actions remain pending until specifically authorized and should be recorded with impact, rollback and verification evidence.
