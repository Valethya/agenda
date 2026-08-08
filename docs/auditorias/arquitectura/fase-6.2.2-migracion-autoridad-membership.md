# Fase 6.2.2 — Preparación y migración de autoridad `Membership`

**Proyecto:** ATMÓSFERA Agenda

**Estado:** Contrato aprobado mediante el PR #16; 6.2.2-B tiene su
implementación read-only cerrada mediante los PR #17 y #19, pero su ejecución
operativa permanece pendiente sobre la nueva baseline; rebaseline
preproductiva incorporada mediante el PR #18; bootstrap fail-closed fusionado
mediante el PR #20 y asistente local endurecido en el PR #21 todavía Draft

**Fecha original:** 27 de julio de 2026

**Última revisión:** 8 de agosto de 2026

**Base de contraste:** `master` después del PR #20
(`14dc6967c16f1579e24f4e5d83b40309945f7a6f`)

**Alcance:** Autoridad tenant de administradores y trabajadores, sesiones,
WebSocket y campos heredados de `User`

**Fuera de alcance:** Turnos y bloqueos de 6.2.3, ownership por recurso de
6.2.4, identidad progresiva de clientes de 6.2.5, rediseño de impersonación de
6.4 y responsive 7.8

## 1. Objetivo

Preparar el corte mediante el cual una `Membership` activa será la única fuente
de rol y acceso dentro de un negocio.

El contrato de migración segura continúa vigente como contingencia para
cualquier entorno que llegue a contener datos reales o no descartables antes
del corte. En ese caso, no podrá modificarse información sin contar con:

1. inventario dry-run;
2. pruebas negativas;
3. respaldo restaurable;
4. migración idempotente;
5. verificación posterior;
6. rollback acotado y comprobable.

En el estado actual no existe un conjunto de datos productivo que requiera
backfill. La ejecución vigente será un bootstrap limpio y verificable; no una
migración destructiva de datos heredados. Este documento no autoriza por sí
mismo ninguna ejecución contra un entorno con datos reales.

## 2. Estado real después del PR #20

### Rebaseline preproductiva

El 31 de julio de 2026 se confirmó que las bases existentes contenían
exclusivamente información ficticia y descartable, sin clientes ni operación
real. La operadora eliminó manualmente en MongoDB Atlas las bases `agenda-dev`
y `agenda`. La base `agenda_test` se conservó como entorno de pruebas; su uso
concreto deberá confirmarse antes de depender de ella fuera de la suite.

La eliminación no fue ejecutada por código, por este repositorio ni por el
auditor del PR #17. Constituye una atestación operativa de la operadora sobre
una actuación manual fuera del repositorio: GitHub no puede demostrar por sí
solo el contenido previo de esas bases. No se almacenarán en el repositorio
capturas, URI, credenciales ni evidencia sensible. Cualquier registro operativo
adicional se mantendrá fuera del código y sin secretos. Este PR tampoco crea
bases, colecciones, índices o datos.

Consecuencias:

- no existe información productiva que respaldar, transformar o restaurar;
- `apply`, `verify` y `rollback` no se implementarán para el estado descartado;
- los requisitos de respaldo y migración productiva no se consideran
  completados: quedan **no aplicables al estado preproductivo actual** y se
  reactivarán antes de admitir datos reales heredados;
- la próxima base de desarrollo se creará desde un bootstrap explícito,
  idempotente y separado del arranque normal, con claves estables para Atmósfera
  y DAM, membresías coherentes e índices verificados;
- el bootstrap no se ejecutará automáticamente al desplegar, iniciar Railway o
  arrancar el servidor; detectará estados parciales o inesperados y fallará de
  forma segura sin duplicar negocios, usuarios o Memberships;
- el auditor read-only se conserva como gate del bootstrap y como protección
  para futuras migraciones.

Si aparece cualquier dato real o no descartable antes del corte, esta
rebaseline deja de ser aplicable: se deberá ejecutar el audit, revisar
conflictos, verificar respaldo y restauración e implementar el flujo
idempotente originalmente definido antes de escribir.

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

El comando implementado en el PR #17 usa `audit` como único modo disponible.
Sin una opción explícita de ejecución:

- no crea, modifica ni elimina documentos;
- no crea índices;
- no actualiza timestamps;
- produce un payload canónico determinista y separa los metadatos operativos;
- termina con código distinto de cero cuando encuentra bloqueos.

