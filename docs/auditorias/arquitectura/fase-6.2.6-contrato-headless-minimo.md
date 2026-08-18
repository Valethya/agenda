# Fase 6.2.6-A — Contrato headless público mínimo

**Estado:** contrato implementado en la rama de 6.2.6-A; cierre sujeto a pruebas/CI y revisión adversarial  
**Fecha:** 18 de agosto de 2026  
**Baseline verificada:** `master@3f2ab734d412828f5a77ec72b778a8d575a14cd4`  
**Precedente:** PR #29 / 6.2.5-C2 merged en esa baseline  
**Ámbito:** contrato público mínimo para discovery de booking y creación de Appointment guest

Este documento formaliza la frontera headless que una web pública puede consumir sin convertir su diseño, navegación o estructura de formularios en lógica de dominio. No inicia 6.3 y no implementa nuevas capabilities de cancelación, reprogramación ni pago.

## 1. Objetivo

Una web pública debe poder:

1. consultar servicios públicos de un Business explícito;
2. consultar profesionales elegibles para un Service de ese Business;
3. consultar disponibilidad de ese profesional y Service;
4. crear una Appointment guest dentro del mismo Business.

Dos webs visualmente incompatibles entre sí deben poder ejecutar esas cuatro operaciones mediante el mismo dominio. El backend no conoce ni decide cantidad de pasos, nombres de páginas, componentes Astro/React, modales, orden de preguntas, marca, rubro ni composición visual.

## 2. Autoridad y fronteras que no se reabren

Continúan vigentes ADR-001, ADR-002, APT-CLIENT-01 y 6.2.5-C2:

- `Membership` activa es la autoridad tenant ordinaria de admin/worker;
- `User.role`, `User.business` y `Business.owner` no conceden autoridad tenant;
- `Appointment.business` expresa ownership tenant del recurso;
- `Appointment.client` es una relación operacional/legacy y no concede Client authority;
- email/teléfono/contact matching no concede ownership, historial, binding ni authority;
- booking guest no requiere login, Client account ni Membership;
- una capability C2 READ autoriza sólo `Business X + Appointment X + read`.

Regla explícita:

```text
READ capability
!= CANCEL capability
!= RESCHEDULE capability
!= PAYMENT authority
```

6.2.6-A no implementa las tres capacidades futuras.

## 3. Identificación de tenant

Las operaciones públicas dependen de un Business explícito. El middleware actual acepta, para requests sin contexto tenant de sesión:

- `businessId` como ObjectId; o
- `slug` del Business.

El identificador puede llegar por las superficies legacy ya soportadas por `scopeBusiness` (query/body o `x-business-id` / `x-business-slug`). El contrato recomendado para consumidores headless es enviar **un único identificador tenant explícito por request**, preferentemente `businessId` o `slug` de forma consistente.

Reglas:

- ausencia de ambos identificadores: `400 VALIDATION_ERROR`;
- `businessId` malformado: `400 VALIDATION_ERROR`;
- identificadores repetidos con valores contradictorios: `400 VALIDATION_ERROR`;
- `businessId` y `slug` que pertenecen a Businesses distintos: `400 VALIDATION_ERROR`;
- Business inexistente o inactivo en flujo público: `404 NOT_FOUND` con mensaje genérico de negocio no disponible;
- no existe fallback al primer Business;
- un ID válido de otro Business nunca cambia el tenant seleccionado;
- una sesión administrativa y su Business activo pertenecen al contrato interno autenticado, no constituyen el contrato guest headless descrito aquí.

## 4. Operaciones incluidas

### 4.1 Servicios públicos

#### `GET /api/services`

Tenant: obligatorio.

Input estable mínimo:

- `businessId` o `slug` explícito.

Output público por Service:

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

Sólo se listan Services activos del Business. `business` se conserva como eco de tenant explícito y compatibilidad del contrato actual; no es authority presentada por el cliente.

Nunca se exponen mediante esta proyección pública:

- `workers`;
- `isActive`;
- timestamps;
- campos internos de persistencia distintos del identificador público necesario.

#### `GET /api/services/:id`

Mismas reglas tenant y misma proyección pública. Un Service inexistente, inactivo o perteneciente a otro Business se trata como recurso no disponible dentro del tenant seleccionado; nunca se resuelve por fallback.

### 4.2 Profesionales públicos

#### `GET /api/users/workers?serviceId=:serviceId`

Tenant: obligatorio.  
`serviceId`: ObjectId obligatorio para lectura pública.

El Service debe:

- existir dentro del Business seleccionado;
- estar activo;
- incluir al profesional en `Service.workers`.

Cada profesional retornado debe además:

- tener `User` activo;
- tener Membership activa del mismo Business;
- poseer un rol tenant participante vigente compatible (`admin|worker`);
- ser elegible por la allowlist concreta del Service.

La autoridad no se obtiene de `User.role` ni `User.business`.

Output público por profesional:

```json
{
  "id": "ObjectId",
  "firstName": "string",
  "lastName": "string"
}
```

No se exponen email, teléfono, role global/legacy, business legacy, estado interno, Membership, timestamps ni credenciales.

Un `serviceId` de Business B presentado dentro de A no enumera profesionales de B y responde como recurso no disponible.

### 4.3 Disponibilidad

#### `GET /api/availability/slots`

Tenant: obligatorio.

Input:

- `workerId`: ObjectId obligatorio;
- `serviceId`: ObjectId obligatorio;
- `date`: `YYYY-MM-DD` obligatorio.

Coherencia requerida:

- Service activo pertenece al Business;
- profesional tiene participación tenant vigente;
- profesional está incluido en `Service.workers`;
- Shift consultado pertenece al mismo Business + worker;
- Block consultado pertenece al mismo Business + worker;
- Appointments que ocupan slots se consultan por Business + worker + date.

Output:

```json
{
  "startTime": "09:00",
  "endTime": "10:00",
  "available": true
}
```

Una Appointment de otro Business no ocupa ni libera slots en el Business consultado. Worker o Service de otro tenant fallan cerrado.

Los endpoints administrativos de Shift/Block no forman parte del contrato público headless mínimo aunque existan rutas legacy separadas.

### 4.4 Crear Appointment guest

#### `POST /api/appointments`

Tenant: obligatorio y explícito para el flujo guest.

Input estable mínimo de booking:

```json
{
  "worker": "ObjectId",
  "service": "ObjectId",
  "date": "YYYY-MM-DD",
  "startTime": "HH:MM",
  "notes": "opcional, máximo 500 caracteres",
  "clientInfo": {
    "firstName": "string",
    "lastName": "string",
    "email": "email",
    "phone": "string"
  }
}
```

El runtime legacy continúa aceptando `paymentOption` e `isSuggestion`; 6.2.6-A no rediseña pagos ni el flujo de sugerencias. Esos campos no se convierten por este documento en payment authority ni en una capability y no deben usarse para seleccionar tenant.

Reglas:

1. se valida Service activo dentro del Business antes de correlacionar/crear el registro guest;
2. worker debe ser elegible para ese Service y Business;
3. la disponibilidad se revalida antes de persistir una reserva normal;
4. el guest puede reservar sin login;
5. cuando se aporta `clientInfo`, se captura `Appointment.guestContact` desde el input de booking antes de cualquier matching legacy de User;
6. `guestContact` es provenance operacional Appointment-scoped, no identidad;
7. matching por email/teléfono no concede authority;
8. `Appointment.client` no concede ownership, historial ni acciones;
9. no se crea Membership, CustomerProfile ownership, Client session ni binding.

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

La respuesta pública no incluye `client`, `guestContact`, notes, `paymentStatus`, CustomerProfile, Verification, Membership ni timestamps internos.

## 5. Operaciones expresamente excluidas

Conocer `businessId` + `appointmentId`, incluso si ambos son válidos, **no** concede:

- detalle sensible de Appointment;
- listado/history de cliente;
- timeline;
- cancelación;
- reprogramación;
- confirmación;
- inicio de pago;
- CustomerProfile ownership;
- User binding;
- Membership;
- Client session.

Las rutas internas actuales de detalle/confirm/complete/cancel continúan requiriendo autenticación/política tenant. Un Appointment ID no es una credencial.

## 6. C2 y capabilities futuras

6.2.5-C2 permanece intacta.

Flujo READ vigente:

```text
challenge durable
-> trusted email delivery
-> exact Verification consume
-> Business + Appointment + READ capability
-> single-use read
```

La proyección C2 READ es distinta del output de creación y no amplía authority. No existe conversión de READ en CANCEL, RESCHEDULE o PAYMENT.

Cualquier futura acción pública mutable deberá tener un purpose/action propio, endpoint propio, reglas de expiración/replay propias y pruebas de scope exacto. Implementarlo queda fuera de 6.2.6-A.

## 7. Errores públicos estables

Los **códigos** forman parte del contrato; los mensajes humanos pueden refinarse sin usarse como lógica de autorización del consumidor.

