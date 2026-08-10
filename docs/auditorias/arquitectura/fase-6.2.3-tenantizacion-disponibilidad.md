# Fase 6.2.3 — Tenantización física de disponibilidad

## Estado y alcance

Esta fase parte de `master` en `d27a312a909e9b36c458c807ac7b7f854447639a`, merge commit del PR #22 (6.2.2-D).

6.2.2-D ya estableció que `Membership` activa es la única autoridad tenant. 6.2.3 no reabre esa decisión: agrega ownership físico tenant a los recursos de disponibilidad que todavía estaban ligados sólo al usuario global y endurece la migración legacy necesaria para llegar a ese estado de forma reproducible.

Alcance:

- `Shift`;
- `Block`;
- consulta de `Appointment` usada como ocupación en disponibilidad;
- índice de colisión de `Appointment`;
- room WebSocket `availability_changed`;
- migración manual plan/apply de `Shift`/`Block` heredados;
- lifecycle tenant de Shift/Block cuando una Membership worker se elimina físicamente.

Fuera de alcance:

- ownership general de Appointment u otros recursos (6.2.4);
- identidad progresiva (6.2.5);
- admin + worker simultáneo dentro del mismo negocio;
- pagos, Webpay, refunds o SII;
- soporte mutable 6.4;
- microservicios, colas o responsive.

## Invariantes heredados de 6.2.2-D

- `User` es identidad global.
- `Membership` activa es la única autoridad tenant.
- `Business.owner`, `User.role`, `session.user.role` y `session.user.businessId` no conceden autoridad tenant.
- `session.user.businessId` es sólo contexto seleccionado.
- `superadmin` es privilegio global, no rol Membership.
- Roles Membership continúan siendo `admin | worker`.
- El índice Membership `{ user: 1, business: 1 }` unique no cambia.

## Invariante física de disponibilidad

Todo `Shift` y `Block` runtime pertenece explícitamente a `business + worker`. Las citas usadas como ocupación se consultan por `business + worker + date`.

## Schemas e índices objetivo

### Shift

Campo nuevo obligatorio:

```js
business: ObjectId<Business>
```

Índice anterior:

```js
{ worker: 1, dayOfWeek: 1 } // unique
```

Índice objetivo:

```js
{ business: 1, worker: 1, dayOfWeek: 1 } // unique
```

Nombre:

```text
shift_business_worker_day_unique
```

### Block

Campo nuevo obligatorio:

```js
business: ObjectId<Business>
```

Índice anterior:

```js
{ worker: 1, date: 1 }
```

Índice objetivo:

```js
{ business: 1, worker: 1, date: 1 }
```

Nombre:

```text
block_business_worker_date
```

### Appointment usado por disponibilidad

Appointment ya posee `business`; 6.2.3 no rediseña ownership general.

Índice anterior:

```js
{ worker: 1, date: 1, startTime: 1 }
```

Índice objetivo:

```js
{ business: 1, worker: 1, date: 1, startTime: 1 }
```

Unique para estados activos actuales:

```js
{
  status: {
    $in: ["pending_payment", "pending", "confirmed", "completed"]
  }
}
```

Nombre:

```text
appointment_business_worker_date_start_active_unique
```

`cancelled` permanece fuera de colisión.

## Gestión explícita de índices

`Shift`, `Block` y `Appointment` sólo permiten `autoIndex` cuando `NODE_ENV === "test"`.

La intención es impedir que un deploy intente construir automáticamente índices nuevos sobre datos heredados antes de la migración. La especificación deseada vive en los schemas, pero el estado físico se transforma únicamente mediante la migración 6.2.3.

## Runtime tenant-scoped

### Shift repository

- `findByBusinessAndWorker(businessId, workerId)`
- `findByBusinessWorkerAndDay(businessId, workerId, dayOfWeek)`
- `upsertByBusinessWorkerAndDay(businessId, workerId, dayOfWeek, data)`
- `deleteByBusinessAndWorker(businessId, workerId)`

### Block repository

- `findByBusinessWorkerAndDateRange(businessId, workerId, startDate, endDate)`
- `findByIdAndBusiness(id, businessId)`
- `createForBusinessWorker(businessId, workerId, data)`
- `deleteByIdBusinessAndWorker(id, businessId, workerId)`
- `deleteByBusinessAndWorker(businessId, workerId)` para hard delete del worker dentro de un único tenant.

### Appointment usado por disponibilidad

- `findByBusinessWorkerAndDate(businessId, workerId, date)`

Los accesos globales que pertenecen a otros flujos de Appointment quedan para la revisión general de ownership 6.2.4.

## WebSocket

El room de disponibilidad es:

```text
availability:<businessId>:<workerId>:<date>
```

`calendar_update` continúa en:

```text
business:<businessId>
```

La Membership se sigue revalidando para joins/broadcasts. El mismo User worker puede pertenecer a A y B sin compartir eventos `availability_changed`.

# Migración 6.2.3

Script:

```text
Server/scripts/migrations/availability-tenantization.js
```

Versión actual:

```text
1.1.0
```

Modos:

- `plan`: read-only.
- `apply`: mutación explícita, confirmada y protegida.

Nunca se ejecuta en startup.

## Clasificación legacy

Para `Shift`/`Block` sin `business`:

### deterministic

Existe exactamente una Membership `worker` activa para el User. Se puede inferir el business.

### ambiguous

Existen dos o más Memberships `worker` activas. No se escoge ninguna automáticamente; Apply falla cerrado.

### unresolved/orphan

No existe Membership `worker` activa válida. Apply falla cerrado.

### alreadyMigrated

El documento tiene `business` y existe Membership `worker` activa para ese par.

### invalidExisting

El documento tiene `business`, pero el valor es inválido o no coincide con una Membership worker activa. Apply falla cerrado.

## Conflictos previos

El plan también bloquea:

- claves Shift que colisionarían tras backfill;
- Appointments activas duplicadas dentro de `business + worker + date + startTime`;
- Appointments activas estructuralmente inválidas para el nuevo índice;
- índices con la misma key tenant y opciones incompatibles.

## Política de destinos

La migración separa capacidad técnica de autorización operacional.

### Local development/test

Continúa permitiendo únicamente Mongo loopback/local y bases con sufijo seguro:

- `development` -> `_dev`
- `test` -> `_test`

`NODE_ENV` debe coincidir exactamente con `--environment`.

### Staging/production externo

El código puede operar técnicamente sobre un target externo futuro, pero permanece deny-by-default. No existe opt-in implícito.

Un target externo exige simultáneamente:

- `NODE_ENV=staging|production` idéntico a `--environment`;
- database exacta explícita;
- fingerprint SHA-256 esperado;
- `--allow-external-target=AUTHORIZE_EXTERNAL_AVAILABILITY_TARGET`;
- `--expected-code-sha=<sha>`;
- SHA efectivo resuelto desde provenance soportada, por ejemplo `AVAILABILITY_TENANTIZATION_CODE_SHA`;
- coincidencia exacta entre SHA efectivo y SHA esperado;
- ausencia de indicadores de Vercel/Railway/Render/Fly/Netlify/Lambda/etc.;
- para Apply, `--maintenance-window=MAINTENANCE_WINDOW_CONFIRMED`;
- para Apply, `--confirm=TENANTIZE_AVAILABILITY_6_2_3`.

La intención es que un eventual Apply externo se ejecute desde un operador aislado y durante una ventana de mantenimiento, no desde la aplicación desplegada.

**Este PR no accede a Atlas, staging real ni producción y no ejecuta Apply sobre datos reales.**

## Fingerprint y provenance

El fingerprint confirma host(es) + database sin depender de credenciales. El SHA efectivo de código es obligatorio para destinos externos y debe coincidir con el SHA esperado por el operador.

Errores públicos se sanitizan reutilizando `sanitizeAuditErrorMessage`; no deben exponer URI Mongo cruda, username ni password.

# Exclusión, lease y fencing

La migración usa una colección dedicada:

```text
availability_tenantization_locks
```

Lock lógico:

```text
availability-tenantization-6.2.3
```

Cada adquisición tiene:

- `ownerId`;
- `fencingToken` monotónico;
- `leaseUntil`;
- `protocolVersion`;
- mecanismo `lease-token`.

Una ejecución activa impide que otra adquiera el lock. Un takeover sólo puede ocurrir cuando la lease anterior expiró y aumenta `fencingToken`.

Cada etapa sensible verifica owner + token + lease vigente y renueva la lease. Un proceso antiguo que pierde ownership no puede liberar el lock del nuevo owner porque release filtra por owner y fencing token exactos.

Las operaciones DDL usan un `maxTimeMS` menor que la lease para reducir la posibilidad de que una operación enviada bajo una lease válida continúe más allá de la ventana de fencing.

El lock protege escritores de migración. Para targets externos, la confirmación de ventana de mantenimiento es adicionalmente obligatoria para evitar escrituras runtime concurrentes de una versión vieja durante el cambio físico.

# Revalidación Membership

El plan inicial no se considera autoridad suficiente para escribir.

Después de adquirir el lock se toma un nuevo plan. El backfill se ejecuta dentro de transacción MongoDB y cada asignación deterministic autorizada por ese plan vuelve a consultar Membership dentro de la transacción.

Para escribir debe seguir existiendo exactamente una Membership:

```text
user = worker
role = worker
isActive = true
business = inferredBusiness
```

Si Membership desaparece, se desactiva, aparece otra Membership worker activa o cambia el business inferible, la transacción aborta. La migración no adopta silenciosamente una inferencia nueva.

Apply requiere replica set/transacciones; un Mongo standalone se rechaza antes de mutar.

# Checkpoint pre-drop

Antes del primer `dropIndex` se vuelve a leer el estado completo y se exige:

- lock/lease/fencing todavía vigentes;
- `safeToApply === true`;
- cero Shift deterministic pendientes;
- cero Shift ambiguous/unresolved/invalidExisting;
- cero Block deterministic pendientes;
- cero Block ambiguous/unresolved/invalidExisting;
- cero duplicate Shift target keys;
- cero Appointment target duplicates/invalid active;
- los tres índices tenant presentes;
- cero conflictos de opciones en índices tenant.

Se realiza un segundo checkpoint inmediatamente antes de retirar índices antiguos.

Si aparece un documento legacy después del backfill, los índices antiguos no se eliminan.

# Orden de Apply

1. validar argumentos, entorno, target, fingerprint y provenance;
2. conectar con `autoIndex:false` y comprobar database real;
3. construir plan inicial;
4. exigir `safeToApply`;
5. comprobar soporte de transacciones;
6. preparar y adquirir lock con fencing;
7. releer plan bajo lock;
8. iniciar transacción;
9. revalidar Membership por asignación;
10. backfill determinístico;
11. commit;
12. auditoría post-backfill;
13. crear índices tenant, verificando lock antes/después de cada DDL;
14. auditoría completa pre-drop;
15. segundo checkpoint pre-drop;
16. retirar únicamente índices cuya key física coincide con la especificación legacy;
17. auditoría final;
18. liberar únicamente el lock propio mediante owner + fencing token.

## Fallos parciales

- Si backfill falla, la transacción se aborta.
- Si `createIndex` falla, no se inicia `dropIndex` y los índices legacy permanecen.
- Si aparece estado unsafe antes del drop, se aborta conservadoramente.
- Si se pierde el lock, la ejecución no continúa con nuevas mutaciones y no elimina el lock ajeno.
- Si un índice tenant ya existe con especificación equivalente, se reutiliza.
- Un segundo Apply sobre un estado migrado es idempotente.

# E2E real de migración

La CI ejecuta `runAvailabilityTenantization()` contra MongoDB 7 real configurado como replica set.

La suite construye físicamente estado legacy con:

- Membership worker;
- Shift sin business;
- Block sin business;
- Appointment tenant existente;
- índices físicos legacy.

Se comprueba:

- plan no escribe ni crea lock;
- Apply backfillea Shift/Block al business determinístico;
- crea físicamente los índices tenant;
- elimina físicamente las keys legacy sólo después de checkpoints seguros;
- preserva Appointment/datos no relacionados;
- segundo Apply es idempotente;
- después de migrar, el mismo worker puede tener Shift y Appointment simultáneos en A/B;
- ambiguous produce cero writes;
- cambio de Membership entre plan y backfill aborta sin asignar business incorrecto;
- documento legacy aparecido antes del drop conserva índices antiguos;
- pérdida de fencing lock aborta y no libera lock ajeno;
- fallo simulado de `createIndex` conserva índices legacy.

# Lifecycle de worker

## Soft delete

`deleteWorker(..., softDelete=true)`:

- desactiva Membership tenant;
- conserva Shift del tenant;
- conserva Block del tenant.

La intención es permitir una futura reactivación sin destruir configuración operativa.

## Hard delete

`deleteWorker(..., softDelete=false)`:

- elimina Membership del tenant actual;
- elimina Shift de `business + worker` del tenant actual;
- elimina Block de `business + worker` del tenant actual;
- no elimina Shift/Block del mismo User en otros businesses;
- conserva el User global activo mientras exista otra Membership según la política existente.

Appointment no se borra en esta fase; ownership/lifecycle general pertenece a 6.2.4 u otra decisión explícita.

# Tests de aislamiento runtime

La suite continúa cubriendo:

- Business A + Business B;
- mismo User Worker X;
- Membership X->A y X->B;
- Shift A y Shift B el mismo día con horas distintas;
- GET shifts físicamente limitado al tenant;
- Block A no afecta B y viceversa;
- Admin A/B no eliminan Blocks del otro tenant;
- Worker X en contexto A no manipula B;
- Appointment A no ocupa B y viceversa;
- mismo worker/date/startTime puede coexistir en A/B;
- duplicado activo dentro del mismo tenant sigue colisionando;
- WebSocket `availability_changed` está separado por business;
- hard delete de A conserva Shift/Block/Membership B y el User global.

La prueba `availability-tenant-source-boundary.test.js` sigue recorriendo `Server/src` para impedir la reaparición de APIs runtime globales de disponibilidad y accesos directos Shift/Block fuera de repositories.

# Deuda posterior

6.2.3 no declara resuelto:

- ownership general 6.2.4;
- identidad progresiva 6.2.5;
- admin + worker simultáneo;
- Payments/Webpay/refunds/SII;
- soporte mutable 6.4;
- microservicios/colas/responsive.

`Holiday` permanece como calendario global interno. Una futura necesidad de feriados tenant-specific requiere modelado explícito separado.

# Seguridad operacional

Durante la implementación y sus tests sólo se utiliza infraestructura local/efímera controlada. El soporte técnico para targets externos existe para evitar que el código quede sin ruta operacional futura, pero requiere autorización explícita y no implica que se haya realizado ninguna conexión externa.

Estado del PR durante esta fase:

```text
Draft
No Ready
No merge
```
