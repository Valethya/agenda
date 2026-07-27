# Fase 6.2.2 — Preparación y migración de autoridad `Membership`

**Proyecto:** ATMÓSFERA Agenda

**Estado:** Propuesta documental para revisión; sin implementación ni ejecución
productiva

**Fecha:** 27 de julio de 2026

**Base de contraste:** `master` después del PR #15 (`6326c11`)

**Alcance:** Autoridad tenant de administradores y trabajadores, sesiones,
WebSocket y campos heredados de `User`

**Fuera de alcance:** Turnos y bloqueos de 6.2.3, ownership por recurso de
6.2.4, identidad progresiva de clientes de 6.2.5, rediseño de impersonación de
6.4 y responsive 7.8

## 1. Objetivo

Preparar el corte mediante el cual una `Membership` activa será la única fuente
de rol y acceso dentro de un negocio, sin modificar datos productivos antes de
contar con:

1. inventario dry-run;
2. pruebas negativas;
3. respaldo restaurable;
4. migración idempotente;
5. verificación posterior;
6. rollback acotado y comprobable.

Este documento define el contrato de la migración. No autoriza su ejecución
contra producción.

## 2. Estado real después del PR #15

### Capacidades que ya usan `Membership`

- login por contraseña y Google carga membresías activas;
- una única membresía determina el negocio inicial;
- el cambio de negocio consulta una membresía activa;
- creación y baja de profesionales administra `Membership`;
- reserva y disponibilidad comprueban que el profesional tenga una membresía
  worker activa;
- `join_availability` comprueba que el profesional observado pertenezca al
  negocio del socket.

### Autoridades competidoras que permanecen

- `scopeBusiness` confía en `session.user.role` y
  `session.user.businessId`;
- `isAdmin` confía en el rol copiado en sesión;
- la selección inicial confía en una copia temporal de membresías;
- `/me` no revalida la membresía activa correspondiente al tenant de la sesión;
- reserva y disponibilidad todavía exigen `User.role === "worker"`;
- analítica tenant agrupa mediante `User.business` y `User.role`;
- el fallback de impersonación busca administradores mediante campos de `User`;
- el handshake WebSocket confía en el contexto tenant capturado en la sesión;
- el schema de `Membership` admite el rol `superadmin`.

La migración existente `migrate-multi-tenancy.js` no es apta para este corte:
escribe directamente, asume un negocio `barberia`, no crea membresías, no ofrece
dry-run ni rollback y no posee guardas suficientes para producción.

## 3. Contrato de autoridad

### Identidad global

`User` conserva:

- identidad y credenciales;
- estado global de la cuenta;
- privilegios de plataforma.

Durante la ventana de compatibilidad, `User.role` y `User.business` podrán seguir
existiendo, pero no serán consultados para autorizar operaciones tenant.

### Autoridad tenant

Una operación tenant-scoped sólo podrá autorizarse cuando:

1. el usuario global exista y se encuentre habilitado;
2. el negocio exista y sea el negocio resuelto para la solicitud;
3. exista una `Membership` para el par usuario-negocio;
4. la membresía esté activa;
5. el rol de esa membresía permita la operación.

El rol efectivo se resolverá en cada frontera protegida. Una copia de rol
almacenada en sesión podrá utilizarse para presentación, pero nunca como prueba
de autorización.

### `superadmin`

- `User.role === "superadmin"` representa un privilegio global.
- Las rutas del plano de plataforma no requieren `Membership`.
- Las operaciones tenant normales, incluidas sus lecturas, requieren una
  `Membership` activa con rol suficiente.
- Seleccionar explícitamente un negocio sólo aporta contexto y no concede al
  `superadmin` el rol admin de ese tenant.
- Una inspección global de sólo lectura sobre datos tenant está denegada de
  forma predeterminada y sólo puede habilitarse mediante una política de
  plataforma explícita para esa lectura.
- Una acción que requiera rol tenant o produzca una mutación tenant necesita una
  membresía activa o una futura sesión de soporte de 6.4.
