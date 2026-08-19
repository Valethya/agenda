# Fase 6.2.6-A — Contrato headless público mínimo

**Estado:** hardening de nueva revisión implementado; pendiente CI final y nueva revisión adversarial  
**Fecha:** 19 de agosto de 2026  
**Baseline verificada:** `master@3f2ab734d412828f5a77ec72b778a8d575a14cd4`  
**Precedente:** PR #29 / 6.2.5-C2 merged en esa baseline  
**Ámbito:** discovery público de booking + creación guest de Appointment + frontera segura con la superficie administrativa existente

## 1. Objetivo

Agenda expone un dominio headless mínimo para que una web pública pueda:

1. listar Services públicos/activos de un Business;
2. listar profesionales realmente elegibles para un Service;
3. consultar slots de disponibilidad;
4. crear una Appointment guest.

El dominio no depende de cantidad de pasos, páginas, modales, componentes Astro/React, orden de preguntas, marca, rubro ni estructura visual. Dos webs distintas deben poder consumir las mismas reglas de dominio.

6.2.6-A no inicia 6.2.6-B ni 6.3 y no implementa Client accounts, OAuth Client, history, nuevas Appointment capabilities, cancel/reschedule capabilities ni payment capability.

## 2. Fronteras de autoridad preservadas

Continúan vigentes ADR-001, ADR-002, APT-CLIENT-01, C1 y C2:

- `Membership` activa es la autoridad tenant ordinaria de admin/worker;
- `User.role`, `User.business` y `Business.owner` no conceden autoridad tenant;
- `Appointment.business` expresa pertenencia tenant del recurso;
- `Appointment.client` es una relación operacional opcional, **no** ownership ni Client authority;
- para guest, `Appointment.client = null`;
- `Appointment.guestContact` es provenance operacional de una única Appointment y permanece `select:false`;
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

No se implementan esas capabilities futuras en este PR.

## 3. Tenant y surface son decisiones independientes

### 3.1 Tenant público explícito

Las operaciones headless requieren un Business explícito mediante:

- `businessId` válido; o
- `slug` válido.

El resolver público acepta los selectores ya compatibles en query/body o `x-business-id` / `x-business-slug`. Se recomienda que un consumidor use una única forma de manera consistente.

Reglas públicas:

- tenant ausente: `400 VALIDATION_ERROR`;
- ObjectId malformado: `400 VALIDATION_ERROR`;
- valores contradictorios para un mismo identificador: `400 VALIDATION_ERROR`;
- `businessId` y `slug` de Businesses distintos: `400 VALIDATION_ERROR`;
- Business inexistente o inactivo: `404 NOT_FOUND` genérico;
- jamás hay fallback al primer Business ni a otro tenant.

### 3.2 La surface la fija el servidor, no el caller

`businessId`, `slug`, `x-business-id` y `x-business-slug` seleccionan tenant en el contrato público cuando corresponda. **No seleccionan surface.**

Del mismo modo, una cookie ambiente no convierte una request pública en interna.

La separación se fija mediante routing/policy del servidor:

#### Paths públicos

```text
GET  /api/services
GET  /api/services/:id
GET  /api/users/workers
GET  /api/availability/slots
POST /api/appointments
GET  /api/business-settings
```

Estos paths permanecen públicos aunque el navegador transporte una cookie administrativa. Sus schemas y proyecciones siguen siendo públicos.

#### Paths internos introducidos para lecturas/creación antes compartidas

```text
GET  /api/internal/services
GET  /api/internal/services/:id
GET  /api/internal/users/workers
POST /api/internal/appointments
```

Las operaciones que ya eran inequívocamente administrativas conservan sus paths existentes, por ejemplo:

```text
GET/PATCH /api/appointments/...
GET/POST/DELETE /api/availability/shifts|blocks/...
POST/PUT/DELETE /api/services/...
POST/DELETE /api/users/workers/...
PUT/GET /api/business-settings (configuración/métricas/analytics protegidas)
```

