# Fase 6.2.4-A — Auditoría y contrato de ownership de Appointment

Fecha de auditoría: 2026-08-12  
Base exacta revisada: `master@a91dddbbc5482ee192944a05d9203de47e021dae`  
HEAD adversarial de entrada: `c6a0c542aa8cbe4d960c7094177020aa8e1a03c4`  
Origen de la base: merge de PR #23 (`6.2.3 tenantización de disponibilidad`).  
Naturaleza de esta fase: **arquitectónica/documental**. Este documento no autoriza por sí mismo cambios runtime, migraciones ni acceso a producción.

## 1. Contexto y separación de alcance

Las decisiones arquitectónicas vigentes no se reabren:

- `User` representa identidad global.
- `Membership` activa representa participación y autoridad tenant; roles tenant actuales: `admin | worker`.
- `Business.owner` expresa propiedad, pero no concede autoridad tenant.
- `superadmin` es privilegio global y no rol `Membership`.
- seleccionar un Business representa contexto, no autoridad.
- `req.tenantAuthority` representa autoridad tenant persistente revalidada.
- `businessId` de sesión no es autoridad.
- `Shift` y `Block` ya están físicamente tenantizados.
- `Appointment.business` es obligatorio y la disponibilidad de 6.2.3 ya consulta Appointment con scope de Business.

El objetivo de 6.2.4 es que ownership, capacidad de operación y mutaciones de Appointment sean explícitos, fail-closed y difíciles de eludir accidentalmente.

Modelo conceptual:

```text
Appointment
├── business  -> ownership tenant del recurso
├── worker    -> assignment profesional
├── client    -> relación de cliente
├── service   -> prestación asociada dentro del mismo tenant
└── status    -> estado operacional
```

`Appointment.business` responde **a qué tenant pertenece el recurso**. No responde por sí solo **qué actor puede realizar una operación**.

### 1.1 MVP CORE — 6.2.4

El núcleo MVP de 6.2.4 debe cerrar:

- ownership tenant de Appointment;
- capacidades Client / Worker / Admin;
- `Appointment.business` como ownership inmutable;
- coherencia `Service` / `Worker` / `Business`;
- `Service.workers` como allowlist autoritativa;
- Service activo para nuevas reservas y disponibilidad;
- mutaciones purpose-specific;
- campos de ownership/assignment protegidos;
- transiciones de estado explícitas y CAS cuando corresponda;
- repository boundaries;
- modelo de error fail-closed;
- timeline/AuditLog con proyección segura cuando aplique al core.

### 1.2 PAYMENT / WEBPAY — FUERA DEL MVP

Webpay **no es requisito del MVP de Agenda**. Los problemas de Payment/Webpay descubiertos siguen siendo reales y se documentan para impedir que una futura activación reintroduzca una frontera insegura, pero no deben definir ni expandir el contrato central de Appointment.

Reglas de separación:

- Appointment/Booking debe funcionar completamente sin Webpay.
- Payment es un módulo opcional.
- Webpay es un adapter externo reemplazable de Payment.
- Appointment no conoce `token_ws`, `buy_order`, códigos de autorización ni tipos específicos de Transbank.
- Payment puede referenciar Appointment, pero Payment no se convierte en autoridad tenant sobre Appointment.
- un Business sin pagos debe completar todo Booking sin tocar Payment.
- fallos de Webpay no pueden corromper Appointments ajenas ni otros módulos.

Los hallazgos críticos de Payment se clasifican como **BLOCKER BEFORE PAYMENT ENABLEMENT**. Si Payment/Webpay está explícitamente deshabilitado/inaccesible en el MVP, no bloquean el cierre conceptual del MVP Core.

Sin embargo, el código actual monta `/api/payments` incondicionalmente y declara públicas `POST /payments/initiate` y POST/GET `/payments/webpay-return`. No existe feature flag visible en el árbol revisado. Por tanto, antes de un release MVP debe ocurrir una de estas dos cosas:

1. **opción recomendada para MVP:** deshabilitar explícitamente el módulo/rutas Payment/Webpay, deny-by-default; o
2. corregir `APT-PAY-01`, `APT-PAY-02` y `APT-PAY-03` antes de mantener esas rutas públicamente accesibles.

Esta auditoría no sondea producción y no modifica runtime.

---

## 2. Estado actual

El modelo físico ya exige `Appointment.business` y posee un índice activo único por `{ business, worker, date, startTime }` para evitar colisiones entre citas activas del mismo tenant/profesional/horario.

La ruta `/api/appointments` está bajo `scopeBusiness`. En operaciones tenant autenticadas, `appointment.controller` pasa `req.businessId` y `req.tenantAuthority.role` al servicio. `appointment.service` recupera el recurso mediante `findByIdAndBusiness()` y muta estados mediante `updateByIdAndBusiness()`.

No existe actualmente un endpoint general de `PATCH /appointments/:id`. Tampoco existe un flujo runtime formal de reschedule/reassign. La mutabilidad de ownership/assignment es principalmente un problema de contrato de repositorio y de futuras implementaciones.

### 2.1 Conteo de call sites runtime auditados

Se mantienen **23 invocaciones directas de persistencia de Appointment en runtime**, contando expresiones ejecutables `appointmentRepository.*` y `appointmentRepository.aggregate(...)`, y excluyendo definiciones del repositorio, tests, migraciones, seeds y scripts manuales:

- `appointment.service.js`: 6.
- `availability.service.js`: 1.
- `payment.service.js`: 6.
- `appointment.notifications.js`: 3.
- `analytics.service.js`: 7 aggregations.

