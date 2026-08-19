# Fase 6.2.6-A — Contrato headless público mínimo

**Estado:** hardening de la revisión adversarial implementado; pendiente nueva revisión adversarial  
**Fecha:** 19 de agosto de 2026  
**Baseline verificada:** `master@3f2ab734d412828f5a77ec72b778a8d575a14cd4`  
**Precedente:** PR #29 / 6.2.5-C2 merged en esa baseline  
**Ámbito:** discovery público de booking + creación guest de Appointment + fronteras seguras con la superficie autenticada existente

## 1. Objetivo y alcance

6.2.6-A formaliza un contrato headless mínimo para que una web pública pueda:

1. descubrir Services públicos de un Business;
2. descubrir profesionales elegibles para un Service;
3. consultar slots;
4. crear una Appointment guest.

El dominio no depende de una marca, layout, número de pasos, framework ni recorrido visual concreto.

Este PR **no** implementa:

- 6.2.6-B;
- Client accounts/login;
- OAuth Client;
- User↔CustomerProfile binding;
- history/timeline para Client;
- nuevas Appointment capabilities;
- cancel/reschedule capability;
- payment capability;
- un nuevo inicio Webpay;
- el rediseño CSRF general de 6.3;
- tenantización de Holiday.

## 2. Autoridad: invariantes que permanecen vigentes

Continúan vigentes ADR-001, ADR-002, APT-CLIENT-01, C1 y C2:

- la identidad `User` es global;
- `Membership` activa es la autoridad tenant ordinaria;
- `Business.owner` expresa propiedad, no autoridad tenant;
- `User.role` y `User.business` legacy no sustituyen Membership;
- seleccionar Business sólo establece contexto;
- `Appointment.business` expresa pertenencia tenant del recurso;
- `Appointment.client` es una relación operacional opcional, no ownership;
- para guest, `Appointment.client = null`;
- `Appointment.guestContact` es provenance operacional Appointment-scoped y `select:false`;
- email, teléfono, contact matching y CustomerProfile no conceden autoridad;
- una capability C2 READ autoriza exactamente `Business + Appointment + READ`.

Regla contractual:

```text
READ capability
!= CANCEL capability
!= RESCHEDULE capability
!= PAYMENT authority
```

Conocer un Appointment ID tampoco concede detalle, cancelación, reprogramación ni pago.

## 3. Public e internal son superficies fijadas por el servidor

El caller no selecciona la surface.

`businessId`, `slug`, `x-business-id` y `x-business-slug` pueden seleccionar tenant en una operación pública compatible, pero **no** convierten la request en interna.

`x-agenda-surface` no es una frontera de confianza:

- una ruta pública sigue siendo pública aunque reciba `x-agenda-surface: internal`;
- una cookie administrativa ambiente no eleva una ruta pública;
- una ruta interna no se habilita por enviar ese header;
- el frontend del panel no depende de ese header.

### 3.1 Paths públicos headless

```text
GET  /api/services
GET  /api/services/:id
GET  /api/users/workers
GET  /api/availability/slots
POST /api/appointments
```

### 3.2 Mounts internos separados

Las operaciones que necesitan representación o controles administrativos usan routing controlado por servidor, incluyendo:

```text
GET  /api/internal/services
GET  /api/internal/services/:id
GET  /api/internal/users/workers
POST /api/internal/appointments
```

Además permanecen internas las rutas administrativas existentes de Appointment, Shift/Block, mutación de Service, Workers y Business Settings.

`GET /api/availability/shifts/:workerId` continúa siendo estado operativo interno. La superficie guest consume `/api/availability/slots`, no Shift raw.

## 4. Public headless origin y trusted authenticated/panel origin son conceptos distintos

### 4.1 CORS no concede sesión ni autoridad

`CORS_ORIGINS` puede incluir origins de consumidores headless públicos.

Eso **no** significa que esos origins sean first-party ni que puedan reutilizar una cookie Agenda ambiente.

La aplicación distingue:

```text
public/headless origin permitido por CORS
!= trusted authenticated/panel origin
```

`FRONTEND_URL` define el origin confiable del panel para requests autenticadas de navegador.

En la política CORS:

- un origin público permitido puede recibir `Access-Control-Allow-Origin`;
- sólo el origin exacto de `FRONTEND_URL` recibe `Access-Control-Allow-Credentials: true`;
- permitir un origin en `CORS_ORIGINS` no le concede uso credentialed de la sesión del panel.

Las operaciones headless públicas no requieren cookies de sesión.

