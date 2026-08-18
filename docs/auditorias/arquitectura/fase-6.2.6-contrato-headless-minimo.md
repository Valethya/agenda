# Fase 6.2.6-A — Contrato headless público mínimo

**Estado:** hardening de segunda revisión implementado; CI verde, pendiente nueva revisión adversarial  
**Fecha:** 18 de agosto de 2026  
**Baseline verificada:** `master@3f2ab734d412828f5a77ec72b778a8d575a14cd4`  
**Precedente:** PR #29 / 6.2.5-C2 merged en esa baseline  
**Ámbito:** discovery público de booking + creación guest de Appointment

## 1. Objetivo

Agenda expone un dominio headless mínimo para que una web pública pueda:

1. listar Services públicos/activos de un Business;
2. listar profesionales realmente elegibles para un Service;
3. consultar slots de disponibilidad;
4. crear una Appointment guest.

El dominio no depende de cantidad de pasos, páginas, modales, componentes Astro/React, orden de preguntas, marca, rubro ni estructura visual. Dos webs completamente distintas deben poder consumir exactamente las mismas reglas.

6.2.6-A no inicia 6.3 y no implementa Client accounts, history, cancel/reschedule capabilities ni payment capability.

## 2. Fronteras de autoridad preservadas

Continúan vigentes ADR-001, ADR-002, APT-CLIENT-01, C1 y C2:

- `Membership` activa es la autoridad tenant ordinaria de admin/worker;
- `User.role`, `User.business` y `Business.owner` no conceden autoridad tenant;
- `Appointment.business` expresa pertenencia tenant del recurso;
- `Appointment.client` es una relación operacional opcional, **no** ownership ni Client authority;
- `Appointment.guestContact` es provenance operacional de una única Appointment, **no** identidad;
- email, teléfono o contact matching no conceden binding ni autoridad;
- CustomerProfile no es autoridad;
- una C2 READ capability autoriza exactamente `Business X + Appointment X + READ`.

Regla contractual:

```text
READ capability
!= CANCEL capability
!= RESCHEDULE capability
!= PAYMENT authority
```

No se implementan las capabilities futuras en este PR.

## 3. Tenant y surface son decisiones independientes

### 3.1 Tenant público explícito

Las operaciones headless requieren un Business explícito mediante:

- `businessId` válido; o
- `slug` válido.

Las superficies legacy aceptadas por el resolver son query/body o `x-business-id` / `x-business-slug`. Para consumidores headless se recomienda usar un único identificador de forma consistente.

Reglas:

- tenant ausente: `400 VALIDATION_ERROR`;
- ObjectId malformado: `400 VALIDATION_ERROR`;
- valores contradictorios para el mismo identificador: `400 VALIDATION_ERROR`;
- `businessId` y `slug` de Businesses diferentes: `400 VALIDATION_ERROR`;
- Business inexistente o inactivo: `404 NOT_FOUND` genérico;
- jamás hay fallback al primer Business ni a otro tenant.

### 3.2 El tenant no selecciona la surface

La presencia de `businessId`, `slug`, `x-business-id` o `x-business-slug` **no** significa que una request sea pública. Tampoco la presencia de una cookie significa que una request sea interna.

Las rutas que comparten path entre panel y contrato headless usan una política de surface separada:

```text
x-agenda-surface: public | internal
```

Semántica:

- `public` resuelve el Business sólo desde identificadores tenant explícitos;
- `public` ignora una sesión ambiente como fuente de autoridad/proyección;
- `internal` exige sesión autenticada y usa exclusivamente el Business/Membership vigentes de esa sesión;
- `internal` nunca obtiene autoridad de `User.role` ni `User.business`;
- la mera presencia de tenant identifiers nunca eleva ni degrada la proyección;
- en paths compartidos, ausencia de `x-agenda-surface` conserva la política segura por defecto: `public`;
- por tanto, una cookie incidental jamás convierte automáticamente una request pública en interna.

