# Agenda — MVP roadmap

GitHub is the source of truth for the product roadmap. This document records the current MVP path and the phase sequence that should be followed unless a reviewed pull request changes it.

## Current baseline

- `master`: `bacfdb022b403850a41f6a0922c620197cf5233e` (merge of Phase I, PR #52)
- Last completed and merged phase: **I — Guest communications** (H4 and I merged)
- Phase J: implementation under Draft PR #54; repository/non-production checks green on recorded CI run #590, but production acceptance criteria #6 (real Resend delivery) and #9 (production MVP smoke) remain pending separately authorized verification
- Phase K: not started; requires reviewed and accepted J
- Tracking: [PR #54](https://github.com/Valethya/agenda/pull/54) and [issue #55](https://github.com/Valethya/agenda/issues/55)
- This baseline is documentary, not an approval to merge or deploy

## MVP definition

The MVP must support a complete public booking flow without requiring a customer account:

1. discover bookable services and professionals;
2. inspect canonical availability;
3. create a booking safely under concurrency;
4. access the booking as a guest;
5. cancel the booking as a guest;
6. reschedule the same booking as a guest;
7. receive transactional communication that allows the customer to return to the booking safely;
8. operate the system in production with minimum security, observability and recovery guarantees;
9. validate the whole flow with a controlled real-business pilot.

The business side must continue to support the already-implemented tenant administration for team, services, schedules/availability and appointments.

## Completed product phases

- A — canonical bookability foundation
- A2 — legacy hardening
- B — administrative Team endpoints
- C1 — pending onboarding storage
- C2 — secure onboarding account binding
- C3 — atomic onboarding consume → Membership
- D1 — Team UI for existing Memberships
- D2 — Team “Add person” UI
- E — Service administration
- F — Schedules / availability administration
- G1 — public booking discovery
- G2 — booking commit concurrency hardening
- G3 — public booking UI
- H1 — guest appointment access
- H2 — guest cancellation
- H3 — guest reschedule
- H4 — MVP integration hardening
- I — Guest communications

## Remaining MVP phases

### J — Production readiness (implementation in Draft PR #54; acceptance pending)

Prepare the application and operating contract for a real production launch: configuration, security, persistence, observability, recovery and production smoke verification.

Specification: [`phases/J-production-readiness.md`](./phases/J-production-readiness.md)

### K — Pilot launch (not started)

Run a controlled launch with a real business and real booking journeys. Only defects required to make the defined MVP reliable should feed back into code before public launch.

Specification: [`phases/K-pilot-launch.md`](./phases/K-pilot-launch.md)

## MVP exit condition

Agenda is considered ready for MVP public availability only after H4, I, J and K are completed and reviewed, and the final production baseline has green CI plus a successful production smoke/pilot result.

## Roadmap governance

- Do not start a new phase before the previous phase has been merged and reviewed, except for an explicitly reviewed exception.
- Every phase implementation must declare its exact baseline commit.
- Each phase must have explicit scope, invariants, out-of-scope items and acceptance criteria before implementation begins.
- GitHub is the source of truth. Conversation context, local notes and generated prompts do not supersede the merged roadmap/specifications.
- Changes to this roadmap must be made through a reviewed pull request.
- Do not expand MVP scope just because an adjacent capability would be useful later.

## Explicitly outside the current MVP path

Unless a future reviewed roadmap change says otherwise, the following are not blockers for the first public MVP:

- online payments;
- WhatsApp or SMS messaging;
- advanced analytics;
- loyalty/fidelization;
- marketplace or public business directory;
- native mobile applications;
- universal SDK/widget work beyond what the current public booking integration needs;
- advanced visual customization;
- features whose only purpose is speculative future scalability.