El endurecimiento que exige tipos BSON `ObjectId` físicos quedó integrado
mediante el PR #19. Esta garantía no formó parte del PR #17 original. Un string
hexadecimal convertible, una representación `$oid` o un objeto ordinario
convertible constituyen corrupción bloqueante, generan
`invalidAuthorityIdentifier` y no participan en correlaciones, candidatas,
pares ni duplicados. El PR #19 conserva `CANONICAL_SCHEMA_VERSION = 4` y
`MEMBERSHIP_AUTHORITY_AUDITOR_VERSION = "1.3.0"`. La ejecución operativa sobre
la nueva baseline continúa pendiente y sus seeds y fixtures también deberán
generar BSON `ObjectId` reales.

Antes de calcular candidatas, `audit` comprueba mediante `listCollections` que
existan físicamente `users`, `businesses` y `memberships`. Una colección ausente
no se representa como un arreglo vacío válido: queda como fuente ausente,
genera `missingRequiredCollection` y fuerza `safeToApply: false`. Una colección
existente y legítimamente vacía conserva un arreglo vacío.

Después comprueba la colección física de `Membership`; la declaración del índice
en el schema no demuestra que el índice exista en la base objetivo:

1. registrar como precondición las colecciones esperadas, observadas y ausentes;
2. consultar los índices reales de la colección;
3. exigir un índice con clave exacta `{ user: 1, business: 1 }` y
   `unique: true`;
4. ejecutar una agregación independiente por `{ user, business }` para detectar
   cualquier par con conteo mayor que uno;
5. registrar las comprobaciones como precondiciones del plan.

El auditor no crea ni repara índices. `safeToApply` será `false` si el índice
único falta, tiene otra clave u opción, existen duplicados o falta cualquiera de
las tres colecciones requeridas.

Interfaz implementada:

```bash
npm run migration:membership-authority -- \
  --mode=audit \
  --environment=production \
  --expected-target-fingerprint=<sha256-aprobado> \
  --database=agenda \
  --report=./artifacts/membership-authority-audit.json
```

`--environment` es obligatorio antes de conectar y sólo acepta `development`,
`test`, `staging` o `production`. En `staging` y `production` también es
obligatorio el fingerprint aprobado del destino. El auditor calcula el
fingerprint observado con el mismo algoritmo y aborta antes de conectar —y, por
tanto, antes de leer colecciones— si falta o no coincide. La opción explícita
tiene precedencia sobre
`MEMBERSHIP_AUTHORITY_EXPECTED_TARGET_FINGERPRINT`. En `development` y `test`
el fingerprint puede omitirse; si se entrega, también debe coincidir. Confirmar
el entorno no reemplaza la comprobación posterior de que el nombre real de la
base coincide exactamente con `--database`.

El informe no se versionará si contiene identificadores o información de
producción. Utiliza evidencias SHA-256 estables y no reversibles para
identificadores válidos o malformados; no incluye ObjectId sin pseudonimizar,
correos ni teléfonos.

La validez exige además el tipo físico correcto: sólo una instancia BSON
`ObjectId` entregada por MongoDB o por el driver oficial participa en mapas,
pares, correlaciones o candidatas. Un string hexadecimal de 24 caracteres sigue
siendo corrupción de tipo aunque pueda convertirse a `ObjectId`; tampoco se
aceptan representaciones Extended JSON `{ $oid: "..." }` ni objetos ordinarios
que expongan `toHexString()`. Todos esos valores generan
`invalidAuthorityIdentifier`, conservan únicamente evidencia pseudonimizada en
un dominio distinto del usado por los BSON `ObjectId` válidos y bloquean el
informe.

### Categorías obligatorias

