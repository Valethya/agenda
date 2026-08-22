# Fase 6.2.6-A — Contrato headless público mínimo

**Estado:** revisión adversarial completada; HEAD técnico `e85a00d361d60df349030bc43a274c2433dd4e0a` aprobado; CI #286 `success`; 6.2.6-A técnicamente cerrada; PR #30 Ready y pendiente únicamente de autorización explícita de merge  
**Fecha:** 22 de agosto de 2026  
**Baseline verificada:** `master@3f2ab734d412828f5a77ec72b778a8d575a14cd4`  
**Precedente:** PR #29 / 6.2.5-C2 merged en esa baseline  
**Ámbito:** discovery público de booking + creación guest de Appointment + fronteras seguras con la superficie autenticada y Payment legacy existente

## 1. Objetivo y alcance

6.2.6-A formaliza un contrato headless mínimo para que una web pública pueda:

1. descubrir Services públicos de un Business;
2. descubrir profesionales elegibles para un Service;
3. consultar slots;
4. crear una Appointment guest.

El dominio no depende de una marca, layout, número de pasos, framework ni recorrido visual concreto.

Este PR **no** implementa 6.2.6-B, Client accounts/login, OAuth Client, User↔CustomerProfile binding, Client history/timeline, nuevas Appointment capabilities, cancel/reschedule/payment capability, un nuevo inicio Webpay, el rediseño CSRF general de 6.3 ni tenantización de Holiday.

## 2. Autoridad: invariantes vigentes

Continúan vigentes ADR-001, ADR-002, APT-CLIENT-01, C1 y C2:

- la identidad `User` es global;
- `Membership` activa es la autoridad tenant ordinaria;
- `Business.owner` expresa propiedad, no autoridad tenant;
- `User.role` y `User.business` legacy no sustituyen Membership;
- seleccionar Business sólo establece contexto;
- `Appointment.business` expresa pertenencia tenant del recurso;
- `Appointment.client` es relación operacional opcional, no ownership;
- para guest, `Appointment.client = null`;
- `Appointment.guestContact` es provenance operacional Appointment-scoped y `select:false`;
- email, teléfono, contact matching y CustomerProfile no conceden autoridad;
- una capability C2 READ autoriza exactamente `Business + Appointment + READ`.

```text
READ capability
!= CANCEL capability
!= RESCHEDULE capability
!= PAYMENT authority
```

Conocer un Appointment ID tampoco concede detalle, cancelación, reprogramación ni pago.

## 3. Public e internal son superficies fijadas por el servidor

El caller no selecciona la surface.

`businessId`, `slug`, `x-business-id` y `x-business-slug` pueden seleccionar tenant en una operación pública compatible, pero no convierten la request en interna. `x-agenda-surface` no es una frontera de confianza.

Paths públicos headless:

```text
GET  /api/services
GET  /api/services/:id
GET  /api/users/workers
GET  /api/availability/slots
POST /api/appointments
```

Mounts internos separados incluyen:

```text
GET  /api/internal/services
GET  /api/internal/services/:id
GET  /api/internal/users/workers
POST /api/internal/appointments
```

Las rutas administrativas de Appointment, Shift/Block, mutación de Service, Workers y Business Settings permanecen internas. `GET /api/availability/shifts/:workerId` continúa siendo estado operativo interno; la superficie guest consume `/api/availability/slots`.

## 4. Public headless origin != trusted authenticated/panel origin

`CORS_ORIGINS` puede incluir origins de consumidores headless públicos sin convertirlos en first-party admin origins.

`FRONTEND_URL` define el origin confiable del panel para requests autenticadas de navegador:

- un public origin permitido puede recibir `Access-Control-Allow-Origin`;
- sólo el origin exacto de `FRONTEND_URL` recibe `Access-Control-Allow-Credentials: true`;
- CORS permission no equivale a session/admin authority;
- las operaciones headless públicas no necesitan cookies de sesión.

La frontera de trusted authenticated origin es compartida y no depende únicamente de `scopeBusiness`. Cubre las rutas que consumen o modifican sesión y todo `/api/superadmin/*`.

Está verificado que `public origin + admin cookie` no obtiene `/api/me`, no cambia Business y no destruye la sesión; y que `public origin + superadmin cookie` no obtiene businesses/metrics/analytics ni crea, togglea o impersona Business. El trusted panel origin conserva el comportamiento legítimo.

