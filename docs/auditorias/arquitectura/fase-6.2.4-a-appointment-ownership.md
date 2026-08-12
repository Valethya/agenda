# Fase 6.2.4-A — Auditoría y contrato de ownership de Appointment

Fecha de auditoría: 2026-08-12  
Base exacta revisada: `master@a91dddbbc5482ee192944a05d9203de47e021dae`  
Origen de la base: merge de PR #23 (`6.2.3 tenantización de disponibilidad`).  
Naturaleza de esta fase: **arquitectónica/documental**. Este documento no autoriza por sí mismo cambios runtime, migraciones ni acceso a producción.

## 1. Contexto

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

El objetivo de 6.2.4 es que el ownership y la autorización de cada Appointment sean explícitos y difíciles de eludir accidentalmente.

Modelo conceptual:

```text
Appointment
├── business  -> ownership tenant del recurso
├── worker    -> assignment profesional
├── client    -> ownership de cliente para flujos propios
├── service   -> prestación asociada dentro del mismo tenant
└── status    -> estado operacional
```

`Appointment.business` responde **a qué tenant pertenece el recurso**. No responde por sí solo **quién puede ejecutar una operación**.

## 2. Estado actual

El modelo físico ya exige `Appointment.business` y posee índice activo único por `{ business, worker, date, startTime }` para evitar colisiones entre citas activas del mismo tenant/profesional/horario.

La ruta `/api/appointments` está bajo `scopeBusiness`. En operaciones tenant autenticadas, `appointment.controller` pasa `req.businessId` y `req.tenantAuthority.role` al servicio. `appointment.service` recupera el recurso mediante `findByIdAndBusiness()` y muta estados mediante `updateByIdAndBusiness()`.

Los tests adversariales existentes ya demuestran fail-closed `404` cuando Admin A intenta leer, consultar timeline, confirmar, completar o cancelar Appointment B.

No existe actualmente un endpoint general de `PATCH /appointments/:id` para editar libremente una Appointment. Tampoco existe un flujo runtime formal de reschedule/reassign de Appointment. Por ello, la mutabilidad de ownership es hoy principalmente un **problema de contrato de repositorio y diseño futuro**, no una superficie HTTP genérica ya expuesta.

### Conteo de call sites runtime auditados

Se auditaron **23 invocaciones directas de persistencia de Appointment en runtime**, contando expresiones ejecutables `appointmentRepository.*` y `appointmentRepository.aggregate(...)`, y excluyendo definiciones del repositorio, tests, migraciones, seeds y scripts manuales:

- `appointment.service.js`: 6.
- `availability.service.js`: 1.
- `payment.service.js`: 6.
- `appointment.notifications.js`: 3.
- `analytics.service.js`: 7 aggregations.

Adicionalmente se auditaron rutas, controladores, middleware de tenant/roles, WebSocket, AuditLog, Client API, tests de aislamiento/pagos/integración, migraciones 6.2.3 y legacy, seeds y scripts de debug que referencian Appointment.

No se encontró un subsistema de cron/jobs específico que opere Appointment en el árbol actual.

## 3. Modelo de ownership y autoridad

### Ownership tenant

**Fuente única propuesta:** `Appointment.business`.

Ningún `worker`, `client`, `service`, header, query param, sesión, `User.role`, `User.business` ni `Business.owner` debe sustituir esta relación.

### CLIENT

Un cliente global no necesita Membership por el hecho de ser cliente.

Autoridad sobre una Appointment existente:

```text
authenticatedUser._id === appointment.client
```

más las reglas de negocio de la operación y, cuando corresponda, una consulta fail-closed del recurso. Para continuidad de invitado no autenticado debe existir una prueba purpose-specific emitida/controlada por servidor; un ObjectId de Appointment por sí solo no es autoridad.

### WORKER

Un worker sólo ejerce autoridad profesional si simultáneamente:

```text
User.isActive === true
Membership.isActive === true
Membership.role === "worker"
Membership.business === Appointment.business
Appointment.worker === User._id
```

La asignación `Appointment.worker` por sí sola no concede autoridad si la Membership fue revocada.

### ADMIN

Un admin sólo puede operar una Appointment cuando:

```text
Membership.isActive === true
Membership.role === "admin"
Membership.business === Appointment.business
```

`User.role === "admin"`, `User.business` o `Business.owner` no son sustitutos válidos.

