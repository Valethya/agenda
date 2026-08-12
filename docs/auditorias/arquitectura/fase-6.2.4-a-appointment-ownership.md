# Fase 6.2.4-A — Auditoría y contrato de ownership de Appointment

Fecha de auditoría: 2026-08-12  
Base exacta revisada: `master@a91dddbbc5482ee192944a05d9203de47e021dae`  
HEAD adversarial de entrada para esta corrección: `04abed55d5795645279a1161d1df2f86e1440782`  
Origen de la base: merge de PR #23 (`6.2.3 tenantización de disponibilidad`).  
Naturaleza: **arquitectónica/documental**. Este documento no autoriza cambios runtime, migraciones, seeds ni acceso a producción.

---

## 1. Alcance y decisiones que no se reabren

Las decisiones arquitectónicas vigentes continúan siendo:

- `User` representa identidad global y privilegios de plataforma.
- `Membership` activa representa participación y autoridad tenant.
- los roles físicos actuales de `Membership` son `admin | worker`.
- existe como máximo una `Membership` por `{ user, business }`.
- `Business.owner` expresa propiedad, pero no concede autoridad tenant.
- `User.role` y `User.business` heredados no conceden autoridad tenant.
- `superadmin` es un privilegio global, no un rol `Membership`.
- seleccionar un Business aporta contexto, no autoridad.
- `req.tenantAuthority` es la autoridad tenant revalidada desde persistencia.
- `businessId` de sesión no es autoridad.
- `Appointment.business` es obligatorio y expresa ownership tenant del recurso.
- `Appointment.business` debe ser inmutable en runtime ordinario.
- `Service.workers` será una allowlist autoritativa de elegibilidad profesional.
- `Service.workers=[]` significa **ningún profesional elegible**.
- Service inactivo no debe generar nueva availability ni nuevas Appointments.
- desactivar un Service no altera automáticamente Appointments ya creadas o históricas.
- mutaciones de Appointment deben ser purpose-specific y proteger ownership/assignments.
- transiciones de estado deben declarar expected-state y usar CAS cuando haya replay/carreras.
- el modelo de error de recursos protegidos es 404/403/409 según la frontera definida más adelante.
- el timeline funcional debe usar una proyección segura allowlist.
- Payment/Webpay es opcional y está fuera del MVP.
- 6.2.5 (identidad progresiva del cliente) no se implementa en esta fase ni en este PR.

El objetivo de 6.2.4-A es congelar un contrato que permita implementar 6.2.4-B sin consolidar una autorización incorrecta para Client ni una equivalencia incorrecta entre `Membership.role=worker` y la capacidad de prestar servicios.

Modelo conceptual:

```text
Appointment
├── business  -> ownership tenant del recurso
├── client    -> relación persistida de dominio/contacto; NO prueba identidad por sí sola
├── worker    -> assignment profesional
├── service   -> prestación asociada dentro del mismo tenant
└── status    -> estado operacional
```

`Appointment.business` responde **a qué tenant pertenece el recurso**. Ninguno de los demás campos concede por sí solo autoridad para operar.

---

## 2. Separación de alcance

### 2.1 MVP CORE — 6.2.4

El núcleo MVP de 6.2.4 debe cerrar:

- ownership tenant de Appointment;
- separación entre relación `Appointment.client` y Client authority verificada;
- capacidades independientes Client / profesional asignado / Admin / superadmin;
- coherencia `Appointment.business` / `Service.business` / Membership;
- elegibilidad profesional mediante `Service.workers`;
- compatibilidad con propietarios/admin que también prestan servicios;
- Service activo para nueva availability y booking;
- mutaciones purpose-specific;
- campos de ownership/assignment protegidos;
- transiciones de estado explícitas y CAS;
- repository boundaries;
- modelo de error fail-closed;
- timeline/AuditLog con proyección segura.

### 2.2 PAYMENT / WEBPAY — FUERA DEL MVP

Webpay **no es requisito del MVP de Agenda**.

Reglas de separación:

- Appointment/Booking debe funcionar completamente sin Payment.
- Payment es un módulo opcional.
- Webpay es un adapter externo reemplazable de Payment.
- Appointment no conoce `token_ws`, `buy_order`, códigos de autorización ni conceptos específicos de Transbank.
- Payment puede referenciar Appointment, pero no sustituye su autoridad tenant.
- un Business sin pagos debe completar Booking sin tocar Payment.
- fallos de Payment/Webpay no pueden corromper Appointments ajenas ni módulos no relacionados.

Los hallazgos `APT-PAY-01/02/03/04` son **BLOCKER BEFORE PAYMENT ENABLEMENT**. No bloquean conceptualmente el MVP Core si Payment/Webpay está efectivamente deshabilitado.

El código actual, sin embargo, monta `/api/payments` sin feature flag visible y declara públicas:

```text
POST /api/payments/initiate
POST /api/payments/webpay-return
GET  /api/payments/webpay-return
```

Por tanto, antes de un release MVP debe ocurrir una de estas dos cosas:

1. **opción recomendada:** deshabilitar/no montar Payment/Webpay mediante configuración deny-by-default; o
2. corregir `APT-PAY-01/02/03/04` antes de mantener esas rutas accesibles.

Esta auditoría no sondea producción.

---

## 3. Estado actual relevante

### 3.1 Inventario Appointment

Se mantienen **23 invocaciones directas de persistencia de Appointment en runtime** auditadas:

- `appointment.service.js`: 6.
- `availability.service.js`: 1.
- `payment.service.js`: 6.
- `appointment.notifications.js`: 3.
- `analytics.service.js`: 7 aggregations.

Además se revisaron controllers, routes, middleware tenant, auth/sesiones, Membership, Service, Payment/Webpay, WebSocket, AuditLog/timeline, tests, migraciones, seeds y scripts legacy.

### 3.2 Estado actual de identidad guest

`getOrCreateGuestUser()` actualmente puede:

- buscar un `User` existente por email;
- si no lo encuentra, buscar por teléfono;
- reutilizar ese `User`;
- añadir email/teléfono adicionales a ese mismo `User`;
- o crear un `User` nuevo para la reserva guest.

Esos contactos no se verifican como condición de la reserva.

ADR-001 establece explícitamente que una coincidencia de contacto no verificado:

- no fusiona identidades;
- no concede historial;
- no concede gestión de citas anteriores;
- requiere verificación antes de vincular definitivamente identidad/contacto.

Además, los guest users creados durante booking no reciben una sesión autenticada. El login normal actual tampoco entrega una sesión tenant ordinaria a un User sin Membership.

Consecuencia: `Appointment.client` actual es una **relación persistida de dominio/contacto**, pero no una prueba completa de identidad ni de Client authority.

### 3.3 Divergencia legacy de identidad detectada

Durante este contraste se confirma una divergencia adicional ya perteneciente al trabajo de identidad progresiva: `getOrCreateGuestUser()` crea actualmente un password aleatorio desconocido para un guest nuevo, mientras ADR-001 prohíbe contraseñas aleatorias desconocidas por el cliente.

Se documenta como **`ID-LEGACY-01 — DEBT / 6.2.5`**.

No se corrige en 6.2.4-A ni debe expandir 6.2.4-B hacia implementación de identidad.

### 3.4 Membership y propietarios que prestan servicios

El modelo actual impone:

```text
Membership.role ∈ { admin, worker }
unique { user, business }
```

Por tanto una misma persona no puede mantener dos Membership separadas `admin` y `worker` para un mismo Business.

PR #21 fijó la baseline inicial de Atmósfera y DAM como propietarios con Membership `admin`, sin crear identidades `worker` artificiales, y dejó explícito que esas personas también prestan servicios aunque todavía no fueran profesionales agendables en 6.2.2-C.

El runtime actual, en cambio, acopla profesional a `role=worker`:

- booking exige `Membership.role === "worker"`;
- availability exige `Membership.role === "worker"`;
- `canOperateAsAssignedWorker()` exige `tenantRole === "worker"`.

Ese acoplamiento no puede convertirse en el contrato futuro de 6.2.4-B.

### 3.5 Holiday es una dependencia global actual

`availability.service` consulta:

```text
holidayRepository.findByDate(targetDate)
```

El modelo `Holiday` no contiene `business` y su `date` es única globalmente.

Por tanto, aunque Shift, Block y las consultas de Appointment estén tenant-scoped, availability todavía consume una política Holiday global cuyo significado tenant no está declarado formalmente.

Se clasifica como **`HOLIDAY-POLICY-01 — DEBT / CROSS-TENANT POLICY TO CLARIFY`**.

No es blocker de Appointment ownership y no se tenantiza en 6.2.4. Antes de permitir feriados específicos por negocio deberá decidirse en una fase separada si `Holiday` es deliberadamente global/plataforma o debe adquirir scope de Business.

Mientras esa decisión esté pendiente, no debe describirse availability como “completamente tenantizada” en sentido absoluto; sus recursos de agenda principales están tenant-scoped, pero Holiday sigue siendo una política global compartida.

---

## 4. Ownership y capacidades

### 4.1 Ownership tenant

Fuente única:

```text
Appointment.business
```

Ningún `worker`, `client`, `service`, header, query param, sesión, `User.role`, `User.business`, `Business.owner`, Payment ni provider externo sustituye esta relación.

### 4.2 Las capacidades no son categorías excluyentes

Un mismo `User` puede simultáneamente:

- estar relacionado como `Appointment.client`;
- tener una Membership `admin` o `worker`;
- estar incluido en `Service.workers`;
- estar asignado como `Appointment.worker`;
- poseer privilegio global `superadmin`.

Cada operación evalúa la capacidad concreta que el actor presenta. Una capacidad no se anula por la existencia de otra.

---

## 5. APT-CLIENT-01 — BLOCKER CORE BEFORE 6.2.4-B CONTRACT FREEZE

### 5.1 Problema

La regla anterior:

```text
authenticatedUser._id === Appointment.client
```

es insuficiente como prueba completa de Client authority histórica.

Debido al comportamiento actual de `getOrCreateGuestUser()`, varias reservas guest pueden quedar asociadas a un mismo `User` por coincidencias de email/teléfono que no fueron verificadas. Autenticar en el futuro ese `User` no puede legitimar retroactivamente todas las asociaciones guest históricas vinculadas a su `_id`.

### 5.2 Separación contractual

Deben distinguirse dos conceptos:

**A. Relación persistida de dominio/contacto**

```text
Appointment.client -> User/contact record
```

Sirve para relacionar operacionalmente la Appointment con el registro utilizado al reservar. No es por sí sola prueba de que una request posterior pertenezca a la misma persona.

**B. Client authority verificada**

Conceptualmente:

```text
verified client relationship/capability
        ↓
Appointment
```

La prueba concreta será definida por 6.2.5 para identidad autenticada/histórica.

