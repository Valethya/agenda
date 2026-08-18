# Fase 6.2.5-C2 — Verified guest Appointment capabilities

## Estado y baseline

Implementación construida sobre `master@a84b5619b7f2fc0f928fff51755c8930934fcc0c`, merge de 6.2.5-C1 / PR #28.

C2 conserva los contratos de 6.2.5-A, 6.2.5-B, 6.2.5-C1, ADR-002 y APT-CLIENT-01. El alcance ejecutable continúa siendo **READ únicamente**.

## Autoridad que introduce C2

El flujo efectivo sigue siendo:

`HTTP acceptance -> durable intent -> worker -> Appointment-scoped contact provenance -> C1 Verification -> trusted delivery -> exact C1 consume -> Appointment READ capability`

Una capability concede exclusivamente `read` sobre una Appointment exacta de un Business exacto mientras el bearer single-use siga válido. No significa Client account, User authority, Membership, Business.owner authority, superadmin Client authority, CustomerProfile ownership, claim, historial ni continuidad histórica.

`appointment-read-bootstrap -> read` es el único mapping implementado. Cancel y reschedule permanecen fuera de C2.

## Provenance Appointment-scoped

Las reservas guest nuevas capturan `Appointment.guestContact` directamente desde el input del booking **antes** de `getOrCreateGuestUser()`:

- `channel: email`;
- `destination`;
- `provenance: guest-booking-input-v1`;
- `capturedAt`.

El snapshot es interno, inmutable y operacional; no es identidad ni ownership. El worker resuelve únicamente Appointment + Business + Service + `guestContact`.

No existe fallback a `Appointment.client`, `User.email`, `User.phone`, CustomerProfile, otra Appointment ni matching histórico. Appointment legacy sin provenance válida falla cerrado.

`current channel control != historical subject continuity` continúa siendo frontera obligatoria.

## Frontera HTTP y orquestación durable

`POST /api/guest-appointments/read/challenge` valida sólo IDs sintácticos, persiste/deduplica una intención durable y responde el mismo `202` genérico. No demuestra existencia consultando Business/Appointment antes de responder y no espera al proveedor de email.

`GuestAppointmentVerificationJob` mantiene scope único:

`Business + Appointment + purpose + action`

Lifecycle:

`queued -> processing -> delivering -> delivered | failed`

Sólo un worker reclama un job mediante lease. `processing` stale es reclaimable. `delivering` stale falla cerrado, no se reenvía automáticamente y revoca la Verification conocida. Un worker sin ownership o una generación antigua no puede completar una generación nueva.

## Trusted delivery, exact consume y secretos

Challenges y capabilities usan `crypto.randomBytes(32)` + `base64url`. Los bearer raw nunca se persisten; MongoDB conserva sólo hashes SHA-256 scoped.

La URL sensible usa fragment y un trusted HTTPS origin explícito. La ruta sensible de email no registra recipient, body/HTML, bearer URL ni provider payload.

C2 consume C1 mediante una única operación atómica que exige:

`verificationId + Business + purpose + secretHash + status=pending + expiresAt>now`

Una emisión C1 directa sin Delivery/Job C2 coherentes no puede mintar capability.

READ es single-use y la proyección no expone client/contact, notes, CustomerProfile, Membership, historial ni timeline.

## Anti-amplificación durable

Se preserva el diseño aprobado:

1. consultar sólo `GuestAppointmentVerificationJob` por exact scope;
2. scope existente/activo/cooldown -> dedupe sin cobrar presupuesto global;
3. terminal elegible -> reutilizar el mismo job y aumentar `generation` sin cobrar crecimiento nuevo;
4. sólo ausencia real entra al intake guard.

`GuestAppointmentIntakeBucket.scopeKeys` almacena fingerprints SHA-256, nunca Business/Appointment/email raw. `$addToSet` hace idempotente la admisión concurrente del mismo scope.

Valores actuales:

- ventana: 60 segundos;
- máximo: 240 scopes nuevos distintos por ventana;
- retención bucket: 10 minutos;
- saturación: mismo `202 { accepted: true }`.

El riesgo residual cross-tenant por suficientes scopes distintos es un trade-off de disponibilidad aceptado; no se amplía C2 con identidad/autenticación para eliminarlo.

## Retención — política por artefacto

C2 adopta explícitamente **política A: retención por artefacto**. No existe una deadline única de cadena completa. Cada objeto conserva 60 minutos desde su propio deadline relevante; por ello Verification, Delivery, Job y Capability pueden desaparecer físicamente en instantes distintos.

Esto no cambia autoridad: los checks runtime vencen antes y de forma exacta; MongoDB TTL es cleanup eventual.

### ClientContactVerification — contrato compartido C1

La retención de `ClientContactVerification` no es exclusiva de C2. C2 materializa la política compartida que C1 había dejado pendiente:

```text
{ expiresAt: 1 }
expireAfterSeconds: 3600
```

Aplica sin filtro de purpose a:

- `contact-control`;
- `appointment-read-bootstrap`;
- `appointment-cancel-bootstrap`;
- `appointment-reschedule-bootstrap`.

La autoridad lógica termina exactamente en `expiresAt <= now`; el documento sólo se vuelve elegible para cleanup físico una hora después. El contrato compartido se documenta también en `fase-6.2.5-c1-retention-contract.md`.

### Resto de la cadena C2

