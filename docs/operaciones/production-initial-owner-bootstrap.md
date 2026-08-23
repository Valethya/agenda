# Bootstrap inicial de propietarios en producción

## Propósito

Este runbook cubre exclusivamente la creación inicial, única y controlada de las identidades propietarias de los dos tenants fundacionales de Agenda en Railway production.

Resultado exacto permitido:

- 2 `Business`: `Atmósfera` (`atmosfera`) y `DAM` (`dam`);
- 2 `User` propietarios, uno por Business;
- 2 `Membership` activas con `role=admin`, una por propietario/Business;
- 0 workers artificiales;
- 0 clientes ficticios;
- 0 superadmin creados por este bootstrap.

`Membership` continúa siendo la única autoridad tenant. `Business.owner` expresa propiedad declarativa y `User.business` **no se escribe** para estos administradores.

## Lo que este bootstrap no hace

- no ejecuta seeds antiguos;
- no reutiliza `seed-production.js`;
- no relaja el bootstrap preproductivo `membership-baseline`;
- no cambia `NODE_ENV`;
- no crea cuentas desde una ruta HTTP;
- no corre durante `npm start`;
- no permanece configurado después de completar la operación;
- no crea workers, clientes, servicios, citas ni pagos;
- no crea ni concede `superadmin`.

## Cercos obligatorios

`apply` sólo puede ejecutarse cuando todos los siguientes puntos se cumplen:

1. `NODE_ENV=production`;
2. `RAILWAY_ENVIRONMENT_NAME=production`;
3. `RAILWAY_GIT_BRANCH=master`;
4. existen `RAILWAY_PROJECT_ID`, `RAILWAY_SERVICE_ID`, `RAILWAY_DEPLOYMENT_ID` y `RAILWAY_GIT_COMMIT_SHA`;
5. `--approved-sha` coincide exactamente con `RAILWAY_GIT_COMMIT_SHA`;
6. `--expected-target-fingerprint` coincide con el fingerprint calculado sobre el `MONGO_URI` y database reales;
7. confirmación literal `CREATE_INITIAL_PRODUCTION_OWNERS`;
8. MongoDB admite transacciones;
9. el estado de `businesses/users/memberships` está vacío, o ya coincide exactamente con el resultado esperado;
10. existen físicamente —o pueden crearse transaccionalmente porque la colección aún no existe— los índices únicos:
   - `businesses { slug: 1 } unique`;
   - `users { email: 1 } unique`;
   - `memberships { user: 1, business: 1 } unique`;
11. `_id`, `Business.owner`, `Membership.user` y `Membership.business` deben ser BSON `ObjectId` físicos; strings hex equivalentes no satisfacen la verificación;
12. los propietarios no pueden persistir `User.business`, ni siquiera como `null`.

Si una colección de identidad ya existe pero carece de su índice único requerido, el bootstrap falla cerrado y no intenta reparar el storage de forma destructiva.

## Concurrencia y atomicidad

El `apply` reutiliza el lock transaccional de la baseline Membership y ejecuta las mutaciones funcionales dentro de una única transacción MongoDB.

La secuencia es:

```text
runtime/sha/fingerprint guards
→ transaction support
→ acquire persisted bootstrap lock
→ read identity state
→ fail closed si partial/incompatible
→ ensure missing identity collections + exact unique indexes
→ hash passwords
→ create 2 Business
→ create 2 User sin User.business
→ create 2 Membership admin
→ verify exact topology + BSON refs in transaction
→ release lock
→ commit
→ physical post-commit verification
```

Un resultado de commit/cierre incierto se trata como `MembershipBaselineUnknownResultError`; no se reintenta a ciegas. Primero debe ejecutarse un nuevo `plan`.

## Variables temporales de propietarios

Sólo durante el `apply` se definen en Railway:

```text
PRODUCTION_BOOTSTRAP_ATMOSFERA_FIRST_NAME
PRODUCTION_BOOTSTRAP_ATMOSFERA_LAST_NAME
PRODUCTION_BOOTSTRAP_ATMOSFERA_EMAIL
PRODUCTION_BOOTSTRAP_ATMOSFERA_PASSWORD

PRODUCTION_BOOTSTRAP_DAM_FIRST_NAME
PRODUCTION_BOOTSTRAP_DAM_LAST_NAME
PRODUCTION_BOOTSTRAP_DAM_EMAIL
PRODUCTION_BOOTSTRAP_DAM_PASSWORD
```