Para un cliente autenticado creado/vinculado de forma segura en el futuro, la coincidencia con la identidad global podrá formar parte de la prueba, pero sólo después de que exista un binding verificado que determine qué relaciones históricas pertenecen realmente a esa identidad.

### 5.3 Invariantes Client

- `Appointment.client` no es por sí solo Client authority.
- email/teléfono no verificado no es identidad.
- `clientId` no es bearer capability.
- autenticar un `User` no hace administrables automáticamente todas las Appointments históricas asociadas a ese `_id` por matching guest previo.
- acceso a historial y gestión histórica requieren relación/verificación establecida por la política de identidad progresiva.
- 6.2.4-B **no implementa 6.2.5**.
- 6.2.4-B sí debe evitar introducir o consolidar una primitive reutilizable que autorice historial sólo por `authenticatedUser._id === Appointment.client`.
- mientras 6.2.5 no provea el binding verificado, las operaciones Client históricas protegidas no deben obtener autoridad nueva por inferencia de contacto.
- una capability purpose-specific puede autorizar una operación concreta sin convertirse en identidad general.

---

## 6. APT-WORKER-CAP-01 — BLOCKER CORE

### 6.1 Problema

`Membership.role=worker` no puede seguir siendo un requisito universal para que una persona sea profesional agendable.

Con una Membership única por `{user,business}`, exigir una segunda Membership `worker` impediría que un propietario/admin pueda prestar servicios sin rediseñar Membership o duplicar identidad, contradiciendo la baseline de PR #21.

### 6.2 Separación: autoridad tenant vs elegibilidad profesional

**Autoridad tenant** deriva de Membership.

Ejemplos:

- `Membership.role=admin` concede capacidades administrativas definidas para el tenant.
- `Membership.role=worker` concede las capacidades tenant operativas asociadas a ese rol.
- una Membership activa sigue siendo obligatoria para participar en operaciones tenant protegidas.

**Elegibilidad profesional para un Service** deriva de una relación explícita distinta:

```text
User activo
+ Membership activa en el mismo Business
+ User ∈ Service.workers
+ Service.business correcto
+ invariantes Service/Business
```

`Service.workers` expresa **qué personas pueden prestar ese Service**.

No concede privilegios administrativos.

No sustituye Membership.

No crea un rol tenant nuevo.

### 6.3 Capacidad profesional asignada sobre Appointment

Para operar específicamente como profesional asignado:

```text
User.isActive === true
Membership.isActive === true
Membership.business === Appointment.business
User._id ∈ Appointment.service.workers
Appointment.worker === User._id
```

El rol físico de esa Membership puede ser `worker` o `admin` bajo el esquema actual; lo relevante para esta capacidad concreta es que exista participación tenant activa y que la elegibilidad profesional esté expresada por `Service.workers` + assignment.

Esto permite que un propietario con Membership `admin` pueda ser profesional asignado cuando el Service lo incluya explícitamente, sin crear una segunda Membership imposible bajo el índice único.

Un `admin` no incluido en `Service.workers` **no** adquiere elegibilidad profesional por ser admin, aunque pueda tener separadamente capacidades administrativas sobre Appointments según la operación.

Un `worker` con Membership activa pero no incluido en `Service.workers` **no** es elegible para prestar ese Service.

### 6.4 Multirol formal

Un sistema formal de múltiples roles/permissions dentro de Membership sigue fuera de 6.2.4.

No es necesario resolverlo para permitir que un admin preste servicios: la autoridad tenant y la elegibilidad profesional son dimensiones distintas.

6.2.4-A no modifica el modelo Membership.

---

## 7. Capacidad ADMIN

Para operar bajo capacidad administrativa:

```text
User.isActive === true
Membership.isActive === true
Membership.role === 'admin'
Membership.business === Appointment.business
```

Además el Business debe encontrarse activo según la autoridad tenant vigente.

No sustituyen esta prueba:

- `User.role` heredado;
- `User.business` heredado;
- `Business.owner`;
- `session.businessId`;
- seleccionar un Business.

La inclusión en `Service.workers` tampoco concede capacidad ADMIN.

---

## 8. Privilegio SUPERADMIN

El privilegio global por sí solo:

- puede autorizar inspección global read-only cuando exista una política explícita;
- no autoriza mutación tenant;
- seleccionar/impersonar Business no crea Membership ni capacidad admin.

Si el mismo User posee una Membership activa válida en `Appointment.business`, esa Membership se evalúa independientemente. El privilegio superadmin no anula ni amplía la Membership.

---

## 9. SYSTEM / INTERNAL

Una operación interna puede no tener `req.businessId`, pero debe demostrar provenance persistente y estado esperado.

Un ObjectId arbitrario nunca constituye autoridad.

Ejemplo válido para un módulo opcional de pagos:

```text
trusted callback token
    ↓
Payment persistido válido
    ├── appointment
    ├── business
    └── economic intent
    ↓
Appointment tenant consistente
```

---

## 10. Service y elegibilidad profesional

### 10.1 `Service.workers` es allowlist autoritativa

```text
Service.workers = [u1, u2]  -> sólo u1 y u2 pueden prestar ese Service
Service.workers = []        -> ningún profesional elegible
```

Un array vacío nunca significa “todos”.

### 10.2 Create/update Service

6.2.4-B deberá aceptar en `Service.workers` únicamente Users que:

- existan;
- tengan `User.isActive === true`;
- tengan Membership activa en el mismo Business del Service;
- satisfagan las invariantes de Business.

**No** debe exigir universalmente `Membership.role === "worker"`.