| Categoría | Tratamiento |
|---|---|
| `alreadyConsistent` | Existe Membership con el mismo negocio y rol; no se modifica. |
| `eligibleBackfill` | Usuario heredado admin/worker con negocio válido y sin Membership para ese par. |
| `roleConflict` | Membership existente y `User.role` heredado difieren; bloquea `apply`. |
| `missingBusinessReference` | `User.business` no existe o es inválido; bloquea `apply`. |
| `orphanMembership` | Falta usuario o negocio referenciado; bloquea `apply`. |
| `duplicateMembership` | Más de una relación para el mismo par; bloquea `apply`. |
| `missingRequiredCollection` | Falta físicamente `users`, `businesses` o `memberships`; se emite un hallazgo por colección, bloquea el informe y exige revisar la base o restauración. |
| `snapshotInconsistency` | Dos lecturas completas difieren en cualquier dato relevante de autoridad, colecciones, índices o duplicados, o la agregación y la lectura de Memberships no coinciden; bloquea y exige repetir el audit. |
| `temporalSnapshotNotGuaranteed` | La topología sólo permitió doble lectura. El resultado es diagnóstico, nunca equivale a un snapshot temporal ni habilita `safeToApply`. |
| `missingUniqueMembershipIndex` | No existe físicamente el índice único exacto `{ user: 1, business: 1 }`; bloquea `apply`. |
| `invalidAuthorityState` | `isActive` está ausente o contiene un valor distinto de `true` o `false`; conserva la diferencia entre ausencia e invalidez y bloquea. |
| `invalidAuthorityIdentifier` | Un identificador o referencia requerido está ausente, malformado o posee un tipo físico distinto de BSON `ObjectId`; registra únicamente evidencia pseudonimizada, no lo usa para correlacionar relaciones y bloquea. Strings hexadecimales, objetos `$oid` y objetos convertibles nunca son relaciones válidas. |
| `platformRoleInMembership` | Membership con rol `superadmin`; bloquea `apply`. |
| `unknownMembershipRole` | Membership con un rol distinto de `admin` o `worker`; bloquea `apply`. |
| `membershipStateConflict` | Membership existente para el par y rol esperados, pero sin estado activo explícito; bloquea `apply`. |
| `ownerWithoutAdminMembership` | `Business.owner` no posee Membership admin activa. Sólo es elegible si también existe evidencia heredada exacta y no contradictoria; cualquier otro caso bloquea `apply` y exige decisión manual. |
| `inactiveIdentity` | Usuario inactivo con relación heredada; no genera candidata automática, bloquea `apply` y exige decisión manual. |
| `legacyClientScope` | `User.role === "user"` con negocio heredado; se excluye y se reserva para 6.2.5. |
| `multipleMemberships` | Usuario con más de una Membership; se informa para verificar que no se use `User.business` como selector. |

### Huella canónica del plan

El informe tendrá dos bloques separados:

1. `canonicalPayload`, único contenido cubierto por el checksum;
2. `metadata`, útil para trazabilidad, pero excluido del checksum.

`canonicalPayload` contendrá únicamente:

- versión del esquema canónico `4`. La versión `3` incorporó estados e
  identificadores estrictos y garantía temporal explícita; la versión `4`
  cambia la semántica canónica para que sólo BSON `ObjectId` físicos sean
  válidos y para que sus representaciones textuales o convertibles queden como
  corrupción bloqueante;
- nombre exacto de la base;
- colecciones físicas esperadas, observadas y ausentes;
- precondición de coherencia con las huellas de las fuentes comparadas;
- precondición del índice `{ user: 1, business: 1, unique: true }`;
- conteos de usuarios, negocios y membresías;
- fuentes relevantes para decidir autoridad:
  - de `User`: identificador, negocio heredado, rol heredado y estado activo;
  - de `Business`: identificador, existencia, propietario y estado activo cuando
    cualquiera de esos campos participe en una regla;
  - de `Membership`: identificador, usuario, negocio, rol y estado activo;
- evidencia legacy utilizada para clasificar cada candidata, incluidos los
  campos concretos que justifican `eligibleBackfill` o
  `ownerWithoutAdminMembership`;
- candidatas con evidencias pseudonimizadas de usuario y negocio, rol, estado
  activo y resultado de login o selección que cambiaría con el backfill;
- conflictos, duplicados y categorías bloqueantes con evidencias
  pseudonimizadas estables;
- cualquier otro campo cuya variación cambie la clasificación, las
  precondiciones o la decisión de migración;
- resultado `safeToApply`.

No contendrá ningún timestamp, incluidos `generatedAt` y `updatedAt`, ni SHA de
código, versión de aplicación, duración, ruta de informe, host, `runId` u otros
metadatos volátiles. Si resultan útiles para diagnóstico, esos valores vivirán
exclusivamente en `metadata`.

`metadata` contiene exclusivamente procedencia operativa fuera del checksum:

- `environment`, confirmado mediante `--environment`;
- `mongoTargetFingerprint`, huella SHA-256 de protocolo, hosts y base
  sanitizados, sin URI, usuario, contraseña ni query string;
- `codeSha`, priorizando `RAILWAY_GIT_COMMIT_SHA`, después `GITHUB_SHA`, después
  `--code-sha` o la variable explícita del auditor, y finalmente `null`; sólo
  admite SHA hexadecimales de Git de 40 o 64 caracteres;
- `codeShaSource`, con `railway`, `github-actions`, `explicit` o `null`;
- `targetValidation`, que registra si la comprobación era obligatoria, si se
  proporcionó un fingerprint, si coincidió y si procedió de CLI o variable;
- `auditorVersion`;
- `readStrategy`, con valor `snapshot` o `double-read`;
- `generatedAt`.

Ni la URI MongoDB ni sus credenciales se almacenan o imprimen.

