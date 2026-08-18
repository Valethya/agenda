# Fase 6.2.5-C2 — Verified guest Appointment capabilities

## Estado y baseline

Implementación construida sobre `master@a84b5619b7f2fc0f928fff51755c8930934fcc0c`, merge aprobado de 6.2.5-C1 / PR #28.

C2 conserva los contratos de 6.2.5-A, 6.2.5-B, 6.2.5-C1, ADR-002 y APT-CLIENT-01. El alcance ejecutable continúa siendo **READ únicamente**.

## Autoridad que introduce C2

El flujo efectivo es:

`HTTP acceptance -> durable intent -> worker -> Appointment-scoped contact provenance -> C1 Verification -> trusted delivery -> exact C1 consume -> Appointment READ capability`

Una capability significa exclusivamente que quien posee el bearer puede ejecutar `read` sobre **una Appointment exacta de un Business exacto** mientras el grant sea válido.

No significa Client account, User authority, Membership, CustomerProfile ownership, claim, historial ni continuidad histórica.

`appointment-read-bootstrap -> read` es el único mapping implementado. `cancel` y `reschedule` permanecen separados y fuera de este PR.

## Provenance Appointment-scoped

Las nuevas reservas guest capturan `Appointment.guestContact` directamente desde el input de ese booking **antes** de llamar a `getOrCreateGuestUser()`:

- `channel: email`
- `destination`
- `provenance: guest-booking-input-v1`
- `capturedAt`

El snapshot es `select:false` e inmutable. Es contacto operacional del recurso; no es identidad ni ownership.

El worker C2 consulta únicamente `Appointment + Business + Service + guestContact`. No popula `Appointment.client`, `User`, `CustomerProfile`, otras Appointment ni historial.

Por tanto:

- `Appointment.client` no habilita bootstrap;
- `User.email` / `User.phone` legacy no son provenance;
- cambiar posteriormente `User.email` no cambia el destinatario histórico de la Appointment;
- Appointment legacy sin `guestContact` válido falla cerrado;
- no existe migración heurística de legacy en C2.

`current channel control != historical subject continuity` sigue siendo una frontera explícita.

## Frontera HTTP y orquestación durable

`POST /api/guest-appointments/read/challenge` valida sólo IDs sintácticos, persiste/deduplica una intención durable y responde el mismo `202` genérico. No consulta Appointment, User, CustomerProfile ni proveedor de email antes de responder.

`GuestAppointmentVerificationJob` mantiene scope físico único:

`Business + Appointment + purpose + action`

Lifecycle:

`queued -> processing -> delivering -> delivered | failed`

El worker:

1. reclama un job con lease atómico;
2. resuelve la Appointment tenant-scoped y `guestContact` válido;
3. emite C1 Verification;
4. adjunta la Verification a la generación reclamada;
5. crea y adjunta Delivery con la misma generación;
6. construye la URL desde `GUEST_APPOINTMENT_ACCESS_ORIGIN`;
7. cambia a `delivering` antes del transporte externo;
8. sólo tras aceptación marca Delivery y Job como `delivered`.

Un worker sin ownership o con generación obsoleta no puede completar el estado actual.

### Leases y resultado externo incierto

`processing` stale puede recuperarse porque ningún email ha sido intentado todavía. Los artefactos derivados conocidos se cierran/revocan antes de emitir un nuevo challenge.

`delivering` stale **no se reenvía automáticamente**. Se convierte a `failed`, se intenta cerrar Delivery y revocar la Verification conocida. Si el proveedor aceptó el email justo cuando otro worker marcó el job failed, la Verification queda revocada y el job no está `delivered`; exchange exige ambos estados coherentes, por lo que no aparece una segunda autoridad.

Esta política sacrifica disponibilidad ante resultado de transporte incierto para conservar fail-closed.

## Trusted delivery y secretos

Challenges y capabilities usan `crypto.randomBytes(32)` y `base64url`.

MongoDB nunca persiste challenge raw ni capability bearer raw. C1 y C2 persisten únicamente hashes derivados.

El challenge raw existe en memoria del worker durante la construcción/entrega del mensaje. La URL lo lleva en fragment (`#`), no query.

La infraestructura sensible de email:

- usa el destination persistido por C1, proveniente del snapshot Appointment-scoped;
- no registra recipient;
- no registra HTML/body;
- no registra bearer URL;
- no registra provider error body;
- no imprime preview URL Ethereal para mensajes sensibles.

`delivered` significa sólo que el transport/provider configurado aceptó el mensaje. No demuestra lectura ni identidad histórica.

## Consumo exacto de C1

C1 mantiene su API previa `consumeVerificationForBusiness()`.

C2 usa la primitive adicional `consumeExactVerificationForBusiness()`, que deriva el mismo hash y ejecuta una única operación atómica con:

`verificationId + Business + purpose + secretHash + status=pending + expiresAt>now`

Un verificationId incorrecto acompañado de un secret válido no consume otra proof.

C1 Verification continúa sin campo Appointment y no se convierte en Appointment authority.

## Capability READ

`GuestAppointmentCapability` persiste:

- `business`
- `appointment`
- `verification`
- `action=read`
- `secretHash`
- `status=active|consumed|revoked`
- `expiresAt`
- timestamps terminales

Una Verification sólo puede respaldar una capability por índice unique.

READ es single-use. `expiresAt <= now` falla cerrado y revocación/consumo son terminales.

La proyección READ contiene sólo datos operacionales de Appointment, Business, Service y professional. No expone client/contact, notes, User authority, Membership, CustomerProfile, historial ni timeline.

