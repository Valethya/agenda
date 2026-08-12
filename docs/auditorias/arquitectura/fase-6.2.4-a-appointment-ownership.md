# Fase 6.2.4-A — Auditoría y contrato de ownership de Appointment

Fecha de auditoría: 2026-08-12  
Base exacta revisada: `master@a91dddbbc5482ee192944a05d9203de47e021dae`  
HEAD adversarial de entrada para esta corrección: `ccf61c8f23250dae59b474fcb4965925d86517dc`  
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
- `Service.workers` es una allowlist autoritativa de elegibilidad profesional.
- `Service.workers=[]` significa **ningún profesional elegible**.
- autoridad tenant y elegibilidad profesional son dimensiones distintas.
- una Membership `admin` activa puede coexistir con elegibilidad profesional expresada por `Service.workers` sin una segunda Membership.
- Service inactivo no debe generar nueva availability ni nuevas Appointments.
- desactivar un Service no altera automáticamente Appointments ya creadas o históricas.
- mutaciones de Appointment deben ser purpose-specific y proteger ownership/assignments.
- transiciones de estado deben declarar expected-state y usar CAS cuando haya replay/carreras.
- el modelo de error de recursos protegidos es 404/403/409 según la frontera definida más adelante.
- el timeline funcional debe usar una proyección segura allowlist.
- Payment/Webpay es opcional y está fuera del MVP.
- `APT-PAY-01/02/03/04` siguen siendo `BLOCKER BEFORE PAYMENT ENABLEMENT`.
- Holiday continúa como `DEBT / CROSS-TENANT POLICY TO CLARIFY`.
- 6.2.5, identidad progresiva del cliente, no se implementa en esta fase ni en 6.2.4-B.

El objetivo específico de esta última corrección es cerrar `APT-CLIENT-01` sin construir todavía la solución de identidad progresiva.

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

El núcleo MVP debe cerrar:

- ownership tenant de Appointment;
- neutralización de grants Client inseguros ya existentes;
- separación entre `Appointment.client` y Client authority verificada;
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

### 2.2 IDENTIDAD PROGRESIVA — 6.2.5, FUERA DE 6.2.4-B

6.2.4-B **no debe implementar**:

- verificación de email o teléfono;
- account linking;
- identity merging;
- client profile binding;
- login/sesión de cliente;
- recuperación de historial;
- fusión/deduplicación de identidades guest;
- ninguna otra parte del modelo de identidad progresiva de 6.2.5.

6.2.4-B sí debe impedir que el runtime actual convierta una asociación guest no verificada en autoridad sólo por igualdad de IDs.

### 2.3 PAYMENT / WEBPAY — FUERA DEL MVP

Webpay no es requisito del MVP de Agenda.

Reglas vigentes:

- Appointment/Booking funciona sin Payment.
- Payment es un módulo opcional.
- Webpay es un adapter externo reemplazable de Payment.
- Appointment no conoce `token_ws`, `buy_order` ni conceptos específicos de Transbank.
- Payment puede referenciar Appointment, pero no sustituye `Appointment.business` como autoridad tenant.
- un Business sin pagos completa Booking sin tocar Payment.
- fallos de Payment/Webpay no pueden corromper Appointments ajenas ni módulos no relacionados.

El código actual monta `/api/payments` sin feature flag visible. Para un MVP sin Payment se recomienda deshabilitar/no montar Payment/Webpay deny-by-default. Si permanece accesible, `APT-PAY-01/02/03/04` deben resolverse antes del release.

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

ADR-001 establece que una coincidencia de contacto no verificado:

- no fusiona identidades;
- no concede historial;
- no concede gestión de citas anteriores;
- requiere verificación antes de vincular definitivamente identidad/contacto.

Los guest users creados durante booking tampoco reciben una sesión autenticada normal.

Consecuencia: `Appointment.client` actual es una **relación persistida de dominio/contacto**, pero no una prueba completa de identidad ni de Client authority.

### 3.3 Grants Client existentes que 6.2.4-B debe neutralizar

El runtime actual contiene grants directos basados únicamente en la igualdad con `Appointment.client`:

```text
cancelAppointment:
appointment.client._id.toString() === userId

getAppointmentDetails:
appointment.client._id.toString() === userId

getMyAppointments:
query.client = userId   // rama no admin/no worker
```