La decisión de surface deriva de la ruta y método montados por el servidor, no de un dato enviado por el navegador.

### 3.3 `x-agenda-surface` no es una frontera de confianza

`x-agenda-surface: public|internal` deja de formar parte de la política de autoridad.

Reglas:

- una ruta pública no se vuelve interna aunque reciba `x-agenda-surface: internal`;
- una ruta interna no se habilita por recibir ese header;
- `apiFetch()` del panel no emite ese header;
- el alias defensivo histórico del middleware, si algún import residual lo usa, aplica únicamente política pública;
- no debe introducirse lógica futura que trate ese header como prueba de surface o authority.

### 3.4 Cookie A + contrato público B

Una cookie autenticada de Business A que llama el contrato público para Business B:

- resuelve exclusivamente B desde el tenant público explícito;
- nunca devuelve datos internos de A;
- nunca eleva la respuesta a proyección administrativa;
- no adquiere Membership ni autoridad en B por ese hecho.

Una Membership de A tampoco eleva una proyección pública de A: los paths públicos conservan siempre su allowlist pública.

### 3.5 Origen del panel en superficies internas de navegador

Producción utiliza cookies con credenciales y puede permitir más de un origen mediante CORS. Por ello, CORS por sí solo no define qué origen puede usar la superficie administrativa.

Para una request interna que contiene `Origin`, `scopeBusiness` exige que el origen coincida con el origen configurado en `FRONTEND_URL` para el panel.

Consecuencias:

- un origin headless permitido por CORS puede consumir la API pública;
- ese origin no puede reutilizar una cookie administrativa ambiente para entrar a una ruta interna;
- que CORS emita `Access-Control-Allow-Origin` y `Access-Control-Allow-Credentials` para un origin público **no** lo convierte en origen administrativo;
- una request interna sin `Origin` puede seguir existiendo para same-origin/non-browser/server tooling, pero continúa requiriendo sesión y autoridad tenant vigente.

Esta comprobación acota la surface administrativa en 6.2.6-A. **No sustituye el diseño CSRF general pendiente de una fase posterior.**

La configuración operativa debe mantener `FRONTEND_URL` como origen confiable del panel y no reutilizarlo como un origen de terceros no confiable.

## 4. Toda surface interna exige autoridad tenant vigente

La sesión no congela autoridad.

Cada request interna tenant-scoped debe resolver nuevamente desde persistencia:

```text
session user id
-> User vigente y activo
-> Business de sesión existente y activo
-> Membership (User + Business) existente y activa
-> Membership.role vigente en {admin, worker}
-> tenantAuthority no-null
```

Si cualquiera de estas condiciones deja de cumplirse después del login, la request interna falla antes de ejecutar la política del recurso.

En particular:

- Membership revocada/inactiva: `403`;
- User desactivado: `403`;
- Business desactivado: `403`;
- rol Membership no reconocido como autoridad tenant: `403`;
- `User.role` o `User.business` legacy no recuperan autoridad;
- email, phone, `Appointment.client`, `guestContact` o CustomerProfile no recuperan autoridad.

Las rutas internas no continúan con `req.tenantAuthority === null`.

El Business interno proviene del contexto de sesión autorizado. Un `businessId`, slug o header tenant enviado por el caller no puede mover silenciosamente una operación administrativa a otro tenant.

## 5. Operaciones públicas incluidas

### 5.1 Services

#### `GET /api/services`

Tenant explícito obligatorio. Sólo lista Services activos del Business.

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
- metadata administrativa/persistencia interna.

#### `GET /api/services/:id`

Mismas reglas. Un Service de B presentado dentro de A se trata como no disponible.

El panel usa `/api/internal/services[/...]` cuando necesita la representación administrativa.

### 5.2 Profesionales

#### `GET /api/users/workers?serviceId=:serviceId`

Tenant explícito y `serviceId` ObjectId obligatorios.

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