- Delivery: `purgeAfter = verification.expiresAt + 60 min`; TTL `{ purgeAfter: 1 }`, `expireAfterSeconds: 0`.
- Capability: autoridad termina en `expiresAt`; TTL físico `{ expiresAt: 1 }`, `expireAfterSeconds: 3600`.
- Job: sólo `delivered|failed` reciben `purgeAfter = terminalAt + 60 min`; `queued|processing|delivering` mantienen `purgeAfter=null`.
- Intake Bucket: TTL corto propio; no es evidencia de autoridad.
- `Appointment.guestContact`: no se purga por esta política porque es provenance operacional del recurso.

## Índices físicos — identidad de seguridad

El cutover valida físicamente:

- key pattern y orden exacto;
- `unique`;
- `expireAfterSeconds`;
- `sparse`;
- `partialFilterExpression` con canonicalización estructural determinista;
- `collation`;
- `hidden`.

Opciones no declaradas deben estar ausentes/default seguro. Los índices actuales exigen collation simple/default; al materializar se fuerza `locale: simple`.

El nombre físico es diagnóstico: otro nombre es aceptable sólo con semántica exactamente equivalente. Same-name o same-key incompatible bloquea el cutover; no se hace drop/recreate automático de índices preexistentes.

## Migración operacional en cuatro fases

`npm run migration:guest-appointment-capability-storage` conecta con `autoIndex:false` y exige replica set o mongos.

### Fase 1 — preflight completo read-only

Antes de cualquier `createCollection()` o `createIndex()`:

1. valida topología;
2. lista colecciones relevantes;
3. lista todos los índices físicos C1+C2 existentes;
4. valida same-name y same-key conflicts;
5. compara todas las opciones de identidad física;
6. pre-valida cada unique requerido sobre datos existentes.

La prevalidación unique es server-side y acotada:

`$group -> $match count > 1 -> $limit 1`

Se ejecuta con collation simple y no descarga la colección a memoria de la aplicación. No incluye valores duplicados en el error público/operacional; sólo colección e índice esperado.

Si este preflight falla: cero colecciones nuevas, cero índices nuevos, cero TTL nuevos y cero cambios de documentos.

### Fase 2 — índices estructurales/no destructivos

Sólo después del preflight global:

1. crea las colecciones faltantes;
2. materializa índices no TTL;
3. revalida unique inmediatamente antes de cada unique `createIndex()` para cerrar carreras de forma fail-closed;
4. vuelve a `listIndexes()` y exige semántica exacta de toda la topología estructural.

Un fallo aquí puede dejar únicamente estructura no destructiva creada por esta ejecución; **ningún TTL nuevo ha sido activado todavía**.

### Fase 3 — TTL/cleanup al final

Después de verificar todos los índices estructurales, se vuelve a inspeccionar globalmente cada target TTL. Sólo entonces se materializan:

- C1 Verification `{ expiresAt: 1 } + 3600`;
- C2 Delivery `{ purgeAfter: 1 } + 0`;
- C2 Capability `{ expiresAt: 1 } + 3600`;
- C2 Job `{ purgeAfter: 1 } + 0`;
- Intake Bucket `{ expiresAt: 1 } + 0`.

Así, un conflicto predecible tardío de estructura/unique no puede dejar activada una nueva política destructiva de cleanup.

### Fase 4 — verificación física final

Al terminar se vuelve a inspeccionar la topología C1+C2 completa y el comando sólo informa ready si todos los índices existen con semántica exacta.

La migración sigue siendo idempotente y no modifica automáticamente índices incompatibles.

## Cutover remoto fail-closed

Runtime remoto requiere:

`GUEST_APPOINTMENT_6_2_5_C2_CUTOVER=GUEST_APPOINTMENT_6_2_5_C2_STORAGE_READY`

Se considera remoto si `NODE_ENV` es staging/production o existe cualquier deployment indicator soportado. Un deployment indicator siempre prevalece frente a `NODE_ENV=test`; no existe bypass especial de CI.

El startup sigue:

`connectDB -> availability gate -> C2 storage gate -> app.listen/listening -> socket init -> worker start`

Confirmation sin índices exactos falla cerrado. El worker no arranca antes del gate.

## Evidencia automatizada

`Server/test/guestAppointmentCapabilityStorage.test.js` y `Server/test/guestAppointmentCapabilityStorageCutover.test.js` cubren production-like con `autoIndex:false` y MongoDB replica set real, incluyendo:

- DB vacía y preflight read-only;
- topología parcialmente materializada pero compatible;
- rerun idempotente;
- standalone reject / replica set accept;
- same-name y same-key incompatibles;
- wrong unique / wrong TTL;
- partial, sparse, collation y hidden inesperados;
- alternate physical name sólo con semántica exacta;
- duplicate data para future unique -> preflight reject;
- failure injection que demuestra cero nuevos índices/TTL/colecciones y preservación del documento C1 preexistente;
- retención C1 sin filtro que cubre físicamente `contact-control`;
- gate remoto, confirmation e indicadores de deployment.

Las suites de capability mantienen provenance, trusted delivery, exact consume, worker fencing, single-use y backpressure. Las suites generales siguen validando Membership, tenant isolation, Appointment ownership/coherence, availability, API, pagos, WebSocket y frontend.

## Fuera de alcance

C2 no implementa Client account/login/session, User↔CustomerProfile binding, claims, Client history/list/timeline, correlación histórica, CustomerProfile ownership, Appointment.client authority, Membership Client, OAuth Client, SMS, migración histórica, cancel/reschedule end-to-end ni 6.2.5-D.