Para un consumidor headless que pueda portar cookies se recomienda enviar explícitamente:

```http
x-agenda-surface: public
```

El panel autenticado declara explícitamente:

```http
x-agenda-surface: internal
```

El frontend administrativo real (`apiFetch`) conserva `x-business-slug` derivado de `/admin?slug=...`, pero ese header es sólo contexto/selector tenant para superficies que lo necesitan. `apiFetch` añade además `x-agenda-surface: internal`, por lo que `CalendarDataContext` puede seguir consumiendo `/users/workers` sin `serviceId`, Services administrativos, `/appointments/my` y Shift raw sin ser reclasificado como headless.

### 3.3 Cookie A + contrato público B

Una cookie autenticada de Business A que llama el contrato público para Business B:

- resuelve B;
- nunca devuelve datos de A;
- nunca eleva la respuesta a proyección administrativa;
- no adquiere Membership ni autoridad en B por ese hecho.

La selección public/internal se deriva de política de surface (`bookingSurface`), nunca de `!req.tenantAuthority` ni de la presencia de tenant identifiers.

## 4. Operaciones públicas incluidas

### 4.1 Services

#### `GET /api/services`

Tenant explícito obligatorio en superficie pública.

Sólo lista Services activos del Business.

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

No expone:

- `workers`;
- `isActive`;
- timestamps;
- campos de persistencia internos.

#### `GET /api/services/:id`

Mismas reglas. Un Service de B presentado dentro de A se trata como no disponible; no se resuelve cross-tenant.

### 4.2 Profesionales

#### `GET /api/users/workers?serviceId=:serviceId`

Tenant explícito obligatorio. `serviceId` ObjectId obligatorio.

El Service debe:

- existir en el Business;
- estar activo;
- contener al profesional en `Service.workers`.

Cada profesional retornado debe:

- tener User activo;
- tener Membership activa del mismo Business;
- tener rol tenant participante vigente (`admin|worker`);
- seguir incluido en la allowlist del Service.

`User.role` y `User.business` legacy no son autoridad.

Proyección pública:

```json
{
  "id": "ObjectId",
  "firstName": "string",
  "lastName": "string"
}
```

Nunca expone email, phone, role, business legacy, Membership, credenciales ni timestamps.

Un profesional individual inelegible/revocado se omite. El servicio sólo absorbe el error esperado de inelegibilidad (`NotFoundError`); un error de repositorio, base de datos o infraestructura se propaga y **no** se degrada silenciosamente a un array parcial con `200`.

### 4.3 Disponibilidad

#### `GET /api/availability/slots`

Input público:

- tenant explícito;
- `workerId` ObjectId;
- `serviceId` ObjectId;
- `date` en `YYYY-MM-DD` y además fecha Gregoriana real.

Ejemplo inválido:

```text
2026-02-31 => 400 VALIDATION_ERROR
```

Coherencia requerida:

- Service activo del Business;
- worker con Membership activa del mismo Business;
- worker incluido en `Service.workers`;
- Shift consultado por `Business + worker`;
- Block consultado por `Business + worker`;
- Appointment que ocupa slot consultada por `Business + worker + date`.

Una Appointment de B no ocupa disponibilidad de A.

Proyección:

```json
{
  "startTime": "09:00",
  "endTime": "10:00",
  "available": true
}
```

#### `GET /api/availability/shifts/:workerId` NO es guest

Los documentos Shift son estado operativo interno. La ruta requiere:

- sesión autenticada;
- Membership activa del tenant;
- rol `admin|worker` compatible.

Un guest recibe `401/403`. La superficie pública debe consumir `/availability/slots`, no Shift raw.

### 4.4 Crear Appointment guest

#### `POST /api/appointments`

Tenant explícito obligatorio para la superficie headless.

Input contractual permitido:

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

También se aceptan `businessId`/`slug` únicamente como selectores tenant compatibles con el resolver.

#### Allowlist de input público

El schema público es `strict` y el controller consume exclusivamente el body parseado/transformado. No reutiliza `req.body` raw para controles del service layer.