Una Membership `admin` activa es compatible con elegibilidad profesional si el User está explícitamente incluido en `Service.workers`.

La validación de forma ObjectId no es suficiente.

### 10.3 Public booking y availability

Para publicar slots o crear una Appointment nueva deben cumplirse:

```text
Service.business === targetBusiness
Service.isActive === true
Professional User.isActive === true
Professional tiene Membership activa en targetBusiness
Professional User._id ∈ Service.workers
Business activo
```

No se concede autoridad administrativa mediante esta validación.

### 10.4 Service inactivo

Estado actual: booking y availability consultan Service sin `onlyActive=true`.

Invariante:

- un Service debe estar activo al publicar nueva disponibilidad y al crear una Appointment nueva;
- desactivarlo posteriormente no reescribe, invalida ni elimina automáticamente Appointments existentes/históricas.

### 10.5 Fixtures y datos legacy

La semántica `workers=[] => ninguno` y la separación de roles puede revelar fixtures/datos legacy incompatibles.

Antes de enforcement real deben auditarse:

- fixtures/tests;
- seeds de desarrollo/test;
- datos legacy;
- Services cuyos workers no tengan Membership activa en el mismo Business;
- propietarios/admin que deban ser incluidos explícitamente como profesionales.

6.2.4-A no ejecuta migraciones ni seeds.

---

## 11. Matriz de autorización corregida

Las columnas son capacidades independientes. `NO GRANT` significa que esa capacidad por sí sola no autoriza; el mismo User puede satisfacer otra capacidad válida.

| Operación | Client verificado / capability Client | Profesional asignado | Membership Admin | Superadmin global | System / capability purpose-specific |
|---|---|---|---|---|---|
| Create booking público | CONDITIONAL según flujo público | NO GRANT adicional | NO GRANT adicional | NO GRANT adicional | CONDITIONAL sólo flujo interno explícito |
| Read detail | CONDITIONAL futuro con binding verificado | CONDITIONAL | CONDITIONAL | CONDITIONAL read-only explícito | CONDITIONAL internal |
| List | CONDITIONAL futuro, sólo recursos vinculados/verificados | CONDITIONAL, sólo asignados | CONDITIONAL tenant | CONDITIONAL read-only explícito | CONDITIONAL internal |
| Cancel | CONDITIONAL futuro + regla negocio | CONDITIONAL | CONDITIONAL | NO GRANT | CONDITIONAL purpose-specific |
| Confirm | NO GRANT por Client | CONDITIONAL | CONDITIONAL | NO GRANT | CONDITIONAL sólo flujo interno definido |
| Complete | NO GRANT por Client | CONDITIONAL | CONDITIONAL | NO GRANT | DENY por defecto |
| Reschedule | CONDITIONAL futuro si producto lo habilita | CONDITIONAL | CONDITIONAL | NO GRANT | DENY por defecto |
| Payment initiation si se habilita | CONDITIONAL Client verificado o guest payment capability | NO GRANT adicional; puede aplicar otra capacidad Client | NO GRANT adicional; puede aplicar otra capacidad Client | NO GRANT adicional; puede aplicar otra capacidad Client | CONDITIONAL guest payment capability |
| Payment callback si se habilita | NO GRANT directo | NO GRANT directo | NO GRANT directo | NO GRANT directo | CONDITIONAL Payment persistido + provider proof |
| Notification read interno | NO GRANT directo | NO GRANT directo | NO GRANT directo | NO GRANT directo | CONDITIONAL provenance interno |
| Timeline funcional | CONDITIONAL futuro tras binding/authorization | CONDITIONAL | CONDITIONAL | CONDITIONAL read-only explícito | CONDITIONAL con safe projection |
| Global analytics | NO GRANT | NO GRANT | NO GRANT | ALLOW read-only explícito | CONDITIONAL internal |

Reglas esenciales:

- las capacidades no son roles mutuamente excluyentes;
- `Appointment.client` no crea por sí solo la columna Client;
- `Membership.role=worker` no crea por sí solo la columna Profesional asignado;
- `Service.workers` + assignment no crean la columna Admin.

---

## 12. Inventario de fronteras actualizado

| Flujo | Appointment lookup/write | Prueba actual | Estado contractual |
|---|---|---|---|
| Public booking prevalidación | sin lookup Appointment | Service tenant + User activo + `Membership.role=worker` | Parcial: debe pasar a Membership activa + `Service.workers` + Service activo |
| Public booking create | `create({business:req.businessId})` | disponibilidad + relaciones actuales | Parcial: cerrar elegibilidad profesional y Service activo |
| Availability | `findByBusinessWorkerAndDate` | actualmente exige `Membership.role=worker` | Appointment query tenant-safe; elegibilidad debe desacoplarse del rol; Holiday sigue global |
| Confirm | scoped read/write | Admin o `tenantRole=worker` + assignment | tenant-safe por Business, pero profesional está acoplado al rol y state es débil |
| Complete | scoped read/write | Admin o `tenantRole=worker` + assignment | mismo problema de capacidad profesional + transición |
| Cancel | scoped read/write | comparación Client ID o profesional/admin | tenant-safe por Business; Client ID no debe congelarse como autoridad histórica suficiente |
| Read detail | `findByIdAndBusiness` | Client ID o profesional/admin | cross-tenant protegido; Client authority futura debe usar binding verificado |
| My appointments | `findAll(query)` | client/worker/admin según rol | caller tenant-scoped; contrato Client/profesional debe corregirse |
| Timeline | Appointment scoped, luego AuditLog | auth Appointment | ownership gate existe; proyección actual es insegura |
| Payment initiation | global `findById` + global `update` | ObjectId + status | BLOCKER BEFORE PAYMENT ENABLEMENT |
| Webpay callback | Payment lookup no obligatorio en práctica + Appointment global | provider/token incompleto | BLOCKER BEFORE PAYMENT ENABLEMENT |
| Payment return transport | POST y GET; query/body token | callback público | BLOCKER BEFORE PAYMENT ENABLEMENT (`APT-PAY-04`) |
| Notifications | 3 `findById` globales | provenance interno | lectura internal-only legítima pero boundary genérico |
| Global metrics/analytics | 7 aggregations | superadmin read-only | válido bajo política explícita; repo global sigue siendo deuda |
| WebSocket availability | no lookup Appointment | Membership revalidada | tenant-scoped para su propósito |
| Holiday | `findByDate` global | fecha global | DEBT / política cross-tenant por aclarar |
| Legacy migration/debug/seed | queries/writes globales | operador | fuera del runtime moderno; DEBT |