Además, `getAppointmentTimeline` reutiliza `getAppointmentDetails()` como gate previo; por tanto hereda el mismo problema de Client authority cuando ese gate se satisface sólo por la igualdad de IDs.

Estos usages son parte del problema actual de `APT-CLIENT-01`. 6.2.4-B no puede limitarse a evitar nuevas comparaciones: debe **eliminar o neutralizar como grant independiente las comparaciones y queries protegidas existentes** que traten `User._id === Appointment.client` como autoridad suficiente.

### 3.4 Divergencia legacy de identidad

`getOrCreateGuestUser()` crea actualmente un password aleatorio desconocido para un guest nuevo, mientras ADR-001 prohíbe ese patrón.

Se mantiene documentado como **`ID-LEGACY-01 — DEBT / 6.2.5`**. No se corrige en 6.2.4-B.

### 3.5 Membership y propietarios que prestan servicios

El modelo actual impone:

```text
Membership.role ∈ { admin, worker }
unique { user, business }
```

PR #21 fijó propietarios con Membership `admin` que también prestan servicios. El contrato permanece:

- Membership expresa participación/autoridad tenant;
- `Service.workers` expresa elegibilidad profesional;
- un User con Membership `admin` activa puede ser profesional cuando el Service lo incluye explícitamente y la Appointment lo asigna;
- no se implementa multirrol formal.

### 3.6 Holiday

`availability.service` usa `holidayRepository.findByDate(targetDate)` y `Holiday` no contiene `business`.

Se conserva como **`HOLIDAY-POLICY-01 — DEBT / CROSS-TENANT POLICY TO CLARIFY`**. No es blocker de Appointment ownership y no se tenantiza en 6.2.4.

---

## 4. Ownership y capacidades

### 4.1 Ownership tenant

Fuente única:

```text
Appointment.business
```

Ningún `worker`, `client`, `service`, header, query param, sesión, `User.role`, `User.business`, `Business.owner`, Payment ni provider externo sustituye esta relación.

### 4.2 Las capacidades no son categorías excluyentes

Un mismo User puede simultáneamente:

- estar relacionado como `Appointment.client`;
- tener Membership `admin` o `worker`;
- estar incluido en `Service.workers`;
- estar asignado como `Appointment.worker`;
- poseer privilegio global `superadmin`.

Cada operación evalúa la capacidad concreta que el actor presenta. Una capacidad válida no se invalida por la existencia de otra, y una relación insuficiente no se vuelve válida por coexistir con otra etiqueta.

---

## 5. APT-CLIENT-01 — BLOCKER CORE BEFORE 6.2.4-B CONTRACT FREEZE

### 5.1 Problema

La igualdad:

```text
authenticatedUser._id === Appointment.client
```

no es una prueba completa de Client authority.

Debido al matching guest no verificado, una Appointment puede quedar asociada a un `User` por email/teléfono sin demostrar que ese contacto pertenece a la misma persona. Autenticar posteriormente ese `User` no puede legitimar retroactivamente todas las asociaciones guest históricas vinculadas a su `_id`.

### 5.2 Separación contractual

Deben distinguirse:

**A. Relación persistida de dominio/contacto**

```text
Appointment.client -> User/contact record
```

Sirve para relacionar operacionalmente la Appointment con el registro utilizado durante booking. No prueba por sí sola que una request posterior pertenezca a esa persona.

**B. Client authority válida**

Conceptualmente:

```text
verified client binding
        OR
explicit purpose-specific capability
        ↓
operación protegida sobre Appointment autorizada
```

La forma del binding autenticado/histórico será definida por 6.2.5.

### 5.3 Invariante inequívoca

**Hasta que exista un binding Client verificado o una capability purpose-specific explícita, la igualdad entre `authenticated User._id` y `Appointment.client` NO DEBE autorizar de forma independiente ninguna operación Client protegida.**

Esta regla aplica tanto a nuevas implementaciones como a los grants existentes.

En particular:

- `User._id === Appointment.client` por sí solo no concede `read`;
- por sí solo no concede `list/history`;
- por sí solo no concede `cancel`;
- por sí solo no concede `timeline`;
- por sí solo no concede reschedule ni ninguna otra operación Client protegida futura.

### 5.4 Obligación concreta de 6.2.4-B

6.2.4-B debe **eliminar o neutralizar como grants independientes** los usages protegidos existentes basados exclusivamente en esa igualdad.

Como mínimo debe revisar y corregir:

- `cancelAppointment()`;
- `getAppointmentDetails()`;
- `getMyAppointments()`;
- `getAppointmentTimeline()` por su dependencia de `getAppointmentDetails()`;
- cualquier otro caller protegido que derive Client authority únicamente de `Appointment.client` / `client=userId`.

No basta con documentar que no deben introducirse usos nuevos.

Mientras 6.2.5 no provea un binding verificado:

- una identidad autenticada **no** obtiene Client authority histórica sólo porque su `_id` coincida con `Appointment.client`;
- si una operación Client protegida no recibe una prueba válida de Client authority, debe fallar closed;
- admin o profesional asignado pueden seguir operando mediante sus capacidades independientes cuando éstas sean válidas;
- una capability purpose-specific válida puede autorizar únicamente el recurso y la operación/purpose para los que fue emitida;
- esa capability no se convierte en identidad global;
- esa capability no concede historial general;
- esa capability no habilita automáticamente otras operaciones sobre la misma Appointment ni sobre otras Appointments.

### 5.5 Qué NO debe resolver 6.2.4-B

Para cerrar este blocker, 6.2.4-B **no** implementa:

- verificación de email/teléfono;
- account linking;
- identity merging;
- client profile binding;
- login de cliente;
- recuperación de historial;
- migración/fusión de relaciones guest;
- ningún mecanismo general de 6.2.5.

La obligación es cerrar el grant inseguro actual y dejar preparada una frontera donde 6.2.5 pueda aportar posteriormente la prueba de identidad correcta.

---

## 6. APT-WORKER-CAP-01 — BLOCKER CORE

Esta decisión ya se considera cerrada y no se reabre en esta corrección.

### 6.1 Autoridad tenant vs elegibilidad profesional

**Autoridad tenant** deriva de Membership.

**Elegibilidad profesional** deriva de:

```text
User.isActive === true
Membership.isActive === true
Membership.business === Appointment.business
User._id ∈ Service.workers
Service.business === Appointment.business
```

Para operar específicamente como profesional asignado se añade:

```text
Appointment.worker === User._id
```

El rol físico de la Membership puede ser `worker` o `admin` bajo el esquema actual. `Service.workers` no concede privilegios administrativos ni sustituye Membership.

Un sistema formal multirrol continúa fuera de 6.2.4.

---

## 7. Capacidad ADMIN

Para operar bajo capacidad administrativa:

```text
User.isActive === true
Membership.isActive === true
Membership.role === 'admin'
Membership.business === Appointment.business
```

Además el Business debe estar activo.

No sustituyen esta prueba:

- `User.role` heredado;
- `User.business` heredado;
- `Business.owner`;
- session `businessId`;
- seleccionar un Business;
- inclusión en `Service.workers`.

---

## 8. Privilegio SUPERADMIN

El privilegio global por sí solo:

- puede autorizar inspección global read-only bajo política explícita;
- no autoriza mutación tenant;
- seleccionar/impersonar Business no crea Membership ni capacidad admin.

Si el mismo User posee una Membership activa válida en `Appointment.business`, esa Membership se evalúa independientemente.

---

## 9. SYSTEM / CAPABILITIES PURPOSE-SPECIFIC

Una operación system/internal o una capability explícita debe demostrar provenance y scope.

Una capability purpose-specific:

- debe estar ligada a recurso y purpose concretos;
- debe tener integridad/entropía/expiración adecuadas cuando corresponda;
- no se deriva de un ObjectId público;
- no se convierte en identidad general;
- no concede historial general;
- no debe reutilizarse para operaciones fuera de su scope.

Un ObjectId arbitrario nunca constituye autoridad.

---

## 10. Service y elegibilidad profesional

### 10.1 `Service.workers` es allowlist autoritativa

```text
Service.workers = [u1, u2]  -> sólo u1 y u2 pueden prestar ese Service
Service.workers = []        -> ningún profesional elegible
```

### 10.2 Create/update Service

6.2.4-B debe aceptar en `Service.workers` únicamente Users que:

- existan;
- estén activos;
- tengan Membership activa en el mismo Business;
- satisfagan invariantes de Business.

No debe exigir universalmente `Membership.role === "worker"`.

### 10.3 Public booking y availability

Para publicar slots o crear Appointment nueva:

```text
Service.business === targetBusiness
Service.isActive === true
Professional User.isActive === true
Professional tiene Membership activa en targetBusiness
Professional User._id ∈ Service.workers
Business activo
```

