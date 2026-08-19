# Fase 6.2.6-A — Contrato headless público mínimo

**Estado:** hardening del prompt adversarial completo implementado; pendiente nueva revisión adversarial  
**Fecha:** 19 de agosto de 2026  
**Baseline verificada:** `master@3f2ab734d412828f5a77ec72b778a8d575a14cd4`  
**Precedente:** PR #29 / 6.2.5-C2 merged en esa baseline  
**Ámbito:** discovery público de booking + creación guest de Appointment + frontera segura con la superficie administrativa existente

## 1. Objetivo

6.2.6-A formaliza el dominio headless mínimo para que una web pública pueda:

1. listar Services públicos/activos de un Business;
2. listar profesionales realmente elegibles para un Service;
3. consultar slots de disponibilidad;
4. crear una Appointment guest.

El contrato no depende de una web, marca, framework, cantidad de pantallas ni recorrido visual concreto.

Esta subfase **no** implementa Client accounts, OAuth Client, nuevas Appointment capabilities, cancel/reschedule capabilities, payment capability, 6.2.6-B ni 6.3.

## 2. Fronteras de autoridad preservadas

Continúan vigentes ADR-001, ADR-002, APT-CLIENT-01, C1 y C2:

- `Membership` activa es la autoridad tenant ordinaria de admin/worker;
- `User.role`, `User.business` y `Business.owner` no conceden autoridad tenant;
- `Appointment.business` expresa pertenencia tenant del recurso;
- `Appointment.client` es una relación operacional opcional, **no** ownership ni Client authority;
- en guest booking, `Appointment.client = null`;
- `Appointment.guestContact` es provenance operacional Appointment-scoped y permanece `select:false`;
- email, phone, contact matching y CustomerProfile no conceden binding ni authority;
- C1 prueba control de contacto dentro de su purpose;
- C2 entrega una capability bearer limitada exactamente a `Business X + Appointment X + READ`.

Regla contractual:

```text
READ capability
!= CANCEL capability
!= RESCHEDULE capability
!= PAYMENT authority
```

## 3. Tenant y surface son decisiones distintas

### 3.1 Tenant público explícito

Las operaciones headless usan un Business explícito por `businessId` o `slug`.

El resolver público admite los selectores compatibles existentes en query/body o `x-business-id` / `x-business-slug`, pero nunca hace fallback a otro Business.

Reglas:

- tenant ausente: `400 VALIDATION_ERROR`;
- ObjectId mal formado: `400 VALIDATION_ERROR`;
- selectores contradictorios: `400 VALIDATION_ERROR`;
- Business inexistente/inactivo: `404 NOT_FOUND` genérico;
- una cookie de otro tenant no cambia el Business público solicitado.

### 3.2 Surface controlada por servidor

`businessId`, `slug`, `x-business-id` y `x-business-slug` seleccionan tenant cuando corresponde. **No seleccionan surface.**

`x-agenda-surface` tampoco es prueba de surface ni authority.

La clasificación deriva del routing/policy montado por el servidor.

#### Paths públicos

```text
GET  /api/services
GET  /api/services/:id
GET  /api/users/workers
GET  /api/availability/slots
POST /api/appointments
```

Estos paths permanecen públicos aunque exista cookie administrativa o el caller envíe `x-agenda-surface: internal`.

#### Mounts internos explícitos

```text
GET  /api/internal/services
GET  /api/internal/services/:id
GET  /api/internal/users/workers
POST /api/internal/appointments
```

Además continúan siendo internas las operaciones administrativas existentes, entre ellas:

```text
GET/PATCH /api/appointments/...
GET/POST/DELETE /api/availability/shifts|blocks/...
POST/PUT/DELETE /api/services/...
POST/DELETE /api/users/workers/...
GET/PUT /api/business-settings
GET /api/business-settings/metrics
GET /api/business-settings/analytics
```

`apiFetch()` del panel no emite `x-agenda-surface`.

### 3.3 Cookie incidental no eleva el contrato público

Una cookie de admin de Business A que consume un path público para Business B:

- opera sólo sobre B;
- recibe la proyección pública de B;
- no obtiene datos internos de A;
- no convierte Membership A en authority dentro de B;
- no eleva el schema de `POST /api/appointments`.

### 3.4 Origin del panel

CORS puede permitir credentials y más de un origin. Por ello, “origin permitido por CORS” no equivale a “origin administrativo”.

Cuando una request interna de navegador contiene `Origin`, `scopeBusiness` exige que coincida con el origin configurado en `FRONTEND_URL`.

Así:

```text
origin público permitido por CORS
+ cookie admin válida
+ x-agenda-surface: internal
!= surface interna
```

El origin público puede consumir la API pública, pero no reutilizar una cookie ambiente para acceder a mounts internos.

Una request interna sin `Origin` continúa siendo posible para same-origin/non-browser/server tooling, pero exige igualmente sesión y autoridad tenant vigente.

Esta guarda es específica de la frontera de 6.2.6-A y **no sustituye** un diseño CSRF general futuro.

## 4. Toda surface tenant-interna exige Membership vigente

La sesión no congela authority.

Cada request interna revalida desde persistencia:

```text
session user id
-> User existente y activo
-> Business de sesión existente y activo
-> Membership(User, Business) existente y activa
-> Membership.role en {admin, worker}
-> tenantAuthority vigente
```

Si cualquiera deja de cumplirse después del login, la request interna falla cerrado.

En particular:

- Membership revocada/inactiva: `403`;
- User desactivado: `403`;
- Business desactivado: `403`;
- role Membership inválido: `403`;
- `User.role`, `User.business`, `Business.owner` o copias de role de sesión no recuperan authority.

El Business interno procede del contexto tenant autorizado de sesión. Selectores tenant del caller no desplazan silenciosamente la operación a otro Business.

La política global especial de superadmin permanece separada: no se fabrica una Membership tenant para representar privilegio de plataforma.

## 5. Services públicos

### `GET /api/services`

Sólo lista Services activos del Business público explícito.

Proyección pública:

```json
{
  "id": "ObjectId",
  "business": "ObjectId",
  "name": "string",
  "description": "string",
  "duration": 60,
  "price": 25000,
  "depositAmount": 5000
}
```

No expone `workers`, `isActive`, timestamps ni metadata administrativa.

### `GET /api/services/:id`

Misma proyección y mismo tenant scope. Un Service de B dentro de A falla cerrado.

El panel utiliza `/api/internal/services[/...]` cuando necesita la representación administrativa.

## 6. Professional discovery público

### `GET /api/users/workers?serviceId=:serviceId`

Requiere tenant explícito y Service válido/activo del mismo Business.

Cada profesional retornado debe:

- ser User activo;
- tener Membership activa del Business;
- tener role tenant vigente `admin|worker`;
- estar incluido en `Service.workers`.

Proyección pública:

```json
{
  "id": "ObjectId",
  "firstName": "string",
  "lastName": "string"
}
```

Nunca expone email, phone, `User.role`, `User.business`, Membership, credenciales ni timestamps.

La inelegibilidad esperada de un profesional puede omitirlo; errores de repositorio/DB/infraestructura se propagan y no se convierten silenciosamente en `200` parcial.

El panel usa `/api/internal/users/workers` para la proyección operacional autorizada.

## 7. Disponibilidad

### `GET /api/availability/slots`

Input:

- tenant explícito;
- `workerId`;
- `serviceId`;
- `date` estricta `YYYY-MM-DD` y fecha Gregoriana real.

Ejemplo:

```text
2026-02-31 -> 400 VALIDATION_ERROR
```

La consulta mantiene coherencia de Business + Service + worker + Shift + Block + Appointment.

`slotDuration` define la grilla de slots presentada, mientras `Service.duration` define la duración real de cada cita.

### Shift raw

`GET /api/availability/shifts/:workerId` es interno y exige sesión + Membership tenant vigente + role compatible. No forma parte del contrato guest.

## 8. Crear Appointment guest

### `POST /api/appointments`

