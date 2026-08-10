# Fase 6.2.3 — Tenantización física de disponibilidad

## Estado y alcance

Esta fase parte de `master` en `d27a312a909e9b36c458c807ac7b7f854447639a`, merge commit del PR #22 (6.2.2-D).

6.2.2-D estableció que `Membership` activa es la única autoridad tenant. 6.2.3 no reabre esa decisión: agrega ownership físico tenant a disponibilidad y una migración manual reproducible para transformar el estado heredado.

Incluye:

- `Shift` tenant-scoped;
- `Block` tenant-scoped;
- ocupación de `Appointment` consultada por tenant;
- índice de colisión tenant de Appointment;
- aislamiento WebSocket de `availability_changed`;
- migración plan/apply de Shift/Block legacy;
- lifecycle tenant de Shift/Block al eliminar físicamente una Membership worker.

No incluye:

- ownership general de Appointment u otros recursos (6.2.4);
- identidad progresiva (6.2.5);
- admin + worker simultáneo;
- Payments/Webpay/refunds/SII;
- soporte mutable 6.4;
- microservicios, colas o responsive.

## Invariantes

Se conservan las decisiones de 6.2.2-D:

- `User` es identidad global;
- `Membership` activa es la única autoridad tenant;
- `Business.owner`, `User.role`, `session.user.role` y `session.user.businessId` no conceden autoridad tenant;
- `session.user.businessId` sólo representa contexto seleccionado;
- `superadmin` es privilegio global y no un rol Membership;
- roles Membership continúan siendo `admin | worker`;
- el índice Membership `{ user: 1, business: 1 }` unique no cambia.

La invariante física de disponibilidad queda:

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

Índice legacy:

```js
{ worker: 1, date: 1, startTime: 1 }
```

Índice objetivo:

```js
{ business: 1, worker: 1, date: 1, startTime: 1 }
```

Unique para los estados activos actualmente definidos:

```js
{
  status: {
    $in: ["pending_payment", "pending", "confirmed", "completed"]
  }
}
```

Nombre: `appointment_business_worker_date_start_active_unique`.

`cancelled` permanece fuera de la colisión.

## Gestión explícita de índices

`Shift`, `Block` y `Appointment` sólo permiten `autoIndex` con `NODE_ENV === "test"`.

Esto evita que un deploy intente crear índices nuevos sobre datos heredados antes del backfill. Fuera de test, el estado físico se transforma mediante la migración 6.2.3.

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

Las APIs generales de Appointment que quedan fuera de disponibilidad no se rediseñan aquí; pertenecen a 6.2.4.

## WebSocket

El room de disponibilidad es:

```text
availability:<businessId>:<workerId>:<date>
```

`calendar_update` continúa en:

```text
business:<businessId>
```

La autoridad Membership se sigue revalidando para joins/broadcasts. El mismo User worker puede pertenecer a A y B sin compartir `availability_changed`.

# Migración 6.2.3

Script:

```text
Server/scripts/migrations/availability-tenantization.js
```

Versión:

```text
1.1.2
```

Modos:

- `plan`: read-only;
- `apply`: mutación explícita, confirmada y cercada.

La migración no se ejecuta al startup.

## Clasificación legacy

Para Shift/Block sin business:

- `deterministic`: existe exactamente una Membership `worker` activa para el User;
- `ambiguous`: existen dos o más Memberships `worker` activas; Apply falla cerrado;
- `unresolved/orphan`: no existe Membership `worker` activa válida; Apply falla cerrado;
- `alreadyMigrated`: business ya existe y coincide con una Membership worker activa;
- `invalidExisting`: business existe pero es inválido o incompatible; Apply falla cerrado.

El plan también bloquea:

- claves Shift que colisionarían tras backfill;
- Appointments activas duplicadas dentro de `business + worker + date + startTime`;
- Appointments activas inválidas para la clave objetivo;
- índices destino con key o nombre objetivo pero opciones incompatibles.

## Política de destinos

La migración separa capacidad técnica de autorización operacional y permanece deny-by-default.

### Development/test local

Sólo acepta:

- `NODE_ENV=development|test` idéntico a `--environment`;
- MongoDB loopback/local;
- base `_dev` en development o `_test` en test;
- fingerprint SHA-256 esperado;
- confirmación literal para Apply.

### Staging/production externo

Existe una ruta técnica futura para un destino externo explícitamente autorizado, pero no existe opt-in implícito.

Se exige simultáneamente:

- `NODE_ENV=staging|production` idéntico a `--environment`;
- database exacta explícita;
- fingerprint SHA-256 esperado;
- `--allow-external-target=AUTHORIZE_EXTERNAL_AVAILABILITY_TARGET`;
- `--expected-code-sha=<sha>`;
- SHA efectivo resuelto desde provenance soportada, por ejemplo `AVAILABILITY_TENANTIZATION_CODE_SHA`;
- coincidencia exacta entre SHA esperado y SHA efectivo;
- ausencia de indicadores de ejecución dentro de Vercel/Railway/Render/Fly/Netlify/Lambda/etc.;
- para Apply: `--maintenance-window=MAINTENANCE_WINDOW_CONFIRMED`;
- para Apply: `--confirm=TENANTIZE_AVAILABILITY_6_2_3`.

La ventana de mantenimiento es parte del contrato operacional porque el lock de migración coordina escritores de la propia migración, pero no pretende convertir automáticamente todas las escrituras runtime existentes en participantes del protocolo.

**Durante el desarrollo de este PR no se accedió a Atlas, staging real, producción ni datos reales.**

## Fingerprint, provenance y errores públicos

El fingerprint confirma el target esperado sin depender de credenciales. Para destinos externos, el SHA efectivo de código es obligatorio y debe coincidir con el esperado por el operador.

El entrypoint reutiliza `sanitizeAuditErrorMessage` para no imprimir la URI Mongo cruda, username o password en errores operacionales.

# Exclusión, lease y fencing

Colección dedicada:

```text
availability_tenantization_locks
```

Lock lógico:

```text
availability-6-2-3
```

Cada adquisición registra:

- `ownerId`;
- `fencingToken`;
- `leaseUntil`;
- `protocolVersion`;
- mecanismo `lease-token`.

Una segunda ejecución no puede adquirir un lock vivo. Un takeover sólo puede ocurrir cuando la lease previa expiró y aumenta el fencing token. Release exige owner + fencing token + versión exactos, por lo que un proceso antiguo no puede liberar el lock del nuevo propietario.

## Fence dentro de la transacción

Antes de tocar Shift/Block, la transacción ejecuta su primer write sobre el mismo documento de lock utilizando:

- `_id` del lock;
- `ownerId`;
- `fencingToken`;
- `protocolVersion`;
- lease aún vigente.

Ese write registra `transactionFenceOwner`, `transactionFenceToken` y `transactionFenceAt` dentro de la propia transacción.

La consecuencia buscada es que un takeover que intente modificar el mismo documento de lock después de superar el TTL no pueda coexistir limpiamente con el backfill transaccional: deberá esperar, provocar conflicto o ganar después de que la transacción termine. Inmediatamente después del commit, el proceso vuelve a comprobar y renovar owner/token antes de cualquier DDL. Si otro owner ganó, la ejecución anterior aborta y no continúa con índices.

Las operaciones DDL usan además `maxTimeMS` menor que la lease y verifican ownership antes y después de cada operación.

# Revalidación Membership

El plan inicial no es suficiente para escribir.

Después de adquirir el lock se toma un nuevo plan. Dentro de la transacción, cada asignación deterministic vuelve a consultar Membership con:

```text
user = worker
role = worker
isActive = true
```

Debe existir exactamente un business activo y debe coincidir con el `inferredBusiness` observado bajo lock.

Si Membership desaparece, se desactiva, aparece otra Membership worker antes de abrir la transacción o cambia la inferencia observada, Apply aborta y no adopta silenciosamente un business distinto.

Apply requiere un Mongo que admita transacciones; un standalone se rechaza antes de mutar.

# Checkpoint pre-drop

Antes del primer `dropIndex` se relee el estado completo y se exige:

- lock/lease/fencing vigentes;
- `safeToApply === true`;
- cero Shift deterministic pendientes;
- cero Shift ambiguous/unresolved/invalidExisting;
- cero Block deterministic pendientes;
- cero Block ambiguous/unresolved/invalidExisting;
- cero duplicate Shift target keys;
- cero Appointment target duplicates/invalid active;
- los tres índices tenant presentes;
- cero conflictos de opciones en los índices tenant.

Se realiza un segundo checkpoint inmediatamente antes de retirar índices legacy.

Si aparece un nuevo documento legacy después del backfill, Apply aborta conservadoramente y los índices legacy no se eliminan.

# Orden de Apply

1. validar argumentos, entorno, target, fingerprint y provenance;
2. conectar con `autoIndex:false` y verificar database real;
3. construir plan inicial;
4. exigir `safeToApply`;
5. verificar soporte de transacciones;
6. preparar y adquirir lock con lease/fencing;
7. releer plan bajo lock;
8. abrir transacción;
9. cercar el documento de lock dentro de la transacción;
10. revalidar Membership por asignación;
11. backfill determinístico;
12. commit;
13. revalidar ownership del lock;
14. auditar post-backfill;
15. crear índices tenant con checkpoints de lock;
16. auditoría completa pre-drop;
17. segundo checkpoint inmediatamente antes de drop;
18. retirar únicamente índices cuya key física coincide con la especificación legacy;
19. auditoría final;
20. liberar únicamente el lock propio.

## Fallos parciales e idempotencia

