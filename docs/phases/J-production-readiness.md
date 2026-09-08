# J — Production readiness

## Objective

Prepare Agenda to operate as a real production service with the minimum required guarantees for configuration, security, persistence, observability, recovery and verification.

## Dependency

Start only after phase I is merged and reviewed.

Before implementation begins, the phase J PR must record the exact reviewed merge commit that is being used as its baseline. If `master` advanced after the phase I merge, review the complete delta first and explicitly record the accepted replacement baseline rather than assuming the previous SHA still applies.

## In scope

- production configuration contract and required environment variables;
- secure secret handling and rotation expectations;
- production MongoDB connectivity, indexes and startup assumptions;
- production CORS/origin/cookie/session configuration appropriate to the deployed topology;
- publicWeb origin/trust fencing verification against production configuration;
- rate-limit configuration review for public and guest endpoints;
- email provider production configuration and failure observability;
- health/readiness checks sufficient for deployment operation;
- structured application error/logging expectations without leaking secrets or personal data;
- minimum backup and restore procedure for authoritative persisted data;
- production-safe migration/index deployment procedure where applicable;
- production smoke test covering the critical MVP journey without mutating unrelated customer data;
- operational documentation for startup, rollback and incident triage;
- confirmation that client/server production URLs and callback/access flows are coherent.

## Security invariants

- Production secrets must never be committed to the repository.
- Test/dev credentials and permissive local defaults must not silently become production defaults.
- Public and guest trust boundaries must remain fail-closed under missing or malformed production configuration.
- Logs must not expose capability secrets, session secrets, passwords or sensitive customer content.
- Production startup must fail clearly when mandatory security configuration is absent.

## Operational invariants

- Deployment must not require manual modification of production data outside documented migration/index procedures.
- A deploy must have a documented rollback path.
- Database backup/restore responsibility and procedure must be explicit before pilot use.
- Health/readiness endpoints must not grant privileged information or authority.
- Smoke verification must be repeatable and safe.

## Out of scope

- multi-region/high-availability architecture;
- Redis unless a demonstrated MVP blocker makes it necessary;
- advanced APM or enterprise observability suites;
- autoscaling optimization beyond current MVP traffic needs;
- zero-downtime migration infrastructure unless required by an actual migration;
- payment production setup;
- SMS/WhatsApp providers;
- speculative infrastructure re-platforming.

## Acceptance criteria

J is complete only when:

1. the complete production configuration contract is documented and validated;
2. production startup fails safely on missing critical configuration;
3. MongoDB production persistence/index assumptions are verified;
4. CORS/origin/session/publicWeb trust behaviour is correct for the production topology;
5. rate limits and guest/public abuse boundaries are active and reviewed;
6. transactional email works against the selected production provider;
7. health/readiness and minimum error observability are available;
8. a backup and restore procedure is documented and has been validated at least in a safe non-production rehearsal or equivalent controlled verification;
9. the MVP production smoke test succeeds;
10. rollback/incident procedures are documented;
11. CI is green on the final reviewed phase HEAD.

## Production change rule

Unlike earlier product phases, J may require explicit changes to deployment infrastructure and production configuration. Read-only inspection, planning and non-production rehearsal may proceed within the reviewed phase scope, but any operation that mutates production infrastructure, production configuration, production database indexes/schema, production data, deployment state, Railway, Vercel or equivalent production services requires separate explicit authorization for that concrete operation.

Execution of phase J must never be interpreted as blanket authorization to modify production. Any authorized production change must be minimal, reviewed, reversible, scoped to the stated objective and recorded sufficiently to reconstruct what changed and how to roll it back. No production mutation may be performed implicitly as part of unrelated code or documentation work.
