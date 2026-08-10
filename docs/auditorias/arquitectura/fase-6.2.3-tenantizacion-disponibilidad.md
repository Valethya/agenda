# Fase 6.2.3 — Tenantización física de disponibilidad

## Estado y alcance

Esta fase parte de `master` en `d27a312a909e9b36c458c807ac7b7f854447639a`, merge commit del PR #22 (6.2.2-D).

6.2.2-D ya estableció que `Membership` activa es la única autoridad tenant. Esta fase no reabre esa decisión: agrega ownership físico tenant a los recursos de disponibilidad que todavía estaban ligados sólo al usuario global.

Alcance de 6.2.3:

- `Shift`;
- `Block`;
- consulta de `Appointment` usada como ocupación en disponibilidad;
- índice de colisión de `Appointment` que todavía imponía unicidad global por worker;
- aislamiento del room WebSocket `availability_changed`;
- migración manual de datos heredados `Shift`/`Block` sin `business`.

No pertenece a 6.2.3:

- ownership general de Appointment u otros recursos (6.2.4);
- identidad progresiva (6.2.5);
- modelo definitivo admin + worker;
- pagos, Webpay, refunds o SII;
- soporte mutable 6.4;
- microservicios, colas o responsive.

## Invariantes

Se mantienen las garantías de 6.2.2-D:

- la identidad de `User` es global;
- `Membership` activa es la única autoridad tenant;
- `Business.owner`, `User.role`, `session.user.role` y `session.user.businessId` no conceden autoridad tenant;
- `session.user.businessId` es contexto seleccionado;
- `superadmin` es privilegio global y no un rol Membership;
- los roles Membership siguen siendo exclusivamente `admin | worker`;
- el índice Membership `{ user: 1, business: 1 }` unique no cambia.

La nueva invariante física de disponibilidad es:

> Todo `Shift` y `Block` tenant runtime pertenece explícitamente a `business + worker`.

Además, las citas usadas como ocupación deben consultarse por `business + worker + date`.

## Situación previa

### Shift

Antes:

```js
{
  worker,
  dayOfWeek,
  ...
}
```

Índice conceptual previo:

```js
{ worker: 1, dayOfWeek: 1 } // unique
```

Este índice impedía que un mismo usuario global tuviera el mismo día de semana configurado en dos negocios diferentes.

### Block

Antes:

```js
{
  worker,
  date,
  ...
}
```

Índice de consulta previo:

```js
{ worker: 1, date: 1 }
```

Las consultas de rango y la eliminación podían comenzar desde un recurso global ligado sólo al worker.

### Appointment en disponibilidad

`Appointment` ya tenía `business`, pero disponibilidad consultaba por:

```js
worker + date
```

El índice de colisión también era global:

```js
{ worker: 1, date: 1, startTime: 1 }
```

Por lo tanto una Appointment en A podía ocupar B y el mismo worker no podía tener la misma hora en dos negocios diferentes.

### WebSocket

`calendar_update` ya se emitía al room:

```text
business:<businessId>
```

pero `availability_changed` usaba:

```text
availability:<workerId>:<date>
```

Con un mismo usuario global en A y B, ambos tenants podían compartir el mismo room de disponibilidad.

## Schemas después de 6.2.3

### Shift

```js
{
  business: ObjectId<Business>, // required
  worker: ObjectId<User>,       // required
  dayOfWeek,
  isOpen,
  startTime,
  endTime,
  breaks
}
```

Índice objetivo:

```js
{ business: 1, worker: 1, dayOfWeek: 1 } // unique
```

Nombre declarado:

```text
shift_business_worker_day_unique
```

### Block

```js
{
  business: ObjectId<Business>, // required
  worker: ObjectId<User>,       // required
  date,
  startTime,
  endTime,
  reason
}
```

Índice objetivo:

```js
{ business: 1, worker: 1, date: 1 }
```

Nombre declarado:

```text
block_business_worker_date
```

### Appointment

No se rediseña el ownership de Appointment. Sólo se corrige la frontera física que afecta disponibilidad.

Índice objetivo:

```js
{ business: 1, worker: 1, date: 1, startTime: 1 }
```

Unique únicamente para estados activos:

```js
{
  status: {
    $in: ["pending_payment", "pending", "confirmed", "completed"]
  }
}
```

Las citas `cancelled` permanecen fuera de la colisión.

Nombre declarado:

```text
appointment_business_worker_date_start_active_unique
```

## Gestión explícita de índices

Los schemas `Shift`, `Block` y `Appointment` sólo permiten `autoIndex` cuando `NODE_ENV === "test"`.