| HTTP | Código | Semántica pública |
|---|---|---|
| 400 | `VALIDATION_ERROR` | input/tenant ausente, malformado o contradictorio |
| 401 | `UNAUTHORIZED_ERROR` | una ruta fuera del contrato público exige autenticación/authority |
| 404 | `NOT_FOUND` | tenant o recurso públicamente no disponible dentro del scope solicitado |
| 409 | `CONFLICT_ERROR` | conflicto operacional, por ejemplo slot dejó de estar disponible |
| 409 | `DOUBLE_BOOKING_ERROR` | colisión física de reserva activa en el mismo Business/worker/date/startTime |
| 429 | `RATE_LIMITED` | límite global HTTP agotado |
| 500 | `INTERNAL_SERVER_ERROR` | error no operacional en producción, sin driver/Mongoose details |

C2 conserva sus códigos purpose-specific (`GUEST_APPOINTMENT_*`) y su contrato externo uniforme donde corresponde.

No deben existir variantes que revelen si:

- una Appointment ajena existe;
- existe CustomerProfile;
- existe relación User↔Appointment;
- un email está persistido;
- una Verification concreta existe internamente;
- un recurso pertenece a otro tenant.

## 8. Campos sensibles que jamás son parte del contrato público base

Como mínimo:

- passwords y reset tokens;
- bearer/capability/challenge raw y hashes reutilizables;
- email/teléfono de Users profesionales;
- `User.role` / `User.business` legacy;
- Memberships;
- `Appointment.client`;
- `Appointment.guestContact`;
- CustomerProfile y bindings;
- Verification/Delivery/Job internos;
- AuditLog/timeline;
- notes de Appointment en respuestas de creación;
- payloads de proveedor de correo/pago;
- errores de driver/Mongoose;
- URI con credenciales;
- configuración interna de negocio no necesaria para booking.

## 9. Idempotencia de creación

### Estado actual

No existe `Idempotency-Key` para `POST /api/appointments`.

Sí existe una barrera física tenant-scoped para reservas activas:

```text
unique { business, worker, date, startTime }
partial status in pending_payment|pending|confirmed|completed
```

Esto impide que un retry/race cree dos Appointments activas para el mismo Business + worker + date + startTime.

### Semántica ante timeout

Si el servidor alcanza a persistir la cita pero el consumidor no recibe la respuesta, el consumidor no puede saber sólo a partir del timeout si la operación fue confirmada. Reintentar la misma reserva puede recibir `409` porque el slot ya está ocupado. Ese `409` no equivale a una respuesta idempotente que reproduzca el `201` original.

### Decisión MVP

6.2.6-A **no** introduce una plataforma genérica de idempotency keys. La unicidad física existente es suficiente para evitar el duplicado activo más previsible, pero el estado post-timeout continúa siendo un riesgo residual explícito.

Antes de abrir integraciones de terceros o flujos que necesiten retry automático transparente deberá diseñarse una idempotencia request-scoped acotada a booking, con tenant y payload canónico. No debe mezclarse con la idempotencia futura de pagos.

## 10. Rate limiting

### Contrato base

Toda ruta bajo `/api` conserva el limiter global actual:

- ventana: 15 minutos;
- máximo: 200 requests por IP;
- `429 RATE_LIMITED` al superar el límite.

No se utiliza rate limiting como autorización. Si un limiter desapareciera accidentalmente, un recurso cross-tenant debe seguir siendo inaccesible por los filtros de ownership/tenant.

### C2 preservado

C2 mantiene además budgets independientes por IP/15 min:

- challenge READ: 5;
- verify/exchange: 10;
- consume READ: 20.

También conserva el guard durable anti-amplificación de scopes nuevos: ventana 60 s, máximo 240 scopes nuevos distintos y retención corta de bucket. Ninguna guarda C2 se elimina o relaja en esta fase.

Tighter limits específicos para discovery/booking sólo se añadirán con evidencia de abuso o capacidad operacional que lo justifique.

## 11. Versionado y compatibilidad

No se crea `/v1` artificialmente en 6.2.6-A. La versión contractual inicial queda identificada por esta especificación y sus pruebas.

Se consideran **compatibles**, salvo evidencia contraria:

- añadir un campo de respuesta opcional cuando consumidores estén obligados a ignorar campos desconocidos;
- añadir un input opcional con semántica por defecto preservada;
- añadir un nuevo endpoint sin cambiar los existentes;
- ampliar valores sólo cuando el consumidor no dependa de un enum cerrado.

Se consideran **breaking**:

- eliminar o renombrar un campo existente del contrato estable;
- convertir un campo opcional en obligatorio;
- cambiar tipo o significado semántico;
- cambiar un HTTP status o código de error estable para el mismo caso;
- reinterpretar un identificador como authority;
- ampliar una capability a otra acción;
- dejar de requerir tenant explícito o cambiar la frontera de tenant.

Un cambio breaking deberá usar una versión nueva o una ventana de migración explícita antes de retirar el contrato anterior. Los mensajes humanos no son API estable; los códigos sí.

## 12. websiteUrl / bookingUrl y dominios confiables

### Estado objetivo aprobado por ADR-002

Cada Business podrá disponer de:

- `websiteUrl`: origen público principal;
- `bookingUrl`: destino del flujo de booking/reprogramación.

En producción deberán ser HTTPS y pertenecer a dominios previamente verificados. Los enlaces sensibles se construirán sólo desde configuración confiable persistida; jamás desde `Host`, `Origin`, query, body o headers suministrados por el navegador.

### Estado runtime verificado en esta baseline

`BusinessConfig` todavía **no** posee campos persistidos `websiteUrl`/`bookingUrl` ni existe en esta fase una infraestructura completa de verificación de dominios.

C2 ya protege su enlace sensible READ mediante una configuración server-side separada:

- `GUEST_APPOINTMENT_ACCESS_ORIGIN`;
- exige un origin HTTPS puro, sin username/password, query, fragment ni path arbitrario;
- el worker construye el link desde esa configuración, no desde la request;
- el bearer viaja en fragment antes del canje.

### Decisión de 6.2.6-A

No se inventa un registry/verificador de dominios ni se añaden `websiteUrl`/`bookingUrl` sin la infraestructura que permita demostrar confianza.

Pendiente antes de depender de URLs por Business para bearers operativos:

1. persistencia tenant-scoped de website/booking URL;
2. política de validación HTTPS por entorno;
3. mecanismo verificable de ownership/allowlist del dominio;
4. reglas de rotación/revocación y cambio de dominio;
5. integración de construcción de enlaces sin aceptar destinos browser-controlled.

Mientras eso no exista, C2 continúa usando exclusivamente su trusted server-side origin. Esta deuda impide declarar que el objetivo completo de URLs por Business de 6.2.6 esté cerrado.

## 13. Criterios de aceptación de 6.2.6-A

La implementación/pruebas deben demostrar al menos:

1. dos Businesses consumen la misma forma contractual;
2. Service de B no funciona dentro de A;
3. worker de B no funciona dentro de A;
4. disponibilidad A no filtra recursos de B;
5. booking A no crea Appointment B;
6. tenant ausente no selecciona otro;
7. identificadores contradictorios fallan;
8. responses públicas usan allowlists y no incluyen campos internos;
9. guest booking no requiere login;
10. `guestContact` se conserva internamente sin convertir matching/`Appointment.client` en authority;
11. Appointment ID solo no concede detalle ni acciones;
12. suites C2 existentes siguen demostrando que READ no concede otras acciones.

## 14. Riesgos y pending work

- El retry de booking después de timeout no reproduce todavía el resultado original; sólo se previene el duplicado activo equivalente por índice físico.
- `websiteUrl`/`bookingUrl` persistidos y domain verification siguen pendientes.
- Las rutas legacy comparten infraestructura pública/interna; la proyección 6.2.6-A se selecciona por ausencia de authority tenant, por lo que futuros endpoints externos versionados deberán preservar explícitamente esa frontera.
- `paymentOption`/`isSuggestion` permanecen como compatibilidad runtime y no deben confundirse con el mínimo estable ni con authority.
- Holiday conserva la deuda cross-tenant ya documentada; no se redefine aquí.
- No se implementan cancel/reschedule/payment capabilities.
- No se implementan Client account, CustomerProfile binding, history, timeline ni 6.3.

## 15. Criterio de cierre

6.2.6-A puede considerarse técnicamente lista para revisión cuando:

- la suite contractual nueva pasa;
- las suites backend/tenant/availability/ownership/C1/C2 continúan verdes;
- frontend policy, Astro check, TypeScript estricto y build continúan verdes;
- npm audit y secret scan cumplen la política del repositorio;
- el PR permanece Draft hasta revisión adversarial.

**Este documento no declara cerrada la totalidad de 6.2.6.** La infraestructura por Business de `websiteUrl`/`bookingUrl` y verificación de dominios permanece pendiente de diseño/implementación posterior y no se inventa en 6.2.6-A.