### 10.4 Service inactivo

Service debe estar activo al publicar nueva availability y al crear Appointment. Desactivarlo posteriormente no reescribe ni invalida automáticamente Appointments existentes/históricas.

---

## 11. Matriz de autorización corregida

Las columnas representan capacidades independientes. `NO GRANT` significa que esa capacidad por sí sola no autoriza; el mismo User puede satisfacer otra capacidad válida.

| Operación | Client binding verificado | Capability purpose-specific | Profesional asignado | Membership Admin | Superadmin global | System/internal |
|---|---|---|---|---|---|---|
| Create booking público | no requerida por flujo guest | CONDITIONAL si el flujo la define | NO GRANT adicional | NO GRANT adicional | NO GRANT adicional | CONDITIONAL explícito |
| Read detail | CONDITIONAL cuando 6.2.5 provea binding | sólo si capability incluye `read` + recurso | CONDITIONAL | CONDITIONAL | CONDITIONAL read-only explícito | CONDITIONAL internal |
| List / history | CONDITIONAL cuando 6.2.5 provea binding | NO GRANT salvo capability específica de lista, no generalizable | CONDITIONAL sólo asignados | CONDITIONAL tenant | CONDITIONAL read-only explícito | CONDITIONAL internal |
| Cancel | CONDITIONAL con binding + regla negocio | sólo si capability incluye `cancel` + recurso | CONDITIONAL | CONDITIONAL | NO GRANT | CONDITIONAL explícito |
| Confirm | NO GRANT por Client | NO GRANT salvo capability interna expresamente definida | CONDITIONAL | CONDITIONAL | NO GRANT | CONDITIONAL definido |
| Complete | NO GRANT por Client | NO GRANT | CONDITIONAL | CONDITIONAL | NO GRANT | DENY por defecto |
| Reschedule | CONDITIONAL futuro | sólo si capability incluye `reschedule` + recurso | CONDITIONAL | CONDITIONAL | NO GRANT | DENY por defecto |
| Timeline | CONDITIONAL cuando exista binding | sólo si capability incluye `timeline` + recurso | CONDITIONAL | CONDITIONAL | CONDITIONAL read-only explícito | CONDITIONAL safe projection |
| Payment initiation, si se habilita | CONDITIONAL Client verificado | CONDITIONAL guest payment capability | NO GRANT adicional | NO GRANT adicional | NO GRANT adicional | CONDITIONAL |
| Payment callback, si se habilita | NO GRANT directo | NO GRANT directo | NO GRANT directo | NO GRANT directo | NO GRANT directo | Payment persistido + provider proof |
| Global analytics | NO GRANT | NO GRANT | NO GRANT | NO GRANT | ALLOW read-only explícito | CONDITIONAL internal |

**Regla fail-closed Client:** mientras no exista binding Client verificado ni capability válida para la operación/recurso, la columna Client equivale a `NO GRANT` aunque `authenticatedUser._id === Appointment.client`.

---

## 12. Inventario de fronteras actualizado

| Flujo | Appointment lookup/write | Prueba actual | Contrato 6.2.4-B |
|---|---|---|---|
| Public booking prevalidación | sin lookup Appointment | Service tenant + User activo + `Membership.role=worker` | Membership activa + `Service.workers` + Service activo |
| Public booking create | `create({business:req.businessId})` | disponibilidad + relaciones actuales | cerrar elegibilidad profesional y Service activo |
| Availability | `findByBusinessWorkerAndDate` | actualmente `Membership.role=worker` | desacoplar rol de elegibilidad; Holiday sigue global |
| Confirm | scoped read/write | Admin o worker-role + assignment | profesional por Membership activa + Service allowlist + assignment; CAS |
| Complete | scoped read/write | Admin o worker-role + assignment | mismo contrato profesional + transición válida |
| Cancel | scoped read/write | **Client ID directo** o profesional/admin | eliminar Client ID como grant independiente; binding/capability o capacidad profesional/admin |
| Read detail | `findByIdAndBusiness` | **Client ID directo** o profesional/admin | eliminar Client ID como grant independiente; binding/capability o capacidad profesional/admin |
| My appointments | `findAll(query)` | **`client=userId`** para rama no admin/worker | no listar historial Client sin binding válido; profesional/admin conservan capacidades independientes |
| Timeline | Appointment scoped y luego AuditLog | gate por `getAppointmentDetails` | hereda corrección Client; luego safe projection |
| Payment initiation | global `findById` + global `update` | ObjectId + status | BLOCKER BEFORE PAYMENT ENABLEMENT |
| Webpay callback | Payment no obligatorio + Appointment global | provider/token incompleto | BLOCKER BEFORE PAYMENT ENABLEMENT |
| Payment return transport | POST/GET; query/body token | callback público | `APT-PAY-04` diferido hasta habilitación |
| Notifications | 3 `findById` globales | provenance interno | internal/read-only explícito |
| Global metrics/analytics | 7 aggregations | superadmin read-only | política read-only explícita |
| WebSocket availability | no lookup Appointment | Membership revalidada | tenant-scoped para su propósito |
| Holiday | `findByDate` global | fecha global | DEBT / política cross-tenant por aclarar |

