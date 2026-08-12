# Fase 6.2.3 — Tenantización física de disponibilidad

## Estado y alcance

Base de esta fase:

- `master`
- `d27a312a909e9b36c458c807ac7b7f854447639a`

6.2.2-D estableció que `Membership` activa es la única autoridad tenant. 6.2.3 no reabre esa decisión: agrega ownership físico tenant a disponibilidad, migra el estado legacy y evita que un runtime 6.2.3 pueda servir tráfico remoto antes de completar el cutover físico.

Incluye:

- `Shift` tenant-scoped;
- `Block` tenant-scoped;
- ocupación de `Appointment` consultada por tenant;
- índice de colisión tenant de Appointment;
- aislamiento WebSocket de `availability_changed`;
- migración plan/apply de Shift/Block legacy;
- lifecycle tenant de Shift/Block al eliminar físicamente una Membership worker;
- gate de startup para impedir un despliegue remoto sobre almacenamiento legacy.

Fuera de alcance:

- ownership general de Appointment u otros recursos (6.2.4);
- identidad progresiva (6.2.5);
- admin + worker simultáneo;
- Payments/Webpay/refunds/SII;
- soporte mutable 6.4;
- microservicios, colas o responsive.

## Invariantes preservados

- `User` es identidad global.
- `Membership` activa es la única autoridad tenant.
- `Business.owner`, `User.role`, `session.user.role` y `session.user.businessId` no conceden autoridad tenant.
- `session.user.businessId` sólo representa contexto seleccionado.
- `superadmin` es privilegio global y no un rol Membership.
- Roles Membership continúan siendo `admin | worker`.
- El índice Membership `{ user: 1, business: 1 }` unique no cambia.
- No se reintroducen consultas globales de disponibilidad por sólo `worker`.

La invariante física de disponibilidad es:

> Todo Shift y Block runtime pertenece explícitamente a `business + worker`; Appointment usado como ocupación se consulta por `business + worker + date`.

## Schemas e índices

### Shift

Campo obligatorio:

```js
business: ObjectId<Business>
```

Índice legacy:

```js
{ worker: 1, dayOfWeek: 1 } // unique
```

Índice objetivo:

```js
{ business: 1, worker: 1, dayOfWeek: 1 } // unique
```

Nombre: `shift_business_worker_day_unique`.

### Block

Campo obligatorio:

```js
business: ObjectId<Business>
```

Índice legacy:

```js
{ worker: 1, date: 1 }
```

Índice objetivo:

```js
{ business: 1, worker: 1, date: 1 }
```

Nombre: `block_business_worker_date`.

### Appointment usado por disponibilidad

No se rediseña ownership general de Appointment.

Key legacy declarada en la base 6.2.2-D:

```js
{ worker: 1, date: 1, startTime: 1 }
```

La declaración heredada intentaba aplicar:

```js
partialFilterExpression: {
  status: { $ne: "cancelled" }
}
```

El índice objetivo 6.2.3 es:

```js
{ business: 1, worker: 1, date: 1, startTime: 1 }
```

con:

```js
partialFilterExpression: {
  status: {
    $in: ["pending_payment", "pending", "confirmed", "completed"]
  }
}
```

Nombre: `appointment_business_worker_date_start_active_unique`.

## Importante: declaración legacy `$ne` y MongoDB 7

MongoDB 7 no admite `$ne` dentro de `partialFilterExpression`. La E2E lo comprueba ejecutando físicamente `createIndex()` con la declaración heredada y exige que MongoDB 7 la rechace.

Por tanto, la suite no falsifica el índice heredado utilizando el `$in` del índice nuevo. Para las pruebas del orden DDL se usa como sustituto físico conservador un índice global `unique` regular sobre la misma key legacy, sin partial filter. Ese índice es un superset más estricto: también cubre documentos con status desconocido o ausente. La migración sigue identificando el índice obsoleto por su key física.

Esta diferencia entre **declaración de schema heredada** y **capacidad física real de MongoDB 7** queda documentada explícitamente y no se presenta como equivalencia exacta.

## Política exhaustiva de estados físicos Appointment

Estados permitidos:

```text
pending_payment
pending
confirmed
completed
cancelled
```

Reglas de auditoría:

- `cancelled`: queda legítimamente fuera de la colisión activa;
- `pending_payment`, `pending`, `confirmed`, `completed`: deben tener `business`, `worker`, `date` y `startTime` físicamente válidos y participan en detección de duplicados tenant;
- cualquier otro status, string vacío, campo ausente o tipo malformado se cuenta como `invalidStatus` y fuerza `safeToApply=false`.

No se normaliza ni corrige automáticamente un status desconocido.

El plan público expone:

```text
counts.appointments.invalidStatus
```

## Gestión explícita de índices

`Shift`, `Block` y `Appointment` sólo permiten `autoIndex` con `NODE_ENV === "test"`.

Fuera de test, el estado físico se transforma mediante la migración 6.2.3. El runtime no crea los índices de migración a ciegas sobre datos heredados.

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
- `deleteByBusinessAndWorker(businessId, workerId)`

### Appointment usado por disponibilidad

- `findByBusinessWorkerAndDate(businessId, workerId, date)`

Las APIs generales de Appointment que quedan fuera de disponibilidad pertenecen a 6.2.4 y no se modifican aquí.

## WebSocket

Room de disponibilidad:

```text
availability:<businessId>:<workerId>:<date>
```

`calendar_update` continúa en:

```text
business:<businessId>
```

El mismo User worker puede pertenecer a A y B sin compartir `availability_changed`.

# Migración 6.2.3

Script:

```text
Server/scripts/migrations/availability-tenantization.js
```

Versión después de la corrección adversarial:

```text
1.1.3
```

Modos:

- `plan`: read-only;
- `apply`: mutación explícita, confirmada y cercada.

La migración no se ejecuta al startup.

## Business físico existente y activo

El snapshot de migración lee como mínimo de `businesses`:

```text
_id
isActive
```

Una Membership puede participar en la inferencia de Shift/Block sólo cuando simultáneamente se cumple:

```text
Membership.role === "worker"
Membership.isActive === true
Membership.business es BSON ObjectId
Business._id === Membership.business
Business.isActive === true
```

No basta con que Membership contenga un ObjectId.

### Clasificación

`deterministic`:

- exactamente un Business físico, existente y activo es elegible para ese worker.

`ambiguous`:

- más de un Business físico activo válido es elegible.

`unresolved`:

- no existe ningún Business físico activo válido, incluso si existe una Membership activa que apunta a un Business ausente o inactivo.

`alreadyMigrated`:

- `document.business` es BSON ObjectId;
- existe físicamente;
- `Business.isActive === true`;
- corresponde a una Membership `worker` activa del mismo User.

`invalidExisting`:

- business existente en el documento es malformado, inexistente, inactivo o no está respaldado por la Membership worker activa requerida.

Todos los estados ambiguous/unresolved/invalidExisting bloquean Apply.

## Revalidación dentro de la transacción

El plan nunca se usa como autoridad suficiente para escribir.

Después de adquirir el lock se relee el plan. Dentro de la transacción, inmediatamente antes de cada backfill, se vuelve a consultar bajo la misma sesión:

1. Membership del worker con `role=worker` e `isActive=true`;
2. los Business referenciados por esas Memberships;
3. `Business._id` físico;
4. `Business.isActive === true`.

Debe continuar existiendo exactamente un Business elegible y debe ser idéntico al `inferredBusiness` observado bajo lock.

Si Membership cambia, Business desaparece, Business se desactiva o la inferencia cambia antes del backfill, la transacción aborta. No se adopta automáticamente otro tenant.

## Lock, lease y fencing

Se conserva íntegramente el protocolo endurecido:

- colección `availability_tenantization_locks`;
- lock lógico `availability-6-2-3`;
- `ownerId`;
- `fencingToken`;
- `leaseUntil`;
- `protocolVersion`;
- fence transaccional sobre el propio documento de lock;
- renew/assert/release con owner + token;
- checkpoints antes y después de DDL;
- `maxTimeMS` DDL inferior a la lease.

La validación de Business se añade dentro de este modelo fail-closed; no lo sustituye ni simplifica.

## Checkpoint pre-drop

Antes de retirar el primer índice legacy se exige nuevamente:

- lock/lease/fencing vigentes;
- `safeToApply === true`;
- cero Shift/Block deterministic pendientes;
- cero ambiguous/unresolved/invalidExisting;
- cero duplicate Shift target keys;
- cero Appointment activos inválidos;
- cero `invalidStatus` Appointment;
- cero duplicate Appointment target keys;
- los tres índices tenant presentes;
- cero conflictos físicos de los índices tenant.

Se hace un segundo snapshot/checkpoint inmediatamente antes del drop.

Si aparece un documento legacy o un status inválido después del backfill, los índices legacy permanecen.

## Orden de Apply