## Anti-amplificación durable

### Cooldown por scope

Un índice unique conserva un único job por `Business + Appointment + purpose + action`. El cooldown actual es 15 minutos y funciona entre procesos/instancias.

### Retención terminal

Los jobs `delivered` y `failed` reciben `purgeAfter`. La retención por defecto es 60 minutos, superior al cooldown.

`queued`, `processing` y `delivering` mantienen `purgeAfter=null`, por lo que el TTL nunca elimina trabajo activo.

MongoDB materializa:

`{ purgeAfter: 1 }` con `expireAfterSeconds: 0`.

Al reutilizar un scope terminal después del cooldown, `generation` aumenta y `purgeAfter` vuelve a `null`.

### Backpressure de intake

Antes de crear/reutilizar un job, un bucket global persistente reserva capacidad en una ventana temporal. Por defecto:

- ventana: 60 segundos;
- máximo: 240 intents por ventana;
- retención del bucket: 10 minutos tras su ventana.

El bucket contiene sólo `_id` temporal, `count` y `expiresAt`: no contiene Business, Appointment, email ni autoridad. Por ello saturarlo no exige consultar ni revela la existencia del recurso.

Su TTL físico es:

`{ expiresAt: 1 }` con `expireAfterSeconds: 0`.

Al alcanzar el límite, el enqueue no crea otro scope, pero la superficie pública conserva exactamente el mismo `202`.

Este mecanismo limita la tasa durable de scopes aleatorios; la retención terminal evita acumulación indefinida de jobs ya procesados. Una caída indefinida del worker puede seguir acumulando jobs activos a la tasa limitada, porque C2 deliberadamente no aplica TTL a trabajo activo; es un riesgo operacional residual a monitorizar, no una razón para consultar Appointment antes del 202.

## Índices físicos y cutover

Antes de exponer C2 remotamente se ejecuta:

`npm run migration:guest-appointment-capability-storage`

El migrador conecta con `autoIndex:false`, exige replica set o mongos, materializa de forma idempotente las colecciones/índices C1+C2 y no hace drop/recreate destructivo.

La identidad de seguridad de un índice es:

- key pattern en orden exacto;
- `unique` exacto;
- `expireAfterSeconds` exacto cuando corresponde.

**El nombre físico no forma parte de la equivalencia de seguridad.** Un índice con key/options equivalentes y otro nombre es aceptable. Sin embargo, si el nombre esperado ya existe con keys/options incompatibles, el cutover falla cerrado para no ocultar una colisión de topología.

Índices C2 adicionales de jobs:

- scope unique;
- claim por status/lease/updatedAt;
- TTL terminal sobre `purgeAfter`.

También existe TTL del bucket de intake sobre `expiresAt`.

Runtime remoto requiere:

`GUEST_APPOINTMENT_6_2_5_C2_CUTOVER=GUEST_APPOINTMENT_6_2_5_C2_STORAGE_READY`

El orden de startup es:

`connectDB -> availability cutover gate -> C2 storage cutover gate -> app.listen -> socket init -> worker start`

Si cualquiera de los gates falla, HTTP no abre y el worker no arranca. El worker se detiene al evento `close` del HTTP server.

## URLs y claimant

`GUEST_APPOINTMENT_ACCESS_ORIGIN` debe ser un origin HTTPS explícito, sin credenciales/path/query/hash. No se usan `Host`, `Origin`, `Referer` ni `X-Forwarded-*` del requester para construir bearer links.

`/appointment-access` elimina el fragmento antes del primer POST, usa `credentials: omit`, no usa `localStorage` ni `sessionStorage`, no crea Client session y no carga recursos third-party antes del canje.

## Evidencia automatizada real

Los archivos de prueba C2 presentes son:

- `Server/test/guestAppointmentCapability.test.js`
  - intake durable sin transporte HTTP;
  - provenance Appointment-scoped;
  - legacy fail-closed;
  - delivery accepted/failed;
  - C1 directo sin delivery;
  - purpose confusion;
  - cross-Business/cross-Appointment;
  - bearer raw ausente;
  - READ projection/single-use/replay/expiry/revoke;
  - service incoherence;
  - worker concurrency, stale processing/delivering, ownership y generation;
  - cooldown, retención y backpressure.
- `Server/test/guestAppointmentCapabilityStorage.test.js`
  - `autoIndex:false`;
  - materialización e inspección con `listIndexes()`;
  - key order, unique y TTL exactos;
  - idempotencia;
  - índices incompatibles;
  - semántica de nombres físicos;
  - standalone reject / replica set accept;
  - gate remoto y confirmation.
- `Server/test/unit/client-contact-verification.contract.test.js`
  - superficie C1 preservada más primitives exactas documentadas.
- `Server/test/unit/guest-appointment-capability.contract.test.js`
  - fronteras de action/scope/secrets/TTL e HTTP strict.
- `Server/test/unit/guest-appointment-startup.lifecycle.test.js`
  - database real de Mongoose sin typo;
  - gate fallido antes de listen;
  - orden gates/listen/socket/worker;
  - shutdown del worker en `close`.

No se declaran suites inexistentes.

## Fuera de alcance

C2 no implementa Client account/login/session, User↔CustomerProfile binding, claims, Client history/list/timeline, correlación histórica, CustomerProfile ownership, Appointment.client authority, cambios a `getOrCreateGuestUser()`, Membership Client, OAuth Client, CRM/marketing/loyalty/subscription, SMS, migración histórica, cancel/reschedule end-to-end ni 6.2.5-D.