Una request sin `Origin` continúa siendo compatible con same-origin/non-browser/server tooling y debe superar igualmente autenticación y autoridad. Este hardening no sustituye el rediseño CSRF general futuro.

## 5. Toda operación tenant-interna revalida autoridad vigente

Cada request tenant-interna vuelve a resolver desde persistencia:

```text
session user id
-> User vigente y activo
-> Business seleccionado existente y activo
-> Membership(User, Business) existente y activa
-> Membership.role vigente en {admin, worker}
-> tenantAuthority válido
```

Revocar Membership, desactivar User/Business o introducir un role Membership inválido corta inmediatamente la surface interna. `User.role`, `User.business`, `Business.owner` y roles copiados en sesión no recuperan authority.

El privilegio global `superadmin` sigue siendo autoridad de plataforma separada y no un role de Membership.

## 6. Contrato público de discovery

### 6.1 Services

`GET /api/services` y `GET /api/services/:id` requieren tenant público explícito y sólo exponen Services activos/coherentes del Business. La proyección no incluye `workers`, timestamps ni metadata administrativa.

### 6.2 Profesionales

`GET /api/users/workers?serviceId=:serviceId` exige tenant + Service explícitos. El profesional retornado debe estar en `Service.workers`, tener User activo y Membership activa del mismo Business. La proyección pública contiene únicamente `id`, `firstName` y `lastName`.

La inelegibilidad esperada se omite; errores de DB/repositorio/infraestructura se propagan.

### 6.3 Slots y default canónico

`GET /api/availability/slots` recibe Business, worker, Service y fecha Gregoriana real y comprueba coherencia tenant, Shift/Block tenant-scoped y Appointments ocupantes del mismo Business + worker + date.

`slotDuration` tiene un único default canónico:

```text
DEFAULT_SLOT_DURATION_MINUTES = 60
```

El mismo valor se usa en:

- el schema físico `BusinessConfig.appointmentSettings.slotDuration`;
- los defaults read-only de Business Settings;
- la materialización de un BusinessConfig nuevo;
- Availability cuando todavía no existe BusinessConfig.

Por lo tanto, la existencia física del documento no cambia la cadencia. Está verificado el caso:

```text
Business sin BusinessConfig
-> GET BusinessSettings devuelve slotDuration=60 sin persistir
-> Availability produce grilla de 60 min
-> PUT sólo bufferTime=15 materializa config
-> slotDuration permanece 60
-> Availability conserva exactamente la misma cadencia
```

No existen defaults mágicos divergentes 30/60 para esta decisión.

Holiday continúa deliberadamente global: la misma fecha global afecta a todos los Businesses. Es una decisión de producto/modelo actual, no una garantía de aislamiento tenant.

## 7. Crear Appointment guest

`POST /api/appointments` es siempre público/headless. El schema público es `strict` y el controller consume el body validado/transformado.

No acepta públicamente `isSuggestion`, `paymentOption`, overrides administrativos ni campos desconocidos.

El flujo guest:

- no busca User por email ni teléfono;
- no correlaciona contacto declarado con identidad global;
- no crea ni muta User;
- no crea password aleatoria;
- persiste `Appointment.client = null`;
- persiste contacto sólo en `Appointment.guestContact` Appointment-scoped/select:false;
- no convierte guestContact, CustomerProfile o coincidencia de contacto en authority.

## 8. DTO operacional interno del guest

Sólo después de superar autoridad tenant y autorización del recurso, una lectura interna puede transformar `guestContact` a un DTO mínimo:

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

Nunca se serializa `guestContact` raw, provenance, capturedAt o channel. Un worker no asignado o un Business distinto no adquieren acceso por conocer ese contacto.

## 9. Exclusión transaccional de intervalos

Toda creación runtime que usa `appointmentRepository.create()` se serializa mediante `AppointmentBookingMutex` con clave determinística `Business + worker + YYYY-MM-DD`.

Dentro de MongoDB transaction se escribe el mutex, se consulta overlap activo y sólo si no existe overlap se inserta la Appointment.

La condición real de overlap es:

```text
existing.startTime < new.endTime
&& existing.endTime > new.startTime
```