### SUPERADMIN

ADR-001 mantiene al superadmin fuera de la autoridad tenant. La política propuesta para Appointment es:

- inspección global: **sólo read-only cuando una ruta/plataforma explícita la autorice**;
- mutación tenant: **DENY por defecto**;
- seleccionar/impersonar un Business no concede `admin` tenant sin Membership activa según la política vigente.

Las aggregations globales de analítica actualmente expuestas sólo por rutas `isSuperadmin` son compatibles con esta excepción read-only explícita. No deben convertirse en precedente para mutaciones globales.

### SYSTEM / INTERNAL

Una operación interna puede carecer de `req.businessId`, pero debe demostrar provenance mediante una relación persistente confiable y/o estado de proveedor verificable.

Patrón aceptable:

```text
trusted token/event
    ↓
Payment persistido
    ├── appointment
    └── business
    ↓
Appointment
    └── business (debe coincidir)
```

Patrón no aceptable:

```text
request body arbitrario
    ↓
appointmentId global
    ↓
mutación
```

## 4. Actores e invariantes de autorización

Invariantes obligatorios propuestos:

1. `Appointment.business` es la autoridad de ownership tenant del recurso.
2. `Appointment.service.business === Appointment.business` en creación y en cualquier cambio posterior de servicio.
3. En creación, `Appointment.worker` debe ser un `User` activo con Membership activa `worker` en `Appointment.business`.
4. Si `Service.workers` representa elegibilidad para prestar ese servicio, `Appointment.worker` debe pertenecer también a `Service.workers`. El código actual no impone esta última relación.
5. Un actor tenant de Business A nunca puede usar su autoridad para leer o mutar Appointment de Business B.
6. Client authority deriva de `Appointment.client`, nunca de Membership.
7. Worker authority requiere assignment + User activo + Membership activa `worker` + mismo Business.
8. Admin authority requiere Membership activa `admin` + mismo `Appointment.business`.
9. Superadmin no obtiene autoridad tenant de mutación por su privilegio global.
10. Una mutación interna debe probar la relación persistente que conecta el evento/callback con la Appointment; un ID arbitrario no es prueba suficiente.
11. `Appointment.business` es inmutable en runtime ordinario después de crear la Appointment.
12. Cambios de assignment (`worker`, `service`, fecha/hora) deben ser comandos purpose-specific, revalidar invariantes y no usar updates genéricos.
13. Cambiar `client` no debe estar disponible mediante update genérico.
14. Transiciones de estado deben declarar estados origen permitidos y preferir una actualización atómica/compare-and-set para detectar replay o carreras.

## 5. Matriz final de autorización propuesta

`CONDITIONAL` significa que además de identidad/rol deben cumplirse scope, estado y reglas de negocio de la operación.

| Operación | Client propio | Worker asignado | Admin tenant | Superadmin | System |
|---|---|---|---|---|---|
| Create | CONDITIONAL | CONDITIONAL* | CONDITIONAL* | CONDITIONAL* | DENY por defecto |
| Read detail | ALLOW | CONDITIONAL | CONDITIONAL | CONDITIONAL read-only explícito | CONDITIONAL internal |
| List | CONDITIONAL | CONDITIONAL | CONDITIONAL | CONDITIONAL read-only explícito | CONDITIONAL internal |
| Cancel | CONDITIONAL | CONDITIONAL | CONDITIONAL | DENY | CONDITIONAL purpose-specific |
| Confirm | DENY | CONDITIONAL | CONDITIONAL | DENY | CONDITIONAL por pago/flujo interno probado |
| Complete | DENY | CONDITIONAL | CONDITIONAL | DENY | DENY por defecto |
| Reschedule | CONDITIONAL si producto lo habilita | CONDITIONAL | CONDITIONAL | DENY | DENY por defecto |
| Payment initiation | CONDITIONAL | DENY por rol | DENY por rol | DENY | CONDITIONAL |
| Payment confirmation | DENY directo | DENY directo | DENY directo | DENY | CONDITIONAL con cadena Payment/Webpay verificada |
| Notification read interno | DENY | DENY | DENY | DENY | CONDITIONAL con ID proveniente de evento autorizado |
| Audit read | CONDITIONAL tras autorizar Appointment | CONDITIONAL tras autorizar Appointment | CONDITIONAL tras autorizar Appointment | CONDITIONAL read-only explícito | CONDITIONAL |