Por tanto, la superficie pública **no acepta**:

- `isSuggestion`;
- `paymentOption`;
- overrides administrativos;
- campos desconocidos/control fields no documentados.

Esos campos fallan con `400 VALIDATION_ERROR` antes de llamar `bookAppointment()`.

Consecuencias contractuales:

- `isSuggestion=true` no puede saltarse `getAvailableSlots()`;
- `isSuggestion=true` no puede crear solapamientos públicos;
- `paymentOption=local` no puede alterar status, pago ni auto-confirmación;
- un control legacy agregado en el body no puede influir silenciosamente en el dominio público.

La superficie interna puede conservar controles legacy sólo después de `x-agenda-surface: internal`, sesión vigente y política tenant aplicable.

#### Validación de `clientInfo`

Antes de persistencia Mongoose:

- `firstName` y `lastName` se trimean;
- whitespace-only falla;
- nombres: máximo 120 caracteres;
- email: máximo 320 caracteres y formato email válido;
- dominio del email se normaliza a lowercase conservando el local-part;
- phone se trimea y debe cumplir formato E.164-like `+?[1-9][0-9]{6,14}`;
- objetos `clientInfo` con campos desconocidos fallan cerrado.

Los errores de estos inputs son `400 VALIDATION_ERROR`; no dependen de un error posterior de Mongoose.

#### Reglas de identidad y persistencia

1. Service y worker se validan dentro del Business antes de persistir;
2. `date` debe ser una fecha Gregoriana real;
3. disponibilidad se revalida antes de crear una reserva pública normal;
4. un guest no necesita login;
5. `clientInfo` se transforma sólo en `Appointment.guestContact` Appointment-scoped/select:false;
6. el flujo guest **no busca User por email ni por teléfono**;
7. el flujo guest **no añade emails/teléfonos/nombres a User existente**;
8. el flujo guest **no crea User ni contraseña aleatoria**;
9. para guest, `Appointment.client` queda `null`;
10. una Appointment nueva debe tener un `client` autenticado real o `guestContact`; nunca una identidad fabricada;
11. booking fallido no deja side effects de identidad global;
12. `guestContact`, `Appointment.client`, CustomerProfile o coincidencia de contacto no conceden authority.

`guestContact` conserva únicamente provenance operacional de la propia reserva, incluyendo destino de email y datos de contacto declarados necesarios para notificaciones. Continúa fuera de la proyección pública.

Las notificaciones de una reserva guest se envían al `Appointment.guestContact` persistido; no dependen de correlacionar un User global.

Output público de creación:

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

No incluye:

- `client`;
- `guestContact`;
- notes;
- `paymentStatus`;
- CustomerProfile;
- Verification;
- Membership;
- timestamps internos.

### 4.5 Proyección operacional interna de Appointment guest

La persistencia segura permanece:

```text
Appointment.client = null
Appointment.guestContact = datos declarados Appointment-scoped
```

Las lecturas internas protegidas pueden necesitar nombre/email/teléfono para operar el calendario. Sólo después de pasar la autorización tenant/Appointment existente, el repositorio selecciona `guestContact` y una proyección interna lo transforma a un DTO operacional:

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

Para una identidad autenticable real, el mismo campo usa:

```json
{
  "client": {
    "kind": "account",
    "_id": "ObjectId",
    "firstName": "...",
    "lastName": "...",
    "email": "...",
    "phone": "..."
  }
}
```

Este DTO es **representación operacional**, no ownership. `kind: guest` o coincidencia de contacto no concede acceso adicional.

Nunca se serializan a ese DTO:

- `guestContact` raw;
- `provenance`;
- `capturedAt`;
- `channel`;
- Verification;
- CustomerProfile;
- bindings;
- Membership;
- datos históricos de otros Appointments.

Admin del Business y profesional realmente autorizado/asignado pueden recibir esta proyección. Un worker no asignado o un Business distinto no adquieren acceso por conocer el contacto.