El path es siempre público/headless.

Input permitido:

```json
{
  "worker": "ObjectId",
  "service": "ObjectId",
  "date": "YYYY-MM-DD",
  "startTime": "HH:MM",
  "notes": "opcional",
  "clientInfo": {
    "firstName": "string",
    "lastName": "string",
    "email": "email",
    "phone": "+56912345678"
  }
}
```

El schema es `strict`. El controller consume únicamente el body validado/transformado.

No se aceptan públicamente:

- `isSuggestion`;
- `paymentOption`;
- campos administrativos;
- campos desconocidos/control fields.

Todos fallan con `400 VALIDATION_ERROR` antes de llegar al service layer.

La variante administrativa legacy que realmente necesita controles internos vive en `POST /api/internal/appointments` y exige la frontera tenant-interna completa.

### 8.1 Validación de `clientInfo`

Antes de Mongoose:

- nombres se trimean;
- whitespace-only falla;
- nombres máximo 120 caracteres;
- email máximo 320 y formato válido;
- dominio del email se normaliza a lowercase conservando local-part;
- phone se trimea y usa formato E.164-like `+?[1-9][0-9]{6,14}`;
- campos desconocidos fallan cerrado.

### 8.2 Invariantes guest

El booking guest:

1. valida Service/worker dentro del Business;
2. valida fecha Gregoriana;
3. no requiere login;
4. no busca User por email o teléfono;
5. no modifica User existente;
6. no crea User;
7. no crea password aleatoria;
8. persiste `Appointment.client = null`;
9. persiste únicamente un snapshot `guestContact` Appointment-scoped/select:false;
10. un fallo de booking no deja side effects de identidad global;
11. `guestContact`, email, phone, CustomerProfile o `Appointment.client` no conceden authority.

Output público mínimo:

```json
{
  "appointmentId": "ObjectId",
  "businessId": "ObjectId",
  "serviceId": "ObjectId",
  "workerId": "ObjectId",
  "date": "ISO date",
  "startTime": "09:00",
  "endTime": "10:00",
  "status": "pending"
}
```

No expone `client`, `guestContact`, notes, paymentStatus, CustomerProfile, Verification ni Membership.

## 9. Exclusión concurrente de intervalos

La consulta inicial de disponibilidad es útil para UX, pero **no es la garantía de integridad**, porque por sí sola tendría una carrera TOCTOU.

La garantía física se aplica en la capa de persistencia para toda creación runtime que utiliza `appointmentRepository.create()`.

### 9.1 Clave de serialización

Existe un registro de coordinación `AppointmentBookingMutex` con `_id` determinístico:

```text
BusinessId : WorkerId : YYYY-MM-DD
```

Por tanto:

- distintos Businesses no comparten exclusión;
- distintos workers no comparten exclusión;
- citas del mismo worker/día se serializan aunque tengan distinta hora o duración.

El registro no es authority, ownership, capability ni “reserva” del slot.

### 9.2 Transacción

Para crear una Appointment:

```text
materializar mutex row si no existe
-> iniciar MongoDB transaction
-> write sobre mutex Business+worker+date
-> consultar overlap activo dentro de la misma transaction
-> si overlap: abort + 409 CONFLICT_ERROR
-> si no overlap: insertar Appointment en la misma transaction
-> commit
```

El write del mutex es el punto de serialización cross-process. Dos transacciones para el mismo Business+worker+date no pueden confirmar basándose en snapshots independientes sin resolver antes el conflicto de escritura.

`withTransaction()` permite al driver reintentar errores transitorios. Un retry obtiene un snapshot actualizado y vuelve a comprobar overlap después del ganador.

### 9.3 Definición de overlap

Para estados activos:

```text
existing.startTime < new.endTime
AND
existing.endTime > new.startTime
```

Estados ocupantes:

```text
pending_payment
pending
confirmed
completed
```

`cancelled` no ocupa intervalo.

Consecuencias:

- `09:00-11:00` y `10:00-12:00` no pueden coexistir;
- `09:00-10:00` y `10:00-11:00` sí pueden coexistir;
- funciona con Services de distinta duración;
- usa `startTime/endTime` reales, no sólo `slotDuration`;
- cancelar libera funcionalmente el intervalo para una reserva posterior.

El índice único existente `{business, worker, date, startTime}` permanece como defensa adicional para comienzos idénticos, pero **no** es la garantía principal de no-overlap.

### 9.4 Semántica del mutex persistente

No existe TTL, lease ni lock lógico que deba “liberarse”.

La fila puede permanecer después de una reserva o cancelación. Sólo produce exclusión mientras una transacción está escribiendo sobre ella. Por tanto:

- no existe riesgo de lock expirado mientras un writer sigue vivo;
- no hay ownership de lease que recuperar;
- una fila antigua no impide reservar;
- la ocupación real deriva exclusivamente de Appointments activas.

Si MongoDB no soporta transactions, el booking falla en vez de degradarse a una inserción no serializada. El gate oficial usa un replica set real.

## 10. DTO operacional interno de guest

Persistencia:

```text
Appointment.client = null
Appointment.guestContact = Appointment-scoped/select:false
```

Sólo después de superar tenant scope + autorización de Appointment, una lectura interna puede transformar el snapshot a:

```json
{
  "client": {
    "kind": "guest",
    "firstName": "Ada",
    "lastName": "Lovelace",
    "email": "ada@example.com",
    "phone": "+56912345678"
  }
}
```

Nunca serializa `guestContact` raw, provenance, capturedAt, channel, Verification, CustomerProfile, bindings ni Membership.

Admin del Business y profesional realmente asignado pueden recibir el DTO. Worker no asignado y otro Business no adquieren acceso.

C2 READ mantiene su query/proyección separada y no recibe este DTO ampliado.

## 11. Business Settings

### Decisión: internal-only

`BusinessConfig` no forma parte del contrato headless mínimo de 6.2.6-A.

`GET /api/business-settings` exige:

- sesión;
- User vigente;
- Business vigente;
- Membership tenant vigente;
- trusted panel origin cuando la request de navegador incluye `Origin`.

Esto evita exponer raw BusinessConfig, que contiene datos operacionales como working hours, cancellation/payment/email/UI settings.

### Sin side effects públicos

`getOrInitializeConfig()` puede crear defaults cuando un actor interno autorizado abre por primera vez la configuración del Business.

Pero una request pública/anónima se detiene **antes** del controller:

```text
GET público /api/business-settings
-> 401/403
-> no BusinessConfig read
-> no default initialization
-> cero writes
```

Un origin público permitido por CORS con una cookie admin ambiente también falla antes de la inicialización.

El panel conserva el mismo endpoint `/api/business-settings`; no necesita migración de path para esta lectura.

## 12. Payment

6.2.6-A no implementa payment capability.

Incluso con `ENABLE_PAYMENTS=true`:

```text
POST /api/payments/initiate
-> 403 FORBIDDEN_ERROR
```

Appointment ID no concede payment authority.

### Callback Webpay legacy

`/api/payments/webpay-return` sólo preserva transacciones ya iniciadas:

```text
token_ws
-> Payment existente pending
-> Appointment fijada por Payment
-> Business coherente
-> Appointment pending_payment
-> Business/Service coherentes
-> commit Transbank
-> buy_order == Payment.appointment
-> amount/status válidos
-> transición aprobada o rechazada
```

Payment/Appointment cross-Business falla antes del commit externo. `buy_order` mismatch no produce transición local.

No se introduce nuevo flujo de inicio, ownership de pago por Client ni matching User/contact.

## 13. C2 preservado

El flujo sigue separado:

```text
challenge durable
-> trusted email delivery
-> exact Verification consume
-> Business + Appointment + READ capability
```

La capability continúa siendo single-Business, single-Appointment, single-purpose READ y single-use. No concede history/list, cancel/reschedule/payment ni authority derivada de email, phone, client o guestContact.

## 14. Appointment ID no es authority