`*` La ruta pública de creación no debe conceder capacidad adicional por ser worker/admin/superadmin. Si esos usuarios consumen el flujo público, lo hacen bajo las mismas reglas de booking; su rol no amplía la autoridad de creación.

## 6. Inventario de call sites y fronteras

| Flujo | Actor | Entrypoint | Appointment lookup / write | Business source | Authorization source | R/W | Tenant-safe actual | Observaciones |
|---|---|---|---|---|---|---|---|---|
| Public booking: prevalidación | Public/client | `POST /appointments` | sin lookup Appointment | `scopeBusiness -> req.businessId` | service en Business + worker activo + Membership worker | R | Sí | valida tenant antes de crear invitado |
| Public booking: create | Public/client | `POST /appointments` | `create({ business: req.businessId })` | servidor/middleware | relaciones service/worker + disponibilidad | W | Sí | falta confirmar semántica `Service.workers` |
| Confirm | worker/admin | `PATCH /appointments/:id/confirm` | `findByIdAndBusiness`, `updateByIdAndBusiness` | `req.businessId` | tenantAuthority + assignment worker | R/W | Sí | estado origen demasiado amplio |
| Complete | worker/admin | `PATCH /appointments/:id/complete` | `findByIdAndBusiness`, `updateByIdAndBusiness` | `req.businessId` | tenantAuthority + assignment worker | R/W | Sí | estado origen demasiado amplio |
| Cancel | client/worker/admin | `PATCH /appointments/:id/cancel` | `findByIdAndBusiness`, `updateByIdAndBusiness` | `req.businessId` | client ownership o tenant authority | R/W | Sí | cliente además tiene regla de 2h |
| Read detail | client/worker/admin | `GET /appointments/:id` | `findByIdAndBusiness` | `req.businessId` | client / worker asignado / admin | R | Sí | cross-tenant termina en 404 |
| My appointments | client/worker/admin | `GET /appointments/my` | `findAll(query)` | `req.businessId` | query por worker/client/tenant | R | Sí con businessId | el repo permite `findAll({})` global fuera de este uso |
| Timeline | client/worker/admin | `GET /appointments/:id/timeline` | primero detalle scoped; luego `AuditLog.find({appointmentId})` | Appointment autorizada | misma autorización de detalle | R | Sí por gate | AuditLog no tiene business propio |
| Availability | public/tenant | slots | `findByBusinessWorkerAndDate` | businessId explícito | worker Membership + service Business | R | Sí | resultado 6.2.3 |
| Payment initiation | public | `POST /payments/initiate` | **global `findById` + global `update`** | ignora `req.businessId`; deriva de Appointment | ObjectId + estado | R/W | **No** | BLOCKER: ID global no demuestra client/business ownership |
| Webpay return | external/system | `/payments/webpay-return` | Payment por token; luego global `findById` y global `update` | Appointment cargada | proveedor + token | R/W | Condicional/incompleto | falta enlazar explícitamente Payment.appointment/business con buy_order/Appointment |
| Payment success mail | system | dentro de callback | global `findById` | ID ya procesado | flujo interno | R | Sí como internal read | puede reemplazarse por read purpose-specific |
| Booking notification | system | `setImmediate` | global `findById` | ID creado por servicio | evento interno | R | Sí como internal read | 1 de 3 lecturas globales de notification |
| Confirm notification | system | `setImmediate` | global `findById` | ID ya autorizado | evento interno | R | Sí como internal read | sin mutación |
| Cancel notification | system | `setImmediate` | global `findById` | ID ya autorizado | evento interno | R | Sí como internal read | sin mutación |
| Global metrics | superadmin | `/superadmin/metrics` | 2 `aggregate()` | businessId opcional | `isSuperadmin`, read-only | R | Sí bajo política explícita | global cuando no se entrega businessId |
| Advanced analytics | superadmin | `/superadmin/analytics` | 5 `aggregate()` | businessId opcional | `isSuperadmin`, read-only | R | Sí bajo política explícita | con businessId hace `$match` tenant antes de group/lookup |
| WebSocket availability | tenant/system | Socket.IO | no recupera Appointment | room incluye business/worker/date | Membership revalidada | event | Sí | no usa lookup global de Appointment |
| Legacy migration | operador manual | `migrate-multi-tenancy.js` | `Appointment.updateMany` global | Business legacy fijo | operador | W | No como runtime | DEBT; no ejecutar; fuera del contrato runtime |
| 6.2.3 migration | operador aislado | `availability-tenantization.js` | snapshot Appointment + DDL índices | Appointment.business | guards de migración | R/DDL | Sí para propósito 6.2.3 | no backfillea ownership Appointment |
| Debug July 7 | operador manual | `scratch_check_july_7.js` | `Appointment.find` global por worker/date | URI derivada a `/agenda` | ninguna de app | R | No como herramienta segura | DEBT: script apunta explícitamente a DB prod derivada |
| Seed production | operador manual | `seed-production.js` | `Appointment.insertMany` | business generado en seed | operador | W | fuera de runtime | no ejecutar; fuera de 6.2.4-A |