Además se auditaron controllers, routes, middleware tenant, Payments/Webpay, WebSocket, AuditLog, Client API, auth/sesiones, tests, migraciones, seeds y scripts manuales/legacy.

### 2.2 Estado actual del Client autenticado

Hay que separar el contrato futuro del comportamiento actual:

- `authService.login()` puede autenticar credenciales de un User ordinario, pero `resolveSessionFromUser()` rechaza con `UnauthorizedError` si ese User no tiene Membership activa.
- la sesión normal se crea para superadmin o para una Membership tenant seleccionada.
- `getOrCreateGuestUser()` crea/recupera un User global durante booking, pero ese flujo no crea una sesión autenticada.
- las rutas `GET /appointments/:id`, `/my`, timeline y cancel exigen `isAuthenticated`.

Consecuencia: **client authenticated ownership es un contrato futuro compatible con 6.2.5, no una capacidad plenamente utilizable hoy por clientes ordinarios sin Membership**.

6.2.4-B no debe implementar login/identidad de clientes. Tampoco debe considerar `clientId` persistido como prueba de identidad de un guest.

### 2.3 Superficie Payment actual

En el HEAD revisado:

```text
app.use('/api', routes)
    ↓
router.use('/payments', paymentRoutes)
    ↓
POST /payments/initiate        PUBLIC
POST /payments/webpay-return   PUBLIC
GET  /payments/webpay-return   PUBLIC
```

No se encontró guard de feature, auth o habilitación del módulo. `scopeBusiness` se aplica sólo a `/payments/initiate`; el controller no usa `req.businessId` para demostrar ownership y pasa únicamente `appointmentId` + `paymentType` al servicio.

A nivel de código desplegable, Payment/Webpay es una superficie accesible. Como esta fase prohíbe acceso a producción, no se realiza una prueba HTTP contra el deployment real.

---

## 3. Modelo de ownership y capacidades

### 3.1 Los actores no son categorías excluyentes

Un mismo `User` puede satisfacer simultáneamente varias relaciones:

- ser `appointment.client`;
- tener Membership `worker` o `admin`;
- eventualmente poseer privilegio global `superadmin`.

La autorización debe evaluarse **por capacidad/relación concreta para la operación**, no mediante una clasificación excluyente del User.

Ejemplo:

```text
User X
├── es client de Appointment A
├── tiene Membership worker en Business B
└── puede tener privilegio global
```

Para pagar Appointment A, si Payment estuviera habilitado, se evalúa la capacidad Client/guest-payment de A. La existencia de Membership worker/admin no niega ni concede esa capacidad.

### 3.2 Ownership tenant

**Fuente única:**

```text
Appointment.business
```

Ningún `worker`, `client`, `service`, header, query param, sesión, `User.role`, `User.business`, `Business.owner`, Payment ni provider externo sustituye esa relación.

### 3.3 Capacidad CLIENT

Contrato lógico:

```text
authenticatedUser._id === Appointment.client
```

más reglas de negocio y resolución fail-closed del recurso.

Estado actual: clientes ordinarios sin Membership no obtienen sesión normal, por lo que esta capacidad debe permanecer como contrato futuro y no obliga a 6.2.4-B a implementar identidad 6.2.5.

Para guest booking, `Appointment.client` conserva la relación de dominio, pero **no demuestra que la request posterior provenga de esa persona**.

### 3.4 Capacidad WORKER

Para ejercer autoridad profesional deben cumplirse simultáneamente:

```text
User.isActive === true
Membership.isActive === true
Membership.role === 'worker'
Membership.business === Appointment.business
Appointment.worker === User._id
```

`Appointment.worker` por sí solo no concede autoridad si la Membership fue revocada.

### 3.5 Capacidad ADMIN

Para operar como admin:

```text
Membership.isActive === true
Membership.role === 'admin'
Membership.business === Appointment.business
```

`User.role === 'admin'`, `User.business` y `Business.owner` no sustituyen Membership.

### 3.6 Privilegio SUPERADMIN

El privilegio global por sí solo:

- puede autorizar inspección global read-only cuando exista una ruta/política explícita;
- **no autoriza mutación tenant**;
- seleccionar/impersonar Business no crea autoridad tenant.

Si el mismo User también posee una Membership activa válida para `Appointment.business`, esa Membership se evalúa de forma independiente como capacidad tenant. No hay un DENY por el hecho de ser superadmin.

### 3.7 SYSTEM / INTERNAL

Una operación interna puede carecer de `req.businessId`, pero debe demostrar provenance mediante una relación persistente confiable y estado esperado.

Un ObjectId arbitrario nunca constituye autoridad.

---

## 4. Service, Worker y elegibilidad

### 4.1 `Service.workers` es allowlist autoritativa

Decisión de contrato:

```text
Service.workers = [w1, w2]  -> sólo w1 y w2 son elegibles
Service.workers = []        -> ningún profesional es elegible
```

Un array vacío **no** significa "todos".

Actualmente booking y availability validan Business + User activo + Membership worker, pero no comprueban que el worker esté incluido en `Service.workers`.

### 4.2 Escritura de Service

Para que 6.2.4-B pueda imponer la allowlist, `create/update Service` debe aceptar únicamente workers que:

- existan;
- tengan `User.isActive === true`;
- tengan Membership activa `role=worker`;
- pertenezcan al mismo `Business` del Service.

La validación de forma (`ObjectId`) no basta.

No se resuelve aquí la futura posibilidad de admin+worker simultáneo.

### 4.3 Public booking y availability

Ambos deben exigir:

```text
Service.business === targetBusiness
Service.isActive === true
Appointment.worker ∈ Service.workers
Worker User activo
Membership worker activa del mismo Business
```

### 4.4 Service inactivo

Estado actual: `validateBookingTenantScope()` y `availability.getAvailableSlots()` usan `findByIdAndBusiness(..., { onlyActive=false })` implícito. Por tanto un Service inactivo puede seguir publicando disponibilidad y originando nuevas Appointments.

Invariante:

- un Service debe estar activo al publicar nueva disponibilidad y al crear una nueva Appointment;
- desactivar posteriormente un Service **no** reescribe, invalida ni elimina automáticamente Appointments históricas o ya creadas.

### 4.5 Impacto en fixtures y legacy

La semántica nueva puede revelar datos existentes con `workers=[]` o con workers que no cumplen Membership. Antes de imponer enforcement en un entorno real se debe:

- auditar fixtures/tests;
- auditar datos legacy;
- ajustar seeds/fixtures de test que dependan de la semántica ambigua;
- definir remediación/migración separada si fuera necesaria.

6.2.4-A no ejecuta ninguna migración.

---

## 5. Matriz de autorización corregida

Las columnas representan **capacidades independientes**. Un User puede satisfacer más de una columna. `NO GRANT` significa que esa capacidad por sí sola no autoriza la operación; no significa que el mismo User quede denegado si satisface otra capacidad válida.

| Operación | Relación Client propia | Relación Worker asignado + Membership | Membership Admin tenant | Privilegio global superadmin | System / capability purpose-specific |
|---|---|---|---|---|---|
| Create booking | CONDITIONAL / público | NO GRANT adicional | NO GRANT adicional | NO GRANT adicional | CONDITIONAL sólo flujo interno explícito |
| Read detail | ALLOW futuro cuando exista sesión Client | CONDITIONAL | CONDITIONAL | CONDITIONAL read-only explícito | CONDITIONAL internal |
| List | CONDITIONAL futuro | CONDITIONAL | CONDITIONAL | CONDITIONAL read-only explícito | CONDITIONAL internal |
| Cancel | CONDITIONAL futuro | CONDITIONAL | CONDITIONAL | NO GRANT | CONDITIONAL purpose-specific |
| Confirm | NO GRANT | CONDITIONAL | CONDITIONAL | NO GRANT | CONDITIONAL sólo flujo interno definido |
| Complete | NO GRANT | CONDITIONAL | CONDITIONAL | NO GRANT | DENY por defecto |
| Reschedule | CONDITIONAL futuro si producto lo habilita | CONDITIONAL | CONDITIONAL | NO GRANT | DENY por defecto |
| Payment initiation, si se habilita | CONDITIONAL Client o guest capability | NO GRANT adicional; puede aplicar Client | NO GRANT adicional; puede aplicar Client | NO GRANT adicional; puede aplicar Client | CONDITIONAL guest payment capability |
| Payment callback, si se habilita | NO GRANT directo | NO GRANT directo | NO GRANT directo | NO GRANT directo | CONDITIONAL Payment persistido + provider proof |
| Notification read interno | NO GRANT directo | NO GRANT directo | NO GRANT directo | NO GRANT directo | CONDITIONAL con provenance interno |
| Timeline funcional | CONDITIONAL futuro tras autorizar Appointment | CONDITIONAL tras autorizar Appointment | CONDITIONAL tras autorizar Appointment | CONDITIONAL read-only explícito | CONDITIONAL con proyección segura |
| Global analytics | NO GRANT | NO GRANT | NO GRANT | ALLOW read-only explícito | CONDITIONAL internal |

Regla esencial: **las capacidades se suman como pruebas independientes; no se anulan por etiquetas de rol globales o tenant**.

---

## 6. Inventario de call sites y fronteras