C2 conserva su consulta/proyección independiente y **no** recibe este DTO ampliado.

## 5. Operaciones expresamente fuera del contrato base

Conocer `businessId + appointmentId` no concede:

- detalle sensible;
- history/list de cliente;
- timeline;
- cancelación;
- reprogramación;
- confirmación;
- inicio de pago;
- CustomerProfile ownership;
- User binding;
- Membership;
- Client session.

Las acciones administrativas existentes continúan bajo sesión + política tenant.

## 6. Payment: inicio fail-closed y callback legacy acotado

6.2.6-A no implementa payment capability.

Aunque `ENABLE_PAYMENTS=true`, el runtime **no permite** iniciar un pago mediante sólo:

```text
Business + Appointment ID
```

`POST /api/payments/initiate` valida tenant/input y luego falla cerrado con `403 FORBIDDEN_ERROR` hasta que exista una autoridad purpose-specific diseñada en una fase posterior.

Esto evita que una feature flag convierta `appointmentId` en bearer implícito.

### Callback Webpay legacy preservado

Se conserva `/api/payments/webpay-return` únicamente para transacciones legacy **ya iniciadas**. No crea una transacción nueva y no acepta `appointmentId` como authority de inicio.

El callback se resuelve fail-closed en este orden:

```text
token_ws
-> Payment existente con status=pending
-> Payment.appointment + Payment.business fijan el scope local
-> Appointment debe existir
-> Appointment.business debe coincidir con Payment.business
-> Appointment debe estar pending_payment
-> Business y Service asociados deben existir
-> commit Transbank
-> buy_order debe coincidir exactamente con Payment.appointment
-> monto/status Transbank válido
-> transición aprobada o rechazada
```

Un `Payment` de Business B no puede transicionar una Appointment de A y esa incoherencia local falla **antes** de invocar `commit` al proveedor. Un `buy_order` distinto al Appointment fijado por el Payment pending sólo puede detectarse después del `commit`, pero falla sin transición local.

El gate oficial prepara fixtures directamente en estado `Payment pending + Appointment pending_payment`; no reabre `/payments/initiate` para fabricar fixtures.

## 7. C2 preservado

El flujo aprobado sigue siendo:

```text
challenge durable
-> trusted email delivery
-> exact Verification consume
-> Business + Appointment + READ capability
-> single-use READ
```

C2 usa `Appointment.guestContact` como provenance. No usa `Appointment.client` como fallback de identidad.

READ no concede CANCEL, RESCHEDULE ni PAYMENT.

## 8. Errores públicos

Los códigos son contrato estable; el mensaje humano puede refinarse.

| HTTP | Código | Semántica |
|---|---|---|
| 400 | `VALIDATION_ERROR` | input/tenant ausente, malformado, contradictorio, campo público no permitido o fecha imposible |
| 401 | `UNAUTHORIZED_ERROR` | endpoint/surface interna requiere autenticación |
| 403 | `FORBIDDEN_ERROR` | sesión sin política necesaria o acción pública deliberadamente no habilitada |
| 404 | `NOT_FOUND` | tenant/recurso públicamente no disponible en el scope solicitado |
| 409 | `CONFLICT_ERROR` | conflicto operacional, por ejemplo slot ocupado |
| 409 | `DOUBLE_BOOKING_ERROR` | colisión física de reserva activa |
| 429 | `RATE_LIMITED` | budget HTTP agotado |
| 500 | `INTERNAL_SERVER_ERROR` | error no operacional sin detalles de driver |

Las diferencias de error no deben convertirse en oráculos para descubrir:

- Appointment ajena;
- CustomerProfile;
- relación User↔Appointment;
- email persistido;
- Verification interna;
- existencia de otro tenant.

No se devuelven errores Mongoose/driver como mensajes públicos.

## 9. Campos sensibles excluidos de la superficie pública

Como mínimo:

- password/reset tokens;
- capability/challenge bearer raw y hashes reutilizables;
- email/teléfono de profesionales;
- `User.role` / `User.business` legacy;
- Memberships;
- `Appointment.client`;
- `Appointment.guestContact`;
- CustomerProfile/bindings;
- Verification/Delivery/Job internos;
- AuditLog/timeline;
- payment provider payloads;
- URI con credenciales;
- configuración interna no requerida para booking.

La proyección operacional interna descrita en 4.5 no modifica esta exclusión pública.

## 10. Idempotencia de Appointment

No existe `Idempotency-Key` en 6.2.6-A.

Sí existe la barrera física:

```text
unique { business, worker, date, startTime }
partial status in pending_payment|pending|confirmed|completed
```

Por tanto, un retry/race no puede crear dos Appointments activas equivalentes.

Si el primer POST persistió pero la respuesta se perdió por timeout, un retry puede recibir `409`; el consumidor aún no puede recuperar automáticamente el `201` original. Esto es una deuda explícita y no se confunde con idempotencia de pagos.

## 11. Rate limiting

Todas las rutas `/api` conservan el limiter global:

- 15 minutos;
- 200 requests por IP;
- `429 RATE_LIMITED`.

Rate limiting no es autorización. Quitar accidentalmente un limiter no debe volver accesible un recurso cross-tenant.

C2 conserva además sus guards/budgets purpose-specific vigentes; 6.2.6-A no los elimina ni relaja.

## 12. Holiday: semántica global deliberada

El modelo `Holiday` vigente:

- no tiene `business`;
- tiene `date` única global;
- se consulta por fecha sin tenant.

6.2.6-A **no inventa una tenantización ni migración** para Holiday. Se mantiene como decisión explícita de producto/modelo: un **calendario global compartido de cierre**, donde un Holiday aplica deliberadamente por igual a todos los Businesses.

Esto **no** es una garantía de aislamiento tenant de Holiday. Es precisamente una excepción global conocida. No concede autoridad ni permite leer recursos de otro tenant. Shift, Block y Appointment continúan tenant-scoped.

Existe una regresión contractual que crea un Holiday global y demuestra que el mismo día cierra disponibilidad de dos Businesses independientes.

Si el producto futuro requiere feriados o cierres diferentes por negocio, deberá existir una fase específica de cambio de modelo/migración; hasta entonces no debe reinterpretarse Holiday como política tenant.

## 13. Versionado

No se crea `/v1` artificialmente.

Compatibles, en principio:

- campos opcionales nuevos sin cambiar semántica existente;
- input opcional con default preservado;
- endpoint nuevo independiente.

Breaking:

- eliminar/renombrar campo estable;
- cambiar tipo o significado;
- hacer obligatorio lo antes opcional;
- cambiar HTTP/código estable para el mismo caso;
- relajar tenant explícito;
- convertir un identificador en authority;
- ampliar una capability a otra acción.

Un breaking change requiere versión/migración explícita antes de retirar el contrato previo.

## 14. websiteUrl / bookingUrl y orígenes confiables

### Estado objetivo

ADR-002 define que cada Business podrá tener:

- `websiteUrl` público principal;
- `bookingUrl` para operaciones de booking/reprogramación.

En producción deben ser HTTPS y pertenecer a una configuración confiable/verificada server-side.

### Estado actual

6.2.6-A no dispone todavía de una infraestructura completa de verificación de dominios ni persiste `websiteUrl`/`bookingUrl` con ese lifecycle.

C2 continúa construyendo enlaces sensibles desde `GUEST_APPOINTMENT_ACCESS_ORIGIN`, configuración server-side HTTPS confiable.

Nunca se usa `Host`, `Origin`, `Referer`, query, body o header arbitrario recibido del navegador para decidir a qué dominio enviar un bearer o enlace sensible.

### Pending

La configuración tenant-scoped de website/booking origins y su verificación real permanece trabajo posterior. Por esta razón no se declara cerrada la totalidad de 6.2.6.

## 15. Criterios de aceptación verificables