---

## 13. Repository contract y mutabilidad

### 13.1 APT-REP-01 — HIGH

El problema incluye ambas mutaciones:

```text
update(id, data)
updateByIdAndBusiness(id, businessId, data)
```

La segunda protege el recurso seleccionado por Business, pero sigue aceptando `data` arbitrario capaz de alterar ownership, assignments y status.

### 13.2 Contrato futuro

6.2.4-B debe eliminar o encapsular mutaciones genéricas desde callers runtime y usar comandos purpose-specific, por ejemplo:

```text
transitionStatusByBusiness(...expectedState...)
reassignProfessionalByBusiness(...)
changeServiceByBusiness(...)
rescheduleByBusiness(...)
```

Reglas:

- `business`: inmutable.
- `client`: no mutable por patch genérico.
- `status`: sólo por transición explícita con expected-state.
- `worker`, `service`, `date`, `startTime`, `endTime`: sólo por comandos que revaliden invariantes.
- lecturas globales legítimas: encapsuladas como internal/read-only.

### 13.3 Reassignment profesional

Un cambio de `Appointment.worker` debe revalidar:

- User activo;
- Membership activa en `Appointment.business`;
- User incluido en `Service.workers`;
- disponibilidad;
- restricciones de estado.

No debe exigir universalmente `Membership.role=worker`.

---

## 14. State transitions

### APT-STATE-01 — HIGH

Confirm/complete/cancel y Payment no expresan de forma uniforme estados origen ni CAS.

Contrato:

- cada comando declara estados origen permitidos;
- la condición expected-state forma parte del filtro de persistencia cuando existe riesgo de concurrencia/replay;
- conflicto de CAS sobre recurso autorizado produce 409;
- un transition command no acepta fields arbitrarios.

---

## 15. AuditLog y timeline

### APT-AUD-01 — HIGH

Actualmente Payment/Webpay puede persistir en AuditLog:

- tokens;
- `token_ws`/`TBK_TOKEN`;
- URLs de provider;
- payloads/respuestas del provider;
- `technicalMessage`;
- stack traces en errores.

El timeline autoriza primero Appointment, pero devuelve documentos AuditLog completos.

Contrato 6.2.4-B Core:

- timeline funcional usa una **safe projection allowlist**;
- no expone `technicalMessage`;
- no expone stack traces;
- no expone tokens/capabilities;
- no expone payloads crudos de providers;
- metadata visible se sanitiza/allowlistea;
- observabilidad operacional interna se separa del timeline funcional cuando requiera más detalle.

### APT-AUD-02 — LOW

AuditLog no contiene `business` propio. El gate actual deriva ownership desde Appointment antes de consultar timeline. No es blocker, pero cualquier futuro acceso directo/global a AuditLog debe preservar el tenant boundary de forma explícita.

---

## 16. Payment/Webpay — contrato diferido

### 16.1 APT-PAY-01 — BLOCKER BEFORE PAYMENT ENABLEMENT

`POST /payments/initiate` usa un `appointmentId` público como selector de Appointment global sin Client authority verificada o guest payment capability.

Invariante: conocer un Appointment ObjectId nunca autoriza iniciar pago.

### 16.2 Guest payment capability

Si Payment se habilita, continuidad guest usa capability corta purpose-specific emitida por servidor, ligada como mínimo a:

- Appointment;
- Business;
- `purpose=payment`;
- expiry corta;
- integridad criptográfica o valor opaco aleatorio no derivable.

No es:

- Appointment ObjectId;
- `clientId`;
- identidad general;
- sesión 6.2.5.

### 16.3 APT-PAY-02 — BLOCKER BEFORE PAYMENT ENABLEMENT

`confirmPayment(tokenWs)` actualmente puede:

1. intentar buscar Payment por token;
2. ignorar errores de esa consulta;
3. continuar sin Payment persistido;
4. llamar al provider;
5. reemplazar `appointmentId` por `commitResponse.buy_order`;
6. recuperar Appointment globalmente;
7. mutar Payment/Appointment.

Invariante: ningún callback muta Appointment sin Payment persistido válido previo.

Payment debe probar antes del commit:

```text
transactionId === token_ws
status === 'pending'
gateway === 'webpay'
appointment
business
amount
type
currency
```

Provider debe probar:

```text
buy_order === Payment.appointment
amount === Payment.amount
resultado authorized/rejected compatible
```

Y antes de mutar:

```text
Appointment._id === Payment.appointment
Appointment.business === Payment.business
```