---

## 13. Repository contract y mutabilidad

### APT-REP-01 — HIGH

Tanto:

```text
update(id, data)
updateByIdAndBusiness(id, businessId, data)
```

son demasiado genéricos para mutaciones runtime. La segunda protege el recurso seleccionado por Business, pero no los campos mutados.

Contrato:

- `business`: inmutable;
- `client`: no mutable por patch genérico;
- `status`: sólo por transición purpose-specific con expected-state/CAS;
- `worker`, `service`, `date`, `startTime`, `endTime`: sólo mediante comandos que revaliden invariantes;
- lecturas globales legítimas: internal/read-only explícitas.

---

## 14. State transitions

### APT-STATE-01 — HIGH

Cada comando debe:

- declarar estados origen permitidos;
- incluir expected-state en persistencia cuando exista riesgo de replay/carrera;
- devolver 409 ante conflicto de CAS sobre recurso ya autorizado;
- no aceptar fields arbitrarios.

---

## 15. AuditLog y timeline

### APT-AUD-01 — HIGH

El timeline funcional debe usar **safe projection allowlist** y nunca exponer:

- `technicalMessage`;
- stack traces;
- tokens/capabilities;
- payloads crudos de providers;
- metadata no allowlisteada.

La observabilidad técnica interna se separa del timeline funcional cuando necesite mayor detalle.

### APT-AUD-02 — LOW

AuditLog no contiene `business` propio. El gate actual deriva ownership desde Appointment. Cualquier futuro acceso directo/global debe conservar ese boundary explícitamente.

---

## 16. Payment/Webpay — contrato diferido

No se modifica Payment en esta corrección.

### APT-PAY-01 — BLOCKER BEFORE PAYMENT ENABLEMENT

Appointment ObjectId no es payment capability.

### APT-PAY-02 — BLOCKER BEFORE PAYMENT ENABLEMENT

Ningún callback muta Appointment sin Payment persistido válido previo que pruebe `transactionId/status/gateway/appointment/business/amount/type/currency`; provider `buy_order` y amount se validan contra ese Payment.

### APT-PAY-03 — BLOCKER BEFORE PAYMENT ENABLEMENT

Máximo un Payment `pending` autoritativo por Appointment/gateway; provider calls fuera de transacción Mongo; persistencia local y callback idempotentes/CAS; `Payment.amount/type/currency` persistidos son autoridad económica del intento.

### APT-PAY-04 — BLOCKER BEFORE PAYMENT ENABLEMENT

Callback futuro debe usar el transporte mínimo requerido por provider, evitar tokens en query cuando el contrato lo permita y nunca propagar `error.message`, stack o provider errors en redirects públicos; usar reasons/codes allowlisted y observabilidad interna sanitizada.

---

## 17. Modelo de error

### 404 — resource-specific fail-closed

Respuesta uniforme para:

- Appointment inexistente;
- Appointment de otro Business;
- Client sin binding/capability válida para ese recurso;
- profesional intentando Appointment no asignada;
- recurso relacionado no observable bajo la capacidad evaluada.

### 403 — autoridad tenant faltante antes de resolver recurso

Usar cuando una operación tenant protegida determina antes de cargar Appointment concreto que falta User/Membership/capacidad tenant necesaria.

### 409 — recurso autorizado, transición inválida/replay

Usar para expected-state mismatch, replay, CAS conflict o conflicto de transición sobre recurso ya autorizado.

---

## 18. Hallazgos finales

### BLOCKER CORE / BEFORE 6.2.4-B CONTRACT FREEZE

#### APT-CLIENT-01 — grants Client directos basados en asociación guest no verificada

