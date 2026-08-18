# Fase 6.2.5-C2 — Verified guest Appointment capabilities

## Estado y baseline

Implementación construida sobre `master@a84b5619b7f2fc0f928fff51755c8930934fcc0c`, merge de 6.2.5-C1 / PR #28.

C2 conserva los contratos de 6.2.5-A, 6.2.5-B, 6.2.5-C1, ADR-002 y APT-CLIENT-01. El alcance ejecutable continúa siendo **READ únicamente**.

## Autoridad que introduce C2

El flujo efectivo es:

`HTTP acceptance -> durable intent -> worker -> Appointment-scoped contact provenance -> C1 Verification -> trusted delivery -> exact C1 consume -> Appointment READ capability`

Una capability significa exclusivamente que quien posee el bearer puede ejecutar `read` sobre **una Appointment exacta de un Business exacto** mientras el grant sea válido.

No significa Client account, User authority, Membership, CustomerProfile ownership, claim, historial ni continuidad histórica.

`appointment-read-bootstrap -> read` es el único mapping implementado. `cancel` y `reschedule` permanecen separados y fuera de este PR.

## Provenance Appointment-scoped

Las nuevas reservas guest capturan `Appointment.guestContact` directamente desde el input de ese booking **antes** de llamar a `getOrCreateGuestUser()`:

- `channel: email`;
- `destination`;
- `provenance: guest-booking-input-v1`;
- `capturedAt`.

El snapshot es `select:false` e inmutable. Es contacto operacional del recurso; no es identidad ni ownership.

El worker C2 consulta únicamente `Appointment + Business + Service + guestContact`. No popula `Appointment.client`, `User`, `CustomerProfile`, otras Appointment ni historial.

Por tanto:

- `Appointment.client` no habilita bootstrap;
- `User.email` / `User.phone` legacy no son provenance;
- cambiar posteriormente `User.email` no cambia el destinatario de la Appointment;
- Appointment legacy sin `guestContact` válido falla cerrado;
- no existe migración heurística de legacy en C2.

`current channel control != historical subject continuity` sigue siendo una frontera explícita.

## Frontera HTTP y orquestación durable

`POST /api/guest-appointments/read/challenge` valida sólo IDs sintácticos, persiste/deduplica una intención durable y responde el mismo `202` genérico. No consulta Appointment, User, CustomerProfile ni proveedor de email antes de responder.

`GuestAppointmentVerificationJob` mantiene scope físico único:

`Business + Appointment + purpose + action`

Lifecycle:

`queued -> processing -> delivering -> delivered | failed`

El worker reclama con lease atómico, resuelve provenance, emite C1, vincula Verification y Delivery a la misma generación, cambia a `delivering` antes del proveedor y sólo tras aceptación marca Delivery/Job `delivered`.

`processing` stale puede recuperarse. `delivering` stale no se reenvía: termina fail-closed y revoca la Verification conocida. Un worker sin ownership o una generación antigua no puede completar el estado actual.

## Trusted delivery y secretos

Challenges y capabilities usan `crypto.randomBytes(32)` y `base64url`.

MongoDB nunca persiste challenge raw ni capability bearer raw. El challenge raw sólo existe en memoria del worker durante trusted delivery y la URL lo transporta en fragment (`#`), no query.

La ruta sensible de email no registra recipient, HTML/body, bearer URL, provider error body ni preview URL Ethereal. El origin se obtiene exclusivamente de `GUEST_APPOINTMENT_ACCESS_ORIGIN`, nunca de `Host`, `Origin`, `Referer` ni `X-Forwarded-*` del requester.

## Consumo exacto de C1

C1 conserva su API previa. C2 usa `consumeExactVerificationForBusiness()`, respaldado por un único `findOneAndUpdate()` que exige:

`verificationId + Business + purpose + secretHash + status=pending + expiresAt>now`

