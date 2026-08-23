# Contrato inicial de administración de Equipo y agendabilidad

**Proyecto:** ATMÓSFERA Agenda  
**Estado:** definición documental inicial; implementación funcional pendiente  
**Fecha:** 23 de agosto de 2026  
**Baseline verificada:** `master@5743bdb9fa530bb3f989893fe6ebdf1a3caa07ad`  
**Precedente operativo:** PR #33 `feat(ops): add one-shot production owner bootstrap`, merged en la baseline anterior  
**Ámbito:** Equipo, autoridad tenant y capacidad operacional de ser profesional agendable  
**Naturaleza:** exclusivamente documental

Este documento especializa ADR-001 para separar de forma explícita la **autoridad tenant** de la **capacidad operacional de ser agendable**. No implementa schemas, rutas, migraciones, UI, servicios, horarios, disponibilidad ni reservas nuevas.

## 1. Problema

El modelo runtime actual sobrecarga el término `worker`.

Hoy `Membership.role = "worker"` se usa simultáneamente como:

1. una clase de participación/autoridad tenant; y
2. una señal indirecta de que la persona es un profesional operativo del negocio.

Ese acoplamiento deja de ser válido cuando una misma identidad debe poder ser, dentro del mismo `Business`:

- owner;
- admin;
- profesional que presta servicios y recibe reservas.

El índice físico obligatorio de `Membership` es:

```text
{ user: 1, business: 1 }
unique: true
```

Por tanto, una identidad no puede ni debe recibir dos Memberships para el mismo Business. Un owner/admin con `Membership.role = "admin"` no puede recibir una segunda `Membership.role = "worker"` para expresar que también presta servicios.

La solución tampoco puede consistir en:

- relajar o eliminar el índice único;
- cambiar al admin de `admin` a `worker`;
- usar `User.role` como autoridad tenant;
- usar `User.business` como autoridad tenant;
- usar `Business.owner` como autorización;
- inferir agendabilidad a partir del rol tenant.

El contrato correcto debe representar por separado:

```text
AUTORIDAD TENANT
!=
CAPACIDAD OPERACIONAL DE SER AGENDABLE
```

## 2. Estado actual verificado

La revisión se realizó contra `master@5743bdb9fa530bb3f989893fe6ebdf1a3caa07ad`.

### 2.1 Frontend

`Client/src/components/Sidebar.tsx` muestra visualmente, entre otras entradas:

- Calendario;
- Horarios;
- Clientes;
- Seguimiento;
- Servicios;
- Reglas de negocio;
- Equipo;
- Reportes.

Sin embargo, `handleNavClick` sólo implementa navegación funcional para calendario, horarios y vistas SaaS. `Equipo` sigue siendo placeholder.

`Client/src/components/AdminDashboard.tsx` renderiza actualmente:

- semana;
- día;
- mes;
- horarios;
- SaaS negocios;
- SaaS métricas.

No existe una vista funcional de Equipo. El botón visual `Editar horarios` no constituye todavía una herramienta real de edición.

`Client/src/context/CalendarDataContext.tsx` carga `api.getWorkers()` y trata ese resultado como `profs`. Después consulta shifts por cada elemento. `Client/src/services/api.ts` obtiene esos datos desde:

```text
GET /api/internal/users/workers
```

La superficie del panel ya está correctamente separada del discovery público, pero la semántica frontend sigue acoplando `worker` con `Professional`.

`Client/src/context/sessionPolicy.ts` también conserva lógica histórica asociada a `user.role === "worker"`. Esa lógica no redefine la autoridad backend, pero deberá revisarse en la implementación funcional para no usar el rol como sustituto de agendabilidad.

### 2.2 Backend administrativo de workers

`Server/src/routes/user.routes.js` mantiene:

```text
POST   /api/users/workers
DELETE /api/users/workers/:id
```

con `scopeBusiness -> isAuthenticated -> isAdmin`.

`Server/src/routes/internalBooking.routes.js` mantiene la lectura interna:

```text
GET /api/internal/users/workers
```

con `scopeBusiness -> isAuthenticated -> getWorkers`.

La lectura interna no usa el endpoint público y esa separación debe conservarse.

### 2.3 Creación actual

`Server/src/services/user.service.js#createWorker()` actualmente:

1. busca un `User` global por email;
2. si no existe, crea `User`;
3. para un User nuevo persiste todavía valores legacy `User.role = "worker"` y `User.business = businessId`;
4. crea una única `Membership` con `role = "worker"`;
5. rechaza si ya existe cualquier Membership para ese `User + Business`;
6. inicializa automáticamente horarios lunes-viernes 09:00-18:00, descanso 13:00-14:00 y fin de semana cerrado.

Ese comportamiento describe el runtime legacy, **no** el contrato futuro de Equipo.

### 2.4 Eliminación actual

`deleteWorker()` busca específicamente:

```text
Membership(user, business, role="worker")
```

El soft delete desactiva `Membership.isActive` y conserva `Shift`/`Block`. El hard delete elimina la Membership y los recursos operacionales de ese tenant; si no quedan Memberships, puede desactivar el User global.

