# Fase 6.2.2-D — Corte runtime de autoridad tenant hacia Membership

**Proyecto:** ATMÓSFERA Agenda  
**Estado:** implementación en Draft; pendiente revisión adversarial y CI final  
**Base:** `master` `6df6ec29cb665ec6383db72d5051e8cff2c3d5fe`, posterior al merge del PR #21  
**Rama:** `agent/6.2.2-d-membership-runtime-authority`

## 1. Objetivo

Hacer que una `Membership` activa sea la única fuente de rol y autoridad para operaciones tenant-scoped. `User.role`, `User.business` y las copias de `role`/`businessId` en sesión pueden permanecer durante la transición como privilegio global, contexto, presentación o compatibilidad, pero no conceden autoridad tenant.

La autoridad efectiva se resuelve mediante `tenantAuthority.service.js` a partir de identidad global vigente, negocio vigente y `Membership` activa del par usuario-negocio. Los únicos roles tenant válidos son `admin` y `worker`.

## 2. Inventario inicial de autoridades competidoras

Clasificación:

- **A — autoridad tenant:** participaba en una decisión de acceso tenant.
- **B — privilegio global:** corresponde al plano de plataforma.
- **C — contexto/presentación:** puede existir, pero no debe autorizar.
- **D — compatibilidad heredada sin autoridad:** escritura/lectura mantenida temporalmente.
- **E — deuda fuera de alcance:** no debe confundirse con este corte.

| Frontera / uso inicial | Clasificación | Estado previo al corte |
|---|---:|---|
| `business.middleware.js` — `session.user.role` + `session.user.businessId` | A | `scopeBusiness` asumía que `admin`/`worker` en sesión demostraba autoridad sobre el negocio copiado. |
| `role.middleware.js` — `isAdmin` | A | Autorizaba exclusivamente con `session.user.role === "admin"`. |
| `auth.controller.js` — `/select-membership` | A | Elegía desde la copia temporal de memberships sin reconsultar persistencia. |
| `auth.service.js` / `/me` | A | La existencia del usuario bastaba; no revalidaba la Membership del tenant activo. |
| `auth.service.js` — `/switch-business` | A/B | Usuario tenant consultaba Membership, pero la bifurcación `superadmin` dependía del rol copiado en sesión. |
| `service.controller.js`, `user.controller.js` | A | La visibilidad de elementos inactivos dependía de `session.user.role === "admin"`. |
| `availability.controller.js` | A | Turnos/bloqueos autorizaban admin o self-worker desde el rol copiado en sesión. |
| `availability.service.js` | A | La condición de profesional exigía simultáneamente `User.role === "worker"` y Membership worker. |
| `appointment.controller.js` / `appointment.service.js` | A | Confirmar, completar, cancelar, detalle y listado recibían `session.user.role`; `superadmin` podía contarse como admin en mutaciones. |
| `appointment.service.js` — profesional de reserva | A | Exigía `User.role === "worker"` además de Membership worker. |
| `socket.js` — handshake y rooms | A | Capturaba `session.user.businessId` y lo usaba como contexto tenant persistente del socket. |
| `socket.js` — `join_availability` | A | Validaba al trabajador con `MembershipModel`, pero no revalidaba la Membership propia del actor después del handshake. |
| `superadmin.service.js` — impersonación | A/B | El fallback elegía admin mediante `User.business + User.role`; el owner tampoco se revalidaba contra Membership admin activa. |
| `superadmin.controller.js` — impersonación | A/C | Copiaba literalmente `role: "admin"` a la sesión impersonada. |
| `membership.model.js` | A | Admitía `superadmin` como rol tenant válido. |
| `User.role === "superadmin"` para rutas `/superadmin/*` | B | Privilegio global legítimo, separado del tenant. |
| Copias `session.user.role`, `session.user.businessId`, `businessSlug` | C | Necesarias temporalmente para contexto/UI, pero no deben ser prueba de autoridad. |
| `analytics.service.js` — `User.business`/`User.role` en agrupación de usuarios | C/E | Dato/agrupación analítica heredada; la ruta tenant estaba protegida por rol de sesión. La semántica de perfiles cliente y métricas completas se difiere. |
| `user.service.js` / `superadmin.service.js` — escritura de `User.role` y `User.business` | D | Compatibilidad heredada al crear worker/owner; no debe autorizar runtime. |
| Ownership de Service/Appointment por ID | E | 6.2.4. El corte de autoridad no sustituye las comprobaciones de ownership de recursos. |
| Turnos/bloqueos sin `business` propio obligatorio | E | 6.2.3/6.2.4. No se migra el schema en este PR. |
| Modelo definitivo de clientes autenticados | E | 6.2.5. No se rediseña en este PR. |
| Soporte mutable de superadmin | E | 6.4. No se implementa una excepción de soporte en este PR. |