| Flujo | Capacidad/actor | Entrypoint | Appointment lookup/write | Business source | Prueba de autorización | R/W | Estado actual | Observaciones |
|---|---|---|---|---|---|---|---|---|
| Public booking prevalidación | público/client | `POST /appointments` | sin lookup Appointment | `scopeBusiness -> req.businessId` | Service/worker tenant | R | Parcialmente seguro | falta `Service.isActive` y allowlist `Service.workers` |
| Public booking create | público/client | `POST /appointments` | `create({business:req.businessId})` | servidor | relaciones + disponibilidad | W | Parcialmente seguro | debe cerrar invariantes Service/worker |
| Confirm | worker/admin | `PATCH /appointments/:id/confirm` | `findByIdAndBusiness` + `updateByIdAndBusiness` | `req.businessId` | Membership + assignment | R/W | tenant-safe, state débil | update genérico y transición sin CAS estricto |
| Complete | worker/admin | `PATCH /appointments/:id/complete` | scoped read/write | `req.businessId` | Membership + assignment | R/W | tenant-safe, state débil | transición origen demasiado amplia |
| Cancel | client/worker/admin | `PATCH /appointments/:id/cancel` | scoped read/write | `req.businessId` | relación válida | R/W | tenant-safe | Client hoy no posee sesión normal sin Membership |
| Read detail | client/worker/admin | `GET /appointments/:id` | `findByIdAndBusiness` | `req.businessId` | relación válida | R | tenant-safe | cross-resource debe uniformarse a 404 |
| My appointments | client/worker/admin | `GET /appointments/my` | `findAll(query)` | `req.businessId` | query tenant/actor | R | tenant-safe en caller | repo sigue permitiendo global `findAll({})` |
| Timeline | actor autorizado | `GET /appointments/:id/timeline` | primero Appointment scoped; luego `AuditLog.find` | Appointment autorizada | detalle autorizado | R | ownership gate sí; proyección insegura | retorna AuditLog completo |
| Availability | público/tenant | slots | `findByBusinessWorkerAndDate` | business explícito | worker Membership | R | tenant-safe parcial | Service inactivo y allowlist no se validan |
| Payment initiation | público | `POST /payments/initiate` | global `findById` + global `update` | Appointment global | ObjectId + status | R/W | **BLOCKER BEFORE PAYMENT ENABLEMENT** | `req.businessId` no prueba ownership |
| Webpay callback | provider/system | `/payments/webpay-return` | Payment token opcional en práctica; luego global Appointment | provider response | incompleta | R/W | **BLOCKER BEFORE PAYMENT ENABLEMENT** | Payment persistido no es requisito duro |
| Payment notification mail | system | callback | global `findById` | ID ya procesado | flujo interno | R | internal read | boundary debería ser explícito |
| Booking notification | system | `setImmediate` | global `findById` | ID creado por booking | evento interno | R | aceptable con deuda | no muta Appointment |
| Confirm notification | system | `setImmediate` | global `findById` | ID autorizado | evento interno | R | aceptable con deuda | no muta Appointment |
| Cancel notification | system | `setImmediate` | global `findById` | ID autorizado | evento interno | R | aceptable con deuda | no muta Appointment |
| Global metrics | superadmin | `/superadmin/metrics` | 2 `aggregate()` | business opcional | `isSuperadmin` | R | read-only explícito | global cuando no hay businessId |
| Advanced analytics | superadmin | `/superadmin/analytics` | 5 `aggregate()` | business opcional | `isSuperadmin` | R | read-only explícito | tenant match cuando se filtra |
| WebSocket availability | tenant/system | Socket.IO | no recupera Appointment | room business/worker/date | Membership revalidada | event | tenant-safe | no usa global Appointment |
| Legacy migration | operador | manual | `Appointment.updateMany` | legacy | operador | W | fuera de runtime | DEBT; no ejecutar |
| 6.2.3 migration | operador aislado | manual | snapshot + índices | Appointment.business | guards de migración | R/DDL | propósito acotado | no backfillea ownership Appointment |
| Debug/seed | operador manual | scripts | queries/inserts globales | variable | ninguna política runtime | R/W | fuera de contrato | DEBT; no ejecutar |

---

## 7. Repository contracts actuales y contrato propuesto

### 7.1 Contrato actual

`appointmentRepository` expone APIs tenant-scoped y globales:

**Tenant-scoped:**

- `findByBusinessWorkerAndDate(businessId, workerId, date)`
- `findByIdAndBusiness(id, businessId)`
- `updateByIdAndBusiness(id, businessId, data)`

**Genéricas/globales:**

- `findById(id)`
- `update(id, data)`
- `findAll(query = {})`
- `aggregate(pipeline)`

### 7.2 APT-REP-01 — el problema incluye ambas mutaciones genéricas

No sólo `update(id, data)` es demasiado genérico. También:

```text
updateByIdAndBusiness(id, businessId, data)
```

acepta un `data` arbitrario y técnicamente puede modificar `business`, `client`, `worker`, `service`, fecha/hora o status sin expresar la semántica de la operación.

Que una mutación esté filtrada por Business protege el **recurso seleccionado**, pero no protege los **campos que se pueden mutar**.

### 7.3 Contrato futuro

6.2.4-B debe eliminar o encapsular las mutaciones genéricas desde callers runtime y favorecer comandos purpose-specific, por ejemplo:

```text
transitionStatusByBusiness(id, businessId, expectedStatus, nextStatus)
reassignWorkerByBusiness(id, businessId, workerId, ...)
changeServiceByBusiness(id, businessId, serviceId, ...)
rescheduleByBusiness(id, businessId, date, startTime, ...)
```

Reglas:

- `business` inmutable.
- `client` no mutable por patch genérico.
- `status` sólo mediante comandos/transiciones con estados origen permitidos.
- `worker`, `service`, `date`, `startTime`, `endTime` sólo mediante comandos purpose-specific que revaliden invariantes.
- lecturas globales legítimas deben quedar marcadas/encapsuladas como `internal-only` o `read-only` para reducir reutilización accidental.

---

## 8. Payment / Webpay boundaries — fuera del MVP

### 8.1 Estado de exposición

El módulo está montado incondicionalmente en el router actual y sus tres entrypoints son públicos. No existe evidencia en el código revisado de una feature flag que los deshabilite.

Por tanto:

- para un MVP sin Payment, la recomendación es **no montar las rutas** o responder fail-closed mediante un flag `PAYMENTS_ENABLED=false` deny-by-default;
- si se decide mantenerlas accesibles, los blockers siguientes deben corregirse antes de release.

### 8.2 APT-PAY-01 — BLOCKER BEFORE PAYMENT ENABLEMENT

`POST /payments/initiate` recibe `appointmentId` del body y llama `initiatePayment(appointmentId, paymentType)`.

Actualmente:

```text
request appointmentId
    ↓
appointmentRepository.findById(global)
    ↓
deriva client/business desde Appointment
    ↓
appointmentRepository.update(global)
```

El ObjectId de Appointment actúa de facto como selector/bearer sin una prueba de Client ownership o guest capability.

Invariante: **conocer un Appointment ObjectId nunca autoriza iniciar pago**.

### 8.3 Capability corta para guest payment

Decisión de contrato:

Para continuidad de pago invitado, si Payment se habilita, usar una capability corta purpose-specific emitida por servidor, ligada como mínimo a:

- Appointment;
- Business;
- `purpose=payment`;
- expiry corta;
- integridad criptográfica o valor opaco aleatorio no derivable.

La capability:

- no es el ObjectId;
- no es `clientId`;
- no es una sesión general;
- no concede lectura/cancelación u otras capacidades;
- no resuelve identidad progresiva 6.2.5;
- sólo autoriza el purpose de iniciar/continuar el intento de pago definido.

Un User autenticado que además sea worker/admin/superadmin no queda DENY por esos roles: si satisface Client ownership, se evalúa por capacidad Client. Para guest, se evalúa la capability, no una etiqueta de rol.

### 8.4 APT-PAY-02 — BLOCKER BEFORE PAYMENT ENABLEMENT

`confirmPayment(tokenWs)` actualmente:

1. intenta buscar `Payment` por `token_ws`;
2. **ignora errores** de esa consulta;
3. puede continuar aunque no exista Payment persistido;
4. llama al provider;
5. reemplaza `appointmentId` con `commitResponse.buy_order`;
6. recupera `Appointment` mediante `findById()` global;
7. muta Payment/Appointment globalmente.

Esto invierte la cadena de confianza: la respuesta del provider termina eligiendo la Appointment incluso cuando no hubo un Payment persistido válido como ancla local.

Invariante: **ningún callback puede mutar Appointment si antes no existe un Payment persistido válido que pruebe la relación**.

#### Payment debe probar antes del commit

```text
Payment.transactionId === token_ws
Payment.status === 'pending'
Payment.gateway === 'webpay'
Payment.appointment existe
Payment.business existe
Payment.amount válido/persistido
Payment.type válido/persistido
```

Errores de lectura de Payment son fail-closed; no se ignoran.

#### Provider debe probar después del commit

```text
provider.buy_order === Payment.appointment
provider.amount === Payment.amount
provider result compatible con authorized/rejected esperado
```

Y además:

```text
Appointment._id === Payment.appointment
Appointment.business === Payment.business
```

Payment prueba provenance; **no reemplaza `Appointment.business` como autoridad tenant**.

### 8.5 APT-PAY-03 — consistencia de attempts — BLOCKER BEFORE PAYMENT ENABLEMENT

Estado actual:

- `initiatePayment` acepta Appointment en `pending` **o `pending_payment`**;
- sólo rechaza si existe Payment `approved`;
- pueden coexistir múltiples Payments `pending` para la misma Appointment;
- Appointment cambia a `pending_payment` **antes** de crear Payment;
- si `Payment.create()` falla, Appointment puede quedar en estado parcial;
- callback actualiza Payment y Appointment en pasos separados y también puede quedar parcial;
- un callback repetido no tiene un contrato idempotente/CAS completo.

#### Política elegida

Debe existir **como máximo un intento Payment pending autoritativo por Appointment y gateway**.

- iniciar pago requiere Appointment `pending`;
- si ya existe un Payment `pending` autoritativo, no se crea un segundo intento silenciosamente;
- una política futura puede devolver el intento vigente o exigir expiración/rechazo/supersession explícita;
- Payments terminales (`approved`, `rejected`, etc.) permanecen como historial, pero sólo un `pending` puede ser autoridad vigente.

Si se necesita retry después de un intento terminal, la creación del siguiente intento debe ser explícita y no ambiguamente derivada de `Appointment.status`.

### 8.6 Diseño de initiation esperado

```text
capability Client/guest válida
    ↓
Appointment tenant-scoped + status=pending
    ↓
calcular intención económica inicial
    ↓
Webpay create (HTTP externo; fuera de transacción Mongo)
    ↓
transacción Mongo local:
    Payment pending persistido
    +
    CAS Appointment pending -> pending_payment
```

No incluir la request HTTP al provider dentro de una transacción Mongo.

Si Webpay crea un token pero la transacción Mongo local falla, ese token externo queda **no autorizado localmente**. Un callback posterior debe rechazarse porque no existe un Payment persistido `pending` válido para `token_ws`.

### 8.7 Diseño de callback esperado

```text
Payment pending por token_ws OBLIGATORIO
    ↓
validar gateway/business/appointment/amount/type
    ↓
commit provider (HTTP externo; fuera de transacción Mongo)
    ↓
validar provider.buy_order == Payment.appointment
validar provider.amount == Payment.amount
validar respuesta provider
    ↓
Appointment por (Payment.appointment, Payment.business)
    ↓
transacción Mongo local idempotente/CAS:
    Payment pending -> approved/rejected
    +
    Appointment expected-state -> next-state
```

Replay:

- si Payment ya está terminal y la respuesta coincide con el resultado persistido, el callback puede responder idempotentemente sin mutar otra vez;
- si estado/provider/payload contradicen el intento persistido, fail-closed y sin mutación.

### 8.8 Autoridad del monto

En initiation puede calcularse el monto desde la configuración vigente del Service/Appointment.

Una vez persistido el intento:

```text
Payment.amount
Payment.type
Payment.currency
```

son la **intención económica autoritativa de esa transacción**.

El callback no debe recalcular autoridad desde el precio/deposit actual del `Service`, porque ese Service pudo cambiar después de iniciar el intento.

---

## 9. Mutabilidad de ownership y assignments

### `business`

**Inmutable** después de creación en runtime ordinario.

Transferir una Appointment entre tenants no es reschedule; sería otra operación de dominio y queda fuera de 6.2.4.

### `client`