### 16.4 APT-PAY-03 — BLOCKER BEFORE PAYMENT ENABLEMENT

Problemas actuales:

- initiation acepta `pending` y `pending_payment`;
- sólo excluye Payment `approved`;
- pueden coexistir varios attempts `pending`;
- Appointment cambia antes de crear Payment;
- fallo local puede dejar estado parcial;
- callback modifica Payment y Appointment en pasos separados.

Política:

- máximo un Payment `pending` autoritativo por Appointment/gateway;
- retries/supersession deben ser explícitos;
- `Payment.amount/type/currency` persistidos son autoridad económica del intento;
- callback no recalcula el monto usando el precio actual del Service.

Initiation esperado:

```text
payment capability válida
    ↓
Appointment status=pending
    ↓
Webpay create (HTTP externo, fuera de tx Mongo)
    ↓
transacción Mongo local:
    Payment pending
    + CAS Appointment pending -> pending_payment
```

Si la persistencia local falla, el token externo queda huérfano y no puede ser aceptado posteriormente porque no existe Payment persistido autorizado.

Callback esperado:

```text
Payment pending por token OBLIGATORIO
    ↓
provider commit (HTTP externo, fuera de tx Mongo)
    ↓
validar provider contra Payment
    ↓
Appointment por Payment.appointment + Payment.business
    ↓
transacción Mongo local idempotente/CAS:
    Payment pending -> terminal
    + Appointment expected-state -> next-state
```

### 16.5 APT-PAY-04 — callback transport/error disclosure — BLOCKER BEFORE PAYMENT ENABLEMENT

Estado actual:

- callback soporta POST y GET;
- `token_ws` y `TBK_TOKEN` pueden llegar por query string;
- ante error técnico el controller redirige al frontend incluyendo `message=error.message`.

Riesgos:

- tokens/secret material en URLs, histories, proxies o logs;
- exposición pública de mensajes internos, errores del provider o detalles técnicos.

Contrato futuro:

- respetar el método/transport requerido por el provider;
- no ampliar métodos de callback sin necesidad contractual;
- evitar tokens/capabilities en query strings cuando el contrato del provider lo permita;
- nunca incluir `error.message`, stack, provider error crudo ni detalle interno en redirects públicos;
- redirects usan únicamente `reason/code` públicos, estables y allowlisted;
- detalle técnico permanece en observabilidad interna sanitizada;
- tokens/capabilities no forman parte del timeline funcional.

No se implementa en 6.2.4-A.

---

## 17. Modelo de error

### 404 — resource-specific fail-closed

Respuesta uniforme para:

- Appointment inexistente;
- Appointment de otro Business;
- relación Client no autorizada/no verificada para ese recurso;
- profesional intentando Appointment no asignada;
- recurso relacionado no observable bajo la capacidad evaluada.

### 403 — autoridad tenant faltante antes de resolver recurso

Usar cuando una operación tenant protegida puede determinar antes de cargar un Appointment concreto que falta:

- User activo;
- Membership activa;
- capacidad/rol tenant necesario para entrar al flujo.

### 409 — recurso autorizado, transición inválida/replay

Usar para:

- expected-state mismatch;
- replay;
- CAS conflict;
- intento concurrente/duplicado autoritativo.

Errores de forma permanecen 400/422 según la política vigente.

---

## 18. Hallazgos finales

### BLOCKER CORE / BEFORE 6.2.4-B CONTRACT FREEZE

#### APT-CLIENT-01 — `Appointment.client` no prueba Client authority histórica

El guest matching actual puede reutilizar User por contactos no verificados. La futura autenticación de ese User no puede otorgar retroactivamente historial/gestión sobre todas las Appointments asociadas sólo por `_id`.

#### APT-WORKER-CAP-01 — elegibilidad profesional acoplada incorrectamente a `Membership.role=worker`

El contrato debe permitir que un User con Membership `admin` activa sea profesional cuando aparece explícitamente en `Service.workers` y está asignado, sin segunda Membership ni duplicación de identidad.

### BLOCKER BEFORE PAYMENT ENABLEMENT

#### APT-PAY-01

Initiation público usa Appointment ObjectId sin Client/guest payment capability.

#### APT-PAY-02

Callback puede continuar sin Payment persistido válido y dejar que provider `buy_order` seleccione Appointment global.

#### APT-PAY-03

Attempts múltiples/estado parcial; falta intento pendiente autoritativo e idempotencia/CAS.

#### APT-PAY-04

Callback amplía transporte a GET/query y redirect público puede exponer `error.message`/detalle interno.

### HIGH

#### APT-SVC-01 — `Service.workers` no es enforced

Booking/availability no verifican allowlist y create/update Service no valida User activo + Membership activa en el mismo Business. **La corrección no debe exigir universalmente role=worker.**

#### APT-SVC-02 — Service inactivo todavía bookeable

Booking/availability consultan Service sin `onlyActive=true`.

#### APT-REP-01 — mutaciones genéricas

`update` y `updateByIdAndBusiness` aceptan fields arbitrarios.

#### APT-STATE-01 — state transitions sin CAS uniforme

Faltan expected-state y protección consistente ante replay/carreras.

#### APT-AUD-01 — timeline/observabilidad mezclados

Material técnico/sensible puede persistirse y devolverse en timeline completo.

### MEDIUM

#### APT-WORKER-01 — revocación de Membership y appointments futuras

Revocar la Membership elimina capacidad tenant/profesional futura aunque el assignment histórico permanezca. Debe definirse política para citas futuras sin reescribir historia automáticamente.

