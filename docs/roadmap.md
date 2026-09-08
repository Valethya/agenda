# Agenda — MVP roadmap

GitHub is the source of truth for the product roadmap. This document records the current MVP path and the phase sequence that should be followed unless a reviewed pull request changes it.

## Current baseline

- `master`: `1d95f52f3d0d89cbdf65d18af2b0a313c450c4f2`
- Last completed phase: **H3 — Guest reschedule**
- Status after merge: CI green

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

## Remaining MVP phases

### H4 — MVP integration hardening

Validate the already-built A–H3 product as one integrated system. Fix only defects and integration gaps required for the defined MVP; do not introduce unrelated product scope.

Specification: [`phases/H4-mvp-integration-hardening.md`](./phases/H4-mvp-integration-hardening.md)

### I — Guest communications

Close the guest journey with transactional email for booking confirmation and subsequent booking lifecycle changes, using secure access flows rather than exposing bearer secrets.

Specification: [`phases/I-guest-communications.md`](./phases/I-guest-communications.md)

### J — Production readiness

Prepare the application and operating contract for a real production launch: configuration, security, persistence, observability, recovery and production smoke verification.

Specification: [`phases/J-production-readiness.md`](./phases/J-production-readiness.md)

### K — Pilot launch

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