La canonicalización será exacta:

1. validar que cada identificador sea físicamente una instancia BSON `ObjectId`
   del driver y convertirlo en evidencia SHA-256 estable y no reversible; un
   valor ausente, textual, convertible o malformado conserva ese estado y nunca
   participa como relación válida;
2. omitir valores `undefined` y rechazar tipos no previstos;
3. ordenar recursivamente las claves de cada objeto;
4. ordenar candidatas por `user`, `business` y `role`;
5. ordenar conflictos por `category`, `user`, `business` y `membership`;
6. serializar como JSON UTF-8 sin espacios;
7. calcular `SHA-256` sobre esos bytes.

### Coherencia interna del inventario

Cuando la topología lo admite, el auditor abre una sesión de sólo lectura con
`readConcern: snapshot`, pasa esa misma sesión a `listCollections`, las tres
lecturas `find`, `listIndexes` y la agregación de duplicados, y siempre finaliza
la sesión. Sólo esta estrategia puede registrar
`temporalSnapshotGuaranteed: true`.

Si la topología rechaza lecturas snapshot, el auditor ejecuta dos lecturas
completas secuenciales. Calcula una huella canónica de cada lectura que cubre:

- IDs, rol, negocio heredado y estado de `User`;
- ID, propietario y estado de `Business`;
- ID, usuario, negocio, rol y estado de `Membership`;
- colecciones físicas observadas;
- definición física relevante de índices;
- pares duplicados.

La doble lectura distingue `dataConsistentBetweenReads`, pero siempre registra
`temporalSnapshotGuaranteed: false`, genera
`temporalSnapshotNotGuaranteed` y fuerza `safeToApply: false`, incluso cuando
ambas huellas coinciden. Si difieren, además genera `snapshotInconsistency`.
Incluye inserciones o eliminaciones sin duplicados; comparar exclusivamente
duplicados no es suficiente. Este fallback es diagnóstico y no se presenta como
equivalente a una lectura snapshot.

### Evidencia read-only y archivo local

La prueba E2E ejecuta `runMembershipAuthorityAudit`, captura antes y después los
documentos, nombres de colecciones e índices de toda la base `_test`, y usa
command monitoring para rechazar comandos mutantes. La afirmación read-only se
limita a esa entrada pública y a esa topología controlada.

El informe local se crea de forma exclusiva con permisos `0600`: rechaza
symlinks y destinos preexistentes, no los sobrescribe y elimina el archivo
parcial si falla una escritura iniciada.

### Concurrencia entre `audit` y `apply`

`updatedAt`, los demás timestamps, la fecha de ejecución, el SHA del código y
los metadatos operativos permanecen fuera del checksum canónico. Pueden
conservarse en `metadata` para diagnóstico, pero `updatedAt` nunca será la
guardia exclusiva de concurrencia.

El checksum representa únicamente los datos relevantes para determinar
autoridad, conflictos y candidatas de migración. Inmediatamente antes de
`apply`, el migrador deberá:

1. volver a consultar todas las fuentes;
2. reconstruir `canonicalPayload` con las mismas reglas y orden del `audit`;
3. calcular nuevamente el checksum;
4. compararlo con el checksum aprobado;
5. abortar sin escrituras y exigir un nuevo `audit` si cambió cualquier dato
   relevante.

Dentro de la transacción o, si no existe transacción, inmediatamente antes de
cada escritura, también se revalidarán las precondiciones que afectan a esa
candidata: existencia e identidad de usuario y negocio, rol y negocio legacy,
estado activo, evidencia heredada utilizada, ausencia de Membership para el par,
ausencia de conflictos y duplicados, y vigencia del índice único físico exacto.
Un cambio relevante aborta el lote aunque `updatedAt` no haya cambiado.

## 5. Reglas de transformación

### Backfill permitido

Se podrá crear una Membership únicamente cuando:

1. `User.role` heredado sea `admin` o `worker`;
2. `User.business` sea un BSON `ObjectId` físico válido, no una representación
   textual convertible;
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
cambios de membresía concurrentes. Si no es posible pausar esas escrituras, la
reconstrucción del payload canónico y la revalidación previa a cada escritura
deberán detectar cualquier cambio relevante y abortar. `updatedAt` podrá
registrarse sólo como información diagnóstica.

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
- inmediatamente antes del primer write se reconstruye el payload canónico desde
  las fuentes y su checksum debe seguir coincidiendo con el aprobado;
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
- usuario, negocio, rol y estado activo aún coinciden exactamente con lo creado;
- las precondiciones relevantes reconstruidas desde las fuentes confirman que el
  documento no fue adoptado ni modificado por una decisión posterior.