#### APT-READ-01 — lecturas globales internal-only no expresan intención

Tres lecturas globales de notificaciones tienen provenance interno, pero el contrato del repo no lo expresa.

### LOW

#### APT-AUD-02 — AuditLog sin Business propio

Hoy el timeline queda gateado por Appointment; futuros accesos directos deben conservar boundary.

### DEBT / POLICIES TO CLARIFY

- `appointmentRepository.aggregate(pipeline)` permanece global/genérico aunque los callers actuales sean read-only.
- `migrate-multi-tenancy.js` contiene `Appointment.updateMany` global legacy.
- scripts debug/seed operan fuera de boundaries runtime.
- `HOLIDAY-POLICY-01`: Holiday es global y su política cross-tenant debe aclararse en una fase separada.
- `ID-LEGACY-01`: guest nuevo recibe password aleatorio desconocido pese a ADR-001; deuda de 6.2.5, no de 6.2.4-B.

---

## 19. Invariantes obligatorios

### Ownership

1. `Appointment.business` es ownership tenant.
2. `Appointment.business` es inmutable en runtime ordinario.
3. `Appointment.service.business === Appointment.business`.
4. un actor tenant de Business A nunca usa esa autoridad para operar Appointment B.
5. `Business.owner`, `User.role`, `User.business` y session `businessId` no sustituyen autoridad persistida.

### Client

6. `Appointment.client` es relación de dominio/contacto, no prueba completa de identidad.
7. Client authority requiere una relación/capability verificada para la Appointment.
8. coincidencia guest de email/teléfono no concede historial ni gestión histórica.
9. autenticar un User no legitima retroactivamente asociaciones guest no verificadas.
10. 6.2.4-B no implementa identidad/login/binding 6.2.5.
11. 6.2.4-B no debe consolidar `authenticatedUser._id === Appointment.client` como primitive suficiente para historial.

### Tenant/Admin/profesional

12. Admin requiere User activo + Membership admin activa + mismo Business.
13. autoridad tenant deriva de Membership; elegibilidad profesional no se identifica universalmente con `role=worker`.
14. profesional elegible requiere User activo + Membership activa mismo Business + inclusión en `Service.workers`.
15. profesional asignado requiere además `Appointment.worker === User._id`.
16. una Membership admin es compatible con elegibilidad profesional si `Service.workers` incluye al User.
17. `Service.workers` no concede privilegios admin ni sustituye Membership.
18. superadmin global no concede mutación tenant.

### Service

19. `Service.workers` es allowlist autoritativa; `[] = ninguno`.
20. Service create/update sólo incluye Users activos con Membership activa del mismo Business.
21. Service debe estar activo para nueva availability/booking.
22. desactivar Service no reescribe Appointments ya creadas.

### Mutation/state

23. `client` no cambia por patch genérico.
24. worker/service/date/time sólo cambian mediante comandos purpose-specific.
25. status sólo cambia mediante transición explícita/expected-state/CAS.
26. repositorios runtime no exponen mutación genérica reutilizable que pueda cambiar ownership/assignments.

### Payment opcional

27. Booking funciona sin Payment.
28. Webpay es adapter de Payment, no parte de Appointment.
29. Appointment ObjectId no es payment capability.
30. guest payment usa capability corta purpose-specific.
31. callback exige Payment persistido válido previo.
32. Payment prueba transactionId/status/gateway/appointment/business/amount/type/currency.
33. provider buy_order/amount se comparan contra Payment.
34. `Appointment.business === Payment.business` antes de mutar.
35. `Payment.amount/type/currency` persistidos son autoridad económica del intento.
36. máximo un Payment pending autoritativo por Appointment/gateway.
37. provider calls ocurren fuera de transacciones Mongo.
38. callback es idempotente y coordina Payment + Appointment mediante CAS/transacción local.
39. transport de callback se limita al requerido por provider.
40. redirects públicos nunca contienen `error.message`, stack, provider details ni secretos.

### Timeline/error/Holiday

41. timeline usa safe projection allowlist.
42. tokens/capabilities/provider payload/stack no se exponen.
43. cross-resource/cross-owner/assignment no autorizado falla 404.
44. falta de autoridad tenant previa a resolución falla 403.
45. transición/replay/CAS conflict sobre recurso autorizado falla 409.
46. Holiday permanece explícitamente clasificado como política global pendiente de definición; no se presenta como recurso tenantizado.

---

## 20. Alcance recomendado de 6.2.4-B — MVP CORE

6.2.4-B debe:

1. mantener `Appointment.business` inmutable;
2. introducir una frontera de autorización Client que **no** conceda historial sólo por igualdad de `User._id` con `Appointment.client`;
3. mantener sin implementar el binding/verificación de 6.2.5; hasta entonces no crear nueva Client authority histórica por inferencia;
4. separar autoridad tenant de elegibilidad profesional;
5. permitir elegibilidad profesional de Users con Membership activa `admin` o `worker` cuando estén explícitamente en `Service.workers`;
6. no crear segunda Membership ni implementar multirrol formal;
7. validar `Service.workers` contra User activo + Membership activa del mismo Business;
8. exigir `Service.workers` en booking/availability;
9. exigir Service activo para nueva availability/booking;
10. conservar Appointments existentes al desactivar Service;
11. corregir authorizers de profesional asignado para no depender de `tenantRole === worker` como requisito universal;
12. encapsular/eliminar mutaciones genéricas Appointment desde runtime;
13. introducir comandos purpose-specific;
14. aplicar expected-state/CAS a transiciones;
15. definir política de Membership revocada para citas futuras sin reescribir historia;
16. aplicar 404/403/409 según este contrato;
17. introducir safe projection de timeline/AuditLog;
18. auditar/ajustar fixtures que dependan de `Service.workers=[]` o de profesional=`role=worker`;
19. mantener Holiday fuera del scope funcional, documentando su política global pendiente;
20. mantener identidad progresiva 6.2.5 fuera del alcance.