### 4.2 Frontera independiente para surfaces que consumen sesión

La protección no vive únicamente dentro de `scopeBusiness`.

Existe una frontera compartida de trusted authenticated origin para rutas que consumen o modifican una sesión aunque no sean tenant-scoped.

Cuando una request autenticada de navegador contiene `Origin`, debe coincidir con `FRONTEND_URL`.

La política cubre, entre otras:

```text
POST /api/login
POST /api/select-membership
POST /api/switch-business
POST /api/stop-impersonating
POST /api/google
POST /api/logout
GET  /api/me
POST /api/change-password
```

y todo `/api/superadmin/*`, incluyendo:

```text
GET   /api/superadmin/businesses
GET   /api/superadmin/metrics
GET   /api/superadmin/analytics
POST  /api/superadmin/businesses
PATCH /api/superadmin/businesses/:id/status
POST  /api/superadmin/businesses/:id/impersonate
```

Consecuencias verificadas:

- `public origin + admin cookie` no obtiene `/api/me`;
- no puede cambiar el Business de la sesión;
- no puede ejecutar logout contra la sesión administrativa;
- `public origin + superadmin cookie` no obtiene businesses, metrics ni analytics;
- tampoco puede crear Business, cambiar su estado ni iniciar impersonation;
- el origin del panel conserva los flujos legítimos.

Las assertions comprueban también ausencia de side effects persistentes y de sesión.

### 4.3 Esto no pretende cerrar todavía todo CSRF

Una request sin `Origin` sigue siendo compatible con same-origin/non-browser/server tooling y continúa necesitando la autenticación/autoridad correspondiente.

Esta es una frontera específica de 6.2.6-A para impedir que un origin headless permitido se transforme en origin administrativo. No sustituye el diseño CSRF general pendiente de una fase posterior.

## 5. Toda operación tenant-interna revalida autoridad vigente

La sesión no congela autoridad tenant.

Cada request tenant-interna vuelve a resolver desde persistencia:

```text
session user id
-> User vigente y activo
-> Business seleccionado existente y activo
-> Membership(User, Business) existente y activa
-> Membership.role vigente en {admin, worker}
-> tenantAuthority válido
```

Por ello:

- revocar Membership corta inmediatamente la surface interna;
- desactivar User corta la surface interna;
- desactivar Business corta la surface interna;
- un role Membership inválido falla cerrado;
- `User.role`, `User.business`, `Business.owner` y roles copiados en sesión no recuperan authority;
- un identificador tenant enviado por el caller no mueve silenciosamente una operación interna a otro Business.

El privilegio global `superadmin` continúa siendo una autoridad de plataforma separada y no un role de Membership.

## 6. Contrato público de discovery

### 6.1 Services

`GET /api/services` y `GET /api/services/:id` requieren tenant público explícito y sólo exponen Services activos/coherentes del Business.

Proyección pública mínima:

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

No se exponen `workers`, timestamps ni metadata administrativa.

### 6.2 Profesionales

`GET /api/users/workers?serviceId=:serviceId` exige tenant + Service explícitos.

El profesional retornado debe:

- pertenecer a la allowlist `Service.workers`;
- tener User activo;
- tener Membership activa del mismo Business;
- tener role tenant participante vigente.

Proyección pública:

```json
{
  "id": "ObjectId",
  "firstName": "string",
  "lastName": "string"
}
```

No se exponen email, phone, role, Membership ni metadata interna.

La inelegibilidad esperada se omite; errores de DB/repositorio/infraestructura se propagan y no se convierten silenciosamente en arrays parciales exitosos.

### 6.3 Slots

`GET /api/availability/slots` recibe Business, worker, Service y fecha Gregoriana real.

Comprueba coherencia tenant de Service/profesional, Shift/Block tenant-scoped y Appointments ocupantes del mismo Business + worker + date.

Holiday continúa deliberadamente global: la misma fecha global afecta a todos los Businesses. Esto se documenta como decisión de producto/modelo actual, **no** como garantía de aislamiento tenant.

## 7. Crear Appointment guest

`POST /api/appointments` es siempre público/headless.

El schema público es `strict`; el controller consume el body validado/transformado, no controles raw del caller.

Input contractual:

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

No acepta públicamente:

- `isSuggestion`;
- `paymentOption`;
- overrides administrativos;
- campos desconocidos.

`clientInfo` se valida antes de Mongoose: trim, no-whitespace-only, límites de longitud, email válido y phone E.164-like.

### 7.1 Identidad guest