### Tests relevantes auditados

- `tenantResourceIsolation.test.js`: prueba explícita de Admin A contra Appointment B y espera `404`; verifica que B no cambia.
- `api.test.js`: booking público rechaza service/worker de tenant distinto antes de crear invitado/Appointment.
- `auditPayment.test.js`: cubre booking invitado + inicio público de Webpay + callback exitoso, pero **no** incluye intento adversarial de iniciar pago con Appointment de otro tenant/cliente.
- `integration.test.js`: cubre booking, confirm y cancel administrativos.
- fixtures de test limpian exclusivamente con `NODE_ENV=test` y base terminada en `_test`.
- tests 6.2.3 cubren tenantización e índice de disponibilidad; no sustituyen un contrato de ownership de Appointment para pagos.

## 7. Repository contracts actuales y contrato propuesto

### Contrato actual

`appointmentRepository` expone simultáneamente APIs tenant-safe y APIs globales:

**Tenant-scoped:**

- `findByBusinessWorkerAndDate(businessId, workerId, date)`
- `findByIdAndBusiness(id, businessId)`
- `updateByIdAndBusiness(id, businessId, data)`

**Genéricas/globales:**

- `findById(id)`
- `update(id, data)`
- `findAll(query = {})`
- `aggregate(pipeline)`

El principal riesgo arquitectónico no es que toda lectura global sea ilegítima; es que el repositorio no expresa en el nombre/tipo de API **qué provenance autoriza** un acceso global y que `update(id, data)` permite un futuro uso cross-tenant accidental.

Además, `update()` y `updateByIdAndBusiness()` reciben `data` genérico. Aunque los call sites runtime actuales sólo envían estados/paymentStatus, ese contrato permitiría escribir `business`, `worker`, `service` o `client` si un futuro caller pasa esos campos.

### Contrato recomendado para 6.2.4-B

1. Eliminar el uso tenant de APIs globales.
2. Reemplazar mutaciones genéricas por comandos purpose-specific y con estado esperado, por ejemplo:
   - `transitionStatusByBusiness({ id, businessId, fromStatuses, toStatus, patch })`
   - `reassignWorkerByBusiness(...)`
   - `changeServiceByBusiness(...)`
   - `rescheduleByBusiness(...)`
3. Para cliente autenticado, preferir consultas que incorporen ownership cuando corresponda: `{ _id, business, client }`.
4. Para pagos, crear métodos que requieran la relación persistente/capability necesaria; nunca un `appointmentId` global aislado.
5. Si algunas lecturas globales internas siguen siendo legítimas, separarlas o nombrarlas explícitamente como internal-only, con provenance documentada. Ejemplo: `findByIdForNotificationInternal`.
6. Confinar `aggregate()` global a un módulo read-only de analítica/superadmin en vez de presentarlo como herramienta general del repositorio de dominio.
7. Agregar tests source-boundary en 6.2.4-B sólo después de aprobar este contrato, para impedir que controladores/servicios tenant vuelvan a importar una mutación global.

## 8. Payment / Webpay boundaries

### Inicio de pago — BLOCKER

Flujo actual:

```text
POST /payments/initiate (público)
    ↓ body.appointmentId
scopeBusiness resuelve req.businessId
    ↓
payment.controller NO pasa businessId/identidad
    ↓
appointmentRepository.findById(appointmentId)  [global]
    ↓
Appointment.business derivado del recurso
    ↓
appointmentRepository.update(appointmentId, pending_payment) [global]
    ↓
Payment.create({ appointment, business })
```