`updatedAt` puede conservarse en el manifiesto como dato diagnóstico, pero nunca
es la única guarda del rollback ni forma parte del checksum canónico. Si cambió
algún dato relevante después de la migración, el rollback se detiene y requiere
revisión manual.

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
7. un cambio relevante sin modificación de `updatedAt` también aborta `apply`.
8. índice único ausente o no único bloquea `apply` antes del primer write.
9. un par duplicado bloquea `apply` aunque el schema declare el índice.
10. Membership existente con mismo par y rol queda intacta.
11. Membership existente con rol diferente bloquea el lote.
12. `superadmin` tenant bloquea el lote.
13. referencia huérfana bloquea el lote.
14. `ownerWithoutAdminMembership` sin evidencia heredada exacta bloquea el lote.
15. propietario con evidencia heredada exacta usa la regla normal sin inferir
    el rol desde `Business.owner`.
16. `inactiveIdentity` no genera Membership y bloquea el lote.
17. ejecutar dos veces no crea duplicados.
18. rollback sólo considera IDs del manifiesto.
19. documento modificado después del backfill no se elimina automáticamente.
20. fallo parcial deja un resultado identificable y verificable mediante
    `runId`.
21. el plan informa cada cambio esperado entre login único y
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

La implementación read-only original quedó cerrada mediante el PR #17 y su
validación estricta de tipos BSON `ObjectId` quedó integrada mediante el PR
#19. Su ejecución operativa sobre la nueva baseline sigue pendiente.

- implementar modo `audit`;
- añadir fixtures con roles heredados contradictorios;
- agregar pruebas negativas de base, índice físico, duplicados, propietarios,
  identidades inactivas y conflictos;
- generar sólo informes locales o artefactos protegidos.

### PR 6.2.2-BI — Remediación condicional del índice físico

Este PR separado sólo será necesario cuando `audit` detecte que falta el índice
físico exacto `{ user: 1, business: 1 }` con `unique: true`, o que su definición
es incorrecta. El orden obligatorio será:

1. declarar el resultado como bloqueante, fijar `safeToApply: false` e impedir
   cualquier backfill;
2. identificar y resolver los duplicados o contradicciones mediante una
   actuación separada, respaldada y revisada; nunca corregirlos silenciosamente;
3. obtener un respaldo y verificar su restauración antes de cualquier escritura
   de remediación;
4. crear el índice mediante una migración controlada, acotada y revisada en un
   PR distinto del backfill;
5. consultar los índices físicos de MongoDB y comprobar la clave exacta
   `{ user: 1, business: 1 }` con `unique: true`;
6. volver a ejecutar `audit` desde cero;
7. permitir que un futuro PR de migración ejecute `apply` únicamente si el
   índice exacto existe, no quedan duplicados ni contradicciones y el nuevo
   informe indica `safeToApply: true`.

6.2.2-A no crea el índice ni implementa scripts. La declaración del schema no
sustituye la comprobación física.

### PR 6.2.2-C — Baseline preproductiva

En el estado actual, este PR sustituye el backfill porque las bases descartables
ya fueron retiradas y no existe información productiva que transformar:

- normalizar seeds y fixtures para que todo admin o worker tenant tenga una
  `Membership` activa con rol válido;
- mantener `superadmin` exclusivamente en la identidad global y no crearle una
  Membership implícita;
- preparar un bootstrap explícito, separado del arranque normal e idempotente
  para una base vacía, sin depender de `autoIndex` ni de scripts heredados
  destructivos;
- usar claves estables para Atmósfera y DAM, no duplicar negocios, usuarios o
  Memberships, detectar una inicialización parcial y fallar de forma segura
  ante cualquier estado inesperado;
- impedir que el bootstrap se ejecute automáticamente durante un deploy, al
  iniciar Railway o al arrancar el servidor;
- crear y comprobar de forma controlada el índice físico exacto
  `{ user: 1, business: 1 }` con `unique: true`;
- generar únicamente datos iniciales controlados de desarrollo para Atmósfera
  y DAM con BSON `ObjectId` reales en IDs y referencias;
- verificar después del bootstrap las colecciones, los documentos esperados y
  la definición del índice físico;
- ejecutar el auditor sobre la base nueva como gate posterior y exigir un
  resultado seguro antes de usarla para desarrollo funcional, conservando la
  validación estricta ya integrada de BSON `ObjectId` físicos;
- no implementar ni exponer modos `apply`, `verify` o `rollback` en el migrador
  de datos heredados mientras no exista un conjunto que deba preservarse. El
  `apply` explícito del bootstrap sólo crea la baseline nueva y no ejecuta un
  backfill.