1. validar argumentos, entorno, target, fingerprint y provenance;
2. conectar con `autoIndex:false` y verificar database real;
3. construir plan inicial incluyendo Business físico y Appointment status;
4. exigir `safeToApply`;
5. verificar soporte de transacciones;
6. adquirir lock lease/fencing;
7. releer plan bajo lock;
8. abrir transacción;
9. cercar el lock dentro de la transacción;
10. revalidar Membership + Business físico activo por asignación;
11. ejecutar backfill determinístico;
12. commit;
13. revalidar ownership del lock;
14. auditar post-backfill;
15. crear índices tenant con checkpoints;
16. auditoría completa pre-drop;
17. segundo checkpoint inmediatamente antes de drop;
18. retirar sólo índices cuya key física coincide con la especificación legacy;
19. auditoría final;
20. liberar sólo el lock propio.

# Gate operacional de cutover

## Auditoría de despliegue

El repositorio contiene CI de GitHub Actions para `pull_request` y `push` a `master`; ese workflow no contiene un job de despliegue. El historial del backend contiene cambios específicos para Railway, por lo que existe evidencia de uso de Railway, pero la configuración actual del proyecto Railway/autodeploy es externa al repositorio y no puede verificarse desde GitHub.

Por esa incertidumbre se adopta la política conservadora: **un merge a master se trata como potencialmente desplegable automáticamente**.

## Mecanismo mínimo fail-closed

Archivo:

```text
Server/src/db/availability-cutover-gate.js
```

`Server/src/index.js` ahora:

1. espera conexión Mongo;
2. ejecuta el gate de almacenamiento 6.2.3;
3. sólo después abre `app.listen()` e inicializa Socket.IO.

El gate se aplica cuando:

- `NODE_ENV` es `staging` o `production`; o
- se detecta un indicador conocido de plataforma de deploy, incluyendo Railway, Vercel, Render, Fly, Netlify, Lambda, etc.

Exige explícitamente:

```text
AVAILABILITY_6_2_3_CUTOVER=AVAILABILITY_6_2_3_STORAGE_READY
```

Esa confirmación **no salta las verificaciones físicas**. El gate vuelve a comprobar read-only:

- colecciones Shift/Block/Appointment presentes;
- todo Shift y Block tiene `business` BSON ObjectId;
- ningún Appointment tiene status físico fuera de los cinco permitidos;
- los tres índices tenant exactos existen;
- las keys de índices legacy ya no existen.

Si cualquiera falla, el proceso termina antes de escuchar HTTP.

No existe fallback por worker global.

## Procedimiento obligatorio de cutover externo

La ventana de mantenimiento debe abarcar todo el tramo crítico, no sólo el comando Apply.

1. **Detener/excluir writers runtime** y evitar escrituras manuales sobre disponibilidad.
2. **Abrir ventana de mantenimiento** y mantenerla activa hasta completar smoke tests.
3. **Verificar SHA exacto** del código aprobado y fingerprint/database del destino.
4. Ejecutar **Plan** desde operador aislado usando el SHA aprobado.
5. Revisar `safeToApply`, findings, counts e índices físicos; no continuar si no es completamente seguro.
6. Ejecutar **Apply** con autorización externa, maintenance confirmation y confirmación literal.
7. Revisar el `finalPlan` retornado y exigir `safeToApply=true`.
8. Verificar físicamente Shift/Block, Appointment statuses, índices tenant y ausencia de índices legacy.
9. Configurar `AVAILABILITY_6_2_3_CUTOVER=AVAILABILITY_6_2_3_STORAGE_READY` y **desplegar runtime 6.2.3** del SHA aprobado. Si un autodeploy se adelanta, el gate debe impedir que ese proceso abra HTTP.
10. Ejecutar **smoke tests tenant A/B**, incluyendo mismo User worker donde corresponda y aislamiento de Shift/Block/Appointment/WebSocket.
11. **Restaurar tráfico/writers** sólo después de pasar el gate y los smoke tests.
12. **Cerrar la ventana de mantenimiento** y registrar el SHA/runtime/estado físico finalmente desplegados.

No se debe fusionar ni desplegar 6.2.3 si no existe capacidad operacional para cumplir este orden.

Durante este trabajo no se ejecutó ninguna migración externa ni se accedió a Atlas, staging real, producción o datos reales.

# Política de destinos de la migración

Development/test permanece local-only.

Staging/production externo sigue deny-by-default y requiere simultáneamente:

- entorno efectivo y solicitado idénticos;
- database exacta;
- fingerprint esperado;
- `--allow-external-target=AUTHORIZE_EXTERNAL_AVAILABILITY_TARGET`;
- `--expected-code-sha=<sha>`;
- provenance efectiva coincidente;
- ejecución desde operador aislado, no desde plataforma de deploy;
- Apply: `--maintenance-window=MAINTENANCE_WINDOW_CONFIRMED`;
- Apply: `--confirm=TENANTIZE_AVAILABILITY_6_2_3`.

# E2E real de migración

La suite ejecuta `runAvailabilityTenantization()` contra MongoDB 7 real configurado como replica set y prueba operaciones físicas.