El `business` persistido de Payment es correcto una vez elegida la Appointment, pero el problema ocurre antes: la petición pública puede presentar un ObjectId y el flujo no demuestra que esa Appointment pertenece al contexto público seleccionado ni que el actor sea su cliente/posea una continuidad de booking válida.

**Decisión propuesta:** un ObjectId de Appointment no es bearer capability.

6.2.4-B debe enlazar initiation con una de estas pruebas válidas:

- cliente autenticado: `appointment.client === authenticatedUser` + mismo `appointment.business`;
- invitado: capability opaca, corta y purpose-specific emitida por servidor para continuar el booking/pago, ligada a Appointment + Business; o una relación Payment pendiente creada por servidor y continuada mediante token no derivable.

Esto define continuidad del recurso; no debe convertirse en implementación de identidad progresiva 6.2.5.

### Callback / retorno Webpay — HIGH

El callback sí parte de un `token_ws` y consulta `Payment` persistido, lo que es una base legítima para autoridad de sistema. Sin embargo, después del commit el código sobrescribe `appointmentId` con `commitResponse.buy_order`, vuelve a cargar Appointment globalmente y no comprueba explícitamente antes de mutar que:

```text
Payment.transactionId === token_ws
Payment.status === "pending"
Payment.appointment === commitResponse.buy_order
Payment.business === Appointment.business
Appointment.status === "pending_payment"
```

El código valida `Appointment.status`, monto y un `buy_order` que en ese punto se compara contra el mismo valor usado para cargar la Appointment; esa comparación no sustituye la relación con el `Payment` persistido.

6.2.4-B debe convertir la cadena persistente en el proof principal, hacer la transición idempotente/expected-state y fallar cerrado ante replay/mismatch. No se propone cambiar Webpay ni refunds en 6.2.4-A.

## 9. Mutabilidad de campos de ownership/assignment

| Campo | Propuesta | Motivo / condición |
|---|---|---|
| `business` | **Inmutable en runtime** | cambiarlo cambia el tenant owner; una transferencia cross-business debe ser workflow explícito o cancel/recreate, nunca update genérico |
| `worker` | **Mutable sólo dentro del mismo tenant** | reschedule/reassign dedicado; destino User activo + Membership worker activa del mismo Business + disponibilidad + elegibilidad del servicio |
| `service` | **Mutable sólo dentro del mismo tenant** | command dedicado; Service.business debe coincidir; recalcular duration/endTime, disponibilidad y efectos de precio/pago |
| `client` | **No mutable por update genérico** | cambiarlo transfiere client ownership; corrección/merge de identidad requiere flujo dedicado y auditado, ligado a 6.2.5 cuando corresponda |

`date`, `startTime` y `endTime` son assignment operacional, no ownership tenant, pero cualquier reschedule debe revalidar disponibilidad e invariantes bajo el mismo Business.

### Revocación de worker

La baja actual de Membership conserva Appointments históricas, lo cual es correcto. Sin embargo, una Appointment futura puede quedar asignada a un worker cuya Membership ya no está activa.

Contrato propuesto:

- conservar historia sin reescribir owner/assignment pasado;
- al revocar Membership, no conceder autoridad al ex-worker aunque siga en `appointment.worker`;
- las citas futuras afectadas deben quedar visibles para admin y requerir resolución explícita (reassign same-tenant o cancel según negocio), nunca transferencia automática silenciosa.

## 10. Aggregations

Se encontraron **7** `Appointment.aggregate(...)` runtime, todas a través de `appointmentRepository.aggregate` desde `analytics.service`:

- 2 en global metrics.
- 5 en advanced analytics.

Con `businessId`, los pipelines incorporan `$match` por Business antes de agrupaciones/joins relevantes. Sin `businessId` son globales y sólo se alcanzan por rutas superadmin autenticadas/read-only.

Clasificación: **DEBT de boundary**, no vulnerabilidad tenant activa. El riesgo es que `aggregate(pipeline)` permanezca disponible como API genérica reutilizable por un caller tenant futuro.

## 11. WebSocket, notificaciones y AuditLog

### WebSocket

No recupera Appointment globalmente. Los eventos de disponibilidad se publican en rooms que incluyen `business`, `worker` y `date`; la autorización de sockets revalida Membership. No se detecta bypass de ownership de Appointment en esta frontera.

### Notificaciones