La creación de la nueva base y la carga de seeds serán pasos explícitos y
posteriores al merge del código correspondiente; no son efectos automáticos de
este PR documental.

#### Bootstrap implementado, ejecución pendiente

El PR #20 fusionó la implementación técnica inicial de 6.2.2-C mediante el
comando separado
`bootstrap:membership-baseline`. No está importado por `src/index.js`, no forma
parte de `start` o `dev` y sólo acepta los entornos `development` y `test`.
`staging` y `production` quedan rechazados por esta versión preproductiva.

El comando ofrece dos modos distintos del auditor de 6.2.2-B:

- `plan` sólo lee las colecciones de autoridad y clasifica el destino como
  `empty`, `ready` o `partial`; no adquiere el lock de escritura;
- `apply` exige además la confirmación literal
  `CREATE_MEMBERSHIP_BASELINE`, crea únicamente la baseline de autoridad y
  verifica el resultado. Antes de decidir cualquier escritura adquiere un lock
  atómico común y vuelve a leer íntegramente el estado dentro de la sección
  protegida.

Ambos modos exigen nombre de base y fingerprint SHA-256 aprobado del destino.
El entorno efectivo debe existir en `NODE_ENV`, ser literalmente `development`
o `test` y coincidir con `--environment`. Cualquier indicador de Railway,
Vercel u otra plataforma de despliegue conocida bloquea antes de calcular el
destino o conectar. Las bases de desarrollo deben terminar en `_dev` y las de
prueba en `_test`; esta política, el fingerprint y la comprobación del nombre
real son guardas acumulativas. La conexión utiliza `autoIndex: false` y nunca
imprime la URI.

La baseline utiliza claves lógicas estables: los slugs `atmosfera` y `dam`, una
identidad propietaria administrativa por negocio y las parejas usuario-negocio.
No crea trabajadores artificiales: en ambos negocios la persona propietaria
también presta servicios, pero esa capacidad operativa deberá representarse en
un bloque posterior sin duplicar su identidad ni crear una segunda Membership
para el mismo par. La baseline de autoridad sólo le asigna una Membership
`admin` activa.

Los correos y contraseñas no se almacenan en el repositorio ni se incluyen en
el plan. La CLI conserva como alternativa dos parejas de variables locales y
exige un correo único y una contraseña de al menos doce caracteres para cada
identidad:

- `BASELINE_ATMOSFERA_ADMIN_EMAIL` y
  `BASELINE_ATMOSFERA_ADMIN_PASSWORD`;
- `BASELINE_DAM_ADMIN_EMAIL` y `BASELINE_DAM_ADMIN_PASSWORD`.

El PR #21, todavía Draft y sin ejecución operativa, añade el asistente local
`bootstrap:membership-baseline:ui` para introducir
nombres, correos y contraseñas en un formulario servido exclusivamente en
`127.0.0.1`. La abstracción no expone el servidor HTTP crudo: controla el
`listen`, rechaza cualquier host distinto y verifica dirección local y remota
del socket, `Host` y `Origin`; no confía en cabeceras reenviadas. Las
credenciales se mantienen en memoria durante cada solicitud y no requieren
variables de entorno, no se escriben en archivos, no se registran y no se
incluyen en respuestas. La URI MongoDB permanece como secreto local de
conexión. El asistente aplica contrato JSON estricto, CSRF, límite de 32 KiB,
timeouts, cabeceras defensivas y errores públicos estables sin mensajes del
driver o dependencias. Sólo acepta `development` o `test`, exige un fingerprint
aprobado, ejecuta `plan` antes de habilitar `apply` y vincula la aprobación
temporal al contenido normalizado exacto que consumirá el bootstrap. El token
es aleatorio, en memoria, de un solo uso, se consume antes de `apply` y vence
cuando `expiresAt <= now`; un reinicio lo invalida. No forma parte de `start`,
`dev`, Railway, Vercel ni del despliegue.

`MEMBERSHIP_BASELINE_BOOTSTRAP_VERSION` avanza a `2.0.0` porque la definición
exacta cambia de cuatro identidades a dos propietarios administradores y admite
un manifiesto de credenciales construido en memoria. Este cambio no altera el
payload canónico del auditor read-only: `CANONICAL_SCHEMA_VERSION = 4` y
`MEMBERSHIP_AUTHORITY_AUDITOR_VERSION = "1.3.0"` permanecen sin cambios.