Un verificationId incorrecto acompañado de un secret válido no consume otra proof. C1 Verification continúa sin campo Appointment.

## Capability READ

`GuestAppointmentCapability` persiste sólo Business, Appointment, Verification, action, hash derivado, lifecycle y expiración. Una Verification sólo puede respaldar una capability por índice unique.

READ es single-use. `expiresAt <= now` falla cerrado; revocación y consumo son terminales. La proyección READ no expone client/contact, notes, CustomerProfile, Membership, historial ni timeline.

## Anti-amplificación durable

### Cooldown y dedupe exact-scope

El índice unique mantiene un único job por `Business + Appointment + purpose + action`. El cooldown es 15 minutos.

Antes de tocar el presupuesto global de creación, `enqueueForScope()` consulta **solamente** la colección de durable intents por ese scope exacto. No consulta Business ni Appointment.

- si el scope ya existe y sigue dentro del cooldown o está activo: se deduplica y no consume presupuesto global;
- si el scope terminal ya es elegible: se reutiliza el mismo documento, aumenta `generation` y tampoco consume presupuesto de crecimiento;
- sólo cuando no existe un job durable se entra al guard de creación de storage.

Esto elimina la primitive anterior en que miles de replays de un único scope agotaban el bucket global aunque no creciera MongoDB.

### Guard de creación de scopes nuevos

`GuestAppointmentIntakeBucket` contiene:

- `_id` de ventana temporal;
- `scopeKeys`: fingerprints SHA-256 de scopes admitidos;
- `expiresAt`.

No persiste Business, Appointment, email, destination ni authority data en claro.

Por defecto:

- ventana: 60 segundos;
- máximo: 240 **scopes nuevos distintos** por ventana;
- retención del bucket: 10 minutos tras la ventana.

`$addToSet` hace idempotente la admisión del mismo fingerprint: carreras concurrentes del mismo scope ocupan un único cupo. Cuando la ventana alcanza el máximo de fingerprints distintos, no se crean nuevos jobs, pero la API pública conserva el mismo `202 { accepted: true }`.

La defensa sigue siendo deliberadamente global para no necesitar comprobar existencia de Business antes del 202. Un atacante que genere suficientes scopes sintácticamente distintos todavía puede provocar backpressure temporal cross-tenant; ahora debe consumir el presupuesto con **crecimiento potencial distinto**, no mediante replay gratuito de un solo scope. Ese trade-off de disponibilidad queda explícito y no concede autoridad.

## Política explícita de retención C1/C2

La validez lógica y el cleanup físico son independientes. **TTL nunca extiende autoridad.**

Ventana de retención de evidencia: 60 minutos después de la expiración o terminalización correspondiente.

- `ClientContactVerification`: válida sólo mientras runtime exige `expiresAt > now`; TTL físico `{ expiresAt: 1 }` con `expireAfterSeconds: 3600`.
- `GuestAppointmentVerificationDelivery`: `purgeAfter = verification.expiresAt + 60 min`; TTL `{ purgeAfter: 1 }`, `expireAfterSeconds: 0`. Esto conserva la evidencia durante toda la vida posible del challenge más la ventana de diagnóstico.
- `GuestAppointmentCapability`: válida sólo con `expiresAt > now`; TTL físico `{ expiresAt: 1 }` con `expireAfterSeconds: 3600`.
- `GuestAppointmentVerificationJob`: sólo `delivered|failed` reciben `purgeAfter = terminalAt + 60 min`; `queued|processing|delivering` mantienen `purgeAfter=null` y nunca son candidatos del TTL.
- `GuestAppointmentIntakeBucket`: TTL propio corto sobre `expiresAt`; no es evidencia de autoridad.

`Appointment.guestContact` **no** se elimina por esta política: es provenance operacional del recurso, no challenge/capability bearer ni artefacto temporal de orquestación.

MongoDB TTL es cleanup eventual; los checks de `expiresAt`, status, generation y ownership siguen siendo la autoridad runtime exacta.

