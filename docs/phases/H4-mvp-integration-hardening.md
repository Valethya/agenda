# H4 — MVP integration hardening

## Objective

Prove that the complete already-built MVP flow from A through H3 works coherently as one integrated product, and fix only defects or integration gaps that prevent that defined flow from being reliable.

H4 is a hardening phase, not a feature phase.

## Baseline

Start from the reviewed merge baseline after H3 unless `master` has advanced. If `master` changed, review the complete delta before implementation and declare the new accepted baseline in the H4 PR.

## In scope

- end-to-end validation of public discovery → availability → booking → guest access → cancellation → reschedule;
- end-to-end validation of the corresponding business/admin appointment visibility and lifecycle coherence;
- tenant isolation across all public and guest paths;
- canonical availability consistency after create/cancel/reschedule;
- stale-state and retry behaviour;
- concurrency regressions across booking, cancellation, reschedule and eligibility revocation;
- timezone/date-boundary correctness for supported MVP operation;
- error-state UX sufficient to avoid ambiguous booking outcomes;
- refresh/reload behaviour for public and guest journeys;
- responsive/mobile usability of the critical public flow;
- regression coverage for previously completed A–H3 guarantees;
- removal or correction of integration defects discovered by this validation.

## Invariants

- The canonical availability engine remains the single authority for bookable slots.
- Guest READ, CANCEL and RESCHEDULE remain separate exact-scope authorities.
- No guest flow gains User or Membership authority.
- Booking/reschedule concurrency guarantees from G2/H3 must not be weakened.
- Tenant fencing and business/service/professional eligibility must remain fail-closed.
- No lifecycle action may report success before its authoritative persistence has committed.
- Availability notifications/events must reflect committed state only.

## Out of scope

- transactional email implementation beyond what is required to keep existing challenge mechanisms testable;
- online payments;
- SMS/WhatsApp;
- analytics or reporting expansion;
- loyalty;
- marketplace/directory;
- native applications;
- new scheduling engines;
- production infrastructure changes;
- speculative architecture refactors unrelated to a demonstrated blocker.

## Acceptance criteria

H4 is complete only when:

1. the entire public/guest booking journey passes integrated automated coverage;
2. critical concurrency and stale-state cases remain deterministic and fail safely;
3. no cross-tenant access path is found;
4. public create/cancel/reschedule operations produce canonical availability after commit;
5. user-visible failures are non-ambiguous: a customer can distinguish success, rejection and retryable stale/conflict states;
6. critical mobile/public flows are usable without requiring admin intervention;
7. all defects found that block the defined MVP are fixed within H4;
8. CI is green on the final reviewed H4 HEAD;
9. no unrelated feature scope was added.

## Exit artifact

The H4 PR should include a concise integration matrix documenting the critical journeys and regression cases exercised, either in tests or in the PR description. Its merge baseline becomes the required starting point for phase I.
