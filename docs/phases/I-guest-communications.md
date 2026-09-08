# I — Guest communications

## Objective

Close the customer journey with minimal transactional email so a guest can understand that a booking action succeeded and can return safely to manage the appointment later.

## Dependency

Start only after H4 is merged and reviewed.

Before implementation begins, the phase I PR must record the exact reviewed merge commit that is being used as its baseline. If `master` advanced after the H4 merge, review the complete delta first and explicitly record the accepted replacement baseline rather than assuming the previous SHA still applies.

## In scope

- transactional booking confirmation email;
- transactional cancellation confirmation email;
- transactional reschedule confirmation email;
- clear appointment facts required by the customer: business, service, professional when applicable, date, start/end time and current lifecycle state;
- a safe route back into the existing guest access/challenge flow;
- delivery integration suitable for the production provider selected for the MVP;
- explicit handling of delivery failure that does not roll back an already-committed appointment lifecycle transition;
- tests covering message triggering, tenant scoping, lifecycle correctness and secret handling;
- minimal templates that are readable on mobile and do not depend on the business having custom HTML branding.

## Security invariants

- Do not email stored capability secret hashes or internal tokens.
- Do not create a long-lived bearer link that bypasses the existing guest challenge/capability security model unless a separately reviewed design replaces that model.
- Email destination must come from the authoritative appointment/customer data for the exact tenant/appointment action.
- Email delivery must not grant READ, CANCEL or RESCHEDULE authority by itself.
- Cross-tenant data must never appear in message content or delivery metadata.

## Delivery semantics

The appointment database transaction is authoritative. For create, cancel and reschedule:

1. commit the lifecycle operation first;
2. trigger communication from committed state;
3. if delivery fails, record/observe the failure and permit operational retry without reverting the appointment.

The exact retry mechanism should be the smallest reliable design needed for the MVP and must be documented in the phase PR.

## Out of scope

- marketing email;
- newsletters;
- WhatsApp;
- SMS;
- rich per-tenant email builders;
- campaigns;
- complex reminder scheduling unless a reviewed MVP requirement explicitly adds it;
- email analytics beyond minimum delivery/error observability.

## Acceptance criteria

I is complete only when:

1. a successful public booking triggers one correct confirmation communication;
2. a successful guest cancellation triggers one correct lifecycle communication;
3. a successful guest reschedule triggers one correct updated communication;
4. failed lifecycle operations do not emit success communications;
5. communication failures cannot roll back or corrupt committed appointment state;
6. no capability secret, token hash or cross-tenant data leaks through email;
7. the customer has a clear secure path to manage the appointment again;
8. duplicate/retry behaviour is defined and covered sufficiently to avoid uncontrolled duplicate messages;
9. CI is green on the final reviewed phase HEAD.