## Índices físicos y cutover

Antes de exponer C2 remotamente se ejecuta:

`npm run migration:guest-appointment-capability-storage`

El migrador conecta con `autoIndex:false`, exige replica set o mongos, materializa idempotentemente las colecciones/índices C1+C2 y no hace drop/recreate destructivo.

### Identidad física de seguridad

Para cada índice se valida exactamente:

- key pattern y orden;
- `unique`;
- `expireAfterSeconds`;
- `sparse`;
- `partialFilterExpression` mediante canonicalización estructural determinista;
- `collation`;
- `hidden` como defensa adicional.

Las opciones no declaradas deben estar ausentes o en su default seguro. Los índices actuales requieren collation simple/default; una collation no-simple es incompatible. Al crear un índice se fuerza semántica simple para no heredar accidentalmente una collation de colección más permisiva.

El nombre físico continúa siendo diagnóstico, no identidad de seguridad: un índice con otro nombre es aceptable sólo si **toda** la semántica anterior coincide. Si el nombre esperado ya está ocupado por una forma incompatible, o existe el mismo key pattern con modificadores incompatibles, el cutover falla cerrado.

La topología física incluye C1 Verification, C2 Delivery, Capability, Job e Intake Bucket, incluidos TTLs de retención.

## Cutover remoto fail-closed

Runtime remoto requiere:

`GUEST_APPOINTMENT_6_2_5_C2_CUTOVER=GUEST_APPOINTMENT_6_2_5_C2_STORAGE_READY`

Se considera remoto si:

- `NODE_ENV` es `staging` o `production`; **o**
- existe cualquier indicador de deployment soportado (Railway, Vercel, Render, AWS, Fly, etc.).

Un indicador remoto **siempre gana frente a `NODE_ENV=test`**. `NODE_ENV=test` sólo desactiva el gate para un proceso genuinamente local sin indicadores de deployment. No existe excepción especial de CI.

Para un runtime remoto el gate exige, en este orden lógico:

1. confirmation exacta;
2. topología MongoDB soportada;
3. todos los índices físicos con semántica exacta.

Sólo después el startup continúa a HTTP.

Orden general:

`connectDB -> availability cutover gate -> C2 storage cutover gate -> app.listen/listening -> socket init -> worker start`

Si un gate o `listen` falla, socket/worker no arrancan. El worker se detiene en `close`.

## Evidencia automatizada

- `Server/test/guestAppointmentCapability.test.js`: flujo durable real, provenance, delivery, exact consume, cross-scope, READ single-use, expiry/revoke, worker leases/generation, service coherence y retención terminal.
- `Server/test/guestAppointmentCapabilityHardening.test.js`: replay sin cargo global, carreras del mismo scope con un único fingerprint, reset terminal sin cargo de storage nuevo y límite de scopes nuevos distintos.
- `Server/test/guestAppointmentCapabilityStorage.test.js`: `autoIndex:false`, `listIndexes()` físico, idempotencia, partial/sparse/collation/TTL/unique incompatibles, nombre alternativo con semántica exacta, topología y precedencia de deployment indicators sobre `NODE_ENV=test`.
- `Server/test/unit/guest-appointment-capability.contract.test.js`: authority boundary, secreto derivado, TTL/retención y ausencia de raw resource IDs en el bucket.
- suites C1, Membership, tenant isolation, Appointment ownership/coherence, availability, payments, WebSocket, API y frontend permanecen en la CI general.

## Fuera de alcance

C2 no implementa Client account/login/session, User↔CustomerProfile binding, claims, Client history/list/timeline, correlación histórica, CustomerProfile ownership, Appointment.client authority, cambios a `getOrCreateGuestUser()`, Membership Client, OAuth Client, CRM/marketing/loyalty/subscription, SMS, migración histórica, cancel/reschedule end-to-end ni 6.2.5-D.