- fallo de backfill => transacción abortada;
- Membership incompatible => transacción abortada;
- pérdida de lock => no se ejecutan nuevas mutaciones y no se libera lock ajeno;
- fallo de `createIndex` => no empieza `dropIndex`, índices legacy permanecen;
- estado unsafe pre-drop => no se eliminan índices legacy;
- índice tenant equivalente ya existente => se reutiliza;
- documentos ya migrados no se vuelven a backfillear;
- un segundo Apply sobre estado migrado termina correctamente sin volver a modificar los documentos.

# E2E real de migración

La CI ejecuta `runAvailabilityTenantization()` contra MongoDB 7 real configurado como replica set.

La suite construye físicamente:

- Membership worker;
- Shift legacy sin business;
- Block legacy sin business;
- Appointment tenant existente;
- índices físicos legacy reales.

Se verifica:

1. `plan` es realmente read-only y no crea lock;
2. Apply hace backfill real de Shift/Block;
3. crea físicamente los índices tenant;
4. elimina las keys legacy sólo tras checkpoints seguros;
5. preserva Appointment y datos no relacionados;
6. segundo Apply es idempotente;
7. después de migrar, el mismo worker puede coexistir en A/B con Shift y Appointment a la misma clave lógica;
8. `ambiguous` produce cero writes y conserva índices;
9. Membership cambiada entre plan y backfill aborta sin asignar business incorrecto;
10. un documento legacy aparecido antes de drop conserva los índices legacy;
11. pérdida de fencing lock impide continuar y no libera el lock ajeno;
12. fallo simulado de `createIndex` conserva todos los índices legacy.

# Lifecycle de worker

## Soft delete

`deleteWorker(..., softDelete=true)`:

- desactiva la Membership tenant;
- conserva Shift del tenant;
- conserva Block del tenant.

Esto permite una eventual reactivación sin destruir configuración operativa.

## Hard delete

`deleteWorker(..., softDelete=false)`:

- elimina Membership del tenant actual;
- elimina Shift de `business + worker` del tenant actual;
- elimina Block de `business + worker` del tenant actual;
- no elimina Shift/Block del mismo User en otros negocios;
- conserva el User global activo mientras exista otra Membership según la política existente.

Appointment no se borra en esta fase.

# Cobertura runtime

La suite mantiene los casos adversariales de 6.2.3:

- mismo User Worker X en Business A y B;
- Membership worker X→A y X→B;
- Shift A y Shift B el mismo día con horarios independientes;
- GET shifts físicamente limitado al tenant;
- Block A no afecta B y viceversa;
- Admin A/B no elimina Blocks del otro tenant;
- Worker X en contexto A no manipula B;
- Appointment A no ocupa B y viceversa;
- mismo worker/date/startTime puede coexistir en A/B;
- duplicado activo dentro del mismo tenant sigue colisionando;
- WebSocket `availability_changed` permanece separado por business;
- hard delete de A conserva Membership/Shift/Block B y el User global.

`availability-tenant-source-boundary.test.js` continúa recorriendo `Server/src` para impedir la reaparición de APIs globales de disponibilidad, accesos directos Shift/Block fuera de repositories e índices runtime legacy.

# CI de la corrección adversarial

El primer intento endurecido descubrió fallos reales y no fueron ocultados:

- un test de provenance heredaba `GITHUB_SHA` del runner;
- `listCollections` no es válido dentro de una transacción Mongo;
- Gitleaks clasificó el nombre técnico previo del identificador de lock como posible secreto.

Un segundo intento descubrió que la consulta de revalidación filtraba por `role/isActive` pero proyectaba únicamente `business`, haciendo que el validador interpretara falsamente toda Membership como modificada.

Esos problemas fueron corregidos sin relajar assertions.

En el run CI #100, HEAD `590ea2e303e181d2fb2160e46eb730c3cbdc8ec8` quedó verde:

- backend unit: 242/242;
- migration E2E real: 8/8;
- worker lifecycle: 3/3;
- disponibilidad 6.2.3: 7/7;
- membership audit: 1/1;
- membership baseline: 7/7;
- membership runtime authority: 10/10;
- tenant resource isolation: 8/8;
- API: 18/18;
- full flow: 5/5;
- payment regression: 5/5;
- WebSocket: 9/9;
- backend integration total: 81/81;
- frontend checks/build: success;
- secret scan/Gitleaks: success.

Los advisories npm no críticos preexistentes siguen fuera del alcance de 6.2.3; no se modificaron dependencias para resolverlos.

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

Durante esta implementación y sus tests sólo se utilizó infraestructura local/efímera controlada. El soporte técnico para targets externos existe para evitar que la migración quede sin ruta operacional futura, pero requiere autorización explícita y no implica que se haya realizado ninguna conexión externa.

Estado intencional del PR:

```text
Draft
No Ready
No merge
```