Hay 3 lecturas globales `appointmentRepository.findById()` en helpers asíncronos de notificación. Los IDs provienen actualmente de una creación/mutación de Appointment ya validada y las funciones no mutan Appointment.

Clasificación: **LOW**. Son internal reads legítimos con provenance implícita, pero conviene que el contrato futuro la haga explícita para evitar que un helper de efectos laterales termine aceptando IDs de input público.

### AuditLog

`AuditLog` guarda `appointmentId` y `userId`, pero no `business`. El timeline actual es razonablemente seguro porque primero ejecuta `getAppointmentDetails()` tenant-scoped y sólo después consulta logs por `appointmentId`.

Clasificación: **LOW/DEBT**. Mientras toda lectura de timeline esté subordinada a una Appointment autorizada no hay exposición cross-tenant detectada. Si AuditLog adquiere búsquedas independientes, reportes tenant o mutaciones propias, deberá incorporar Business o un boundary equivalente.

## 12. Modelo de error

Principio general: fail-closed y minimizar enumeración de recursos.

- Appointment de Business B consultada/operada desde autoridad tenant A: **404** genérico. No confirmar existencia.
- Worker de A intentando Appointment de otro worker dentro de A: **403** después de haber probado que el recurso pertenece a A; 404 también es aceptable si se adopta ocultamiento uniforme.
- Cliente autenticado intentando Appointment de otro cliente del mismo Business: **403** si el producto distingue ownership dentro del tenant; se recomienda evaluar 404 uniforme para endpoints de cliente si reduce enumeración.
- Capability pública de booking/pago ausente, inválida o ligada a otro recurso: **404/continuación inválida** sin confirmar que el Appointment existe.
- Estado incompatible/replay sobre un recurso ya autorizado: **409 Conflict** o error de transición equivalente; no confundir con autorización.
- Membership revocada: **403** para un recurso del mismo tenant; cross-tenant sigue siendo 404.

## 13. Hallazgos

### BLOCKER

**APT-PAY-01 — Inicio público de pago usa Appointment ID global como autoridad implícita.**  
`POST /payments/initiate` recibe `appointmentId`, `scopeBusiness` resuelve contexto pero el controller no lo pasa al servicio. `initiatePayment()` hace `findById()` y `update()` globales y deriva el Business desde la Appointment. No prueba `appointment.client`, contexto tenant ni una capability de invitado. Debe corregirse antes de considerar 6.2.4 cerrada.

### HIGH

**APT-PAY-02 — Callback Webpay no encadena explícitamente Payment persistido -> Appointment -> Business antes de mutar.**  
Existe la relación persistida, pero no se comprueba de manera completa contra `buy_order`, business y estado `pending` del Payment. Requiere contrato purpose-specific, idempotencia y expected-state.

**APT-REP-01 — `appointmentRepository.update(id, data)` y mutaciones genéricas permiten saltarse ownership/field boundaries.**  
No hay hoy endpoint de update arbitrario, pero el contrato hace fácil que un futuro caller mutile tenant/assignment accidentalmente. Debe dejar de ser API general para código tenant.

### MEDIUM

**APT-REL-01 — La creación no comprueba `Service.workers` contra `Appointment.worker`.**  
Sí valida Service.business y Membership worker del Business. Si `Service.workers` es la lista autoritativa de profesionales habilitados para ese servicio, falta imponer la relación. Propuesta: tratarla como elegibilidad y validarla en create/reassign/change-service.

**APT-LIFE-01 — Revocar Membership worker conserva correctamente historia, pero puede dejar citas futuras asignadas sin autoridad profesional vigente.**  
Debe existir política explícita de resolución para futuras citas; nunca mantener autoridad por `appointment.worker` solamente.

**APT-STATE-01 — Confirm/complete y Payment updates no expresan una máquina de estados atómica.**  
Confirm/complete sólo excluyen `cancelled`; las mutaciones no comparan siempre estado origen en el mismo write. Riesgo de carreras/replay y transiciones semánticamente inválidas.

### LOW

**APT-NOTIF-01 — Notificaciones hacen 3 `findById` globales internal-only.**  
Provenance actualmente confiable y sin mutación; conviene método internal explícito.

**APT-AUDIT-01 — AuditLog carece de Business propio.**  
Timeline está protegido por autorización previa de Appointment, pero el boundary sería frágil ante búsquedas independientes futuras.

### DEBT