### 20.1 Gating para MVP sin Payment

Recomendado: deshabilitar/no montar Payment/Webpay deny-by-default antes de release.

Si las rutas permanecen accesibles, `APT-PAY-01/02/03/04` deben corregirse antes del release.

### 20.2 Payment diferido hasta habilitación

Cuando Payment se habilite deberá incluir:

- guest payment capability purpose-specific;
- Payment persistido obligatorio antes de callback mutation;
- provenance `Payment -> Appointment -> Business`;
- amount/type/currency persistidos como autoridad;
- single authoritative pending attempt;
- initiation con provider fuera de tx y persistencia local atómica;
- callback idempotente/CAS;
- transport mínimo requerido por provider;
- redirects públicos allowlisted sin mensajes internos;
- logs/observabilidad sanitizados;
- tests adversariales de token, amount, business, replay, transport y partial failure.

---

## 21. Implicaciones de tests para 6.2.4-B

Sin modificar tests en 6.2.4-A, la implementación futura debe cubrir al menos:

- Service con User sin Membership -> reject.
- Service con User inactivo -> reject.
- `Service.workers=[]` -> ningún profesional elegible.
- Membership `worker` + User incluido en Service -> elegible.
- Membership `admin` + User incluido en Service -> elegible profesionalmente sin segunda Membership.
- Membership `admin` + User fuera de Service -> no elegible profesionalmente.
- inclusión en Service no concede capacidades admin.
- worker/profesional de otro Business -> reject.
- Service inactivo -> no nueva availability/booking.
- desactivar Service no altera Appointment existente.
- Membership revocada -> actor deja de ejercer capacidad tenant/profesional.
- cross-resource -> 404 uniforme.
- autoridad tenant ausente previa a resolución -> 403.
- transición/replay autorizado -> 409.
- generic mutation no puede cambiar business/client/worker/service.
- timeline nunca expone technicalMessage/tokens/stacks.
- una relación guest no verificada no obtiene historial únicamente por compartir `Appointment.client` con un User autenticado futuro.

Tests de binding/verificación real de identidad pertenecen a 6.2.5.

Tests Payment pertenecen a la habilitación de Payment, salvo que las rutas permanezcan públicas en el MVP.

---

## 22. Fuera de alcance / deuda diferida

No mezclar con 6.2.4:

- implementación de identidad progresiva 6.2.5;
- login/sesión/verification de clientes;
- fusión/deduplicación de identidades guest;
- sistema formal multirol/permissions en Membership;
- refunds;
- SII;
- billing general;
- microservicios;
- responsive;
- baseline real Atmósfera/DAM;
- migraciones de datos reales;
- tenantización o política definitiva de Holiday;
- acceso a producción.

La capacidad funcional de un `admin` para prestar servicios **no** queda fuera de alcance conceptual: queda resuelta mediante separación entre Membership y `Service.workers`, sin introducir multirrol formal.

---

## 23. Decisiones cerradas por esta revisión adversarial final

- `APT-CLIENT-01`: BLOCKER CORE antes de congelar 6.2.4-B.
- `Appointment.client` es relación persistida, no prueba completa de identidad.
- Client authority histórica futura requiere binding/verificación de 6.2.5; 6.2.4-B no la implementa.
- `APT-WORKER-CAP-01`: BLOCKER CORE.
- autoridad tenant deriva de Membership; elegibilidad profesional deriva además de `Service.workers`.
- un User con Membership `admin` activa puede ser profesional si Service lo incluye y Appointment lo asigna.
- no se requiere segunda Membership ni multirol formal.
- Admin authority exige también `User.isActive === true`.
- `Service.workers` sigue siendo allowlist autoritativa y `[] = ninguno`.
- Service activo sigue siendo obligatorio para nueva availability/booking.
- `APT-PAY-01/02/03/04`: BLOCKER BEFORE PAYMENT ENABLEMENT.
- Payment/Webpay sigue fuera del MVP y debe deshabilitarse deny-by-default o endurecerse antes de exposición.
- callback futuro no expone secretos en query innecesariamente ni mensajes internos en redirects.
- Holiday permanece global y se clasifica como deuda/política cross-tenant por aclarar.
- `Appointment.business` permanece ownership tenant e inmutable.
- mutaciones purpose-specific, CAS, 404/403/409 y safe timeline permanecen vigentes.
- `ID-LEGACY-01` queda documentado como deuda de 6.2.5, sin cambio runtime en este PR.

---

## 24. Estado operacional de esta fase

Esta fase:

- modifica únicamente documentación;
- no modifica runtime;
- no modifica modelos, repositorios, services, controllers ni routes;
- no modifica tests de comportamiento;
- no ejecuta migraciones;
- no ejecuta seeds;
- no accede a producción;
- no crea ni modifica datos reales;
- no inicia 6.2.4-B;
- no inicia 6.2.5;
- no autoriza Ready;
- no autoriza merge.

Después de este Draft corresponde una nueva revisión adversarial documental antes de autorizar cualquier cambio runtime de 6.2.4-B.