- El rol `superadmin` no es válido dentro de `Membership`.
- La impersonación transitoria deberá seleccionar al sujeto mediante una
  membresía admin activa; no mediante `User.business` o `User.role`.

### Matriz de lectura y actuación de `superadmin`

Esta matriz es exhaustiva para 6.2.2. Todo caso no incluido queda denegado.

| Contexto | Lectura | Mutación | Autoridad requerida |
|---|---|---|---|
| Plano global de plataforma, sin tenant | Permitida sólo por una política de ruta global explícita. | Permitida sólo para acciones propias de plataforma y por una política global explícita. | Privilegio global `superadmin`; no `Membership`. |
| Recurso público de un tenant explícito | La misma lectura permitida al consumidor público; sin privilegios adicionales. | Sólo las acciones públicas previstas por su contrato y credencial; nunca por ser `superadmin`. | Contrato público, tenant explícito y, cuando corresponda, credencial de acción. |
| Datos operativos tenant de acceso restringido | Denegada por defecto. Sólo una política de plataforma explícita y allowlisted puede habilitar inspección de sólo lectura. | Denegada. | Para lectura excepcional, política global explícita; seleccionar tenant no basta. |
| Operación tenant normal como admin o worker | Permitida sólo si el actor también posee `Membership` activa con rol suficiente. | Permitida sólo si el actor también posee `Membership` activa con rol suficiente. | `Membership`; el privilegio global no participa en la decisión. |
| Asistencia mutable de soporte | No disponible todavía como excepción. | No disponible todavía. | Futura sesión de soporte separada, acotada y auditable de 6.4. |
| Tenant ausente, inválido o distinto al autorizado | Denegada. | Denegada. | Denegación predeterminada. |

La impersonación existente es deuda transitoria y no amplía esta matriz. Mientras
se sustituye en 6.4, el sujeto impersonado debe obtener su autoridad de una
`Membership` admin activa.

## 4. Inventario dry-run

### Comportamiento

El futuro comando deberá usar `audit` como modo predeterminado. Sin una opción
explícita de ejecución:

- no crea, modifica ni elimina documentos;
- no crea índices;
- no actualiza timestamps;
- produce un informe determinista;
- termina con código distinto de cero cuando encuentra bloqueos.

Antes de calcular candidatas, `audit` deberá comprobar la colección física de
`Membership`; la declaración del índice en el schema no demuestra que el índice
exista en la base objetivo:

1. consultar los índices reales de la colección;
2. exigir un índice con clave exacta `{ user: 1, business: 1 }` y
   `unique: true`;
3. ejecutar una agregación independiente por `{ user, business }` para detectar
   cualquier par con conteo mayor que uno;
4. registrar ambas comprobaciones como precondiciones del plan.

El auditor no crea ni repara índices. `safeToApply` será `false` si el índice
único falta, tiene otra clave u opción, o existen duplicados.

Interfaz prevista:

```bash
npm run migration:membership-authority -- \
  --mode=audit \
  --database=agenda \
  --report=./artifacts/membership-authority-audit.json
```

El informe no se versionará si contiene identificadores o información de
producción. Por defecto utilizará IDs y contadores; no incluirá correos ni
teléfonos.

### Categorías obligatorias

| Categoría | Tratamiento |
|---|---|
| `alreadyConsistent` | Existe Membership con el mismo negocio y rol; no se modifica. |
| `eligibleBackfill` | Usuario heredado admin/worker con negocio válido y sin Membership para ese par. |
| `roleConflict` | Membership existente y `User.role` heredado difieren; bloquea `apply`. |
| `missingBusinessReference` | `User.business` no existe o es inválido; bloquea `apply`. |
| `orphanMembership` | Falta usuario o negocio referenciado; bloquea `apply`. |
| `duplicateMembership` | Más de una relación para el mismo par; bloquea `apply`. |
| `missingUniqueMembershipIndex` | No existe físicamente el índice único exacto `{ user: 1, business: 1 }`; bloquea `apply`. |
| `platformRoleInMembership` | Membership con rol `superadmin`; bloquea `apply`. |
| `ownerWithoutAdminMembership` | `Business.owner` no posee Membership admin activa. Sólo es elegible si también existe evidencia heredada exacta y no contradictoria; cualquier otro caso bloquea `apply` y exige decisión manual. |
| `inactiveIdentity` | Usuario inactivo con relación heredada; no genera candidata automática, bloquea `apply` y exige decisión manual. |
| `legacyClientScope` | `User.role === "user"` con negocio heredado; se excluye y se reserva para 6.2.5. |
| `multipleMemberships` | Usuario con más de una Membership; se informa para verificar que no se use `User.business` como selector. |