No mutable mediante patch genérico. Una eventual corrección administrativa de identidad requiere flujo dedicado y auditado.

### `worker`

Puede ser mutable sólo como assignment dentro del mismo Business mediante comando purpose-specific que revalide:

- User activo;
- Membership `worker` activa en el Business;
- `worker ∈ Service.workers`;
- disponibilidad para fecha/hora;
- restricciones de estado.

### `service`

Puede ser mutable sólo dentro del mismo Business mediante comando purpose-specific que revalide:

- Service activo para un cambio que crea una nueva prestación futura;
- worker elegible en `Service.workers`;
- duración y disponibilidad;
- consecuencias económicas de forma desacoplada de Webpay.

### fecha/hora

Mutables sólo por reschedule purpose-specific. No por `update(data)` libre.

### status

Mutable sólo mediante transición explícita con estado origen permitido y actualización atómica/CAS.

---

## 10. Aggregations

Se identifican 7 `Appointment.aggregate(...)` en analytics:

- 2 para métricas globales;
- 5 para analítica avanzada.

Los entrypoints actuales son superadmin/read-only. Cuando reciben `businessId`, el pipeline tenant debe aplicar `$match` por Business antes de joins/agrupaciones relevantes. Cuando no recibe Business, la operación es global y sólo es válida por la política explícita de inspección read-only de superadmin.

Deuda: `appointmentRepository.aggregate(pipeline)` sigue siendo una API global genérica. Debe mantenerse confinada a boundaries read-only/internal, no convertirse en precedente para mutaciones.

---

## 11. WebSocket, notificaciones y AuditLog

### 11.1 WebSocket

WebSocket de disponibilidad no recupera Appointment globalmente; las rooms incorporan business/worker/date y la autoridad tenant se revalida. No es blocker de 6.2.4.

### 11.2 Notificaciones

`appointment.notifications.js` realiza tres `findById()` globales después de eventos internos de booking/confirm/cancel.

Son lecturas internal-only y no deben clasificarse automáticamente como vulnerabilidad cross-tenant porque el ID proviene del flujo ya autorizado. Aun así, el repository contract futuro debe hacer explícito este boundary para reducir reutilización accidental.

### 11.3 APT-AUD-01 — HIGH — AuditLog/Payment expone material sensible al timeline

Payment/Webpay persiste actualmente en `AuditLog.metadata` / `technicalMessage`:

- token Webpay de creación;
- `token_ws`;
- URL de provider;
- `commitResponse` completo;
- en errores, `error.stack`.

`AuditLog` acepta `metadata: Mixed` y `technicalMessage` sin una proyección pública. El timeline autoriza primero la Appointment, pero luego devuelve documentos `AuditLog` completos al actor autorizado.

Eso mezcla dos responsabilidades:

1. timeline funcional visible al usuario/tenant;
2. observabilidad operacional interna.

Contrato 6.2.4-B para el core:

- timeline debe usar una **proyección segura allowlist**, no el documento AuditLog completo;
- no exponer `technicalMessage`, stack traces, tokens, capabilities ni respuestas crudas de provider;
- sanitizar metadata antes de persistir o al menos antes de exponerla;
- separar observabilidad interna del timeline funcional si se necesita conservar detalle técnico;
- cualquier logging futuro de Payment debe tratar token/capability como secreto y no incorporarlo al timeline.

Aunque Payment quede deshabilitado en MVP, la proyección segura del timeline es una frontera core válida.

---

## 12. Hallazgos finales

### BLOCKER BEFORE PAYMENT ENABLEMENT

#### APT-PAY-01 — initiation sin Client/guest capability

`appointmentId` público selecciona y muta Appointment globalmente. El ObjectId no prueba ownership.

#### APT-PAY-02 — callback sin Payment persistido obligatorio

`confirmPayment` tolera que la búsqueda Payment falle/no exista y después confía en `commitResponse.buy_order` para seleccionar Appointment global.

#### APT-PAY-03 — attempts y consistencia local parcial

Múltiples pending son posibles; Appointment se muta antes de crear Payment; callback actualiza Payment/Appointment en pasos separados; falta política autoritativa de intento e idempotencia/CAS.

**Gating del MVP:** como las rutas Payment están montadas públicamente en el código actual, estos hallazgos dejan de ser irrelevantes mientras la superficie permanezca expuesta. Para cerrar MVP sin implementar Payment, debe deshabilitarse explícitamente el módulo/rutas. Si no se deshabilita, deben corregirse antes del release.

### HIGH

#### APT-SVC-01 — `Service.workers` no es enforced

Booking/availability no comprueban que el worker esté en la allowlist y create/update Service no valida Membership/Business de los workers.

#### APT-SVC-02 — Service inactivo todavía bookeable

Booking y availability usan `findByIdAndBusiness` sin `onlyActive=true`.

#### APT-REP-01 — mutaciones genéricas permiten campos arbitrarios

Tanto `update(id,data)` como `updateByIdAndBusiness(id,businessId,data)` permiten cambiar arbitrariamente ownership/assignments/status.

#### APT-STATE-01 — transiciones sin expected-state/CAS consistente

Confirm/complete/cancel y especialmente Payment no expresan de forma uniforme estados origen y protección ante replay/carreras.

#### APT-AUD-01 — AuditLog/timeline mezcla secretos y observabilidad técnica

Tokens, respuestas/provider URLs y stacks pueden quedar persistidos y el timeline devuelve AuditLog completo.

### MEDIUM

#### APT-WORKER-01 — revocación de Membership y citas futuras