**APT-AGG-01 — `aggregate(pipeline)` global sigue expuesto en el repositorio general.**  
Uso actual: analytics superadmin read-only; debe confinarse para impedir reutilización tenant accidental.

**APT-LEGACY-01 — `migrate-multi-tenancy.js` contiene `Appointment.updateMany` global legacy.**  
No forma parte de runtime y no debe ejecutarse; carece de las protecciones operativas modernas.

**APT-OPS-01 — Existen scripts debug/seed capaces de leer o escribir Appointment fuera de los boundaries runtime.**  
Incluye un debug que deriva URI `/agenda` y `seed-production.js`. Deben tratarse como herramientas legacy/manuales, no como autoridad de dominio. No fueron ejecutados durante esta auditoría.

## 14. Alcance recomendado para 6.2.4-B

### DEBE RESOLVERSE EN 6.2.4

1. Corregir `APT-PAY-01`: payment initiation no puede autorizarse con ObjectId global; bind a Business + client ownership o capability purpose-specific de booking/pago.
2. Corregir `APT-PAY-02`: callback debe validar de forma atómica/lógica la cadena Payment `pending` + token + appointment + business + provider buy_order + Appointment `pending_payment` antes de mutar.
3. Sustituir usos globales de `appointmentRepository.update()` en runtime por mutaciones purpose-specific.
4. Impedir que `business`, `client`, `worker` y `service` se alteren mediante un patch genérico.
5. Declarar `business` inmutable en runtime normal.
6. Implementar comandos tenant-scoped para cualquier reassign/reschedule/change-service que el producto ya necesite; si no existe UI/endpoint todavía, al menos establecer el boundary y tests para futuras implementaciones.
7. Revalidar User/Membership worker activa al operar como profesional y en cualquier reassignment.
8. Definir/validar `Service.workers` como elegibilidad si se confirma su semántica vigente.
9. Endurecer transiciones de estado con estados origen explícitos/compare-and-set y tests de replay/race relevantes.
10. Añadir tests adversariales mínimos: Payment initiate cross-tenant/cross-client; callback Payment/Appointment/business mismatch; worker Membership revocada; intentos de mutar ownership; estados inválidos.
11. Confinar global read/aggregate APIs a módulos internal/read-only cuando sigan justificadas.
12. Mantener error cross-tenant 404 fail-closed.

### Preguntas que la revisión adversarial debe cerrar antes de runtime

1. ¿`Service.workers` es una relación autoritativa de elegibilidad o sólo metadato/UI? Propuesta de este documento: **autoritativa**.
2. ¿La continuidad de pago de invitado se resuelve mejor mediante capability corta ligada a la Appointment o creando Payment pendiente antes de redirigir? Ambas evitan usar ObjectId como bearer token; la revisión debe elegir una sin entrar en identidad progresiva.
3. ¿El cliente autenticado debe recibir 403 o 404 al consultar una cita ajena dentro del mismo tenant? Cross-tenant queda fijado en 404 en cualquier caso.

## 15. Deuda diferida / fuera de alcance

Diferir explícitamente:

- identidad progresiva y consolidación de cliente: 6.2.5;
- admin + worker simultáneo como rediseño de roles;
- refunds;
- SII;
- billing general;
- microservicios;
- responsive;
- creación/baseline real de Atmósfera o DAM;
- ejecución de migraciones;
- limpieza general de seeds/debug legacy que no sea necesaria para cerrar ownership runtime;
- rediseño funcional de Payments/Webpay más allá de las boundaries de ownership necesarias para Appointment.

## Decisión de salida de 6.2.4-A

6.2.4-A **no autoriza 6.2.4-B automáticamente**. El contrato debe pasar revisión adversarial antes de modificar runtime.

La fase documental concluye con una vulnerabilidad/boundary activa clasificada **BLOCKER (`APT-PAY-01`)**, por lo que no se deben ampliar cambios funcionales dentro de este Draft. La acción correcta es documentar, revisar adversarialmente y sólo después autorizar el parche 6.2.4-B.

Confirmaciones de alcance de esta auditoría:

- cero cambios funcionales/runtime;
- cero tests de comportamiento modificados;
- cero migraciones ejecutadas;
- cero datos reales creados/modificados;
- cero acceso a producción;
- Payments/Webpay sólo fueron inspeccionados;
- 6.2.5 no fue iniciado.