La suite contractual/gate debe demostrar como mínimo:

- [x] dos Businesses usan el mismo contrato público;
- [x] Service B no se usa dentro de A;
- [x] worker B no se usa dentro de A;
- [x] disponibilidad A no filtra recursos B;
- [x] booking A no crea Appointment B;
- [x] tenant ausente no selecciona implícitamente otro;
- [x] identificadores contradictorios fallan;
- [x] responses públicas no incluyen campos internos;
- [x] guest booking no requiere login;
- [x] cookie de A + surface pública + tenant B explícito sigue siendo contrato público de B;
- [x] tenant identifiers por sí solos no seleccionan surface;
- [x] `/admin?slug=A` + `apiFetch` interno carga workers sin `serviceId`, Services administrativos, Appointments y Shifts;
- [x] guest booking no crea ni modifica User;
- [x] teléfono conocido + email atacante no modifica a la víctima;
- [x] slot ocupado no deja mutaciones de identidad global;
- [x] guest nuevo no crea password aleatoria;
- [x] admin autorizado ve DTO operacional guest de su Appointment;
- [x] profesional asignado autorizado ve sólo los cuatro datos operacionales necesarios;
- [x] worker no asignado y Business B no adquieren acceso por `guestContact`;
- [x] `guestContact` raw/provenance/capturedAt no se serializan al panel;
- [x] C2 READ no amplía su proyección;
- [x] `isSuggestion`, `paymentOption` y controles desconocidos públicos fallan con `400 VALIDATION_ERROR`;
- [x] booking público normal sigue revalidando disponibilidad y funcionando;
- [x] Shift raw no es endpoint guest;
- [x] fecha imposible como `2026-02-31` falla;
- [x] Holiday global afecta deliberadamente a dos Businesses;
- [x] Appointment ID no concede detail/cancel;
- [x] Appointment ID no concede payment initiation aun con flag habilitado;
- [x] callback Payment legacy approved/rejected continúa cubierto con fixture pending existente;
- [x] callback Payment legacy valida coherencia Payment/Appointment/Business y `buy_order`;
- [x] C2 READ sigue sin conceder otras acciones.

## 16. Gate oficial

`Server/package.json` conserva como gate de integración, además de las suites históricas, las regresiones específicas de 6.2.6-A:

- `test:panel-surface-compatibility`;
- `test:headless-public-contract`;
- `test:public-booking-input`;
- `test:payment`.

`test:payment` vuelve a incluir:

- `paymentAuthorityBoundary.test.js`;
- los entrypoints opt-in históricos, ahora apoyados en fixtures legacy pending compatibles con el contrato vigente;
- cobertura de callback Webpay approved/rejected y coherencia Business/buy_order.

No se obtiene CI verde retirando la superficie legacy que el runtime declara seguir soportando.

## 17. Riesgos y trabajo pendiente

Persisten fuera de 6.2.6-A:

1. idempotencia request-scoped que pueda reproducir el resultado original tras timeout;
2. `websiteUrl`/`bookingUrl` tenant-scoped con verificación real de dominio;
3. capabilities futuras CANCEL/RESCHEDULE/PAYMENT;
4. decisión futura de producto si Holiday debe dejar de ser global;
5. Client account/login/history, que no forman parte de esta fase;
6. retirada o rediseño purpose-specific definitivo del módulo Payment legacy; 6.2.6-A sólo conserva su callback existente de forma fail-closed.

## 18. No scope creep

Este PR no implementa:

- Client account/login;
- OAuth Client;
- User↔CustomerProfile binding;
- Client history/timeline;
- cancel capability;
- reschedule capability;
- payment capability;
- un nuevo inicio de Webpay;
- CSRF redesign;
- password recovery redesign;
- impersonation;
- responsive 7.8;
- 6.3;
- 6.4.

La finalidad de 6.2.6-A es hacer verdadera y verificable la frontera pública mínima sin romper la superficie administrativa existente, no construir las capacidades futuras.