Cobertura de la corrección adversarial:

- la declaración legacy Appointment con `$ne: "cancelled"` es intentada físicamente y MongoDB 7 la rechaza;
- fixture DDL posterior usa índice global regular conservador sobre la misma key legacy, nunca el `$in` nuevo;
- plan read-only;
- Apply real + índices + segundo Apply idempotente;
- gate runtime pasa después de Apply exitoso;
- Membership activa + Business activo => inferencia válida;
- Business inactivo antes de Plan => Apply bloqueado con cero writes;
- Business inexistente => Apply bloqueado con cero writes;
- Business desactivado después del plan bajo lock y antes del backfill => transacción abortada;
- Membership cambiada antes del backfill => transacción abortada;
- unknown Appointment status => Plan/Apply unsafe e índice legacy conservado;
- missing Appointment status => Plan/Apply unsafe e índice legacy conservado;
- `cancelled` no bloquea la creación del índice tenant;
- documento legacy aparecido pre-drop => no se eliminan índices antiguos;
- pérdida del fencing lock => abort y no libera lock ajeno;
- fallo de `createIndex` => índices legacy conservados.

En GitHub Actions #111, sobre HEAD de código y gate `3b89de91163ad8eaa8d6115317c2391eb26dd7f8`, la suite de migración quedó **15/15 pass** y la integración completa **88/88 pass**.

# Lifecycle de worker

## Soft delete

- desactiva Membership tenant;
- conserva Shift tenant;
- conserva Block tenant.

## Hard delete

- elimina Membership tenant actual;
- elimina Shift `business + worker` sólo del tenant actual;
- elimina Block `business + worker` sólo del tenant actual;
- conserva recursos del mismo User en otros negocios;
- conserva User global cuando corresponde según Membership restantes.

Appointment no se borra en esta fase.

# Cobertura runtime preservada

Se mantienen:

- mismo User Worker X en Business A/B;
- Shift A/B mismo día independientes;
- GET shifts físicamente tenant-scoped;
- Block A no afecta B;
- Admin A no elimina Block B;
- Worker A no manipula B;
- Appointment A no ocupa B;
- mismo worker/date/startTime puede coexistir en A/B;
- colisión activa sigue bloqueada dentro del mismo tenant;
- WebSocket room incluye business;
- hard delete A preserva B;
- Membership sigue siendo la única autoridad tenant.

`availability-tenant-source-boundary.test.js` continúa recorriendo `Server/src` y falla si reaparecen APIs globales por worker, accesos directos Shift/Block fuera de repositories o índices runtime legacy.

# CI de esta corrección adversarial

Último run completo de código + gate antes del commit documental de cierre:

```text
GitHub Actions #111
HEAD: 3b89de91163ad8eaa8d6115317c2391eb26dd7f8
```

Resultado:

- Backend unit: **250/250 pass, 0 fail**.
- Backend integration: **88/88 pass, 0 fail**:
  - Membership physical audit 1/1;
  - Membership baseline 7/7;
  - Membership runtime authority 10/10;
  - tenant resource isolation 8/8;
  - availability migration E2E 15/15;
  - worker lifecycle 3/3;
  - availability 6.2.3 7/7;
  - API 18/18;
  - integration flow 5/5;
  - payment regression 5/5;
  - WebSocket 9/9.
- Frontend policy + Astro + strict TypeScript + production build: **SUCCESS**.
- Gitleaks: **SUCCESS**.

Este archivo es una mutación documental posterior al run #111 y por ello genera un nuevo HEAD/run. La descripción del PR registra el run exacto que valida el HEAD definitivo, evitando afirmar que un CI anterior validó un commit posterior.

Los advisories de dependencias preexistentes permanecen fuera del alcance 6.2.3; el workflow continúa usando threshold `critical`.

# Riesgos residuales

- El gate de startup evita servir un runtime remoto 6.2.3 sobre almacenamiento legacy, pero no reemplaza la ventana de mantenimiento ni coordina writers externos/manuales.
- La configuración de autodeploy del proveedor externo no vive en este repositorio y debe verificarse operacionalmente antes de Ready/merge.
- La declaración legacy `$ne: cancelled` no es físicamente construible como partial index en MongoDB 7; la migración y tests tratan esa incompatibilidad explícitamente.
- `Holiday` continúa siendo calendario global interno.
- Ownership general de Appointment continúa diferido a 6.2.4.
- Los advisories npm preexistentes no se corrigen en este PR.

# Estado del PR

6.2.3 debe permanecer **Draft** después de estas correcciones. No Ready y no merge hasta una nueva revisión adversarial independiente y la preparación operacional del cutover.