Revocar Membership worker no reasigna ni invalida Appointments existentes. Esto es correcto para historia, pero requiere política explícita para citas futuras: el worker revocado conserva assignment histórico, pero ya no puede ejercer autoridad profesional.

#### APT-READ-01 — lecturas globales internal-only no expresan intención

Tres lecturas globales de notificación son legítimas por provenance interno, pero el nombre/contrato del repo no lo expresa.

### LOW

#### APT-AUD-02 — AuditLog no contiene `business`

El timeline actual queda protegido porque primero autoriza Appointment. No es blocker, pero un eventual acceso global/directo a AuditLog debe conservar la relación con el tenant o derivarla de Appointment de forma segura.

### DEBT

- `appointmentRepository.aggregate(pipeline)` permanece global/genérico aunque los callers actuales sean read-only.
- `migrate-multi-tenancy.js` contiene `Appointment.updateMany` global legacy.
- scripts debug/seed operan fuera de los boundaries runtime y no son autoridad de dominio.

---

## 13. Invariantes obligatorios propuestos

### Ownership y actores

1. `Appointment.business` es la autoridad de ownership tenant.
2. `Appointment.business` es inmutable en runtime ordinario.
3. capacidades Client, Worker, Admin y privilegio global se evalúan de forma independiente; no son categorías excluyentes.
4. un actor tenant de Business A nunca usa esa autoridad para operar Appointment de Business B.
5. `Business.owner`, `User.role`, `User.business` y session `businessId` no sustituyen Membership/ownership persistente.

### Client

6. Client authority futura deriva de `Appointment.client === authenticatedUser`.
7. Client authority no deriva de Membership.
8. `Appointment.client` persistido no demuestra identidad de un guest request.
9. 6.2.4-B no implementa login/identidad de clientes de 6.2.5.

### Worker/Admin

10. Worker authority requiere User activo + Membership worker activa + mismo Business + assignment.
11. Admin authority requiere Membership admin activa + mismo Appointment.business.
12. privilegio superadmin por sí solo no concede mutación tenant; una Membership válida del mismo User se evalúa independientemente.

### Service/worker

13. `Appointment.service.business === Appointment.business`.
14. Service debe estar activo para nueva disponibilidad/booking.
15. `Service.workers` es allowlist autoritativa; `[]` significa ningún worker elegible.
16. `Appointment.worker ∈ Appointment.service.workers` al crear y al reasignar.
17. Service create/update sólo acepta workers activos con Membership worker activa del mismo Business.
18. desactivar Service no reescribe Appointments históricas/existentes.

### Mutation/state

19. `client` no cambia por patch genérico.
20. worker/service/date/time sólo cambian mediante comandos purpose-specific.
21. status sólo cambia mediante transiciones con estados origen permitidos y CAS cuando haya riesgo de replay/carrera.
22. repositorios runtime no deben exponer una mutación genérica capaz de cambiar ownership/assignment sin invariantes.

### Payment opcional

23. Booking funciona sin Payment.
24. Webpay es adapter de Payment, no parte de Appointment.
25. Payment nunca sustituye `Appointment.business` como autoridad tenant.
26. un ObjectId de Appointment no es payment capability.
27. guest payment usa capability corta, opaca/criptográfica, purpose-specific, con Appointment + Business + expiry.
28. ningún callback muta Appointment sin Payment persistido válido previo.
29. Payment callback exige coincidencia `transactionId`, status, gateway, appointment, business, amount y type.
30. Provider `buy_order` y amount se comparan contra Payment, no contra datos arbitrarios ni precio actual del Service.
31. `Appointment.business === Payment.business` antes de mutar.
32. `Payment.amount/type/currency` persistidos son autoridad económica del intento.
33. existe como máximo un Payment `pending` autoritativo por Appointment/gateway.
34. request HTTP al provider nunca ocurre dentro de una transacción Mongo.
35. callback es idempotente y usa CAS/transacción local para coordinar Payment + Appointment.
36. si no existe Payment local autorizado, un token externo huérfano no puede confirmar Appointment.

### Timeline/error

37. timeline funcional usa proyección segura allowlist.
38. tokens/capabilities, provider payload crudo y stacks no se exponen en timeline.
39. errores resource-specific cross-tenant/cross-owner fallan cerrado sin revelar existencia.

---

## 14. Modelo de error

Contrato recomendado:

### 404 — resource-specific fail-closed

Usar respuesta uniforme para:

- Appointment inexistente;
- Appointment de otro Business;
- Appointment de otro client;
- worker intentando Appointment no asignada;
- recurso relacionado no visible bajo la capacidad evaluada.

El objetivo es no confirmar existencia de un recurso que el actor no puede observar.

### 403 — autoridad tenant faltante antes de resolver el recurso

Usar cuando una ruta/operación exige capacidad tenant y se puede determinar **antes de resolver un Appointment concreto** que falta:

- Membership activa;
- rol tenant requerido;
- autoridad tenant necesaria para entrar al flujo.

### 409 — recurso autorizado, transición inválida o replay

Usar cuando el actor ya está autorizado sobre el recurso pero el estado impide la transición:

- expected status no coincide;
- replay de transición;
- intento Payment concurrente/duplicado;
- conflicto de estado derivado de CAS.

Errores de forma/validación de input permanecen fuera de esta distinción y pueden usar 400/422 según la política vigente.

---

## 15. Alcance recomendado de 6.2.4-B

### 15.1 DEBE RESOLVERSE EN 6.2.4 — MVP CORE

