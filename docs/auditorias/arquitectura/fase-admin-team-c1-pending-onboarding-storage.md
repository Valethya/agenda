# C1 — Pending onboarding storage

**Proyecto:** ATMÓSFERA Agenda  
**Fase:** C1 — Pending onboarding storage  
**Baseline verificada:** `master@697161f29e5d31c1e265e3ed422d2f47dfc861c4`  
**Alcance:** fundamento persistente únicamente

## Contrato

`PendingOnboarding` persiste el envelope server-side de una intención administrativa tenant-scoped para una incorporación futura a Equipo. Este documento especializa, y no reemplaza, `fase-admin-team-bookability-contract.md`.

No representa ni demuestra identidad o autoridad del destinatario:

```text
PendingOnboarding
!= User destinatario
!= Membership
!= autoridad tenant del destinatario
!= agendabilidad efectiva
!= prueba de control del email
```

C1 almacena la autorización administrativa pendiente. C2 resolverá account binding seguro. C3 implementará el consumo seguro y revalidará la autoridad vigente del issuer. D2 expondrá posteriormente la UX «Añadir persona».

La existencia de un documento C1 no crea ni modifica `User` o `Membership`, no concede `admin`/`worker`, no participa en discovery público, no vuelve a nadie agendable y no altera continuidad de owner/last-admin.

## Envelope persistente canónico

La colección dedicada conserva:

- `business`: Business destino obligatorio y exacto;
- `issuer`: `User` que emitió la autorización administrativa;
- `channel`: literal único `email`;
- `email`: destino objetivo canónico del canal email;
- `purpose`: literal único `tenant-onboarding`;
- `role`: intención estructural `admin | worker`;
- `isBookable`: intención estructural booleana e independiente de `role`;
- `expiresAt`: expiración persistente requerida;
- `status`: `pending | consumed | revoked`;
- `createdAt` / `updatedAt` mediante timestamps Mongoose.

`issuer` almacena solamente la identidad global necesaria para una revalidación futura. No se persiste un `issuerRole`, snapshot de Membership ni otra copia durable de autoridad. La creación canónica exige que el issuer esté activo y posea en ese momento una Membership activa `admin` en el mismo Business; C3 deberá repetir esa decisión con estado vigente al consumir.

`consumed` y `revoked` son estados terminales inertes reservados para distinguir un registro todavía utilizable de uno que ya no debe considerarse pending. C1 no implementa ninguna transición hacia ellos.

No existen en C1 campos de binding del destinatario, secret, token, hash, capability ni bearer.

## Purpose y canal

C1 define un único purpose físico estrecho porque el contrato canónico exige un purpose separado de Verification/Appointment y no existía todavía un literal físico:

```text
tenant-onboarding
```

No se reutilizan `contact-control` ni purposes de Appointment.

La primera versión admite un único canal:

```text
email
```

Por ello `email` es simultáneamente el destino exacto de ese canal y un identificador/contacto objetivo. No constituye account binding ni prueba de control del canal.

## Normalización de email

Antes de persistir, el email se normaliza mediante:

```text
trim de espacios externos
+ lowercase del valor completo
```

Esto hace equivalentes diferencias triviales de casing y whitespace para la invariante de duplicados. No se eliminan puntos, no se eliminan `+tags`, no se aplican reglas Gmail/Googlemail ni equivalencias de aliases específicas de proveedor.

El email sigue siendo sólo contacto/identificador objetivo. C1 nunca busca un `User` por ese email.

## Política canónica de emisión C1

El schema conserva la ortogonalidad estructural `role × isBookable` y puede representar las cuatro combinaciones para no reintroducir la equivalencia `worker == profesional`.

Eso no concede libertad a la vía canónica de emisión. `createPendingForBusiness()` fija server-side la primera política ya establecida por el contrato arquitectónico:

```text
role = "worker"
isBookable = false
status = "pending"
channel = "email"
purpose = "tenant-onboarding"
```

`business` e `issuer` llegan como scope server-side separado del payload. Campos `business`, `issuer`, `role`, `isBookable`, `status`, `channel` o `purpose` aportados dentro del data no pueden ampliar el grant y se ignoran.

La creación exige además un `expiresAt` futuro explícito. C1 no fija una duración universal porque el contrato mergeado no define todavía un TTL funcional concreto; sólo exige que la expiración quede persistida. No existe TTL destructivo ni scheduler en esta fase.

Onboarding de nuevos admins permanece fuera de alcance. La eventual Membership, si C3 llega a materializarla tras todos los proofs y revalidaciones requeridos, seguirá la política canónica `worker`, `isActive=true`, `isBookable=false`.

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

El modelo usa `autoIndex` sólo en `NODE_ENV=test`. La materialización física fuera de test queda en `scripts/migrations/pending-onboarding-storage.js` y no se ejecuta como efecto lateral del runtime.

El materializador falla cerrado ante:

- índice con el mismo nombre y semántica distinta;
- índice con las mismas keys y opciones distintas;
- pending sin envelope mínimo requerido;
- email pending sin normalización canónica;
- pending fuera de la política `worker + non-bookable` / `email` / `tenant-onboarding`;
- duplicados pending preexistentes por `Business + email`.

C1 no agrega un startup gate porque todavía no existe endpoint/runtime funcional que dependa de esta colección. Este PR no ejecuta el materializador contra producción.

## Fronteras explícitamente no implementadas

C1 no agrega:

- endpoints Team para crear/cancelar/consumir onboarding;
- rutas públicas de claim o consume;
- lookup o binding del destinatario `User` por email;
- creación/reactivación de `Membership`;
- creación de `User`;
- email delivery o invitaciones funcionales;
- links, magic links, secretos bearer o capabilities;
- UI D2 «Añadir persona»;
- cambios en Team D1, booking, auth o discovery.

`Membership` continúa siendo la única autoridad tenant ordinaria y `Membership.isBookable` la fuente canónica de agendabilidad configurada para miembros existentes.