El flujo guest:

- no busca User por email ni teléfono;
- no correlaciona contacto declarado con identidad global;
- no crea User;
- no crea password aleatoria;
- no muta un User existente;
- persiste `Appointment.client = null`;
- persiste contacto sólo en `Appointment.guestContact` Appointment-scoped/select:false;
- no convierte guestContact, CustomerProfile o coincidencia de contacto en authority.

Las notificaciones guest usan el snapshot de `guestContact` de esa Appointment.

## 8. DTO operacional interno del guest

Sólo después de superar autoridad tenant y autorización del recurso, una lectura interna puede seleccionar `guestContact` y transformarlo a un DTO operacional mínimo:

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

Nunca se serializa `guestContact` raw, provenance, capturedAt o channel.

Un worker no asignado o un Business distinto no adquieren acceso por conocer ese contacto.

La respuesta pública de booking y la proyección C2 READ no se amplían por este DTO.

## 9. Exclusión de intervalos: garantía de integridad, no sólo validación UX

La lectura inicial de disponibilidad no es la garantía final frente a TOCTOU.

Toda creación runtime que usa `appointmentRepository.create()` pasa por una serialización persistente basada en una fila `AppointmentBookingMutex` con clave determinística:

```text
Business + worker + YYYY-MM-DD
```

Dentro de una MongoDB transaction:

1. se realiza un write sobre esa fila para serializar writers del mismo worker/día;
2. se consulta overlap activo;
3. sólo si no existe overlap se inserta la Appointment.

La condición de overlap es por intervalo real:

```text
existing.startTime < new.endTime
&& existing.endTime > new.startTime
```

Estados que ocupan intervalo:

```text
pending_payment
pending
confirmed
completed
```

`cancelled` no ocupa disponibilidad.

La fila mutex no es una lease ni tiene TTL: puede persistir sin bloquear nada. La exclusión existe únicamente mientras una transacción escribe sobre ella.

El índice histórico de exact-start se conserva como defensa adicional; no es la garantía principal.

### 9.1 Concurrencia real verificada

La suite ejecuta con concurrencia real (`Promise.all`) y comprueba:

- `09:00-11:00` vs `10:00-12:00`: un único ganador;
- Service 120 min `09:00-11:00` vs Service 60 min `10:00-11:00`: un único ganador;
- el perdedor obtiene `409 CONFLICT_ERROR` estable;
- `09:00-10:00` y `10:00-11:00` adyacentes pueden coexistir;
- Businesses distintos no comparten exclusión;
- workers distintos no comparten exclusión;
- cancelar libera el intervalo para rebooking posterior.

En las carreras de overlap, ambas requests alcanzan la lectura inicial de disponibilidad antes de que la garantía transaccional deje exactamente una Appointment activa.

## 10. La exclusión también cubre activaciones/reactivaciones

La invariante no termina en INSERT.

Cualquier transición legacy que pueda introducir o reintroducir una Appointment en el conjunto de estados ocupantes debe respetar estado vigente + serialización + overlap.

### 10.1 Callback Webpay legacy

El callback se conserva sólo para Payments legacy ya existentes.

Antes de llamar al proveedor:

1. `token_ws` debe resolver un Payment `pending` existente;
2. Payment debe estar ligado a Appointment y Business coherentes;
3. Appointment debe existir y estar inicialmente `pending_payment`;
4. Business y Service deben ser coherentes;
5. cross-Business falla antes del commit externo.

Después del proveedor:

- `buy_order` debe coincidir con la Appointment del Payment;
- el monto debe coincidir con depósito o total configurado;
- si Webpay retorna AUTHORIZED, ese hecho externo **no concede authority para reactivar la Appointment**.

El settlement autorizado entra al mismo mutex `Business + worker + date` y, dentro de una transacción:

1. vuelve a leer la Appointment;
2. exige que continúe `pending_payment` para poder activarla;
3. revalida overlap activo excluyendo la propia Appointment;
4. usa compare-and-set `pending_payment -> confirmed`;
5. liquida Payment y Appointment de forma atómica cuando la activación sigue siendo válida.

### 10.2 Pago autorizado después de cancelación

Carrera cubierta explícitamente:

```text
A pending_payment 09:00-11:00
-> callback realiza validación local
-> commit Webpay queda esperando
-> admin cancela A
-> guest reserva B 10:00-12:00
-> B queda activa
-> Webpay retorna AUTHORIZED
```

Resultado obligatorio y verificado:

- A permanece `cancelled`;
- A nunca vuelve a `confirmed` ni a otro estado ocupante;
- B permanece activa;
- nunca existen dos Appointments activas solapadas;
- Payment registra el hecho externo como `approved`;
- `authorizedAt` registra el settlement externo;
- `reconciliationStatus = required`;
- `reconciliationReason = appointment_state_changed`;
- el callback retorna un resultado explícito `payment_authorized_reconciliation_required` en lugar de fingir éxito de la Appointment.

Si la Appointment siguiera `pending_payment` pero apareciera un overlap incompatible, la activación también falla cerrada; el Payment queda autorizado con reconciliación requerida (`interval_conflict`) y la Appointment no se introduce como ocupante conflictivo.

Un callback AUTHORIZED normal, sin carrera ni overlap, conserva el contrato legacy: Payment `approved/reconciliationStatus=applied` y Appointment confirmada con paymentStatus correspondiente.

### 10.3 Payment authority sigue cerrada

`POST /api/payments/initiate` permanece fail-closed aun con `ENABLE_PAYMENTS=true`.

Appointment ID no es payment authority.

Este hardening no crea payment capability ni un nuevo flujo de inicio de pago.

Los casos legacy cross-Business y `buy_order` mismatch continúan fallando cerrados.

## 11. Business Settings es internal-only y GET es read-only

`BusinessConfig` no forma parte del contrato headless de 6.2.6-A.

`GET /api/business-settings` exige la frontera interna vigente:

- sesión;
- User y Business activos;
- Membership tenant activa;
- trusted panel origin cuando el navegador envía `Origin`.

Un GET anónimo o desde un public headless origin no llega al controller.

Además GET es ahora semánticamente read-only:

- si existe `BusinessConfig`, se devuelve;
- si no existe, se calculan y devuelven defaults sin persistir un documento;
- leer configuración no ejecuta inicialización incidental.

La materialización de defaults se reserva para un comando explícito que realmente persiste cambios, como `PUT /api/business-settings` autorizado.

## 12. C1 y C2 permanecen sin ampliación

6.2.6-A no cambia la autoridad de C1/C2.

C1 sigue siendo verificación tenant-scoped de control de contacto y no crea User/Membership/CustomerProfile/Appointment authority.

C2 sigue emitiendo únicamente una capability bearer one-shot para:

```text
exactamente un Business
+ exactamente una Appointment
+ exactamente purpose/action READ
```

El bearer raw no se persiste y la entrega confiable sigue ligada al `Appointment.guestContact` capturado, no a User.email.

## 13. Gate de regresión

El gate oficial incluye y mantiene:

- Membership audit/baseline/runtime authority;
- tenant resource isolation;
- CustomerProfile persistence;
- C1 client contact verification;
- C2 capability, hardening, storage y cutover;
- availability migration/lifecycle/tenantization;
- API contract;
- panel compatibility;
- internal surface authority boundary;
- trusted/public authenticated-origin boundary;
- Business Settings boundary/read-only semantics;
- concurrent Appointment interval invariant, incluida duración 120 vs 60;
- headless public contract;
- public booking input boundary;
- integración general;
- Appointment ownership y Service coherence;
- Service update hardening;
- Payment authority + callbacks legacy + cancellation/rebooking race;
- WebSocket tenant isolation;
- frontend policy tests;
- Astro check;
- TypeScript strict;
- frontend production build;
- `npm audit --omit=dev --audit-level=critical` backend/frontend;
- Gitleaks.

No se eliminan tests, no se convierten fallos en skips y no se rebajan assertions para obtener verde.

## 14. Deuda explícita fuera de alcance

Permanece fuera de 6.2.6-A:

- rediseño CSRF general para todos los canales y clientes;
- Client accounts/login;
- OAuth Client;
- binding User↔CustomerProfile;
- Client history/timeline;
- nuevas Appointment capabilities;
- cancel/reschedule/payment capabilities;
- nuevo inicio Webpay;
- workflow operativo posterior para resolver/refund/reconciliar manualmente un Payment externo autorizado que no pudo aplicarse a Appointment;
- idempotency key genérica y rediseño amplio del payment flow;
- domain verification;
- tenantización de Holiday;
- limpieza operativa opcional de filas mutex antiguas;
- 6.2.6-B, 6.3 y 6.4.

## 15. Estado de cierre de este PR

El PR debe permanecer **Draft** hasta una nueva revisión adversarial.

Este documento describe exclusivamente 6.2.6-A y **no declara cerrada toda 6.2.6**.