### Huella canónica del plan

El informe tendrá dos bloques separados:

1. `canonicalPayload`, único contenido cubierto por el checksum;
2. `metadata`, útil para trazabilidad, pero excluido del checksum.

`canonicalPayload` contendrá únicamente:

- versión del esquema canónico;
- nombre exacto de la base;
- precondición del índice `{ user: 1, business: 1, unique: true }`;
- conteos de usuarios, negocios y membresías;
- candidatas con los campos de autoridad esperados: IDs de usuario y negocio,
  rol e `isActive`;
- conflictos con categoría e IDs implicados;
- resultado `safeToApply`.

No contendrá ningún timestamp, incluidos `generatedAt` y `updatedAt`, ni SHA de
código, versión de aplicación, duración, ruta de informe, host, `runId` u otros
metadatos volátiles. Si resultan útiles para diagnóstico, esos valores vivirán
exclusivamente en `metadata`.

La canonicalización será exacta:

1. convertir cada ObjectId a su representación hexadecimal minúscula;
2. omitir valores `undefined` y rechazar tipos no previstos;
3. ordenar recursivamente las claves de cada objeto;
4. ordenar candidatas por `user`, `business` y `role`;
5. ordenar conflictos por `category`, `user`, `business` y `membership`;
6. serializar como JSON UTF-8 sin espacios;
7. calcular `SHA-256` sobre esos bytes.

`apply` volverá a construir el mismo payload desde la base y lo comparará con el
checksum aprobado. Una modificación de datos relevantes para autoridad o un
conflicto nuevo cambia el payload y obliga a generar un audit nuevo, sin depender
de timestamps.

## 5. Reglas de transformación

### Backfill permitido

Se podrá crear una Membership únicamente cuando:

1. `User.role` heredado sea `admin` o `worker`;
2. `User.business` sea un ObjectId válido;
3. el usuario esté activo;
4. usuario y negocio existan;
5. no exista Membership para ese par;
6. no exista contradicción detectada por el inventario;
7. el índice único físico y la ausencia de duplicados hayan sido comprobados.

Documento propuesto:

```js
{
  user: user._id,
  business: user.business,
  role: user.role,
  isActive: true
}
```

La actividad del negocio se valida separadamente. Suspender un negocio no debe
reescribir todas sus membresías.

### Casos de propietario e identidad inactiva

`ownerWithoutAdminMembership` se resuelve de forma determinista:

- si `Business.owner` referencia a un usuario activo cuyo
  `User.role === "admin"` y cuyo `User.business` coincide exactamente con ese
  negocio, puede entrar en `eligibleBackfill` por la regla normal;
- si falta cualquiera de esas evidencias, existe otro negocio o rol, o aparece
  una contradicción, `apply` queda bloqueado;
- el migrador nunca infiere el rol admin únicamente desde `Business.owner`;
- la decisión manual debe corregir la fuente de datos o aprobar una actuación
  separada, y después repetir `audit`.

`inactiveIdentity` también es un bloqueo:

- no se crea automáticamente una Membership activa ni inactiva;
- una identidad global inactiva nunca obtiene acceso por el backfill;
- si se necesita preservar una relación histórica, se hará mediante una
  actuación separada y revisada; después se repetirá `audit`.

### Casos que nunca se corrigen automáticamente

- Membership existente con rol diferente;
- Membership `superadmin`;
- propietario de negocio sin evidencia suficiente para inferir el rol;
- referencias huérfanas;
- roles desconocidos;
- relaciones de clientes;
- múltiples negocios inferidos desde datos no estructurados.