Para considerar una identidad ya existente como coherente no basta con que
`User.password` sea un string no vacío. El formato del hash debe ser válido y
la utilidad de comparación de contraseñas del proyecto debe verificar que la
credencial declarada corresponde a ese hash, sin modificarlo. Un hash ausente
o inválido, un error del verificador o una contraseña distinta produce un
hallazgo determinista por clave lógica, clasifica la base como `partial` y
bloquea. El bootstrap no rota contraseñas. Ni la credencial ni el hash se
serializan en el plan o en los errores.

La primera aplicación crea dos negocios, dos usuarios propietarios y dos
Memberships activas con rol `admin`. Los `_id` y todas las referencias se
generan como BSON `ObjectId` físicos. `superadmin` no forma parte de la baseline
tenant. El alcance no incluye servicios, turnos, reservas ni configuración
funcional. En particular, este bootstrap no afirma que un administrador ya sea
seleccionable como profesional: el runtime actual trata `worker` como rol
exclusivo en reservas y disponibilidad, y esa separación deberá corregirse sin
debilitar la Membership como autoridad tenant. Esos datos y capacidades
pertenecen a bloques posteriores y no deben ocultar el gate de autoridad.

El preflight y la sección crítica se comportan de forma fail-closed:

1. una base sin documentos de autoridad es elegible;
2. una baseline completa y exacta con el índice requerido produce un no-op
   idempotente, siempre que las credenciales declaradas verifiquen contra los
   hashes almacenados; el no-op no recalcula ni rota contraseñas;
3. un subconjunto de las colecciones requeridas, cualquier colección ajena a
   la baseline, una inicialización parcial, documentos inesperados, referencias
   no BSON o contradicciones bloquean antes de escribir;
4. un índice compuesto `{ user: 1, business: 1 }` existente pero incorrecto, o
   cualquier definición incompatible que ocupe el nombre físico
   `user_1_business_1`, bloquea y no se elimina ni modifica automáticamente;
5. si falta el índice en una base elegible, `apply` lo crea de forma explícita
   con `unique: true` y comprueba físicamente su definición;
6. cada `apply` usa la clave estable `membership-baseline-v1` en la colección
   técnica controlada `membership_baseline_locks`. La adquisición es una
   inserción atómica que registra `ownerId`, `acquiredAt` y `expiresAt`, y sólo
   admite un propietario. `expiresAt` se persiste como marca ISO informativa,
   no como fecha apta para un índice TTL que pudiera borrar el lock;
7. `expiresAt` es una señal operativa y nunca habilita recuperación automática.
   Un segundo proceso rechaza incluso un lock vencido, porque el propietario
   anterior podría estar suspendido y reanudarse. La propiedad se comprueba
   antes de cada creación de colección, índice e inserción. Sólo el propietario
   vigente puede liberar el lock y la liberación se intenta en `finally`;
8. después de adquirir el lock, `apply` vuelve a leer y clasificar la base. Si
   otro proceso ya dejó la baseline `ready`, finaliza como no-op; si observa un
   estado `partial`, aborta sin escribir;
9. la colección técnica de lock vacía es compatible con una base funcional
   `empty`, pero no vuelve admisibles documentos funcionales ni otras
   colecciones ajenas;
10. no existe compensación ciega después de comenzar las escrituras. Si la
    lectura de verificación no permite confirmar el resultado, el comando no
    declara `applied: true`, informa un resultado desconocido y exige ejecutar
    `plan` antes de cualquier reintento. Un estado parcial confirmado también
    bloquea; nunca se eliminan documentos que podrían pertenecer a otra
    ejecución.

Una baseline completa se representa como `ready`; no existe un estado separado
`existing` porque no aportaría una transición distinta. `ready` con el índice
exacto es no-op idempotente. `empty` es elegible para creación, `partial`
bloquea y un fallo posterior al inicio de mutaciones produce resultado
`unknown`. Ante `partial` o `unknown` no existe recuperación automática: se
debe detener toda escritura, ejecutar un nuevo `plan`, inspeccionar manualmente
colecciones, documentos e índices y decidir una remediación explícita sin
borrados compensatorios.

Un lock abandonado sólo puede retirarse manualmente después de confirmar fuera
del proceso que el propietario terminó y no puede reanudarse. Después de
retirarlo es obligatorio ejecutar un nuevo `plan`; la mera expiración nunca
autoriza otro `apply`. Los IDs deterministas BSON de los seis documentos
esperados actúan además como defensa frente a duplicación accidental, sin
convertirse en un mecanismo de recuperación.

Los seeds destructivos heredados `seed-atmosfera.js` y `seed-dam.js` quedan
desactivados e indican utilizar el nuevo comando. Esta implementación no ha sido
ejecutada contra Atlas, Railway ni ninguna base externa. Después de una futura
ejecución controlada todavía será obligatorio comprobar colecciones,
documentos e índice y ejecutar el auditor read-only como gate independiente.

