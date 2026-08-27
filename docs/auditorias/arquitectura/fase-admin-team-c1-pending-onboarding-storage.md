# C1 — Pending onboarding storage

**Proyecto:** ATMÓSFERA Agenda  
**Fase:** C1 — Pending onboarding storage  
**Baseline verificada:** `master@697161f29e5d31c1e265e3ed422d2f47dfc861c4`  
**Alcance:** fundamento persistente únicamente

## Contrato

`PendingOnboarding` persiste una intención administrativa tenant-scoped para una incorporación futura a Equipo.

No representa ni demuestra identidad o autoridad:

```text
PendingOnboarding
!= User
!= Membership
!= autoridad tenant
!= agendabilidad efectiva
!= prueba de control del email
```

C1 almacena intención. C2 resolverá account binding seguro. C3 implementará el consumo seguro. D2 expondrá posteriormente la UX «Añadir persona».

La existencia de un documento C1 no crea ni modifica `User` o `Membership`, no concede `admin`/`worker`, no participa en discovery público, no vuelve a nadie agendable y no altera continuidad de owner/last-admin.

## Representación persistente

La colección dedicada conserva exclusivamente:

- `business`: Business destino obligatorio;
- `email`: email objetivo canónico;
- `role`: intención inicial `admin | worker`;
- `isBookable`: intención inicial booleana, independiente de `role`;
- `status`: `pending | consumed | revoked`;
- `createdAt` / `updatedAt` mediante timestamps Mongoose.

`consumed` y `revoked` son estados terminales inertes reservados para distinguir un registro todavía utilizable de uno que ya no debe considerarse pending. C1 no implementa ninguna transición hacia ellos.

No existen en C1 campos `user`, `membership`, binding, secret, token, capability ni bearer.

## Normalización de email

Antes de persistir, el email se normaliza mediante:

```text
trim de espacios externos
+ lowercase del valor completo
```

Esto hace equivalentes diferencias triviales de casing y whitespace para la invariante de duplicados. No se eliminan puntos, no se eliminan `+tags`, no se aplican reglas Gmail/Googlemail ni equivalencias de aliases específicas de proveedor.

El email sigue siendo sólo contacto/identificador objetivo. Nunca se busca un `User` por ese email durante C1.

## Unicidad tenant-scoped y concurrencia

La barrera canónica de persistencia es:

```text
{ business: 1, email: 1 }
unique: true
partialFilterExpression: { status: "pending" }
```

Nombre físico:

```text
pending_onboarding_business_email_pending_unique
```

Consecuencias:

- un Business no puede contener dos onboardings todavía pendientes para el mismo email canónico;
- dos escritores concurrentes quedan serializados por la restricción de MongoDB, no por `find -> create`;
- el mismo email puede tener un onboarding independiente en Businesses distintos;
- registros terminales no bloquean una intención administrativa futura nueva.

El modelo usa `autoIndex` sólo en `NODE_ENV=test`. La materialización física fuera de test queda en un script de storage controlado y no se ejecuta como efecto lateral del runtime. Este PR no ejecuta el script contra producción.

## Fronteras explícitamente no implementadas

C1 no agrega:

- endpoints Team para crear/cancelar/consumir onboarding;
- rutas públicas de claim o consume;
- lookup o binding de `User` por email;
- creación/reactivación de `Membership`;
- creación de `User`;
- email delivery o invitaciones funcionales;
- links, magic links, secretos bearer o capabilities;
- UI D2 «Añadir persona»;
- cambios en Team D1, booking, auth o discovery.

`Membership` continúa siendo la única autoridad tenant ordinaria y `Membership.isBookable` la fuente canónica de agendabilidad configurada para miembros existentes.

## Tensión contractual preexistente detectada

El contrato documental anterior `fase-admin-team-bookability-contract.md` describe, para un **grant funcional futuro**, un conjunto más amplio con issuer, purpose, expiración y lifecycle single-use/revocable, y también enuncia una primera política futura limitada a `worker + non-bookable`.

C1 no convierte esas decisiones futuras en runtime ni inventa hoy valores para issuer/purpose/expiración, porque esta fase no emite una credencial ni implementa aceptación/consumo. A la vez, el storage C1 debe poder conservar las cuatro combinaciones `admin|worker × isBookable true|false` exigidas por el contrato vigente de esta fase.

Por tanto, este PR no resuelve ni amplía la política funcional futura: C2/C3/D2 deberán reconciliar explícitamente esos requisitos antes de habilitar onboarding real. Hasta entonces no existe grant funcional, claimant autorizado ni vía de incorporación.