### Datos heredados

La migración de 6.2.2 no elimina ni modifica `User.role` o `User.business`.
Conservarlos permite:

- revertir la aplicación durante la ventana de observación;
- comparar resultados;
- separar el corte de autoridad de la limpieza destructiva.

Su eliminación pertenece a una migración posterior, después de comprobar que no
existen lecturas productivas.

### Efecto observable antes del corte

El backfill aditivo no es neutral sobre el `master` actual. Login por contraseña
y Google ya consulta Memberships activas; por tanto, crear una puede cambiar de
inmediato:

- un login sin acceso a un login con tenant único;
- un login de tenant único a `needs_selection`;
- las opciones y el negocio mostrado por el selector de workspace.

Este efecto ocurre aunque el corte de autorización HTTP todavía no se haya
desplegado. Antes de autorizar `apply`, el audit deberá mostrar por usuario el
resultado de login anterior y posterior, y toda transición se revisará. La
ejecución deberá realizarse en una ventana comunicada, seguida de pruebas de
login y selección. Un cambio no previsto bloquea el avance y activa el rollback
acotado; no se describirá el backfill como transparente.

## 6. Respaldo obligatorio

Antes de cualquier `apply` productivo se deberá:

1. generar un snapshot del proveedor o un `mongodump` consistente;
2. registrar cluster, base, fecha, tamaño, checksum y responsable;
3. cifrar el respaldo y limitar su acceso;
4. restaurarlo en un entorno aislado;
5. ejecutar allí el inventario y la migración completa;
6. verificar que la restauración y el rollback funcionan.

Un archivo existente que nunca fue restaurado no se considera un respaldo
verificado.

La ejecución productiva deberá realizarse en una ventana sin altas, bajas ni
cambios de membresía concurrentes. Si no es posible pausar esas escrituras, el
migrador deberá detectar cambios mediante `updatedAt` y abortar.

## 7. Aplicación idempotente

Interfaz prevista:

```bash
npm run migration:membership-authority -- \
  --mode=apply \
  --database=agenda \
  --plan=./artifacts/membership-authority-audit.json \
  --plan-checksum=CHECKSUM \
  --backup-id=BACKUP_VERIFICADO \
  --execute
```

Guardas obligatorias:

- `apply` requiere `--execute`;
- el nombre real de la base debe coincidir exactamente con `--database`;
- producción requiere una confirmación adicional explícita;
- el plan debe indicar `safeToApply: true`;
- el checksum debe coincidir;
- justo antes de escribir se vuelve a comprobar que existe físicamente el
  índice único exacto `{ user: 1, business: 1 }`;
- justo antes de escribir se vuelve a comprobar que no existen pares
  duplicados;
- las candidatas se revalidan justo antes de escribir;
- se usa write concern `majority`;
- ninguna operación actualiza una Membership existente;
- cada creación usa filtro `{ user, business }` y `$setOnInsert`;
- una segunda ejecución produce cero creaciones;
- después de cada upsert se verifica que el rol y estado reales coincidan con el
  plan; una creación concurrente contradictoria aborta el lote;
- la ausencia del índice único, cualquier duplicado o conflicto abortan el lote
  completo antes del primer write.

Si la topología de MongoDB admite transacciones, el manifiesto y el lote se
confirmarán dentro de una transacción. Si no las admite, se utilizarán lotes
deterministas pequeños y el manifiesto registrará cada creación confirmada,
permitiendo reanudar o revertir una ejecución parcial sin repetir efectos.

### Manifiesto

Cada ejecución escribe un manifiesto en una colección técnica de migraciones con:

- `runId`;
- SHA de código y checksum del plan;
- base y backup utilizados;
- inicio, término y resultado;
- IDs de Membership creadas;
- valores esperados de cada documento;
- conteos anteriores y posteriores.

El manifiesto no almacena contraseñas, tokens, correos ni teléfonos.

## 8. Verificación posterior

El modo `verify` será read-only y comprobará:

```bash
npm run migration:membership-authority -- \
  --mode=verify \
  --database=agenda \
  --run-id=RUN_ID
```

Criterios de éxito:

- cero admin/worker heredados sin Membership para su par válido;
- cero cambios sobre Membership preexistentes;
- cero pares duplicados;
- cero referencias huérfanas;
- cero Membership con rol `superadmin`;
- todas las creadas coinciden con el manifiesto;
- repetir `apply` genera cero escrituras;
- las transiciones de login y selección coinciden exactamente con el plan
  revisado antes del corte;
- los campos heredados continúan intactos.

La verificación debe completarse antes de fusionar o desplegar el PR que deja de
autorizar mediante la sesión heredada.

## 9. Rollback

### Antes del corte de aplicación

El rollback elimina exclusivamente las Membership creadas por el `runId`, sólo
cuando:

- el ID figura en el manifiesto;
- usuario, negocio, rol y estado aún coinciden con lo creado;
- `updatedAt` demuestra que no fue modificada posteriormente.

Si algún documento cambió después de la migración, el rollback se detiene y
requiere revisión manual.

### Después del corte de aplicación

El orden obligatorio es:

1. revertir el despliegue al código anterior;
2. comprobar que los campos heredados siguen disponibles;
3. detener nuevas escrituras de membresía;
4. ejecutar rollback en modo dry-run;
5. revisar el conjunto exacto;
6. ejecutar la eliminación acotada;
7. verificar conteos y acceso.

Restaurar el respaldo completo queda reservado para corrupción general. No es el
mecanismo normal para revertir un backfill aditivo.

Interfaz prevista:

```bash
npm run migration:membership-authority -- \
  --mode=rollback \
  --database=agenda \
  --run-id=RUN_ID

# Sólo después de revisar el dry-run:
npm run migration:membership-authority -- \
  --mode=rollback \
  --database=agenda \
  --run-id=RUN_ID \
  --execute
```

## 10. Pruebas negativas obligatorias

### Migrador

1. `audit` no modifica documentos ni timestamps.
2. base distinta de la confirmada se rechaza.
3. `apply` sin `--execute` no escribe.
4. plan con checksum distinto se rechaza.
5. cambiar timestamps o metadatos volátiles no cambia el checksum canónico.
6. cambiar un campo relevante de autoridad cambia el checksum y exige un plan
   nuevo.
7. índice único ausente o no único bloquea `apply` antes del primer write.
8. un par duplicado bloquea `apply` aunque el schema declare el índice.
9. Membership existente con mismo par y rol queda intacta.
10. Membership existente con rol diferente bloquea el lote.
11. `superadmin` tenant bloquea el lote.
12. referencia huérfana bloquea el lote.
13. `ownerWithoutAdminMembership` sin evidencia heredada exacta bloquea el lote.
14. propietario con evidencia heredada exacta usa la regla normal sin inferir
    el rol desde `Business.owner`.
15. `inactiveIdentity` no genera Membership y bloquea el lote.
16. ejecutar dos veces no crea duplicados.
17. rollback sólo considera IDs del manifiesto.
18. documento modificado después del backfill no se elimina automáticamente.
19. fallo parcial deja un resultado identificable y verificable mediante
    `runId`.
20. el plan informa cada cambio esperado entre login único y
    `needs_selection`.

### Corte HTTP y sesión

1. `User.role = admin` sin Membership activa recibe `403`.
2. `User.role = worker` sin Membership activa recibe `403`.
3. `User.role = user` con Membership admin activa obtiene rol admin tenant.
4. un rol heredado contradictorio no altera el rol de Membership.
5. desactivar la Membership revoca la siguiente operación protegida.
6. una sesión antigua no conserva permisos después de la revocación.
7. seleccionar una Membership desactivada después del login se rechaza.
8. usuario A no selecciona una Membership de usuario B.
9. Membership de negocio B no autoriza una ruta del negocio A.
10. `superadmin` accede al plano de plataforma sin Membership.
11. una lectura operativa tenant de `superadmin` queda denegada sin una política
    de plataforma explícita y allowlisted.