Un profesional individual inelegible/revocado se omite. Sólo la inelegibilidad esperada se absorbe; un error de repositorio, base de datos o infraestructura se propaga y no se degrada silenciosamente a un array parcial con `200`.

El panel usa `/api/internal/users/workers` para su lista operativa autorizada.

### 5.3 Disponibilidad

#### `GET /api/availability/slots`

Input público:

- tenant explícito;
- `workerId` ObjectId;
- `serviceId` ObjectId;
- `date` en `YYYY-MM-DD` y fecha Gregoriana real.

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

Proyección de slot:

```json
{
  "startTime": "09:00",
  "endTime": "10:00",
  "available": true
}
```

#### Shift raw NO es guest

`GET /api/availability/shifts/:workerId` es estado operativo interno y requiere:

- sesión autenticada;
- Business de sesión válido;
- Membership activa vigente;
- rol `admin|worker` compatible;
- origen de panel válido cuando el navegador envía `Origin`.

La superficie pública debe consumir `/availability/slots`, no Shift raw.

### 5.4 Crear Appointment guest

#### `POST /api/appointments`

Este path es siempre público/headless. Una cookie o `x-agenda-surface: internal` no cambia el schema.

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

`businessId`/`slug` se aceptan únicamente como selectores tenant compatibles con el resolver público.

#### Allowlist de input público

El schema público es `strict` y el controller consume exclusivamente el body parseado/transformado. No reutiliza `req.body` raw para controles del service layer.

La superficie pública no acepta:

- `isSuggestion`;
- `paymentOption`;
- overrides administrativos;
- campos desconocidos/control fields no documentados.

Esos campos fallan con `400 VALIDATION_ERROR` antes de llamar `bookAppointment()`.

Consecuencias:

- `isSuggestion=true` no puede saltarse revalidación de disponibilidad;
- no puede crear solapamientos públicos;
- `paymentOption=local` no puede alterar status, pago ni auto-confirmación;
- enviar `x-agenda-surface: internal` no habilita ninguno de esos knobs.

La creación administrativa legacy que realmente requiere esos controles vive en `POST /api/internal/appointments`, bajo la frontera interna completa.

#### Validación de `clientInfo`

Antes de Mongoose:

- `firstName` y `lastName` se trimean;
- whitespace-only falla;
- nombres: máximo 120 caracteres;
- email: máximo 320 caracteres y formato válido;
- dominio del email se normaliza a lowercase conservando el local-part;
- phone se trimea y debe cumplir formato E.164-like `+?[1-9][0-9]{6,14}`;
- campos desconocidos en `clientInfo` fallan cerrado.

Errores de estos inputs producen `400 VALIDATION_ERROR`.

#### Reglas de identidad y persistencia

1. Service y worker se validan dentro del Business;
2. `date` debe ser una fecha Gregoriana real;
3. disponibilidad se revalida antes de crear una reserva pública normal;
4. un guest no necesita login;
5. `clientInfo` se transforma sólo en `Appointment.guestContact` Appointment-scoped/select:false;
6. el flujo guest no busca User por email ni teléfono;
7. no añade datos declarados a un User existente;
8. no crea User ni contraseña aleatoria;
9. `Appointment.client` queda `null`;
10. booking fallido no deja side effects de identidad global;
11. `guestContact`, `Appointment.client`, CustomerProfile o coincidencia de contacto no conceden authority.

Las notificaciones guest utilizan el snapshot persistido en `Appointment.guestContact`; no dependen de correlacionar un User global.

Output público:

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

No incluye `client`, `guestContact`, notes, paymentStatus, CustomerProfile, Verification, Membership ni timestamps internos.

## 6. DTO operacional interno de Appointment guest

Persistencia segura:

```text
Appointment.client = null
Appointment.guestContact = datos declarados Appointment-scoped/select:false
```

Sólo después de superar la frontera tenant y la autorización de Appointment, las lecturas internas pueden seleccionar `guestContact` y transformarlo a:

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

Para una identidad autenticable real, el mismo DTO puede usar `kind: "account"` y su `_id`.