Estados ocupantes:

```text
pending_payment
pending
confirmed
completed
```

`cancelled` no ocupa disponibilidad.

La suite verifica con concurrencia real:

- 120 vs 120 con overlap: un único ganador;
- 120 vs 60 con overlap: un único ganador;
- el perdedor obtiene `409 CONFLICT_ERROR`;
- intervalos adyacentes coexisten;
- Businesses distintos y workers distintos no comparten exclusión;
- cancelación libera el intervalo para rebooking.

## 10. Payment legacy: snapshot económico y activación segura

El callback Webpay se conserva sólo para Payments legacy ya existentes. `POST /api/payments/initiate` continúa fail-closed incluso con `ENABLE_PAYMENTS=true`; Appointment ID no es payment authority.

### 10.1 El Payment pending es el snapshot autoritativo local

Antes del commit externo, `token_ws` debe resolver exactamente un Payment `pending`. Para una transacción ya creada, ese Payment fija el snapshot local que se valida durante el callback:

```text
Payment.transactionId
Payment.appointment
Payment.business
Payment.amount
Payment.type
```

`Service.price` y `Service.depositAmount` son configuraciones mutables y **no** redefinen retroactivamente una transacción existente.

Consecuencia verificada:

```text
Payment.amount = 5000
Payment.type = deposit
Service.depositAmount al crear transacción = 5000
Service.depositAmount cambia después a 6000
Webpay AUTHORIZED amount = 5000
```

El callback acepta la autorización porque coincide con `Payment.amount=5000`, conserva `Payment.amount=5000` y `Payment.type=deposit`, registra `authorizedAmount=5000`, deja `reconciliationStatus=applied` y confirma la Appointment si sigue siendo activable.

### 10.2 Evidencia esperada y evidencia del gateway se preservan por separado

`Payment.amount` conserva el expected amount del snapshot local. `Payment.authorizedAmount` registra separadamente el monto que Webpay reportó como autorizado.

El settlement no sobrescribe `Payment.amount` ni `Payment.type` con datos derivados de Service o del gateway.

### 10.3 AUTHORIZED con amount mismatch exige reconciliación

Si el Payment pending esperaba 5000 pero Webpay retorna AUTHORIZED/response_code=0 por 7000:

- el hecho externo no se ignora;
- Payment pasa a `approved`;
- `Payment.amount` permanece `5000`;
- `Payment.authorizedAmount` registra `7000`;
- `authorizedAt` registra el hecho externo;
- `reconciliationStatus = required`;
- `reconciliationReason = amount_mismatch`;
- Appointment no se activa ni cambia su `paymentStatus`;
- el resultado público usa `payment_authorized_reconciliation_required`.

Un amount mismatch nunca convierte el monto autorizado en authority para la Appointment.

### 10.4 `buy_order` y coherencia tenant permanecen fail-closed

Antes de aplicar una autorización:

- Payment y Appointment deben pertenecer al mismo Business;
- Appointment debe existir y estar inicialmente `pending_payment`;
- Business y Service relacionados deben existir/coherir;
- cross-Business falla antes del commit externo;
- después del proveedor, `buy_order` debe coincidir con la Appointment del Payment.

La política histórica de `buy_order` mismatch permanece fail-closed y no registra una aprobación local como si el Payment hubiera sido validado correctamente.

### 10.5 Toda activación se revalida bajo el mutex de booking

Un AUTHORIZED válido no concede por sí mismo authority para reactivar la Appointment.

Después de volver del proveedor, el settlement entra al mismo mutex `Business + worker + date` y, dentro de una transaction:

1. vuelve a leer la Appointment;
2. exige que continúe `pending_payment` para activarla;
3. revalida overlap activo excluyendo la propia Appointment;
4. usa CAS `pending_payment -> confirmed`;
5. liquida Payment y Appointment atómicamente cuando la activación sigue siendo válida.

Está cubierta la carrera cancel/rebook:

```text
A pending_payment 09:00-11:00
-> callback inicia commit Webpay
-> admin cancela A
-> guest reserva B 10:00-12:00
-> Webpay retorna AUTHORIZED
```

A permanece `cancelled`, B permanece activa y el Payment autorizado queda `approved/reconciliationStatus=required/reconciliationReason=appointment_state_changed`; nunca se resucita A.