Ese lifecycle tampoco puede ser la interfaz semántica futura de Equipo, porque no permite tratar correctamente a un admin agendable y mezcla acceso con condición profesional.

### 2.5 Listado administrativo actual

`getWorkersList()` consulta:

```text
{ business, role: "worker" }
```

Por ello un admin nunca aparece en ese listado aunque esté legítimamente asignado a servicios.

### 2.6 Autoridad tenant actual

`Server/src/services/tenantAuthority.service.js`, `business.middleware.js` y `auth.service.js` ya aplican la regla correcta:

```text
User activo
+ Business activo
+ Membership activa del mismo User + Business
+ Membership.role válido
= autoridad tenant vigente
```

`User.role`, `User.business`, `Business.owner` y copias stale de rol en sesión no sustituyen esa decisión.

Los tests `membershipRuntimeAuthority.test.js`, `membershipAuthorityAudit.test.js` y `tenantResourceIsolation.test.js` protegen estas invariantes.

### 2.7 Eligibility y discovery público actual

`professionalEligibility.service.js` acepta actualmente como participante profesional activo cualquier Membership activa cuyo rol esté en:

```text
admin | worker
```

`publicBookingContract.service.js#getPublicProfessionalsForService()` exige además que el User esté activo y que el User esté referenciado en `Service.workers`.

Por tanto, hoy no existe una señal independiente de agendabilidad.

El contrato público 6.2.6-A permanece:

```text
GET /api/users/workers?serviceId=...
```

como superficie pública/headless, con proyección mínima y tenant explícito. 6.2.6-B añade la frontera de origin público verificado sin convertirla en session/admin authority.

### 2.8 Service, Shift, Block y Appointment

Actualmente:

- `Service.workers` contiene `User` ObjectIds;
- `Shift` se identifica por `Business + worker(User) + dayOfWeek`;
- `Block` se identifica por `Business + worker(User) + date`;
- `Appointment.worker` referencia un `User` y `Appointment.business` fija tenant;
- Availability valida Service + participante tenant + asignación al Service antes de consultar Shift/Block/Appointments.

Estos recursos pueden seguir referenciando la identidad global `User` siempre que cada operación revalide la relación tenant y la capacidad operacional correspondiente. No convierten por sí mismos a una persona en miembro, admin ni profesional agendable.

## 3. Invariantes obligatorias

1. `User` representa identidad global.
2. `Membership` es la única autoridad tenant ordinaria.
3. `Business.owner` expresa propiedad; no concede autoridad por sí mismo.
4. `superadmin` es privilegio global; no es un rol de Membership.
5. Seleccionar un Business aporta contexto; no concede permisos.
6. Toda autoridad tenant mutable deriva de una Membership activa.
7. Debe conservarse el índice físico `{ user: 1, business: 1 } unique: true`.
8. Existe exactamente una Membership por combinación `User + Business`.
9. `User.business` no es fuente de autoridad ni de agendabilidad.
10. `User.role` no sustituye `Membership.role` para autorización tenant ni determina agendabilidad.
11. Un owner/admin no es agendable automáticamente.
12. Ser agendable no concede autoridad admin.
13. Una identidad puede ser simultáneamente owner, admin y profesional agendable mediante una sola Membership.
14. Una Membership inactiva nunca concede autoridad tenant efectiva ni elegibilidad pública profesional.
15. Un User inactivo nunca es elegible públicamente.
16. Ningún `Service`, `Shift`, `Block` o `Appointment` concede autoridad tenant por su mera referencia a un User.
17. Toda mutación de Equipo debe estar acotada al Business autenticado y revalidar autoridad vigente.
18. El contrato headless/CORS/origin de 6.2.6-A/6.2.6-B permanece vigente.

## 4. Vocabulario canónico

### 4.1 Identidad

**User**: identidad global autenticable. Puede participar en cero, uno o varios Businesses. Sus propiedades globales no conceden autoridad tenant.

### 4.2 Miembro / participación tenant

**Miembro de Equipo** o **miembro tenant**: una identidad que posee la única `Membership(User, Business)` de ese Business.

La existencia de la Membership representa la relación de participación. Su `isActive` determina si esa participación está vigente.

### 4.3 Autoridad tenant

**Membership.role** responde exclusivamente:

> ¿Qué clase de autoridad/acceso posee esta identidad dentro de este Business?

Roles físicos actuales:

```text
admin | worker
```

En este contrato, `worker` debe entenderse como el nombre legacy de una clase de participación tenant no-admin. **No significa automáticamente profesional agendable.** Este PR no introduce roles nuevos ni renombra los existentes.

### 4.4 Agendabilidad

**Agendabilidad** o **capacidad de ser agendable** responde:

> ¿Puede esta persona ser considerada como profesional seleccionable para prestar servicios y recibir reservas dentro de este Business?

Es una capacidad operacional tenant-scoped y ortogonal al rol.

### 4.5 Profesional agendable efectivo

Un miembro no se vuelve públicamente seleccionable sólo por tener la capacidad configurada. La elegibilidad efectiva requiere que se cumpla el contrato completo de discovery/availability.

Conceptualmente:

```text
Business activo
AND User activo
AND Membership del mismo Business activa
AND Membership.isBookable === true
AND Service activo del mismo Business
AND Service asigna ese User
AND resto de condiciones operacionales requeridas
```

Para obtener slots reales se requiere además disponibilidad explícitamente configurada.

### 4.6 Propiedad

**Owner** sigue siendo `Business.owner`. Es metadata de propiedad y puede mostrarse en UI, pero no autoriza mutaciones ni vuelve agendable al User.

## 5. Separación autoridad / agendabilidad

La matriz mínima válida es:

| Membership.role | Agendable | Semántica |
| --- | --- | --- |
| `admin` | `false` | admin/owner administrativo que no presta servicios |
| `admin` | `true` | admin/owner que además presta servicios |
| `worker` | `true` | participante no-admin que presta servicios |
| `worker` | `false` | participante no-admin con acceso tenant pero temporalmente fuera de reservas |

Ninguno de estos estados requiere una segunda Membership.

Reglas de no equivalencia:

```text
role == admin    != not bookable
role == worker   != bookable
isBookable       != admin authority
Business.owner   != isBookable
Service.workers  != Membership
Shift exists     != isBookable
```

## 6. Representación elegida

### 6.1 Decisión

La primera implementación funcional deberá representar la capacidad mediante un booleano tenant-scoped en la Membership existente:

```text
Membership.isBookable: Boolean
```

`isBookable` queda adoptado como **nombre canónico contractual** para la siguiente fase. La forma física exacta deberá implementar esta semántica sin añadir otra fuente de verdad.

### 6.2 Por qué Membership es la ubicación correcta

La capacidad pertenece exactamente a la relación:

```text
User X + Business Y
```

La Membership ya posee exactamente esa cardinalidad y está protegida por el índice único `User + Business`.

Ubicar `isBookable` allí:

- mantiene `Membership.role` como fuente de autoridad tenant;
- no convierte `isBookable` en permiso administrativo;
- permite `admin + isBookable=true`;
- permite `worker + isBookable=false`;
- impide duplicar Memberships;
- no depende de `User.role`;
- no depende de `User.business`;
- no depende de `Business.owner`;
- mantiene aislamiento por Business;
- evita introducir una entidad, índice, lifecycle y join adicionales para un único bit de capacidad actual;
- permite que la identidad global permanezca intacta si el mismo User tiene estados diferentes en Businesses distintos.

Ejemplo legítimo:

```text
User U
├── Membership(U, Business A): role=admin,  isBookable=true
└── Membership(U, Business B): role=worker, isBookable=false
```

### 6.3 Por qué no se adopta una entidad separada ahora

Una entidad `ProfessionalProfile`/`BookableParticipant` separada sólo sería necesaria si la capacidad adquiriera un lifecycle o datos propios independientes de la Membership, por ejemplo configuración profesional compleja, múltiples perfiles por Business o invariantes que no pudieran expresarse con una capacidad simple.

Ese requisito no existe hoy.

Crear una entidad separada en esta fase añadiría:

- otra cardinalidad que proteger;
- otro join crítico para discovery;
- otra superficie de consistencia;
- otro lifecycle de activación/desactivación;
- riesgo de desalineación con Membership.

Por tanto, sería sobreingeniería para el requisito actual.

### 6.4 `isBookable` no es autoridad

Debe quedar prohibido usar:

```text
Membership.isBookable === true
```

como autorización para:

- administrar el Business;
- modificar Servicios;
- modificar Equipo;
- conceder rol admin;
- seleccionar tenant;
- acceder a recursos no autorizados.

La autorización sigue dependiendo de `Membership.role` y `Membership.isActive` según la política del endpoint.

### 6.5 Ausencia del campo

Después del cutover funcional, sólo el valor explícito:

```text
isBookable === true
```

concede la capacidad configurada.

`undefined`, `null`, campo ausente o valores inválidos deben tratarse como **no agendable / fail-closed** durante la transición. Tras la migración verificada no deben quedar Memberships sin valor canónico.

No se autoriza un fallback productivo permanente como:

```js
membership.isBookable ?? membership.role === "worker"
```

## 7. Contrato de la futura vista Equipo

La vista Equipo representa personas vinculadas al Business, no sólo `role="worker"`.

Debe distinguir dos ejes visibles y semánticos.

### 7.1 Acceso / autoridad

Como mínimo:

- Membership activa o inactiva;
- rol tenant actual;
- si la identidad posee capacidad administrativa conforme al rol vigente.

La UI puede mostrar una etiqueta de owner si `Business.owner` coincide, pero esa etiqueta es informativa y nunca sustituye la autorización backend.

### 7.2 Agendabilidad

Como mínimo:

- recibe reservas / no recibe reservas;
- independiente de `admin | worker`.

La UI no puede usar una única acción genérica `Eliminar trabajador` para representar ambos conceptos.

Debe existir una diferencia inequívoca entre:

```text
Dejar de recibir reservas
```

y:

```text
Desactivar acceso al negocio
```

### 7.3 Datos mínimos por fila/tarjeta

La primera versión no necesita un sistema visual complejo. El DTO administrativo mínimo debería permitir presentar:

- `membershipId`;
- `userId`;
- nombre visible canónico del User;
- email canónico necesario para administración autorizada;
- `role` tenant;
- `membershipActive`;
- `isBookable`;
- indicador informativo `isOwner` cuando corresponda.

No debe exponer:

- otras Memberships del User;
- Businesses ajenos;
- `User.business` como señal de pertenencia;
- `User.role` como autoridad tenant;
- password/hash/tokens;
- metadata global innecesaria.

La respuesta debe derivarse de un lookup tenant-scoped de Memberships del Business y no de una búsqueda global de Users presentada al cliente.

## 8. Estados de UI futuros

### 8.1 Loading

Mostrar estado de carga sin asumir lista vacía. No habilitar mutaciones hasta conocer el contexto tenant y autoridad actuales.

### 8.2 Error

Mostrar error estable y opción de reintento. No degradar un error de autorización, DB o red a `equipo vacío`.

### 8.3 Equipo vacío

Representa cero Memberships visibles según la política de la superficie, no fallo de carga.

### 8.4 Miembro activo

Mostrar rol y estado de agendabilidad como atributos separados.

### 8.5 Miembro inactivo

Debe poder conservarse en la proyección administrativa para contexto/historial operacional. No posee acceso tenant efectivo ni puede aparecer públicamente como profesional.

La primera UI no necesita implementar reactivación si esa operación todavía no está contratada.

### 8.6 Profesional agendable

Mostrar `recibe reservas` sólo como capacidad configurada. No prometer disponibilidad real si no posee Service + horario compatible.

### 8.7 Miembro no agendable

Mostrar que mantiene el acceso que corresponda a su Membership, pero no debe ser elegible para discovery público.

### 8.8 Owner/admin agendable

Mostrar simultáneamente su condición administrativa/owner y `recibe reservas`, sin crear otro registro de participación.

### 8.9 Owner/admin no agendable

Estado válido y esperado. Ser owner/admin no genera warning de inconsistencia.

### 8.10 Acción cross-tenant

Debe fallar cerrado desde backend. La UI recibe una respuesta estable sin información sobre la existencia real del objetivo en otro Business.

### 8.11 Conflicto al agregar alguien que ya participa

Si el User ya posee Membership en el mismo Business, la operación no crea otra.

Debe responder con un conflicto tenant-local estable, conceptualmente:

```text
TEAM_MEMBER_ALREADY_EXISTS
```

El mensaje puede indicar que esa persona ya participa **en este Business**, pero no debe revelar Memberships, roles ni presencia en otros Businesses.

## 9. Acciones mínimas de la primera UI funcional

La primera superficie funcional de Equipo debe limitarse a:

1. listar Equipo;
2. añadir un profesional;
3. habilitar como profesional a un admin/owner existente;
4. habilitar recepción de reservas;
5. deshabilitar recepción de reservas;
6. desactivar acceso tenant cuando corresponda.

No debe incluir hard delete.

No debe incluir edición completa de identidad, permisos granulares, invitaciones, fotografías, biografías, comisiones, sucursales, especialidades avanzadas, payroll, RRHH ni métricas de equipo.

## 10. Contrato owner/admin que también presta servicios

Este caso es de primera clase.

Estado inicial posible:

```text
Business.owner = User U
Membership(U, Business) = {
  role: "admin",
  isActive: true,
  isBookable: false
}
```

Acción futura:

```text
"También presto servicios"
```

Resultado:

```text
misma Membership
role permanece "admin"
isActive permanece true
isBookable pasa a true
```

La operación:

- no crea segunda Membership;
- no crea ni recrea User;
- no cambia password;
- no cambia nombre global silenciosamente;
- no modifica autoridad;
- no usa `Business.owner` para autorizar;
- no crea Service assignment automáticamente;
- no crea Shift automáticamente;
- no vuelve al owner públicamente reservable por sí sola.

Acción inversa:

```text
"Dejar de recibir reservas"
```

Resultado:

```text
role permanece "admin"
isActive permanece true
isBookable pasa a false
```

El owner/admin conserva acceso administrativo.

## 11. Lifecycle de miembro y profesional

Los ejes deben evolucionar de forma separada.

### 11.1 Crear participación

```text
User global
-> exactamente una Membership(User, Business)
-> role tenant explícito
-> isActive explícito/verdadero según operación
-> isBookable explícito, nunca inferido del role
```

### 11.2 Habilitar agendabilidad

Precondiciones mínimas:

- User activo;
- Business activo;
- Membership existente del mismo Business;
- Membership activa;
- caller con autoridad tenant requerida.

Mutación:

```text
isBookable: false -> true
```

No cambia `role`.

### 11.3 Deshabilitar agendabilidad

Mutación:

```text
isBookable: true -> false
```

No cambia `role`, no desactiva Membership, no elimina identidad, no borra Services/Shifts/Blocks/Appointments históricos.

Desde el instante en que la mutación es efectiva, discovery/availability público debe fallar cerrado para nuevas selecciones/reservas de esa persona.

### 11.4 Desactivar acceso tenant

Mutación conceptual:

```text
Membership.isActive = false
Membership.isBookable = false
```

La desactivación de acceso debe apagar también la capacidad configurada en la misma operación o unidad de consistencia. Se adopta esta regla fail-closed para que una futura reactivación de acceso no vuelva a publicar reservas accidentalmente.

La desactivación:

- revoca participación tenant;
- no elimina User global;
- no borra Appointments históricas;
- no borra por defecto Shift/Block/Service associations históricas;
- impide discovery público y availability efectiva;
- requiere una acción futura explícita para volver a habilitar agendabilidad.

### 11.5 Reactivación futura

No forma parte de las acciones mínimas de esta primera UI. Cuando se implemente, reactivar acceso no deberá reactivar agendabilidad automáticamente.

### 11.6 Hard delete

Queda fuera de la UI ordinaria de Equipo.

El endpoint legacy `DELETE /api/users/workers/:id?hard=true` no debe convertirse en una acción normal de la futura pantalla. Cualquier lifecycle destructivo futuro requerirá contrato explícito separado, análisis de referencias históricas y autorización reforzada.

## 12. Creación de nuevos profesionales

La operación futura debe ser una mutación tenant autorizada cuyo lookup global permanece interno al servidor.

### 12.1 Email no corresponde a User global

El servidor debe:

1. normalizar/validar el input según una política única;
2. comprobar internamente si existe User;
3. crear una identidad global si no existe;
4. crear exactamente una Membership en el Business;
5. asignar `role` tenant apropiado;
6. persistir `isBookable` de forma explícita;
7. no crear horarios ni Service assignments implícitos.

Mientras no exista un flujo de invitación, la implementación funcional posterior deberá definir de manera acotada cómo se provisiona una credencial inicial para un User realmente nuevo. Este documento no implementa invitaciones ni reset de password.

### 12.2 Email ya corresponde a User global sin Membership en este Business

El servidor debe:

- reutilizar el mismo User;
- no sobrescribir password;
- no sustituir nombre global silenciosamente;
- no cambiar `User.role` para expresar autoridad tenant;
- no cambiar `User.business` para expresar pertenencia;
- crear exactamente una Membership en este Business;
- no revelar las relaciones del User con otros Businesses.

Los campos de identidad enviados para una operación de alta sólo pueden usarse para crear un User inexistente. Si el User ya existe, el resultado debe usar su identidad canónica sin realizar overwrite silencioso.

### 12.3 User ya posee Membership en este Business

No crear otra Membership.

Si la intención es habilitar como profesional a un admin/owner existente, debe utilizarse la mutación de `isBookable` sobre la Membership existente.

Para un intento genérico de alta duplicada, responder conflicto tenant-local estable.

### 12.4 No enumeración global

La API administrativa no debe ofrecer un endpoint de `¿existe este email globalmente?` como paso previo.

El lookup ocurre dentro de la operación autorizada de alta. Las respuestas no deben distinguir innecesariamente:

```text
"email existe globalmente en otro tenant"
```

de:

```text
"se creó una nueva identidad"
```

cuando esa diferencia no sea necesaria para completar la operación.

Sí puede informarse un conflicto si ya existe una Membership **en el Business actual**, porque ese hecho pertenece al tenant autorizado.

## 13. Discovery público

El contrato público de 6.2.6-A/6.2.6-B se conserva.

`GET /api/users/workers` sigue siendo una superficie pública/headless. No debe reutilizarse como lectura administrativa de Equipo.

La elegibilidad pública futura de una persona para un Service debe exigir conceptualmente:

```text
Business solicitado existe y está activo
AND User existe y está activo
AND Membership(User, Business) existe
AND Membership.isActive === true
AND Membership.isBookable === true
AND Service existe, está activo y pertenece al mismo Business
AND Service incluye al User como profesional asignado
AND cualquier otra condición vigente del contrato público
```

No usar como sustitutos:

```text
User.role
User.business
Business.owner
```

### 13.1 Public projection

La proyección pública mínima de 6.2.6-A (`id`, `firstName`, `lastName`) no necesita ampliarse para exponer `role`, email, owner status ni `isBookable`.

La capacidad se usa como criterio interno de elegibilidad, no como metadata pública necesaria.

### 13.2 Availability

`GET /api/availability/slots` deberá reutilizar el mismo predicado canónico de profesional elegible y no implementar una segunda interpretación de `isBookable`.

Una persona no agendable debe fallar como recurso profesional no disponible, aunque conserve Shift/Block históricos o aparezca todavía en un array legacy de `Service.workers`.

### 13.3 Creación de Appointment

La creación pública e interna debe volver a validar la elegibilidad profesional en el momento de reservar. Una selección obtenida antes de que `isBookable` fuera deshabilitado no concede derecho a crear una Appointment después de la revocación.

Las Appointments históricas existentes no se invalidan ni borran por deshabilitar agendabilidad.

## 14. Servicios

`Service.workers` es actualmente una allowlist de User IDs. En la implementación futura puede seguir cumpliendo esa función siempre que la aceptación de un User en esa lista y toda lectura pública revaliden:

```text
mismo Business
+ Membership activa
+ isBookable === true
```