Es representación operacional, no ownership.

Nunca se serializan en ese DTO:

- `guestContact` raw;
- `provenance`;
- `capturedAt`;
- `channel`;
- Verification;
- CustomerProfile;
- bindings;
- Membership;
- otros Appointments del contacto.

Admin del Business y profesional realmente autorizado/asignado pueden recibirlo. Worker no asignado y otro Business no adquieren acceso por conocer el contacto.

C2 conserva consulta/proyección independiente y no recibe este DTO ampliado.

## 7. Operaciones fuera del contrato base

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

Las acciones administrativas existentes continúan bajo sesión + Membership tenant vigente.

## 8. Payment: inicio fail-closed y callback legacy acotado

6.2.6-A no implementa payment capability.

Aun con `ENABLE_PAYMENTS=true`, `POST /api/payments/initiate` no permite iniciar pago sólo con Business + Appointment ID y falla cerrado con `403 FORBIDDEN_ERROR` hasta que exista una autoridad purpose-specific futura.

### Callback Webpay legacy preservado

`/api/payments/webpay-return` se conserva únicamente para transacciones legacy ya iniciadas.

Orden fail-closed:

```text
token_ws
-> Payment existente status=pending
-> Payment.appointment + Payment.business fijan scope local
-> Appointment existe
-> Appointment.business == Payment.business
-> Appointment.status == pending_payment
-> Business y Service asociados existen
-> commit Transbank
-> buy_order == Payment.appointment
-> monto/status proveedor válido
-> transición aprobada o rechazada
```

Una incoherencia local Payment/Appointment/Business falla antes del `commit` externo. Un `buy_order` incorrecto sólo puede detectarse después del commit del proveedor, pero no produce transición local.

El gate prepara fixtures `Payment pending + Appointment pending_payment`; no reabre `/payments/initiate` para fabricarlos.

## 9. C2 preservado

El flujo aprobado continúa separado:

```text
challenge durable
-> trusted email delivery
-> exact Verification consume
-> Business + Appointment + READ capability
```

La capability C2:

- es bearer purpose/action scoped;
- es single-Appointment y single-Business;
- no equivale a cuenta/sesión/ownership;
- no enumera otros Appointments;
- no concede cancel, reschedule ni payment;
- no obtiene authority de email, phone, `Appointment.client` o `guestContact`.

## 10. Errores públicos

El contrato utiliza errores genéricos/estables y no expone mensajes de driver o detalles de authority:

- `400 VALIDATION_ERROR` — input/tenant contradictorio o inválido;
- `404 NOT_FOUND` — recurso público no disponible dentro del scope;
- `409 CONFLICT_ERROR` — slot/estado incompatible;
- `429 RATE_LIMITED` — rate limit.

Las superficies internas pueden responder `401/403` para sesión/authority ausente o revocada, sin transformar una coincidencia de contacto en oracle de acceso.

## 11. Reintentos e idempotencia mínima

6.2.6-A no añade una plataforma genérica de `Idempotency-Key`.

El índice único físico para Appointments activas por Business + worker + date + startTime evita duplicados activos equivalentes. Un retry después de una creación ya confirmada recibe conflicto en lugar de crear una segunda reserva.

Un timeout posterior al commit puede seguir siendo ambiguo. Resolver replay determinista mediante idempotency key queda para cuando exista una necesidad real de integración/producto; no se simula dentro de esta fase.

## 12. Rate limiting

Se conserva:

- limiter global: 200 requests / 15 minutos / IP;
- respuesta estable `429 RATE_LIMITED`;
- C2 challenge/verify/read y su intake durable mantienen sus guards específicos existentes.

Rate limiting reduce abuso; no concede authority y no sustituye Membership/capability.

## 13. Compatibilidad/versionado

No se introduce `/v1` sin una necesidad de ruptura real.

Cambios compatibles pueden añadir información opcional sin alterar semántica/autorización.

Son breaking, entre otros:

- remover/renombrar campos;
- cambiar tipos;
- exigir inputs nuevos;
- cambiar significado de códigos HTTP/error;
- relajar tenant scope;
- ampliar una capability/authority;
- convertir un path público en proyección interna o viceversa sin migración explícita.

La introducción de `/api/internal/...` en este hardening no versiona el contrato público: preserva los paths públicos existentes y separa la superficie administrativa que antes compartía path.

## 14. websiteUrl / bookingUrl y trusted origins

`BusinessConfig` todavía no persiste `websiteUrl`/`bookingUrl` verificadas y no existe infraestructura completa de domain verification.

No se inventa esa infraestructura en 6.2.6-A.

C2 conserva `GUEST_APPOINTMENT_ACCESS_ORIGIN` HTTPS server-side como trusted origin para enlaces sensibles.

La surface administrativa usa el origen configurado `FRONTEND_URL` como guard específico cuando una request interna de navegador trae `Origin`.

Nunca debe utilizarse un Host/Origin/query/body arbitrario del caller para construir un bearer link o para conferir authority.

## 15. Holiday

Decisión actual de producto/modelo:

- Holiday continúa global;
- una misma fecha aplica a todos los Businesses;
- no se tenantiza dentro de 6.2.6-A.

Esto se documenta como comportamiento global deliberado, **no** como garantía de aislamiento tenant.

Shift, Block y Appointment sí continúan tenant-scoped.

## 16. Matriz mínima de regresión de 6.2.6-A

El gate debe demostrar al menos:

1. dos Businesses consumen las mismas proyecciones públicas;
2. tenant ausente/contradictorio falla cerrado;
3. Service/worker cross-tenant no atraviesa scope;
4. Shift raw no es guest y slots sí;
5. guest booking no crea ni muta User;
6. `Appointment.client = null` y `guestContact` permanece interno;
7. public Appointment input rechaza `isSuggestion`, `paymentOption` y campos desconocidos;
8. cookie A + public B opera sólo sobre B;
9. origin público permitido por CORS + cookie admin + `x-agenda-surface: internal` sigue obteniendo únicamente Services/Workers públicos;
10. ese origin no puede activar schema interno de Appointment;
11. ese origin no puede acceder `/api/internal/...` ni Shift/Appointment administrativos;
12. el panel confiable conserva `workers + services + appointments + shifts`;
13. Membership revocada después del login invalida inmediatamente toda surface interna;
14. User inactivo, Business inactivo o rol Membership inválido también fallan cerrado;
15. DTO guest operacional sólo aparece a admin/profesional autorizado;
16. worker no asignado/Business B no obtiene guest data;
17. C2 READ no amplía su proyección;
18. Appointment ID no concede detail/cancel/payment;
19. Payment initiate continúa fail-closed;
20. callback Webpay legacy conserva approved/rejected y coherencia Payment/Appointment/Business/buy_order;
21. professional discovery propaga infraestructura;
22. fechas Gregorianas imposibles fallan;
23. Holiday global afecta deliberadamente a A y B;
24. WebSocket continúa aislado por Membership/Business;
25. frontend policy falla si `apiFetch` vuelve a emitir `x-agenda-surface` como selector interno.

## 17. Riesgos/deudas explícitamente pendientes

Quedan fuera de esta subfase:

- verificación de dominios website/booking por Business;
- Client account/login;
- OAuth Client;
- User↔CustomerProfile binding;
- Client history/timeline;
- nuevas capabilities cancel/reschedule/payment;
- inicio Webpay futuro con autoridad purpose-specific;
- rediseño CSRF/sesiones general;
- idempotency key genérica;
- tenantización de Holiday;
- 6.2.6-B;
- 6.3;
- 6.4.

La finalidad de 6.2.6-A es hacer verificable la frontera pública mínima **sin permitir que el caller se autodeclare interno y sin conservar lecturas tenant-internas cuando Membership ya no es vigente**, manteniendo las garantías de identidad, C1/C2 y Payment ya endurecidas.