El runtime actual contiene `cancel`, `read detail`, `my appointments` y, transitivamente, `timeline` con grants/queries Client basados en `Appointment.client === userId` o `client=userId`.

**6.2.4-B debe eliminar/neutralizar esos grants existentes.** La igualdad de IDs puede seguir existiendo como dato relacional, pero no como prueba independiente de autoridad hasta que exista binding verificado o capability explícita para la operación/recurso.

#### APT-WORKER-CAP-01 — autoridad tenant separada de elegibilidad profesional

Decisión ya cerrada: Membership activa expresa participación/autoridad; `Service.workers` + assignment expresan elegibilidad profesional. Membership `admin` puede coexistir con capacidad profesional sin segunda Membership.

### BLOCKER BEFORE PAYMENT ENABLEMENT

- `APT-PAY-01` — initiation sin Client/guest payment capability.
- `APT-PAY-02` — callback sin Payment persistido obligatorio/provenance fuerte.
- `APT-PAY-03` — attempts/consistencia/idempotencia incompletos.
- `APT-PAY-04` — transport de callback y disclosure de errores.

### HIGH

- `APT-SVC-01` — `Service.workers` no enforced.
- `APT-SVC-02` — Service inactivo todavía bookeable.
- `APT-REP-01` — mutaciones genéricas.
- `APT-STATE-01` — transitions sin CAS uniforme.
- `APT-AUD-01` — timeline/observabilidad mezclados.

### MEDIUM

- `APT-WORKER-01` — Membership revocada y citas futuras requieren política explícita sin reescribir historia.
- `APT-READ-01` — lecturas globales internal-only de notificaciones no expresan intención en repo.

### LOW

- `APT-AUD-02` — AuditLog sin Business propio.

### DEBT / POLICIES TO CLARIFY

- `appointmentRepository.aggregate(pipeline)` global/genérico.
- `Appointment.updateMany` legacy en migración manual.
- scripts debug/seed fuera de boundaries runtime.
- `HOLIDAY-POLICY-01` — Holiday global; política cross-tenant por aclarar.
- `ID-LEGACY-01` — password guest aleatorio desconocido; deuda 6.2.5.

---

## 19. Invariantes obligatorios

### Ownership

1. `Appointment.business` es ownership tenant.
2. `Appointment.business` es inmutable en runtime ordinario.
3. `Appointment.service.business === Appointment.business`.
4. autoridad de Business A nunca opera Appointment B.
5. `Business.owner`, `User.role`, `User.business` y session `businessId` no sustituyen autoridad persistida.

### Client

6. `Appointment.client` es relación de dominio/contacto, no prueba completa de identidad.
7. email/teléfono guest no verificado no concede historial ni gestión histórica.
8. autenticar un User no legitima retroactivamente asociaciones guest no verificadas.
9. **Hasta que exista un binding Client verificado o una capability purpose-specific explícita, `authenticated User._id === Appointment.client` NO DEBE autorizar de forma independiente ninguna operación Client protegida.**
10. 6.2.4-B debe neutralizar también los grants existentes basados únicamente en esa igualdad o en `client=userId`; no basta con prohibir usos nuevos.
11. sin binding/capability válida, read/list/cancel/timeline Client fallan closed.
12. una capability purpose-specific sólo autoriza su recurso + operación/purpose y no concede identidad ni historial general.
13. 6.2.4-B no implementa verificación, linking, merging, client profile binding, client login ni recuperación de historial de 6.2.5.

### Tenant/Admin/profesional

14. Admin requiere User activo + Membership admin activa + mismo Business.
15. autoridad tenant deriva de Membership; elegibilidad profesional no se identifica universalmente con `role=worker`.
16. profesional elegible requiere User activo + Membership activa mismo Business + inclusión en `Service.workers`.
17. profesional asignado requiere además `Appointment.worker === User._id`.
18. una Membership admin es compatible con elegibilidad profesional si Service incluye al User.
19. `Service.workers` no concede privilegios admin ni sustituye Membership.
20. superadmin global no concede mutación tenant.

### Service

21. `Service.workers` es allowlist autoritativa; `[] = ninguno`.
22. Service create/update sólo incluye Users activos con Membership activa del mismo Business.
23. Service debe estar activo para nueva availability/booking.
24. desactivar Service no reescribe Appointments ya creadas.

### Mutation/state