12. `superadmin` no obtiene permisos admin tenant ni mutaciones sólo por
    seleccionar un negocio.
13. impersonación no elige sujetos mediante campos heredados.
14. una lectura tenant no contemplada por la matriz queda denegada.
15. la futura asistencia mutable no se autoriza sin una sesión de soporte 6.4.

### WebSocket

1. conexión sin sesión se rechaza;
2. usuario sin Membership activa del negocio se rechaza;
3. Membership desactivada no permite una nueva conexión o suscripción;
4. rol o negocio heredado en sesión no sustituye una Membership;
5. miembro A no entra a salas de B;
6. desactivar una Membership revoca y desconecta los sockets ya conectados para
   ese usuario y negocio;
7. cambiar el tenant activo retira al socket de todas las salas del tenant
   anterior y exige reautenticación o reconexión antes de suscribirse al nuevo;
8. un socket conectado antes de la revocación deja de recibir eventos del tenant
   sin esperar a que el cliente se reconecte.

## 11. Secuencia de PR

### PR 6.2.2-A — Decisión y preparación documental

- reconciliar ADR, plan maestro e inventario con el PR #15;
- fijar el tratamiento de `superadmin`;
- proponer este diseño de migración para aprobación;
- no modificar runtime ni datos.

### PR 6.2.2-B — Inventario dry-run

- implementar modo `audit`;
- añadir fixtures con roles heredados contradictorios;
- agregar pruebas negativas de base, índice físico, duplicados, propietarios,
  identidades inactivas y conflictos;
- generar sólo informes locales o artefactos protegidos.

### PR 6.2.2-C — Backfill, verificación y rollback

- implementar `apply`, `verify` y `rollback`;
- registrar manifiesto;
- agregar pruebas de checksum, idempotencia, concurrencia y rollback;
- no ejecutar todavía contra producción.

### Punto operativo obligatorio

- respaldo verificado;
- ensayo sobre copia;
- revisión manual de conflictos;
- autorización explícita;
- aplicación productiva;
- verificación y repetición idempotente.

Este punto no se ejecutará como consecuencia automática de fusionar un PR.

### PR 6.2.2-D — Corte HTTP y sesión

- revalidar Membership activa en fronteras protegidas;
- dejar de autorizar mediante rol o negocio de sesión;
- revalidar selección y cambio de negocio;
- incorporar pruebas negativas HTTP.

### PR 6.2.2-E — Lecturas heredadas y WebSocket

- retirar comprobaciones de `User.role/business` en disponibilidad, reserva,
  analítica e impersonación;
- validar Membership propia durante handshake y suscripciones;
- implementar revocación activa de sockets ya conectados cuando se desactive
  una Membership o cambie el tenant activo;
- impedir `superadmin` dentro de Membership;
- actualizar auditoría de cierre.

### Limpieza posterior

Después de una ventana de observación y fuera del corte inicial:

- detener dual-write de campos heredados;
- comprobar que no existan lecturas productivas;
- eliminar índices y campos antiguos mediante migración separada;
- conservar respaldo y evidencia de cierre.

## 12. Estado de la preparación

Este PR propone, para revisión, el tratamiento de `superadmin`, las categorías
de audit, las reglas de backfill, el respaldo, la idempotencia, la verificación,
el rollback y la matriz de pruebas negativas. Su presencia en este documento no
significa que estén implementados ni verificados.

Condiciones operativas pendientes:

- [ ] Implementación del auditor.
- [ ] Comprobación automatizada del índice único físico y de duplicados.
- [ ] Implementación de checksum sobre payload canónico.
- [ ] Pruebas negativas implementadas y verdes.
- [ ] Respaldo productivo verificado.
- [ ] Migración ensayada sobre una copia.
- [ ] Autorización explícita para cualquier escritura productiva.
- [ ] Backfill productivo ejecutado y verificado.
- [ ] Corte de autoridad desplegado.

Mientras los puntos pendientes no se cumplan, `Membership` todavía no puede
declararse autoridad tenant única en producción.