La mera presencia de un User ID en `Service.workers` nunca concede:

- Membership;
- autoridad;
- agendabilidad;
- acceso a otro tenant.

La UI de Servicios queda fuera de este PR y se abordará después de Equipo.

## 15. Horarios y disponibilidad

### 15.1 Decisión

Crear una persona en Equipo **no debe publicar disponibilidad accidentalmente**.

La cadena contractual es:

```text
participación tenant
-> capacidad agendable explícita
-> asignación explícita a Service
-> horario/disponibilidad explícitos
-> reserva pública posible
```

Cada paso es necesario y ninguno sustituye al siguiente.

### 15.2 Retiro del auto-horario legacy

Antes de habilitar la futura creación funcional de Equipo, debe retirarse del flujo de alta la inicialización automática de:

```text
lunes-viernes 09:00-18:00
break 13:00-14:00
sábado/domingo cerrado
```

No se deben asumir horarios comerciales genéricos.

La ausencia de Shift continúa significando ausencia de slots abiertos/fail-closed.

### 15.3 Shifts y Blocks existentes

La migración no necesita borrar Shift/Block para miembros que dejen de ser agendables. Pueden conservarse como configuración/historial tenant-scoped, pero:

```text
Shift existente
AND isBookable !== true
=> cero elegibilidad pública
```

Lo mismo aplica a Blocks: modifican disponibilidad de un profesional elegible, pero nunca crean elegibilidad.

## 16. Contrato administrativo futuro

La futura superficie de Equipo debe ser autenticada, tenant-scoped y separada del endpoint público.

Se recomienda una superficie conceptual del tipo:

```text
/api/internal/team
```

pero este documento no congela paths ni los implementa.

Requisitos independientemente del path final:

- `scopeBusiness` o frontera equivalente server-owned;
- sesión autenticada;
- revalidación de User/Business/Membership vigentes;
- mutaciones sólo con `Membership.role = "admin"` u otra política explícita futura;
- lookups del objetivo siempre acotados al Business mediante Membership;
- no confiar en IDs globales aislados;
- no aceptar `businessId` del body como autoridad sobre otro tenant;
- no usar endpoint público como backend de la pantalla Equipo.

La lectura administrativa debe poder representar roles `admin` y `worker`, miembros activos e inactivos y `isBookable` en ambos roles.

## 17. Seguridad multitenant

### 17.1 Regla de mutación

Un admin de Business A sólo puede mutar la Membership cuyo `business == A`.

Conocer `userId` o `membershipId` de B no autoriza:

- habilitar/deshabilitar agendabilidad;
- cambiar acceso;
- asignar Service;
- crear Shift/Block;
- inferir si esa identidad participa en B.

### 17.2 Lookup por email

La búsqueda global por email es una implementación interna para resolver identidad, no una API de directorio global.

No retornar:

- cantidad de Businesses;
- nombres/slugs de otros Businesses;
- roles en otros Businesses;
- si el User es owner de otro Business;
- `User.business` legacy;
- cualquier correlación innecesaria cross-tenant.

### 17.3 Autoridad del caller

El backend debe revalidar `Membership.role` del caller en cada mutación. Un `role=admin` copiado en sesión no sobrevive a una revocación o cambio de Membership.

### 17.4 Owner

`Business.owner` puede servir para presentación o reglas de continuidad explícitamente documentadas, pero nunca para saltarse una Membership admin activa.

### 17.5 Último admin / auto-desactivación

Este contrato no diseña todavía transferencia de propiedad ni administración avanzada. Hasta que exista una política explícita, la futura mutación debe fallar cerrado ante operaciones que dejarían al Business sin una vía administrativa válida o cuya seguridad dependa de una regla no definida.

No se debe improvisar esa decisión usando `Business.owner` como bypass.

## 18. Compatibilidad y migración futura

La introducción de `Membership.isBookable` requiere una fase funcional/migratoria explícita. No debe aparecer como cambio incidental de schema.

### 18.1 Principio

La transición será:

```text
inventario
-> plan determinista
-> migración explícita
-> verificación
-> cutover
-> una única fuente canónica
```

No:

```text
nuevo campo opcional
+ fallback por role para siempre
```

### 18.2 Inventario obligatorio

Antes de mutar datos, auditar por Business:

- todas las Memberships `role="worker"`;
- todas las Memberships `role="admin"`;
- Memberships activas/inactivas;
- Users activos/inactivos;
- `User.role` legacy;
- `User.business` legacy;
- `Business.owner`;
- `Service.workers`;
- Shift existentes;
- Block existentes;
- Appointment históricas;
- seeds/fixtures/tests que crean Membership directamente.

### 18.3 Reglas de backfill propuestas

La migración podrá usar semántica legacy **sólo como regla de conversión one-shot**, nunca como fallback runtime permanente.

Propuesta fail-closed:

1. Membership inactiva -> `isBookable=false`.
2. User inactivo -> `isBookable=false`.
3. Membership activa `role="worker"` -> candidato legacy a `isBookable=true`, sujeto a validación de coherencia tenant.
4. Membership activa `role="admin"` -> `isBookable=false` por defecto.
5. Admin actualmente referenciado por `Service.workers` -> caso de revisión explícita; no inferir automáticamente por `Business.owner`.
6. Referencias cross-tenant/inválidas en `Service.workers`, Shift o Block -> hallazgo; no conceden bookability.
7. `User.role` y `User.business` no participan en la decisión canónica de backfill salvo como evidencia de deuda a reportar.

Dado el estado productivo inmediatamente posterior a PR #33 —owners admin, cero workers artificiales, cero servicios/citas creados por bootstrap— la futura migración productiva no necesita inventar profesionales para esos owners. Deben permanecer `isBookable=false` hasta una acción explícita.

### 18.4 Verificación previa al cutover

La fase migratoria debe probar, como mínimo:

- todas las Memberships poseen booleano canónico;
- no existen duplicados `User + Business`;
- el índice físico único sigue presente y correcto;
- ninguna Membership inactiva queda `isBookable=true` tras la política adoptada;
- ninguna referencia cross-tenant se transforma en elegibilidad;
- los Services sólo producen profesionales mediante el nuevo predicado;
- fixtures y seeds dejan de depender de `role="worker"` como bookability implícita.

### 18.5 Cutover

Después de verificar storage:

- `professionalEligibility` debe exigir `isBookable === true`;
- discovery público debe usar ese predicado;
- Availability debe usar el mismo predicado;
- Service allowlists deben validarlo;
- creación administrativa debe persistirlo explícitamente;
- el flujo legacy de auto-horarios debe quedar retirado;
- el listado Equipo debe dejar de filtrar exclusivamente `role="worker"`;
- el fallback por role debe eliminarse en el mismo ciclo de cutover.

## 19. Pruebas obligatorias de la futura implementación

La implementación funcional no será aceptable sin regresiones que cubran, como mínimo:

1. **admin no agendable:** `role=admin`, `isBookable=false` no aparece públicamente.
2. **admin agendable:** `role=admin`, `isBookable=true` puede aparecer cuando además cumple Service y demás condiciones.
3. **habilitar no cambia rol:** `false -> true` conserva `Membership.role`.
4. **deshabilitar no revoca admin:** `true -> false` conserva Membership activa y acceso admin.
5. **worker no agendable:** conserva acceso tenant permitido por su rol pero no aparece públicamente.
6. **Membership inactiva:** nunca aparece públicamente aunque existan referencias en Service/Shift.
7. **User inactivo:** nunca aparece públicamente.
8. **User.role contradictorio:** no cambia autoridad tenant ni agendabilidad.
9. **User.business contradictorio/ausente:** no cambia autoridad tenant ni agendabilidad.
10. **Business.owner solo:** no vuelve agendable a nadie.
11. **unicidad:** no puede crearse una segunda Membership para el mismo `User + Business`.
12. **mutación cross-tenant:** admin A no altera `isBookable` ni Membership de B.
13. **profesional cross-tenant:** profesional A no aparece en B.
14. **Service cross-tenant:** Service A no descubre profesional de B.
15. **sin disponibilidad automática:** crear/habilitar profesional no crea Shift ni abre slots públicos.
16. **desactivar acceso conserva historia:** Appointments y recursos históricos necesarios permanecen íntegros; participación deja de ser efectiva.
17. **sin hard delete ordinario:** la UI normal no ofrece ni invoca hard delete.
18. **lectura administrativa separada:** Equipo no depende de `GET /api/users/workers` público.
19. **contrato 6.2.6 preservado:** headless/CORS/origin y proyección pública continúan vigentes.
20. **owner admin + profesional:** misma Membership `admin + isBookable=true`, sin duplicado.

Además deben añadirse regresiones para:

21. desactivar Membership fuerza `isBookable=false` y una reactivación posterior no la restablece implícitamente;
22. `Service.workers` stale no vence `isBookable=false`;
23. Shift existente no vence `isBookable=false`;
24. Block existente no crea elegibilidad;
25. Appointment histórica no concede bookability futura;
26. alta con email de User global existente no cambia password ni nombre global;
27. alta con User global existente no revela sus otros Businesses;
28. conflicto same-Business es estable y no crea duplicados;
29. lectura Equipo puede representar admin/worker, activo/inactivo y bookable/no-bookable;
30. errores DB/infraestructura no se degradan silenciosamente a lista vacía.

## 20. Relación con ADR-001 y contratos anteriores

ADR-001 permanece como autoridad para identidad global y autoridad multitenant.

Este documento añade una precisión normativa:

```text
Membership.role
= clase de autoridad/acceso tenant

Membership.isBookable
= capacidad operacional tenant-scoped de ser considerado profesional agendable
```

Ambos viven en la misma relación `User + Business`, pero son conceptos ortogonales.

6.2.6-A permanece como contrato headless mínimo para Services, profesionales, slots y booking guest.

6.2.6-B permanece como contrato de public origin verificado. La trust pública no concede session/admin authority ni cambia estas reglas.

## 21. Fuera de alcance

Este PR no implementa:

- schema `isBookable`;
- migración/backfill;
- endpoints nuevos;
- cambios a Membership runtime;
- componentes React;
- vista Equipo funcional;
- creación/edición funcional de trabajadores;
- Servicios UI;
- Horarios UI;
- disponibilidad UI;
- Clientes;
- Seguimiento;
- Reportes;
- reglas de negocio;
- pagos;
- nuevas reservas públicas;
- autenticación nueva;
- invitaciones por email;
- reset de contraseña;
- roles nuevos;
- permisos granulares;
- soporte mutable;
- cambios de superadmin;
- multi-sucursal;
- branding/rediseño visual;
- responsive 7.8;
- cambios Railway;
- cambios en MongoDB productivo;
- seeds o migraciones productivas.

## 22. Orden propuesto de implementación funcional

### A. Storage y predicado canónico de agendabilidad

- añadir `Membership.isBookable`;
- diseñar migración one-shot + verificación + cutover;
- actualizar eligibility canónica;
- retirar fallback por role y auto-horarios legacy;
- preservar índice único.

Esta etapa debe ser pequeña y revisable antes de construir UI.

### B. Endpoints administrativos tenant-safe

- listado Equipo separado del endpoint público;
- alta/reutilización de identidad sin enumeración global;
- habilitar/deshabilitar bookability;
- desactivar Membership de forma fail-closed;
- respuestas estables y aislamiento cross-tenant.

### C. UI Equipo

- estados loading/error/empty;
- listado mínimo;
- añadir profesional;
- `También presto servicios` para admin/owner;
- habilitar/deshabilitar reservas;
- desactivar acceso cuando corresponda;
- sin hard delete ordinario.

### D. Servicios

- administración de Service;
- asignación explícita de profesionales bookable;
- validación del predicado canónico.

### E. Horarios / disponibilidad

- edición real de Shift/Block;
- ninguna disponibilidad genérica automática;
- Availability reutiliza eligibility canónica.

### F. Primera reserva productiva end-to-end

Sólo después de cerrar Equipo, Servicios y Horarios debe habilitarse/verificarse el primer flujo productivo real completo:

```text
Equipo configurado
-> profesional agendable
-> Service asignado
-> Shift explícito
-> discovery público
-> slots
-> Appointment
```

## 23. Respuestas normativas inequívocas

### ¿Qué significa ser miembro de un Business?

Que existe exactamente una `Membership(User, Business)`. La Membership representa participación tenant; `isActive` determina si esa participación está vigente y `role` define su clase de autoridad/acceso.

### ¿Qué significa ser profesional agendable?

Que la Membership de ese User en ese Business posee explícitamente `isBookable=true`. Esto no basta por sí solo para ofrecer slots: también deben cumplirse Service y disponibilidad.

### ¿Es `role="worker"` equivalente a profesional?

No. `worker` queda como rol tenant legacy/no-admin. Puede ser `isBookable=true` o `false`.

### ¿Puede un admin/owner ser profesional?

Sí. Debe conservar una única Membership con `role="admin"` y `isBookable=true`.

### ¿Puede un admin/owner no prestar servicios?

Sí. `role="admin"`, `isBookable=false` es un estado normal.

### ¿Qué ocurre al dejar de recibir reservas?

Sólo se deshabilita `isBookable`. La Membership permanece activa, el rol no cambia, la identidad no se borra y el historial se conserva.

### ¿Qué ocurre al desactivar acceso?

La Membership queda inactiva y `isBookable=false`. Se revoca participación tenant y la persona deja de ser elegible públicamente, preservando datos históricos.

### ¿Qué vuelve públicamente seleccionable a una persona?

La conjunción de Business/User/Membership activos, `isBookable=true`, Service válido del mismo Business con asignación explícita y las demás condiciones del contrato público. Ninguna propiedad legacy sustituye esa conjunción.

### ¿Qué fuente decide autoridad tenant?

`Membership.role` de una Membership activa revalidada desde persistencia.

### ¿Qué fuente decide agendabilidad configurada?

`Membership.isBookable` de esa misma relación tenant, con valor explícitamente `true`.

### ¿Debe existir una segunda Membership para un owner profesional?

No. Está prohibido por contrato y por el índice físico único.

### ¿Crear un profesional abre horarios automáticamente?

No. La futura implementación debe eliminar ese comportamiento legacy. La disponibilidad requiere configuración explícita posterior.

### ¿Puede la UI usar hard delete como “eliminar trabajador”?

No. Hard delete queda fuera de la superficie ordinaria de Equipo.

### ¿Puede el panel usar el endpoint público de workers?

No. Debe usar una superficie administrativa autenticada y tenant-scoped distinta.

## 24. Criterio de cierre documental

Esta definición queda lista para revisión adversarial cuando el lector puede distinguir sin ambigüedad:

```text
identidad global
participación tenant
rol/autoridad tenant
agendabilidad
asignación a Service
horario/disponibilidad
reserva
```

Ninguno de esos conceptos debe volver a colapsarse bajo la palabra `worker`.

La siguiente fase no debe comenzar implementando UI directamente: primero debe materializar y migrar de forma segura la fuente canónica de agendabilidad, luego exponer las operaciones administrativas tenant-safe y recién después construir Equipo.