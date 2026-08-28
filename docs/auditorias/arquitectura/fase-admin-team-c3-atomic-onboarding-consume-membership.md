# C3 — Atomic onboarding consume → Membership

**Proyecto:** ATMÓSFERA Agenda  
**Fase:** C3 — Atomic onboarding consume → Membership  
**Baseline:** `master@f4f11eca38aa94d7b0d3f0dd7799708aacc700b4`  
**Contrato padre:** A+A2 bookability + B Team + C1 PendingOnboarding + C2 secure account binding

## Secuencia canónica

```text
C1 PendingOnboarding
-> C2 channel proof + exact accountBinding.user
-> C3 atomic consume + Membership
-> D2 Añadir persona UI (fuera de alcance)
```

C3 no vuelve a demostrar identidad. La única identidad que puede recibir la Membership es:

```text
PendingOnboarding.accountBinding.user
```

No existe lookup de User por email, fallback por sesión, `body.userId` ni nuevo bearer C2.

## Endpoint claimant-facing

```http
POST /api/team/onboardings/:onboardingId/consume
Content-Type: application/json

{}
```

El body es opcional/vacío. Cualquier campo aportado por cliente se rechaza. En particular no se aceptan `userId`, `businessId`, `role`, `isBookable`, `isActive`, `issuedBy`, `email`, challenge secret ni password.

Respuesta exitosa mínima:

```json
{
  "status": "success",
  "payload": {
    "completed": true,
    "onboardingId": "...",
    "membershipId": "..."
  }
}
```

C3 no autentica al claimant, no crea sesión tenant y no emite JWT/capability.

## Revalidaciones dentro de la transacción

Antes del commit se exige nuevamente:

- grant `pending`, vigente, `channel=email`, `purpose=tenant-onboarding`;
- privilegio fijado por el grant: `role=worker`, `isBookable=false`;
- `accountBinding.user`, `accountBinding.challenge` y `boundAt` presentes;
- Business persistido todavía `isActive=true`;
- User exacto de `accountBinding.user` todavía existente y activo;
- issuer User todavía activo;
- issuer con Membership `admin + active` en el mismo Business;
- challenge exacto del binding ya `consumed` por C2;
- challenge ligado al mismo onboarding/Business/channel/destination/purpose/expiry;
- `challenge.boundUser === accountBinding.user`;
- ausencia de cualquier Membership para `(accountBinding.user, business)`, activa o inactiva.

Business validity usa el contrato vigente del repositorio (`Business.isActive`). No se inventa un lifecycle adicional.

## Membership canónica

La creación server-side es exactamente:

```text
Membership {
  user: accountBinding.user,
  business: PendingOnboarding.business,
  role: "worker",
  isActive: true,
  isBookable: false
}
```

Una Membership preexistente activa o inactiva bloquea C3. No existe reactivación, reemplazo ni mutación implícita.

## Atomicidad y concurrencia

C3 usa una transacción Mongo y dos fences:

1. una escritura transaccional sobre el PendingOnboarding todavía `pending`, sin introducir un nuevo estado persistente, serializa consumes concurrentes del mismo grant;
2. `$inc Business.teamAdminRevision` reutiliza el fence de Team/B y serializa C3 contra cambios concurrentes de autoridad administrativa del mismo Business.

Después de revalidar:

```text
crear Membership
-> transición condicional PendingOnboarding.status = consumed
-> commit
```

Si falla la creación de Membership, la reserva del grant se revierte. Si falla la terminalización, la Membership se revierte. Dos consumes del mismo grant producen como máximo un éxito. Una creación concurrente de Membership queda además cerrada por el índice único físico existente `{ user: 1, business: 1 }`.

No se agrega colección, índice, materializer ni startup gate en C3: C1/C2 y el índice único de Membership ya contienen las barreras físicas necesarias.

## Terminalización

El historial se conserva:

```text
PendingOnboarding.status = consumed
accountBinding = preservado
TenantOnboardingChallenge.status = consumed (sin segunda mutación)
```

No se borra el grant ni se reutiliza.

## Side effects ausentes

C3 no crea/modifica Shift, Service, `Service.workers`, Appointment, CustomerProfile, capabilities, Business.owner, `User.role` ni `User.business`. Tampoco habilita bookability ni concede rol admin.