25. `client` no cambia por patch genérico.
26. worker/service/date/time sólo cambian mediante comandos purpose-specific.
27. status sólo cambia mediante transición explícita/expected-state/CAS.
28. repositorios runtime no exponen mutación genérica reutilizable capaz de cambiar ownership/assignments.

### Payment opcional

29. Booking funciona sin Payment.
30. Webpay es adapter de Payment, no parte de Appointment.
31. Appointment ObjectId no es payment capability.
32. guest payment usa capability corta purpose-specific.
33. callback exige Payment persistido válido previo.
34. Payment prueba transactionId/status/gateway/appointment/business/amount/type/currency.
35. provider buy_order/amount se comparan contra Payment.
36. `Appointment.business === Payment.business` antes de mutar.
37. `Payment.amount/type/currency` persistidos son autoridad económica del intento.
38. máximo un Payment pending autoritativo por Appointment/gateway.
39. provider calls ocurren fuera de transacciones Mongo.
40. callback es idempotente y coordina Payment + Appointment mediante CAS/transacción local.
41. transport se limita al requerido por provider y redirects públicos no contienen errores internos.

### Timeline/error/Holiday

42. timeline usa safe projection allowlist.
43. tokens/capabilities/provider payload/stack no se exponen.
44. cross-resource/Client-no-authority/assignment no autorizado falla 404.
45. falta de autoridad tenant previa a resolución falla 403.
46. transición/replay/CAS conflict sobre recurso autorizado falla 409.
47. Holiday permanece política global pendiente de definición, no recurso tenantizado.

---

## 20. Alcance recomendado de 6.2.4-B — MVP CORE

6.2.4-B debe:

1. mantener `Appointment.business` inmutable;
2. **eliminar/neutralizar los grants Client existentes basados únicamente en `Appointment.client === authenticatedUser._id` o `client=userId`;**
3. corregir como mínimo `cancelAppointment`, `getAppointmentDetails`, `getMyAppointments` y el gate de `getAppointmentTimeline`;
4. hacer fail closed las operaciones Client protegidas mientras no exista binding verificado o capability válida para recurso/operación;
5. permitir que admin/profesional sigan operando por sus capacidades independientes;
6. permitir capabilities purpose-specific sólo con scope de recurso + operación, sin convertirlas en identidad/historial;
7. no implementar ninguna parte de identidad progresiva 6.2.5;
8. separar autoridad tenant de elegibilidad profesional;
9. permitir elegibilidad profesional de Users con Membership activa `admin` o `worker` cuando estén explícitamente en `Service.workers`;
10. no crear segunda Membership ni implementar multirrol formal;
11. validar `Service.workers` contra User activo + Membership activa del mismo Business;
12. exigir Service allowlist y Service activo en booking/availability;
13. corregir authorizers de profesional asignado para no depender universalmente de `tenantRole === worker`;
14. encapsular/eliminar mutaciones genéricas Appointment desde runtime;
15. introducir comandos purpose-specific y expected-state/CAS;
16. definir política de Membership revocada para citas futuras sin reescribir historia;
17. aplicar 404/403/409 según este contrato;
18. introducir safe projection de timeline/AuditLog;
19. auditar/ajustar fixtures afectados por `Service.workers=[]` o profesional=`role=worker`;
20. mantener Holiday como deuda de política fuera del alcance funcional;
21. mantener Payment/Webpay fuera del MVP y deny-by-default salvo endurecimiento previo.

### 20.1 Gating para MVP sin Payment

Recomendado: deshabilitar/no montar Payment/Webpay deny-by-default antes de release.

Si las rutas permanecen accesibles, `APT-PAY-01/02/03/04` deben corregirse antes del release.

---

## 21. Contrato futuro de tests para 6.2.4-B

Sin modificar tests en 6.2.4-A, 6.2.4-B deberá demostrar como mínimo:

### APT-CLIENT-01

- `Appointment.client === authenticatedUser._id` derivado de asociación guest no verificada -> **NO concede por sí solo read**.
- la misma condición -> **NO concede por sí sola cancel**.
- la misma condición -> **NO concede por sí sola list/history**.
- la misma condición -> **NO concede por sí sola timeline**.
- ausencia de binding/capability Client válida -> operación Client protegida **fail closed**.
- admin con capacidad administrativa válida sigue pudiendo operar aunque también coincida o no coincida con `Appointment.client`.
- profesional asignado con capacidad profesional válida sigue pudiendo operar por esa capacidad independiente.
- capability purpose-specific válida concede únicamente la operación y recurso declarados.
- capability de una Appointment no concede otra Appointment.
- capability de una operación no concede otra operación.
- capability purpose-specific no concede historial general ni identidad global.