Si aparece un overlap incompatible mientras A sigue `pending_payment`, tampoco se introduce una Appointment conflictiva y la reconciliación usa `interval_conflict`.

Un callback AUTHORIZED normal conserva el contrato legacy: Payment `approved/reconciliationStatus=applied` y Appointment confirmada.

### 10.6 Redirect Webpay no filtra errores técnicos

`payment.controller.js` no incorpora `error.message` raw en `/payment-failed`.

Errores inesperados usan un reason público estable:

```text
server_error
```

Los detalles técnicos permanecen exclusivamente en logs internos. Una prueba inyecta un mensaje sensible sintético en el gateway y verifica que no aparece ni raw ni URL-decoded en `Location`.

## 11. Business Settings es internal-only, read-only y de shape estable

`BusinessConfig` no forma parte del contrato headless de 6.2.6-A.

`GET /api/business-settings` exige sesión, User/Business activos, Membership tenant activa y trusted panel origin cuando el navegador envía `Origin`.

GET es semánticamente read-only:

- si existe BusinessConfig, se lee;
- si no existe, se calculan defaults sin persistir;
- un GET nunca materializa configuración incidentalmente.

Además, el DTO no depende de la existencia física del documento. Tanto antes como después de materializar BusinessConfig, `business` usa la misma proyección estable:

```json
{
  "_id": "ObjectId",
  "name": "string",
  "slug": "string"
}
```

La respuesta normaliza igualmente `workingHours`, `appointmentSettings`, `cancellationSettings`, `paymentSettings`, `emailSettings` y `uiSettings`, sin exponer subdocument `_id`, timestamps u otros detalles físicos como señal de que el documento existe.

Un PUT parcial de `appointmentSettings` preserva los campos no relacionados existentes; modificar `bufferTime` no cambia implícitamente `slotDuration`.

## 12. C1 y C2 permanecen sin ampliación

C1 sigue siendo verificación tenant-scoped de control de contacto y no crea User/Membership/CustomerProfile/Appointment authority.

C2 sigue emitiendo únicamente una capability bearer one-shot para exactamente un Business + una Appointment + purpose/action READ. El bearer raw no se persiste y la entrega confiable continúa ligada al `Appointment.guestContact`, no a User.email.

## 13. Gate de regresión

El gate oficial mantiene:

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
- Business Settings boundary, read-only semantics, canonical slotDuration y DTO estable;
- concurrent Appointment interval invariant 120/120 y 120/60;
- headless public contract y public booking input boundary;
- Appointment ownership/Service coherence/Service update hardening;
- Payment authority, callback legacy, Payment snapshot, amount mismatch reconciliation, redirect hygiene y cancellation/rebooking race;
- WebSocket tenant isolation;
- frontend policy tests;
- Astro check;
- TypeScript strict;
- frontend production build;
- `npm audit --omit=dev --audit-level=critical` backend/frontend;
- Gitleaks.

No se eliminan tests, no se convierten fallos en skips y no se rebajan assertions.

## 14. Deuda explícita fuera de alcance

Permanece fuera de 6.2.6-A:

- rediseño CSRF general;
- Client accounts/login y OAuth Client;
- binding User↔CustomerProfile y Client history/timeline;
- nuevas Appointment capabilities y cancel/reschedule/payment capabilities;
- nuevo inicio Webpay;
- workflow operativo posterior para resolver/refund/reconciliar manualmente un Payment externo autorizado que no pudo aplicarse a Appointment;
- idempotency key genérica y rediseño amplio del payment flow;
- domain verification;
- tenantización de Holiday;
- limpieza operativa opcional de filas mutex antiguas;
- 6.2.6-B, 6.3 y 6.4.

## 15. Estado de cierre de este PR

La revisión adversarial de 6.2.6-A está completada sobre el HEAD técnico aprobado `e85a00d361d60df349030bc43a274c2433dd4e0a`, con CI #286 `success`. 6.2.6-A queda técnicamente cerrada y PR #30 permanece Ready, pendiente únicamente de autorización explícita de merge.

Este documento describe exclusivamente 6.2.6-A y **no declara cerrada toda 6.2.6**. No se inicia 6.2.6-B ni 6.3; la deuda de la sección 14 permanece fuera de alcance.