Motivo:

- la suite usa Mongo local/efímero y necesita comprobar colisiones físicas reales;
- development/producción no deben intentar construir automáticamente los nuevos índices sobre documentos heredados antes del plan/backfill;
- la migración 6.2.3 usa conexión con `autoIndex: false` y controla el orden de creación/eliminación.

El schema expresa la especificación deseada, pero la migración verifica el estado físico mediante `listIndexes()` y opera sobre nombres reales encontrados.

## Repositories tenant-scoped

### Shift

APIs runtime:

```text
findByBusinessAndWorker(businessId, workerId)
findByBusinessWorkerAndDay(businessId, workerId, dayOfWeek)
upsertByBusinessWorkerAndDay(businessId, workerId, dayOfWeek, data)
deleteByBusinessAndWorker(businessId, workerId)
```

Las variantes runtime globales por sólo `workerId` fueron retiradas.

### Block

APIs runtime:

```text
findByBusinessWorkerAndDateRange(businessId, workerId, startDate, endDate)
findByIdAndBusiness(id, businessId)
createForBusinessWorker(businessId, workerId, data)
deleteByIdBusinessAndWorker(id, businessId, workerId)
```

No se conserva una API tenant de eliminación por sólo `_id` o `_id + worker`.

### Appointment usado por disponibilidad

La consulta pasa a:

```text
findByBusinessWorkerAndDate(businessId, workerId, date)
```

Los `findById` globales que permanecen por flujos fuera de disponibilidad no se rediseñan en este PR; pertenecen a la deuda de ownership general 6.2.4 y a dominios públicos/payment ya existentes.

## Escrituras HTTP

### saveShift

La persistencia incluye siempre:

```text
business = req.businessId
worker = workerId validado
```

Antes de escribir se conserva la validación 6.2.2-D:

- User global activo;
- Membership activa del mismo `req.businessId`;
- rol Membership `worker` para el worker objetivo;
- un actor worker sólo puede operar su propia identidad;
- un admin sólo opera dentro de su tenant vigente.

### createBlock

La creación usa `req.businessId + workerId` como identidad tenant explícita.

### deleteBlock

La lectura inicial es:

```js
{ _id: blockId, business: req.businessId }
```

y la eliminación final usa:

```js
{ _id: blockId, business: req.businessId, worker: workerId }
```

Un ID válido de otro tenant falla cerrado como recurso inexistente.

## Lectura pública y cálculo de disponibilidad

`GET /availability/shifts/:workerId` mantiene la validación Membership del worker y además consulta físicamente por `business + worker`.

Para `getAvailableSlots(..., businessId)` las fuentes quedan así:

- Service: `serviceId + businessId`;
- worker: User global activo + Membership `worker` activa en `businessId`;
- Shift: `businessId + workerId + dayOfWeek`;
- Block: `businessId + workerId + date range`;
- Appointment: `businessId + workerId + date`;
- BusinessConfig: `businessId`.

`Holiday` continúa siendo un calendario global interno, sin endpoint tenant de mutación registrado en el router actual. No se presenta como propiedad de Business A o B. Si en el futuro se requieren cierres/feriados configurables por negocio, eso deberá modelarse explícitamente en otra fase en vez de reinterpretar silenciosamente este recurso global.

## WebSocket

El room de disponibilidad cambia de:

```text
availability:<workerId>:<date>
```

a:

```text
availability:<businessId>:<workerId>:<date>
```

La Membership sigue revalidándose antes de joins y broadcasts. `calendar_update` continúa en `business:<businessId>`.

Así, el mismo Worker X puede estar suscrito a la misma fecha en A y B sin recibir `availability_changed` del tenant contrario.

## Migración de datos heredados

Script:

```text
Server/scripts/migrations/availability-tenantization.js
```

Comando:

```text
npm run migration:availability-tenantization -- ...
```

La migración no se ejecuta al iniciar la aplicación.

### Restricciones operacionales

Sólo acepta:

- `NODE_ENV=development|test`;
- `--environment` idéntico a `NODE_ENV`;
- base `_dev` en development o `_test` en test;
- MongoDB local (`127.0.0.1`, `localhost`, loopback IPv6);
- fingerprint SHA-256 esperado explícito;
- ausencia de indicadores de Railway, Vercel, Render, Netlify, Fly, Lambda, etc.

`apply` requiere confirmación literal:

```text
TENANTIZE_AVAILABILITY_6_2_3
```

No admite Atlas ni otro Mongo externo en esta fase.

### Clasificación Shift/Block

Para cada documento sin `business`:

#### A — deterministic

El worker posee exactamente una Membership activa con rol `worker`.

Se puede inferir el `business` sin ambigüedad.

#### B — ambiguous

El worker posee más de una Membership activa con rol `worker`.

No se elige automáticamente un negocio. `safeToApply=false`.

#### C — unresolved/orphan

El worker no posee una Membership `worker` activa válida.

No se inventa un negocio. `safeToApply=false`.

#### alreadyMigrated

El documento ya tiene `business` y existe Membership `worker` activa para ese par `worker + business`.

#### invalidExisting

El documento trae `business` pero el valor es inválido o no coincide con una Membership `worker` activa.

También bloquea Apply.

### Conflictos previos

Antes de escribir se detectan:

- claves Shift que colisionarían después del backfill en `business + worker + dayOfWeek`;
- Appointments activas duplicadas en `business + worker + date + startTime`;
- índices con la misma key destino pero opciones incompatibles.

Dos Appointments con mismo worker/fecha/hora en negocios distintos no se clasifican como conflicto.

## Orden de Apply

El orden implementado es:

1. leer snapshot y `listIndexes()`;
2. construir plan sin writes;
3. fallar cerrado ante ambigüedad, orphan, existing inválido o colisión;
4. backfill determinístico de Shift/Block dentro de una transacción;
5. volver a leer y verificar invariantes;
6. crear índices tenant nuevos por especificación si todavía no existen;
7. verificar físicamente los índices nuevos;
8. localizar y retirar únicamente índices globales obsoletos cuya key coincide exactamente con las especificaciones antiguas;
9. volver a auditar y exigir índices tenant presentes + índices globales ausentes.

Si la creación del índice tenant falla, los índices globales antiguos no se eliminan.

Si el proceso falla después de crear un índice nuevo pero antes de retirar el antiguo, queda en un estado conservador y reintentable: no se pierde el índice previo y la auditoría final no declara éxito.

## Idempotencia

- documentos ya migrados se clasifican y no se vuelven a backfillear;
- el backfill sólo actualiza `_id` cuya propiedad `business` sigue ausente/null;
- una modificación concurrente hace que `modifiedCount` no coincida y aborta la transacción;
- índices destino equivalentes por especificación se reutilizan;
- índices obsoletos se eliminan sólo si su key real coincide exactamente con la key antigua;
- la auditoría se repite después del Apply.

## Tests adversariales 6.2.3

La suite dedicada cubre explícitamente:

- Business A + Business B;
- mismo User Worker X;
- Membership worker X→A y X→B;
- Shift A lunes 09:00–18:00;
- Shift B lunes 14:00–20:00;
- coexistencia física de ambos;
- lectura A sólo devuelve A;
- lectura B sólo devuelve B;
- Block A reduce A y no B;
- Block B reduce B y no A;
- Admin A no elimina Block B;
- Admin B no elimina Block A;
- Worker X en contexto A no elimina Block B;
- Appointment A no ocupa B;
- Appointment B no ocupa A;
- misma hora/worker en A y B puede coexistir;
- misma hora/worker/business activa sigue chocando;
- repositories de Shift/Block/Appointment usados por disponibilidad no devuelven datos del otro tenant;
- índices físicos frescos contienen las keys tenant y no las keys globales antiguas;
- WebSocket `availability_changed` no cruza tenants para el mismo worker global.

La suite de migración cubre además:

- deterministic;
- ambiguous;
- unresolved;
- alreadyMigrated;
- invalidExisting;
- colisiones destino Shift;
- colisiones Appointment tenant-scoped;
- reconocimiento físico de índices anteriores/nuevos;
- rechazo de production, Mongo externo y plataformas de despliegue;
- confirmación obligatoria de Apply.

## Deuda posterior

6.2.3 no declara resuelto ownership general.

Continúa para 6.2.4 la revisión sistemática de ownership y consultas por ID en recursos que no forman parte de disponibilidad, incluidos los flujos globales de Appointment que hoy existen por razones públicas/payment.

También permanece como deuda independiente el caso de una misma persona que deba ser simultáneamente admin y profesional agendable dentro del mismo negocio; no se cambió el modelo `Membership.role = admin | worker` ni su índice único.

## Seguridad operacional

La implementación de esta fase no requiere ni autoriza:

- acceso a Atlas;
- acceso a bases productivas;
- creación de usuarios reales;
- seeds remotos;
- ejecución automática de Apply;
- modificación de datos reales;
- inclusión de credenciales.

Las validaciones y tests están diseñados para infraestructura local/efímera/controlada.