Los tests de verificación real de email/teléfono, linking, merging, login Client o recuperación de historial pertenecen a 6.2.5 y **no** a 6.2.4-B.

### Otros contratos core ya cerrados

También deberán mantenerse los tests previamente definidos para:

- Service con User sin Membership -> reject;
- Service con User inactivo -> reject;
- `Service.workers=[]` -> ningún profesional elegible;
- Membership worker + User incluido -> elegible;
- Membership admin + User incluido -> elegible profesionalmente sin segunda Membership;
- Membership admin + User fuera de Service -> no elegible profesionalmente;
- inclusión en Service no concede capacidades admin;
- profesional de otro Business -> reject;
- Service inactivo -> no nueva availability/booking;
- desactivar Service no altera Appointment existente;
- Membership revocada -> actor deja de ejercer capacidad tenant/profesional;
- cross-resource -> 404;
- autoridad tenant ausente previa a resolución -> 403;
- transición/replay autorizado -> 409;
- generic mutation no cambia business/client/worker/service;
- timeline no expone technicalMessage/tokens/stacks.

Tests Payment permanecen diferidos hasta habilitación salvo exposición pública en MVP.

---

## 22. Fuera de alcance / deuda diferida

No mezclar con 6.2.4:

- implementación de identidad progresiva 6.2.5;
- verificación de email/teléfono;
- client login/session;
- account/profile binding;
- fusión/deduplicación de identidades guest;
- recuperación de historial Client;
- sistema formal multirol/permissions en Membership;
- refunds;
- SII;
- billing general;
- microservicios;
- responsive;
- baseline real Atmósfera/DAM;
- migraciones de datos reales;
- tenantización/política definitiva de Holiday;
- acceso a producción.

Cerrar los grants Client inseguros de 6.2.4 **no equivale** a implementar 6.2.5: significa dejar de aceptar una prueba insuficiente hasta que la capa de identidad aporte una prueba válida.

---

## 23. Decisiones cerradas

- `APT-CLIENT-01` permanece BLOCKER CORE hasta que 6.2.4-B neutralice los grants Client actuales basados sólo en igualdad de IDs.
- `Appointment.client` es relación persistida, no Client authority.
- igualdad `User._id === Appointment.client` no autoriza por sí sola read/list/cancel/timeline ni otra operación protegida.
- 6.2.4-B debe corregir los usages existentes, no sólo evitar nuevos usages.
- sin binding/capability válida, Client protected operations fallan closed.
- capability purpose-specific se limita a recurso + operación y no concede identidad/historial general.
- 6.2.4-B no implementa 6.2.5.
- `APT-WORKER-CAP-01` permanece cerrado: autoridad tenant y elegibilidad profesional están separadas.
- Admin authority exige `User.isActive === true` + Membership admin activa + mismo Business.
- `Service.workers` sigue siendo allowlist autoritativa y `[] = ninguno`.
- Service activo sigue siendo obligatorio para nueva availability/booking.
- `APT-PAY-01/02/03/04` permanecen BLOCKER BEFORE PAYMENT ENABLEMENT.
- Payment/Webpay sigue fuera del MVP y debe deshabilitarse deny-by-default o endurecerse antes de exposición.
- Holiday permanece deuda/política cross-tenant por aclarar.
- `Appointment.business` permanece ownership tenant e inmutable.
- mutaciones purpose-specific, CAS, 404/403/409 y safe timeline permanecen vigentes.
- `ID-LEGACY-01` continúa como deuda de 6.2.5 sin cambio runtime.

---

## 24. Estado operacional de esta fase

Esta fase:

- modifica únicamente documentación;
- no modifica runtime;
- no modifica modelos, repositorios, services, controllers ni routes;
- no modifica tests de comportamiento;
- no modifica Payment;
- no ejecuta migraciones;
- no ejecuta seeds;
- no accede a producción;
- no crea ni modifica datos reales;
- no inicia 6.2.4-B;
- no inicia 6.2.5;
- no autoriza Ready;
- no autoriza merge.

Después de este Draft corresponde una nueva revisión adversarial documental antes de autorizar cualquier cambio runtime de 6.2.4-B.