## 3. Resolución de autoridad efectiva

`tenantAuthority.service.js` centraliza la resolución de autoridad tenant.

Para producir autoridad válida deben cumplirse simultáneamente:

1. existe el usuario global;
2. `User.isActive === true`;
3. existe el negocio y está activo;
4. existe una `Membership` activa para el par usuario-negocio;
5. el rol de Membership es `admin` o `worker`.

El resultado se expone como `req.tenantAuthority` en las fronteras HTTP tenant-scoped. La ausencia de autoridad no impide por sí sola una lectura pública, pero cualquier política protegida debe exigir explícitamente la autoridad requerida.

`scopeBusiness` conserva la responsabilidad de resolver **contexto de negocio**. Si la sesión contiene `businessId`, ese valor se trata como contexto seleccionado, no como prueba de acceso. La resolución de Membership se realiza por separado y se adjunta al request.

## 4. Cambios por frontera

### HTTP y roles

- `isAuthenticated` revalida que la identidad global exista y siga activa.
- `isAdmin` exige `req.tenantAuthority.role === "admin"`.
- `isWorkerOrAdmin` exige una Membership tenant activa `admin` o `worker`.
- `isSuperadmin` usa el `User.role` global recién leído desde persistencia; no la copia de sesión.
- visibilidad administrativa de servicios y profesionales deriva de `req.tenantAuthority`.

### Login, selección, `/me` y cambio de negocio

- login sigue cargando Memberships activas para construir contexto inicial;
- `/select-membership` vuelve a consultar la Membership por ID + usuario y exige que siga activa y que su negocio esté activo;
- `/switch-business` vuelve a leer el usuario global. Usuarios tenant requieren Membership activa; `superadmin` sólo obtiene contexto y conserva `role: superadmin`;
- `/me` revalida identidad, negocio y Membership. Para usuarios tenant, una Membership eliminada/inactiva invalida la sesión y devuelve `401`; un cambio de rol de Membership refresca la copia de presentación;
- un `superadmin` puede conservar contexto de negocio sin Membership, pero `tenantRole` sólo aparece si existe una Membership tenant válida.

### Workers, disponibilidad y reservas

- la condición de profesional ya no consulta `User.role === "worker"`; exige usuario global activo + Membership worker activa en el negocio;
- mutaciones de turnos/bloqueos usan la autoridad tenant efectiva para distinguir admin de self-worker;
- las operaciones de citas ya no reciben `session.user.role`. Admin y worker se determinan desde `req.tenantAuthority`;
- `superadmin` global dejó de contarse como admin para mutaciones tenant normales;
- la relación de cliente con su propia cita se mantiene separada del rol tenant y continúa bajo la deuda de identidad/ownership definida para 6.2.4/6.2.5.

### WebSocket

- el handshake revalida identidad global y, cuando existe tenant seleccionado, Membership propia;
- `superadmin` sin Membership puede mantener una conexión de plataforma/contexto, pero no entra a rooms tenant;
- `join_availability` revalida la sesión persistida y la Membership del actor en cada operación;
- si el tenant activo cambió desde HTTP, el socket antiguo falla cerrado;
- si la Membership se desactiva después del handshake, la siguiente operación protegida falla cerrado;
- antes de emitir `availability_changed` o `calendar_update`, se podan sockets del room cuyo contexto/Membership dejó de ser válido;
- la validación del worker observado usa el repository de Membership y exige rol `worker`.

### Impersonación transitoria

- `Business.owner` ya no basta para elegir sujeto;
- owner y fallback deben tener Membership admin activa y usuario global activo;
- desaparece el fallback `User.business + User.role`;
- la sesión impersonada conserva una copia de rol para presentación, pero cada request vuelve a resolver Membership;
- esto no implementa la asistencia mutable de 6.4 ni amplía privilegios de plataforma.