Ejemplo de preflight, sin credenciales reales:

```bash
NODE_ENV=development npm run bootstrap:membership-baseline -- \
  --mode=plan \
  --environment=development \
  --database=agenda_dev \
  --expected-target-fingerprint=<sha256-aprobado>
```

### Contingencia para datos heredados futuros

La especificación de backfill, manifiesto, checksum, idempotencia, verificación,
respaldo y rollback de las secciones anteriores permanece vigente. Si antes del
corte aparece información real o no descartable, se deberá preparar un PR
separado que implemente `apply`, `verify` y `rollback`, ensayarlo sobre una copia
restaurada y obtener autorización explícita antes de cualquier escritura.

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

El PR #16 incorporó el tratamiento de `superadmin`, las categorías de audit,
las reglas de backfill, el respaldo, la idempotencia, la verificación, el
rollback y la matriz de pruebas negativas. El PR #17 implementó y verificó el
auditor read-only original de 6.2.2-B. El PR #19 endureció su validación para
admitir únicamente BSON `ObjectId` físicos, sin atribuir retroactivamente esa
garantía al PR #17. La rebaseline del PR #18 documenta que no existe
información productiva que migrar; no declara completadas las operaciones que
nunca ocurrieron. Ninguno de estos PR ejecutó el auditor sobre la nueva
baseline, creó esa base, ejecutó el bootstrap o desplegó el corte de autoridad.

La validación estricta de BSON `ObjectId` físicos ya está integrada mediante el
PR #19 y el bootstrap inicial fue fusionado mediante el PR #20. Ninguno fue
ejecutado operativamente. Una futura ejecución
sobre datos reales continúa bloqueada hasta acreditar:

- seeds y fixtures que generen BSON `ObjectId` reales;
- credencial MongoDB estrictamente de sólo lectura;
- fingerprint aprobado y verificado para el entorno;
- topología compatible con una sesión snapshot real;
- política aprobada de acceso, conservación y eliminación del informe;
- evidencia de ejecución controlada en una topología equivalente a producción.

La doble lectura no satisface el gate de topología. Estas condiciones no se han
ejecutado ni verificado contra un entorno con datos reales.

Estado de condiciones:

- [x] Implementación del auditor read-only.
- [x] Comprobación automatizada del índice único físico y de duplicados.
- [x] Comprobación de colecciones físicas requeridas.
- [x] Lectura snapshot con fallback diagnóstico de doble lectura siempre
      bloqueante.
- [x] Procedencia operativa sanitizada fuera del checksum.
- [x] Prueba E2E read-only sobre entrada pública y base `_test` controlada.
- [ ] Credencial operativa estrictamente read-only verificada.
- [ ] Fingerprint operativo aprobado para el entorno de ejecución.
- [ ] Topología operativa compatible con snapshot verificada.
- [ ] Política de acceso, conservación y eliminación del informe aprobada.
- [ ] Ensayo controlado en topología equivalente a producción.
- [ ] Remediación separada del índice físico, sólo si el audit la exige.
- [x] Implementación de checksum sobre payload canónico.
- [x] Pruebas negativas del alcance 6.2.2-B implementadas y verdes.
- [x] Atestación de la operadora sobre el estado preproductivo y la ausencia de
      datos reales; no constituye evidencia reproducible del repositorio.
- [x] Atestación de la operadora sobre la eliminación manual y externa de las
      bases ficticias `agenda-dev` y `agenda`; `agenda_test` se conservó como
      base de pruebas.
- [x] Validación estricta de tipo BSON `ObjectId` integrada mediante el PR #19.
- [x] Manifest y pruebas de la baseline generan BSON `ObjectId` reales.
- [x] Baseline de autoridad de Atmósfera y DAM implementada, sin ejecución
      operativa.
- [x] Bootstrap explícito, idempotente y fail-closed implementado y probado.
- [ ] Índice físico único creado y verificado en la nueva base de desarrollo.
- [ ] Auditor ejecutado con resultado seguro sobre la nueva baseline.
- [ ] Respaldo productivo verificado, no aplicable mientras no existan datos
      reales.
- [ ] Migración ensayada sobre una copia, no aplicable a la baseline vacía.
- [ ] Autorización explícita para cualquier escritura productiva futura.
- [ ] Backfill productivo ejecutado y verificado, no aplicable al estado actual.
- [ ] Corte de autoridad desplegado.

Mientras los puntos pendientes no se cumplan, `Membership` todavía no puede
declararse autoridad tenant única en producción.