1. formalizar capacidades no excluyentes Client/Worker/Admin/superadmin;
2. mantener `Appointment.business` inmutable;
3. encapsular/eliminar mutaciones genéricas de Appointment desde runtime;
4. implementar comandos purpose-specific para status y futuros assignments;
5. aplicar expected-state/CAS a confirm/complete/cancel donde corresponda;
6. declarar `Service.workers` allowlist autoritativa y `[] = ninguno`;
7. validar workers de Service contra User activo + Membership worker activa + mismo Business;
8. exigir `Service.isActive === true` en availability y booking nuevos;
9. exigir worker incluido en `Service.workers` para availability/booking;
10. conservar Appointments históricas cuando Service se desactive;
11. definir comportamiento de worker revocado respecto de citas futuras sin reescribir historia;
12. fijar 404/403/409 según el modelo de error;
13. introducir proyección segura de timeline/AuditLog y separar detalle operacional sensible;
14. tests adversariales core para cross-tenant, worker assignment, Membership revocada, Service allowlist/inactivo, ownership fields y transitions;
15. auditar/ajustar fixtures de test que dependan de `Service.workers=[]` ambiguo.

### 15.2 Gating requerido para un MVP sin Payment

Como Payment routes están montadas en el código actual, el MVP debe elegir explícitamente:

**Recomendado:** deshabilitar/no montar Payment/Webpay mediante configuración deny-by-default antes del release MVP.

Esta contención no convierte Payment en scope funcional del MVP; precisamente elimina la superficie opcional hasta que sea endurecida.

Si no se elige esta contención, entonces `APT-PAY-01/02/03` pasan a ser blockers de release porque la superficie permanecería pública.

### 15.3 PAYMENT / WEBPAY — DIFERIR HASTA HABILITACIÓN

Cuando Payment se decida habilitar:

- guest payment capability purpose-specific;
- Payment persistido obligatorio antes de callback mutation;
- provenance `Payment -> Appointment -> Business`;
- validación provider contra Payment;
- single authoritative pending attempt / supersession explícita;
- amount/type persistidos como autoridad del intento;
- initiation con Webpay create fuera de transacción y persistencia local atómica;
- callback idempotente con transacción local/CAS;
- sanitización específica de logs Payment/provider;
- tests adversariales cross-client/cross-tenant, missing Payment, token mismatch, amount mismatch, business mismatch, replay y partial-failure.

---

## 16. Deuda diferida / fuera de alcance

No mezclar con 6.2.4:

- identidad progresiva 6.2.5;
- login/sesión de clientes;
- admin + worker simultáneo;
- refunds;
- SII;
- billing general;
- microservicios;
- responsive;
- baseline real Atmósfera/DAM;
- migraciones de datos reales;
- acceso a producción.

Las aggregations globales read-only y scripts legacy quedan como deuda controlada mientras no se reutilicen como autoridad runtime.

---

## 17. Implicaciones de tests y CI

6.2.4-A continúa siendo documental:

- no modificar tests de comportamiento;
- no ejecutar migraciones;
- no ejecutar seeds;
- no tocar producción;
- ejecutar CI existente después de esta corrección documental.

Para 6.2.4-B Core se requerirán tests nuevos, entre otros:

- worker de otro Business en Service -> reject;
- worker activo mismo tenant pero fuera de `Service.workers` -> reject;
- `Service.workers=[]` -> ningún slot/booking elegible;
- Service inactivo -> no nueva disponibilidad/booking;
- desactivar Service no altera Appointment existente;
- Membership worker revocada -> worker ya no puede operar la Appointment;
- payload genérico no puede cambiar business/client/worker/service;
- cross-resource 404 uniforme;
- tenant authority ausente 403 previo a resolución;
- transición/replay autorizado 409.

Los tests Payment quedan diferidos junto al módulo, salvo que se decida mantener Payment públicamente habilitado; en ese caso deben implementarse antes del release.

---

## 18. Decisiones resueltas por esta revisión adversarial

Quedan cerradas para la siguiente revisión documental:

- `APT-PAY-01`: BLOCKER BEFORE PAYMENT ENABLEMENT.
- `APT-PAY-02`: elevado a BLOCKER BEFORE PAYMENT ENABLEMENT.
- `APT-PAY-03`: consistencia/attempts, BLOCKER BEFORE PAYMENT ENABLEMENT.
- Payment/Webpay está fuera del MVP, pero las rutas actuales están montadas públicamente en el código y deben deshabilitarse o endurecerse antes de release.
- actores/capacidades no son categorías excluyentes.
- Client authenticated ownership es contrato futuro; 6.2.4-B no implementa identidad 6.2.5.
- guest payment usa capability corta purpose-specific, no Appointment ObjectId ni clientId.
- `Service.workers` es allowlist autoritativa; `[] = ningún profesional`.
- un Service inactivo no puede generar nueva disponibilidad/booking.
- `updateByIdAndBusiness(..., data)` también es demasiado genérico para mutaciones runtime.
- cross-resource/owner/assignment -> 404; falta de autoridad tenant previa -> 403; transición/replay -> 409.
- timeline funcional no debe devolver material técnico/sensible sin proyección segura.

---

## 19. Estado de seguridad operacional de esta fase

Esta fase:

- no modifica runtime;
- no modifica tests de comportamiento;
- no ejecuta migraciones;
- no ejecuta seeds;
- no accede a producción;
- no crea ni modifica Businesses, Users, Memberships, Appointments o Payments reales;
- no inicia 6.2.5;
- no autoriza merge ni Ready.

Después de este Draft corresponde una **revisión adversarial final documental** antes de autorizar cualquier cambio runtime de 6.2.4-B.