Las contraseñas deben tener entre 12 y 256 caracteres según el contrato de baseline. Los dos correos deben ser distintos.

No registrar estos valores en GitHub, PRs, logs, capturas ni documentación. En Railway, los valores de password deben sellarse cuando la UI lo permita.

## Paso 1 — Plan sin credenciales

Después de que este cambio haya sido revisado, aprobado, merged y desplegado desde `master`, configurar temporalmente como **Pre-deploy Command**:

```text
npm run bootstrap:production-owners -- --mode=plan
```

El plan es read-only. Debe mostrar, como mínimo:

```text
Estado: empty
Can apply: true
Business/User/Membership: 0/0/0
Target fingerprint: <sha256>
Deployment SHA: <sha de master desplegado>
```

`Can apply: true` es obligatorio. Si el estado es `occupied` o el storage es incompatible, el proceso devuelve código no-cero para que Railway detenga ese pre-deploy; no debe interpretarse como un plan exitoso.

No continuar si el fingerprint no corresponde al destino esperado o si cualquiera de los tres índices no existe ni puede crearse de forma transaccional segura.

## Paso 2 — Preparar credenciales temporales

Sólo después de revisar el plan:

1. crear las ocho variables `PRODUCTION_BOOTSTRAP_*`;
2. usar correos reales de los propietarios;
3. usar contraseñas nuevas y únicas;
4. sellar las variables de contraseña si Railway lo permite;
5. no compartir sus valores en capturas.

## Paso 3 — Apply ligado a fingerprint y SHA

Reemplazar temporalmente el Pre-deploy Command por:

```text
npm run bootstrap:production-owners -- \
  --mode=apply \
  --expected-target-fingerprint=<fingerprint-del-plan> \
  --approved-sha=<deployment-sha-aprobado> \
  --confirm=CREATE_INITIAL_PRODUCTION_OWNERS
```

El apply debe finalizar con:

```text
Estado: ready
Aplicado: true
Business/User/Membership: 2/2/2
Índice Business.slug exacto: true
Índice User.email exacto: true
Índice Membership exacto: true
```

Una segunda ejecución con exactamente las mismas credenciales y topología es un no-op verificado (`Aplicado: false`). Cualquier diferencia bloquea.

## Paso 4 — Verificación funcional

Antes de limpiar variables:

1. iniciar sesión desde `https://agenda.atmosferastudio.cl/login` con el propietario de Atmósfera;
2. comprobar que entra al tenant `atmosfera` como `admin`;
3. cerrar sesión;
4. repetir con el propietario de DAM;
5. comprobar que entra al tenant `dam` como `admin`.

No se usa un dominio preview `*.vercel.app` para estas sesiones.

## Paso 5 — Limpieza obligatoria

Tras verificar ambos accesos:

1. eliminar las ocho variables `PRODUCTION_BOOTSTRAP_*` de Railway;
2. eliminar el Pre-deploy Command de bootstrap;
3. no dejar `apply` ni `plan` configurados en futuros deployments;
4. conservar los gates operativos permanentes de otras fases, incluido `PUBLIC_WEB_6_2_6_B_CUTOVER=PUBLIC_WEB_6_2_6_B_STORAGE_READY`;
5. no eliminar los índices físicos creados/verificados.

El bootstrap queda en el repositorio como herramienta de recuperación/auditoría controlada, pero no forma parte del startup normal.

## Fallos que requieren detenerse

Detener la operación y revisar antes de cualquier nuevo `apply` si ocurre cualquiera de estos casos:

- `occupied` antes del primer apply;
- `Can apply: false`;
- counts distintos de `0/0/0` o `2/2/2`;
- fingerprint diferente;
- deployment SHA diferente;
- índice único faltante en una colección ya existente;
- referencias de identidad almacenadas como string u otro tipo distinto de BSON `ObjectId`;
- error transaccional/commit incierto;
- password mismatch en una re-ejecución;
- `Business.owner` no coincide con el propietario esperado;
- aparece `User.business` en alguno de los propietarios, incluso `null`;
- aparece cualquier worker/usuario extra en la baseline inicial.

No ejecutar `seed-production.js` ni alterar manualmente MongoDB como atajo.