### Schema de Membership

`superadmin` fue retirado del enum. Una Membership con ese rol es inválida y la suite exige su rechazo. No se ejecuta ninguna migración destructiva ni se modifica una base externa.

## 5. Búsqueda final y clasificación de usos heredados esperados

Después del corte, estos usos siguen siendo legítimos sólo bajo las categorías indicadas:

| Uso restante | Clasificación | Justificación |
|---|---:|---|
| `User.role === "superadmin"` leído desde DB | B | Privilegio global de plataforma. No produce rol tenant. |
| `session.user.role` | C | Copia de presentación/contexto; ninguna política tenant la consulta para conceder admin/worker. |
| `session.user.businessId` / `businessSlug` | C | Contexto seleccionado. `scopeBusiness` y WebSocket vuelven a resolver Membership antes de autoridad protegida. |
| `User.role` `admin`/`worker` al crear usuarios heredados | D | Compatibilidad temporal. Login/runtime no lo usa como rol tenant. |
| `User.business` al crear owner/worker | D | Compatibilidad temporal. No participa en autorización. |
| `analytics.service.js` agrupando `User.business`/`User.role` | C/E | Métrica heredada, no puerta de autorización. Su semántica completa depende del modelo cliente de 6.2.5. |
| comprobaciones literales `admin`/`worker` sobre `Membership.role` o `tenantAuthority.role` | A válida | Son decisiones tenant derivadas de Membership activa. |
| `superadmin` en `User`/middleware global | B | Plano de plataforma. |
| `admin`/`worker` en fixtures, bootstrap y auditor | D | Datos de prueba/baseline, no autoridad runtime. |

Una aparición futura de `User.role`, `User.business`, `session.user.role` o `session.user.businessId` como **prueba suficiente** para una operación tenant protegida se considera bloqueante.

## 6. Pruebas añadidas

`membershipRuntimeAuthority.test.js` demuestra:

- admin con Membership activa permitido;
- revocación de Membership después de login denegada inmediatamente;
- `User.role=admin` sin Membership no obtiene sesión tenant;
- Membership admin prevalece sobre `User.role=worker`;
- cambiar Membership admin→worker invalida el admin copiado en sesión y `/me` refresca el rol efectivo;
- Membership de Business A no habilita cambiar a Business B;
- `/select-membership` no acepta una Membership desactivada después del login;
- superadmin selecciona contexto sin adquirir admin tenant;
- superadmin con Membership admin válida obtiene autoridad tenant desde esa Membership;
- Membership rechaza `role=superadmin`.

La suite WebSocket añade:

- revocación posterior al handshake;
- expulsión lógica de rooms antes de broadcasts tenant;
- aislamiento entre tenants;
- invalidación del socket cuando el tenant activo cambia por HTTP.

## 7. Deuda explícitamente diferida

Este PR no cierra ni intenta resolver:

- 6.2.3: schema/migración tenant de turnos y bloqueos;
- 6.2.4: ownership general de servicios, citas y otros recursos por ID;
- 6.2.5: identidad progresiva y modelo tenant de clientes;
- 6.3: pagos, Webpay, refunds o propiedad de acciones de pago;
- 6.4: sesión de soporte mutable, acotada y auditable;
- reestructuración de microservicios, colas o refactor general;
- semántica definitiva de agrupación de clientes en analytics.

La existencia de estas deudas no autoriza conservar una fuente heredada de rol tenant.

## 8. Persistencia y operación

La implementación y sus pruebas sólo están diseñadas para la infraestructura efímera/controlada de CI. Este trabajo no requiere ni autoriza:

- conexión a Atlas productivo;
- migraciones sobre bases externas;
- creación de usuarios reales;
- seeds destructivos;
- modificación de datos productivos;
- inclusión de secretos.

## 9. Criterio de cierre

6.2.2 **no se declara cerrada por este documento**. El Draft debe superar CI y una revisión adversarial posterior. Sólo podrá proponerse el cierre si la búsqueda final del HEAD demuestra que ninguna operación tenant normal obtiene autoridad desde `User.role`, `User.business`, `session.user.role`, `session.user.businessId` u otra copia heredada.