Conocer `businessId + appointmentId` no concede detalle sensible, timeline/history, cancelación, reprogramación, confirmación, pago, User binding, CustomerProfile ownership ni Membership.

## 15. Idempotencia y retries

La exclusión transaccional evita **overlap**, no convierte automáticamente el endpoint en una API idempotente.

El índice único de startTime y la serialización impiden duplicados/overlaps activos incompatibles, pero un timeout posterior a un commit exitoso puede seguir dejando al caller sin saber si su operación confirmó.

Una `Idempotency-Key` genérica sigue fuera de 6.2.6-A hasta que exista una necesidad de producto/integración concreta.

## 16. Rate limiting

Se conserva el limiter global, el limiter de autenticación y los guards específicos C2. Los tests no elevan límites para obtener verde; reutilizan sesiones cuando corresponde.

## 17. Holiday

Decisión actual de producto/modelo:

- Holiday continúa global;
- la misma fecha afecta a todos los Businesses;
- no se tenantiza en 6.2.6-A.

Es una semántica global deliberada, **no** una garantía de aislamiento tenant.

Shift, Block y Appointment sí permanecen tenant-scoped.

## 18. Matriz adversarial mínima

El gate demuestra al menos:

1. cookie A + contrato público B opera sólo sobre B;
2. origin público permitido + cookie admin + `x-agenda-surface: internal` no eleva Services/Workers/Appointment;
3. public workers nunca exponen email/phone;
4. panel real conserva workers + services + appointments + shifts;
5. Membership revocada después de login invalida surface interna inmediatamente;
6. User/Business inactivos y role Membership inválido fallan cerrado;
7. guest booking no crea ni muta User ni password;
8. `Appointment.client = null` para guest;
9. guestContact no es authority ni se serializa raw;
10. worker no asignado y Business B no obtienen contacto guest;
11. schema público rechaza `isSuggestion`, `paymentOption` y campos desconocidos;
12. clientInfo inválido falla antes de Mongoose;
13. dos POST paralelos `09:00-11:00` vs `10:00-12:00` dejan exactamente un ganador y un `409 CONFLICT_ERROR`;
14. ambos requests de esa carrera pueden superar la lectura inicial de disponibilidad sin romper la invariante transaccional;
15. `09:00-10:00` y `10:00-11:00` pueden coexistir;
16. Business A/B a la misma hora no comparten exclusión;
17. worker A/B a la misma hora no comparten exclusión;
18. cancelación permite rebooking posterior del intervalo;
19. Business Settings público no lee ni inicializa defaults;
20. origin público permitido + cookie no inicializa Business Settings;
21. Membership válida desde panel puede leer/inicializar Business Settings;
22. Shift raw sigue interno y slots público;
23. professional discovery propaga fallos de infraestructura;
24. fechas Gregorianas imposibles fallan;
25. C1 no se amplía;
26. C2 READ no se amplía;
27. Appointment ID no concede detail/cancel/reschedule/payment;
28. Payment initiate permanece fail-closed;
29. callback Webpay legacy mantiene approved/rejected/cross-Business/buy_order mismatch;
30. Holiday global afecta deliberadamente a A y B;
31. WebSocket continúa revalidando Membership/tenant.

## 19. Deudas explícitas fuera de alcance

Permanecen fuera de esta subfase:

- Client account/login;
- OAuth Client;
- User↔CustomerProfile binding;
- Client history/timeline;
- nuevas capabilities cancel/reschedule/payment;
- nuevo inicio Webpay con authority purpose-specific;
- idempotency key genérica;
- rediseño CSRF/sesiones general;
- verificación de websiteUrl/bookingUrl por Business;
- tenantización de Holiday;
- limpieza operativa opcional de mutex rows antiguas —no necesaria para correctness—;
- 6.2.6-B;
- 6.3;
- 6.4.

La finalidad de 6.2.6-A es dejar una frontera headless mínima verificable, con identidad guest no autoritativa, surface interna controlada por servidor, Membership vigente obligatoria y una invariante concurrente real que impida Appointments activas solapadas.
