# K — Pilot launch

## Objective

Validate the production-ready MVP with one controlled real-business pilot before declaring Agenda generally available.

## Dependency

Start only after J is merged, reviewed and the production readiness criteria are satisfied.

Before implementation begins, the phase K PR must record the exact reviewed merge commit that is being used as its baseline. If `master` advanced after the J merge, review the complete delta first and explicitly record the accepted replacement baseline rather than assuming the previous SHA still applies.

## In scope

- configure one real pilot business using the supported admin flows and production configuration;
- verify services, professionals, schedules and public booking entry points;
- perform controlled real booking journeys from public discovery through booking, guest access, reschedule and cancellation;
- verify transactional email delivery and secure return-to-booking flow;
- verify admin appointment visibility and lifecycle coherence for the pilot business;
- observe production logs/errors and operational signals during the pilot;
- collect concrete defects and usability blockers that prevent reliable completion of the defined MVP journey;
- fix only launch-blocking defects and regressions within the already-defined MVP scope;
- rerun the critical production smoke and pilot journeys after fixes;
- record the final release baseline and launch decision.

## Pilot principles

- Use real production topology but keep the audience controlled.
- Prefer one known business and a limited set of services/professionals over broad rollout.
- Do not use the pilot as an excuse to add unrelated features.
- Product feedback is valuable, but requests outside the frozen MVP scope should be recorded for post-MVP planning unless they reveal a true launch blocker.
- Any data correction needed during the pilot must use supported application/operational procedures rather than undocumented direct database edits whenever possible.

## Out of scope

- general public marketing launch;
- onboarding many businesses;
- sales automation;
- payments;
- WhatsApp/SMS;
- advanced reporting;
- post-MVP feature requests;
- scaling optimizations without observed need.

## Acceptance criteria

K is complete only when:

1. a real pilot business is fully configured through supported paths;
2. the complete customer journey works in production for that business;
3. create/cancel/reschedule changes remain coherent in admin and canonical availability;
4. transactional communications arrive with correct tenant/appointment data and secure management flow;
5. no launch-blocking security, tenant-isolation, concurrency or ambiguous-state defect remains open;
6. operational monitoring and incident/rollback procedures are sufficient for the observed pilot behaviour;
7. all launch-blocking fixes have green CI and successful production smoke verification;
8. the final production baseline is recorded;
9. an explicit go/no-go decision for MVP public availability is documented.

## Exit

A successful K review marks the defined Agenda MVP as ready for controlled public availability. New product capabilities after this point should be planned as post-MVP roadmap work rather than silently extending K.
