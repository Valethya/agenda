# Contrato inicial de administración de Equipo y agendabilidad

**Proyecto:** ATMÓSFERA Agenda
**Estado:** definición documental inicial; implementación funcional pendiente
**Fecha:** 23 de agosto de 2026
**Baseline verificada:** `master@5743bdb9fa530bb3f989893fe6ebdf1a3caa07ad`
**Precedente operativo:** PR #33 `feat(ops): add one-shot production owner bootstrap`, merged en la baseline anterior
**Ámbito:** Equipo, autoridad tenant y capacidad operacional de ser profesional agendable
**Naturaleza:** exclusivamente documental

Este documento especializa ADR-001 para separar de forma explícita la **autoridad tenant** de la **capacidad operacional de ser agendable**. No implementa schemas, rutas, migraciones, UI, servicios, horarios, disponibilidad, onboarding ni reservas nuevas.

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

Además, el alta de una nueva participación tenant debe mantener separadas:

```text
email declarado por un admin
!=
identidad global demostrada por la persona
!=
Membership autorizada en un Business
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

La superficie del panel ya está separada del discovery público, pero la semántica frontend sigue acoplando `worker` con `Professional`.

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

Ese endpoint interno actual es una lectura operacional de workers y **no queda adoptado como contrato de la futura superficie administrativa Team**. Su proyección y autorización no deben reutilizarse ciegamente para exponer email, miembros inactivos, rol administrativo, owner status o metadata de Membership.

### 2.3 Creación actual

`Server/src/services/user.service.js#createWorker()` actualmente:

1. busca un `User` global por email;
2. si no existe, crea `User`;
3. para un User nuevo persiste todavía valores legacy `User.role = "worker"` y `User.business = businessId`;
4. crea una única `Membership` con `role = "worker"`;
5. rechaza si ya existe cualquier Membership para ese `User + Business`;
6. inicializa automáticamente horarios lunes-viernes 09:00-18:00, descanso 13:00-14:00 y fin de semana cerrado;
7. para un User nuevo exige y persiste una contraseña porque `User.password` continúa siendo un campo físico obligatorio.

Ese comportamiento describe el runtime legacy, **no** el contrato futuro de Equipo. En particular:

```text
admin escribe email E
-> findByEmail(E) encuentra User
-> crear Membership
```

queda explícitamente rechazado como semántica futura. El hecho de que un email coincida con un `User` global no demuestra que la persona que el admin pretende incorporar sea la identidad global correspondiente ni autoriza materializar autoridad tenant.

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

Por ello un admin nunca aparece en ese listado aunque esté legítimamente asignado a servicios. Además, no representa el contrato admin-only de Team definido en este documento.

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

Estos recursos pueden seguir referenciando la identidad global `User` siempre que cada operación revalide el predicado correcto para su propósito. En particular, **crear nuevas reservas** y **operar Appointments ya asignadas** son decisiones distintas: `isBookable` participa en la primera y no debe revocar retroactivamente la segunda mientras la Membership siga activa y las demás políticas de acceso se cumplan.

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
19. Autenticación, participación tenant y agendabilidad son fronteras distintas: `Membership`/`isBookable` nunca sustituyen una credencial de autenticación ni autorizan a un admin a inventar una contraseña permanente para otra persona.
20. Mientras no exista transferencia de propiedad explícita, la Membership del `Business.owner` y el último admin activo están protegidos contra desactivación desde la superficie ordinaria de Equipo.
21. `User.email` match no es trusted identity binding y nunca basta para crear Membership.
22. Un `User` global preexistente no puede recibir Membership en un Business sólo porque un admin escribió un email coincidente.
23. La primera superficie funcional de Team sólo administra Memberships ya existentes en el Business; incorporar una nueva participación tenant queda detrás del onboarding seguro futuro.
24. La lectura administrativa de Team es `admin`-only y se impone server-side.
25. `isBookable=false` impide nuevas reservas, pero no revoca por sí solo las capacidades válidas sobre Appointments ya asignadas.
26. `Membership.isActive=false` sí revoca la autoridad operacional tenant asociada a esa Membership.

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

> ¿Puede esta persona ser considerada como profesional seleccionable para prestar servicios y recibir nuevas reservas dentro de este Business?

Es una capacidad operacional tenant-scoped y ortogonal al rol.

### 4.5 Booking eligibility

**Booking eligibility** responde si una persona puede participar en discovery, Service allowlist para nuevas reservas, availability y creación de una nueva Appointment.

Conceptualmente exige:

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

### 4.6 Existing Appointment actor capability

**Existing Appointment actor capability** responde si un profesional puede operar una Appointment que ya está asignada a ese User.

No es equivalente a booking eligibility. Debe exigir, como mínimo:

```text
Business activo
AND User activo
AND Membership activa del User en ese Business
AND Appointment pertenece al mismo Business
AND Appointment.worker corresponde a ese User
AND coherencia Service/Appointment requerida
AND política tenant/transición de estado vigente
```

No debe exigir `Membership.isBookable === true`.

### 4.7 Propiedad

**Owner** sigue siendo `Business.owner`. Es metadata de propiedad y puede mostrarse en la superficie Team admin-only, pero no autoriza mutaciones ni vuelve agendable al User.

### 4.8 Onboarding

**Onboarding tenant** es el proceso futuro mediante el cual una persona que aún no posee Membership en un Business demuestra/acepta de forma suficiente la incorporación y sólo entonces obtiene exactamente una Membership.

No se infiere por coincidencia de email y no se congela aquí su mecanismo físico.

## 5. Separación autoridad / agendabilidad

La matriz mínima válida es:

| Membership.role | Agendable | Semántica |
| --- | --- | --- |
| `admin` | `false` | admin/owner administrativo que no recibe nuevas reservas |
| `admin` | `true` | admin/owner que además puede recibir nuevas reservas |
| `worker` | `true` | participante no-admin que puede recibir nuevas reservas |
| `worker` | `false` | participante no-admin con acceso tenant pero fuera de nuevas reservas |

Ninguno de estos estados requiere una segunda Membership.

Reglas de no equivalencia:

```text
role == admin    != not bookable
role == worker   != bookable
isBookable       != admin authority
Business.owner   != isBookable
Service.workers  != Membership
Shift exists     != isBookable
Appointment.worker == User != future booking eligibility
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

Ese requisito no existe hoy. Crear una entidad separada añadiría otra cardinalidad, join y lifecycle sin necesidad actual.

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
- acceder a recursos no autorizados;
- leer u operar Appointments que no estén autorizadas por su propio contrato.

La autorización sigue dependiendo de `Membership.role`, `Membership.isActive` y la política del recurso/endpoint.

### 6.5 Ausencia del campo

Después del cutover funcional, sólo el valor explícito:

```text
isBookable === true
```

concede booking eligibility configurada.

`undefined`, `null`, campo ausente o valores inválidos deben tratarse como **no agendable / fail-closed** durante la transición. Tras la migración verificada no deben quedar Memberships sin valor canónico.

No se autoriza un fallback productivo permanente como:

```js
membership.isBookable ?? membership.role === "worker"
```

## 7. Contrato de la futura vista Equipo

La vista Equipo representa Memberships del Business, no sólo `role="worker"`.

### 7.1 Frontera de lectura administrativa: admin-only

La superficie que expone el DTO administrativo de Team debe exigir server-side, en cada request:

```text
scopeBusiness
+ sesión autenticada
+ User activo
+ Business activo
+ Membership activa del caller en ese Business
+ Membership.role === "admin"
```

No basta con ocultar la pantalla o el menú en frontend.

Un `worker` ordinario no obtiene mediante esta superficie:

- emails de compañeros;
- teléfonos;
- miembros inactivos;
- owner metadata administrativa;
- Membership IDs innecesarios;
- roles/metadata global de User;
- información de otros Businesses.

Si Calendario u otra función necesita una lista operacional de profesionales, debe usar una **superficie/proyección distinta**, tenant-scoped y mínima. Esa proyección operacional no reutiliza el DTO administrativo Team y no debe exponer email, teléfono, miembros inactivos ni metadata administrativa.

La futura Team tampoco debe reutilizar ciegamente `getWorkersList()` ni asumir que el comportamiento actual de `GET /api/internal/users/workers` constituye esta lectura administrativa.

### 7.2 Acceso / autoridad

Como mínimo, Team admin puede representar:

- Membership activa o inactiva;
- rol tenant actual;
- si la identidad posee capacidad administrativa conforme al rol vigente.

La UI puede mostrar una etiqueta de owner si `Business.owner` coincide, pero esa etiqueta es informativa y nunca sustituye la autorización backend.

### 7.3 Agendabilidad

Como mínimo:

- recibe nuevas reservas / no recibe nuevas reservas;
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

### 7.4 Datos mínimos por fila/tarjeta administrativa

El DTO administrativo mínimo puede presentar:

- `membershipId` cuando sea necesario para la mutación administrativa;
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
- `User.business`;
- `User.role` global;
- password/hash/reset tokens;
- metadata global innecesaria.

La respuesta debe derivarse de Memberships del Business ya seleccionado y no de una búsqueda global de Users presentada al cliente.

## 8. Estados de UI futuros

### 8.1 Loading

Mostrar estado de carga sin asumir lista vacía. No habilitar mutaciones hasta conocer contexto tenant y autoridad actuales.

### 8.2 Error

Mostrar error estable y opción de reintento. No degradar un error de autorización, DB o red a `equipo vacío`.

### 8.3 Equipo vacío

Representa cero Memberships visibles según la política de la superficie, no fallo de carga.

### 8.4 Miembro activo

Mostrar rol y estado de agendabilidad como atributos separados.

### 8.5 Miembro inactivo

Puede conservarse en la proyección administrativa admin-only para contexto/historial operacional. No posee acceso tenant efectivo ni puede aparecer públicamente como profesional.

La primera UI no necesita implementar reactivación si esa operación todavía no está contratada.

### 8.6 Profesional agendable

Mostrar `recibe reservas` sólo como capacidad configurada. No prometer disponibilidad real si no posee Service + horario compatible.

### 8.7 Miembro no agendable

Mostrar que mantiene el acceso que corresponda a su Membership, pero no debe ser elegible para nuevas reservas.

### 8.8 Owner/admin agendable

Mostrar simultáneamente su condición administrativa/owner y `recibe reservas`, sin crear otro registro de participación.

### 8.9 Owner/admin no agendable

Estado válido y esperado. Ser owner/admin no genera inconsistencia.

### 8.10 Acción cross-tenant

Debe fallar cerrado desde backend. La UI recibe una respuesta estable sin información sobre la existencia real del objetivo en otro Business.

### 8.11 Conflicto same-Business

Si una operación actúa sobre una persona que ya posee Membership en el Business, nunca se crea otra Membership. La UI debe operar sobre la Membership existente.

### 8.12 Onboarding requerido

La primera UI funcional no incorpora una nueva participación tenant. Si se ofrece una acción futura de `Añadir persona`, ésta permanece bloqueada hasta existir onboarding seguro.

Si se conserva el nombre conceptual `TEAM_ONBOARDING_REQUIRED`, debe significar únicamente:

> esta persona todavía no completó onboarding para este Business.

No puede significar ni permitir inferir:

> no existe un User global con este email.

La misma respuesta/semántica de inicio debe aplicarse aunque el email ya corresponda o no a una cuenta global.

## 9. Acciones mínimas de la primera UI funcional

Antes de implementar onboarding seguro, la primera superficie funcional de Equipo debe limitarse a Memberships **ya existentes** en el Business:

1. listar Team para un caller admin;
2. habilitar como profesional a un admin/owner ya miembro (`También presto servicios`);
3. habilitar recepción de nuevas reservas;
4. deshabilitar recepción de nuevas reservas;
5. desactivar acceso tenant cuando corresponda y sólo si las guardas de continuidad administrativa lo permiten.

Queda fuera de esta primera superficie:

```text
admin escribe email
-> resolver User global
-> crear Membership
```

independientemente de que el `User` global exista o no exista.

No debe incluir hard delete ni edición completa de identidad, permisos granulares, invitaciones, fotografías, biografías, comisiones, sucursales, especialidades avanzadas, payroll, RRHH ni métricas de equipo.

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

El owner/admin conserva acceso administrativo y propiedad. Esta mutación de bookability sí está permitida para el owner; la prohibición de desactivación de acceso no impide activar o desactivar su agendabilidad.

## 11. Lifecycle de miembro y profesional

Los ejes deben evolucionar de forma separada.

### 11.1 Participación ya existente

La primera superficie de Team parte de:

```text
User global
+ Membership(User, Business) ya materializada por un flujo autorizado
```

y administra `isBookable`/acceso sobre esa relación. No crea Membership a partir de email match.

### 11.2 Habilitar agendabilidad

Precondiciones mínimas:

- User activo;
- Business activo;
- Membership existente del mismo Business;
- Membership activa;
- caller con Membership admin activa del mismo Business.

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

No cambia `role`, no desactiva Membership, no elimina identidad, no borra Services/Shifts/Blocks/Appointments históricos ni modifica `Appointment.worker`.

Desde el instante en que la mutación es efectiva, booking eligibility falla cerrado para nuevas selecciones/reservas de esa persona.

**No revoca por sí sola existing Appointment actor capability.** Mientras User, Business y Membership sigan activos y la Appointment continúe asignada/coherente, el profesional conserva las operaciones permitidas por la política de la Appointment ya existente.

### 11.4 Desactivar acceso tenant

Mutación conceptual permitida sólo cuando las guardas de continuidad administrativa de 17.5 se cumplen:

```text
Membership.isActive = false
Membership.isBookable = false
```

La desactivación de acceso debe apagar también la capacidad configurada en la misma operación o unidad de consistencia.

La desactivación:

- revoca participación y autoridad operacional tenant derivadas de esa Membership;
- corta también existing Appointment actor capability basada en esa Membership;
- no elimina User global;
- no borra Appointments históricas;
- no borra por defecto Shift/Block/Service associations históricas;
- impide discovery y availability efectiva;
- requiere una acción futura explícita para volver a habilitar agendabilidad.

No puede ejecutarse desde la primera superficie ordinaria contra la Membership del `Business.owner` ni contra el último admin activo.

### 11.5 Reactivación futura — decisión pendiente explícita

No forma parte de las acciones mínimas de esta primera UI.

Queda pendiente definir qué ocurre, al reactivar una Membership, con configuraciones preservadas como:

- `Service.workers`;
- `Shift`;
- `Block`.

La única regla congelada ahora es:

```text
reactivar Membership
!=
reactivar isBookable automáticamente
```

Tampoco puede existir un fallback automático que convierta referencias preservadas de Service/Shift/Block en bookability. Esa política deberá definirse explícitamente antes de implementar reactivación.

### 11.6 Hard delete

Queda fuera de la UI ordinaria de Equipo.

El endpoint legacy `DELETE /api/users/workers/:id?hard=true` no debe convertirse en una acción normal de la futura pantalla. Cualquier lifecycle destructivo futuro requerirá contrato explícito separado, análisis de referencias históricas y autorización reforzada.

## 12. Incorporación de nueva participación y frontera de onboarding

### 12.1 Regla de seguridad

Una persona que todavía no posee Membership en el Business **no puede recibirla únicamente porque un admin introdujo un email**, aunque ese email coincida con un `User` global existente.

Regla congelada:

```text
User.email match != trusted identity binding
User existente != autorización para conceder Membership
```

Esto se justifica además por el runtime histórico: el registro global no demuestra necesariamente control previo del email y existen contactos legacy con provenance guest no verificada. Por tanto, ni la mera existencia de User ni la coincidencia de email constituyen evidence suficiente para materializar autoridad tenant.

### 12.2 Primera superficie antes de onboarding

Mientras onboarding seguro no exista, Team no crea Memberships para personas nuevas en el Business.

No hay bifurcación:

```text
si User existe -> Membership inmediata
si User no existe -> onboarding
```

Ambos casos permanecen detrás del mismo límite de onboarding.

### 12.3 Semántica futura uniforme

El futuro onboarding debe presentar al admin una semántica uniforme independientemente de si el email ya pertenece a una cuenta global:

```text
admin inicia onboarding para email E
-> respuesta estable no revela si E corresponde a User global
-> destinatario demuestra control / acepta onboarding según contrato futuro
-> servidor resuelve de forma segura identidad existente o crea identidad nueva
-> sólo entonces crea exactamente una Membership(User, Business)
```

No se congela en este PR el mecanismo físico de invitación, token, challenge, autenticación o delivery.

### 12.4 Prohibiciones

No se permite:

- `email match -> Membership inmediata`;
- `User preexistente -> Membership inmediata`;
- endpoint previo de enumeración global por email;
- respuesta que permita distinguir innecesariamente cuenta existente/no existente;
- admin conoce o elige la contraseña de la persona;
- contraseña temporal compartida o predecible;
- convertir contacto legacy guest no verificado en autoridad tenant;
- usar `User.role`, `User.business` o `Business.owner` como atajo de onboarding.

### 12.5 Estado onboarding-required

Si una implementación futura conserva `TEAM_ONBOARDING_REQUIRED` o nombre equivalente, su semántica es tenant-local:

> la incorporación de esta persona a este Business todavía no ha completado el onboarding requerido.

No es un oracle de existencia global de `User`.

### 12.6 Materialización de Membership

La Membership sólo se crea después de la aceptación/proof definida por el futuro contrato de onboarding y debe seguir respetando:

- exactamente una Membership por `User + Business`;
- rol tenant explícito;
- estado activo explícito;
- `isBookable` explícito/fail-closed;
- no overwrite silencioso de password/nombre global;
- no exposición de otras Memberships o Businesses.

## 13. Booking eligibility y discovery público

El contrato público de 6.2.6-A/6.2.6-B se conserva.

`GET /api/users/workers` sigue siendo una superficie pública/headless. No debe reutilizarse como lectura administrativa de Equipo.

### 13.1 Predicado de booking eligibility

Para discovery público, availability, validación de Service allowlist para nuevas reservas y creación de una nueva Appointment, la persona debe satisfacer conceptualmente:

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
Appointment histórica
```

### 13.2 Public projection

La proyección pública mínima de 6.2.6-A (`id`, `firstName`, `lastName`) no necesita ampliarse para exponer `role`, email, owner status ni `isBookable`.

### 13.3 Availability y nueva Appointment

`GET /api/availability/slots` y la creación de nuevas Appointments deben reutilizar un predicado canónico de booking eligibility.

Una persona no agendable debe fallar como profesional disponible para **nuevas** reservas, aunque conserve Shift/Block históricos, aparezca en un array legacy de `Service.workers` o tenga Appointments históricas.

Una selección obtenida antes de que `isBookable` fuera deshabilitado no concede derecho a crear una Appointment después de la revocación.

## 14. Existing Appointment actor capability

Deshabilitar únicamente:

```text
isBookable: true -> false
```

no debe revocar por sí solo el acceso operacional legítimo a Appointments ya asignadas.

Un profesional con `Membership.isBookable=false` puede continuar, cuando la política de transición lo permita:

- viendo sus Appointments existentes;
- confirmándolas;
- completándolas;
- cancelándolas;
- viendo timeline u otra información ya autorizada para esa Appointment.

Ese acceso debe seguir exigiendo:

```text
User activo
+ Business activo
+ Membership activa del User en ese Business
+ Appointment.business coherente
+ Appointment.worker coherente con el actor cuando aplique
+ Service/Appointment coherentes
+ política tenant y de transición de estado vigente
```

No debe exigir `isBookable=true`.

Desactivar `Membership.isActive` sí revoca esta autoridad operacional tenant. Un admin con `isBookable=false` conserva sus capacidades admin porque éstas derivan de `Membership.role="admin"`, no de bookability.

La implementación futura no debe reutilizar un único helper de `professional eligibility` para booking eligibility y existing Appointment actor capability si hacerlo convierte `isBookable` en una revocación retroactiva de acceso a citas ya asignadas.

Cambiar `isBookable` nunca modifica `Appointment.worker` ni reescribe historial.

## 15. Servicios

`Service.workers` es actualmente una allowlist de User IDs. Para incorporar o mantener a alguien como opción para **nuevas reservas**, la implementación futura debe validar booking eligibility del mismo Business.

La mera presencia de un User ID en `Service.workers` nunca concede:

- Membership;
- autoridad;
- agendabilidad;
- acceso a otro tenant;
- existing Appointment actor capability fuera de una Appointment coherente.

La UI de Servicios queda fuera de este PR y se abordará después de Equipo/onboarding.

## 16. Horarios y disponibilidad

### 16.1 Decisión

Crear una participación o habilitar bookability **no debe publicar disponibilidad accidentalmente**.

La cadena contractual para nuevas reservas es:

```text
participación tenant
-> capacidad agendable explícita
-> asignación explícita a Service
-> horario/disponibilidad explícitos
-> reserva pública posible
```

Cada paso es necesario y ninguno sustituye al siguiente.

### 16.2 Retiro del auto-horario legacy

Antes de habilitar el futuro flujo funcional que incorpore profesionales, debe retirarse la inicialización automática de:

```text
lunes-viernes 09:00-18:00
break 13:00-14:00
sábado/domingo cerrado
```

No se deben asumir horarios comerciales genéricos. La ausencia de Shift continúa significando ausencia de slots abiertos/fail-closed.

### 16.3 Shifts y Blocks existentes

La migración o deshabilitación de bookability no necesita borrar Shift/Block. Pueden conservarse como configuración/historial tenant-scoped, pero:

```text
Shift existente
AND isBookable !== true
=> cero booking eligibility
```

Blocks modifican disponibilidad de un profesional elegible, pero nunca crean elegibilidad.

## 17. Contrato administrativo futuro

### 17.1 Team admin

La superficie administrativa Team debe ser distinta de la pública y de cualquier proyección operacional de workers/profesionales.

Independientemente del path final, la lectura y mutaciones administrativas de Team deben exigir server-side:

```text
scopeBusiness
+ sesión autenticada
+ User activo
+ Business activo
+ Membership activa del caller
+ Membership.role === "admin"
```

La superficie debe:

- resolver objetivos por Membership del Business;
- no confiar en IDs globales aislados;
- no aceptar `businessId` del body como autoridad sobre otro tenant;
- no usar `GET /api/users/workers` público como backend de Team;
- no reutilizar ciegamente `GET /api/internal/users/workers`/`getWorkersList()` como DTO administrativo;
- poder representar admin/worker, activo/inactivo y bookable/no-bookable sólo para callers admin.

### 17.2 Proyección operacional para workers

Si un worker necesita profesionales visibles para Calendario u otra operación, debe existir una proyección distinta y mínima.

Esa superficie:

- sigue tenant-scoped;
- exige la autoridad operacional correspondiente;
- no devuelve email/phone;
- no incluye miembros inactivos;
- no expone owner metadata administrativa;
- no expone Membership IDs salvo necesidad operacional explícita;
- no expone `User.role` global, `User.business` ni metadata global innecesaria.

La existencia de esta proyección no concede acceso a Team admin.

### 17.3 Frontend no es enforcement

Ocultar Equipo para workers, deshabilitar botones o filtrar datos en React nunca sustituye estas comprobaciones backend.

## 18. Seguridad multitenant

### 18.1 Regla de mutación

Un admin de Business A sólo puede mutar Memberships cuyo `business == A`.

Conocer `userId` o `membershipId` de B no autoriza:

- habilitar/deshabilitar agendabilidad;
- cambiar acceso;
- asignar Service;
- crear Shift/Block;
- inferir si esa identidad participa en B.

### 18.2 Onboarding y no correlación global

El inicio futuro de onboarding no debe convertirse en un directorio global.

Dos Businesses no deben poder usar esa superficie para correlacionar si el mismo email corresponde a una identidad global existente. Las respuestas iniciales deben ser estables respecto de existencia/no existencia de cuenta y no revelar:

- cantidad de Businesses;
- nombres/slugs de otros Businesses;
- roles en otros Businesses;
- ownership en otros Businesses;
- `User.business` legacy;
- otras Memberships.

### 18.3 Autoridad del caller

El backend debe revalidar `Membership.role` del caller en cada operación Team. Un `role=admin` copiado en sesión no sobrevive a una revocación o cambio de Membership.

### 18.4 Owner

`Business.owner` puede servir para presentación admin-only y para la guarda de continuidad de 18.5, pero nunca para saltarse una Membership admin activa ni autorizar por sí mismo una mutación.

### 18.5 Owner actual / último admin / desactivación

La primera superficie de Equipo adopta una política fail-closed explícita mientras no exista transferencia de propiedad:

1. La Membership correspondiente al `Business.owner` **no puede desactivarse** desde Equipo.
2. El último `Membership.role="admin"` activo del Business **no puede desactivarse**, aunque no coincida con `Business.owner`.
3. Un admin no-owner sólo puede desactivarse si permanece al menos otro admin activo válido después de la operación.
4. El caller debe conservar una Membership admin activa y válida durante la mutación.
5. La Membership objetivo debe pertenecer exactamente al Business autenticado.
6. Las comprobaciones son server-side; esconder un botón frontend no constituye enforcement.
7. La operación debe fallar cerrada ante estado ambiguo, lectura inconsistente o carrera que impida demostrar las precondiciones.
8. `Business.owner` no concede autoridad al caller: sólo identifica un objetivo protegido por continuidad.
9. No se implementa transferencia de propiedad en esta fase.

Estas restricciones sólo protegen la desactivación de acceso. La bookability del owner puede cambiar independientemente sin modificar `Business.owner`, `Membership.role` ni `Membership.isActive`.

## 19. Compatibilidad y migración futura

La introducción de `Membership.isBookable` requiere una fase funcional/migratoria explícita. No debe aparecer como cambio incidental de schema.

### 19.1 Principio

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

### 19.2 Inventario obligatorio

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

### 19.3 Reglas de backfill propuestas

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

### 19.4 Verificación previa al cutover

La fase migratoria debe probar, como mínimo:

- todas las Memberships poseen booleano canónico;
- no existen duplicados `User + Business`;
- el índice físico único sigue presente y correcto;
- ninguna Membership inactiva queda `isBookable=true`;
- ninguna referencia cross-tenant se transforma en elegibilidad;
- booking eligibility usa el nuevo predicado;
- existing Appointment actor capability no queda condicionado por `isBookable`;
- fixtures y seeds dejan de depender de `role="worker"` como bookability implícita.

### 19.5 Cutover

Después de verificar storage:

- discovery público debe exigir `isBookable === true`;
- Availability/nuevas reservas deben usar booking eligibility;
- Service allowlists para nuevas reservas deben validarlo;
- la superficie Team debe operar sólo sobre Memberships existentes hasta cerrar onboarding;
- el flujo legacy de auto-horarios debe quedar retirado;
- el listado Team debe dejar de filtrar exclusivamente `role="worker"`;
- el fallback por role debe eliminarse en el mismo ciclo de cutover;
- las operaciones sobre Appointments existentes deben conservar su predicado separado sin `isBookable`.

El cutover de bookability **no autoriza** `email match -> Membership` para ningún User existente o inexistente.

## 20. Pruebas obligatorias de la futura implementación

La implementación funcional no será aceptable sin regresiones que cubran, como mínimo:

1. `admin`, `isBookable=false` no aparece en discovery público.
2. `admin`, `isBookable=true` puede aparecer cuando además cumple Service y demás condiciones.
3. Habilitar bookability no cambia `Membership.role`.
4. Deshabilitar bookability no revoca acceso admin.
5. Worker activo `isBookable=false` conserva acceso tenant permitido pero no aparece en discovery ni recibe nuevas citas.
6. Membership inactiva nunca aparece públicamente.
7. User inactivo nunca aparece públicamente.
8. `User.role` contradictorio no cambia autoridad tenant ni agendabilidad.
9. `User.business` contradictorio/ausente no cambia autoridad tenant ni agendabilidad.
10. `Business.owner` por sí solo no vuelve agendable a nadie.
11. No puede existir segunda Membership para el mismo `User + Business`.
12. Admin A no altera `isBookable` ni Membership de B.
13. Profesional A no aparece en B.
14. Service A no descubre profesional de B.
15. Habilitar profesional no crea Shift ni abre slots automáticamente.
16. Desactivar acceso conserva historial y revoca participación efectiva.
17. Hard delete no está disponible en la UI ordinaria.
18. Team admin no depende del endpoint público de workers.
19. El contrato headless/CORS/origin 6.2.6-A/B permanece vigente.
20. Owner puede ser admin + profesional con una sola Membership.
21. Desactivar Membership fuerza `isBookable=false`; reactivación futura no lo restablece implícitamente.
22. `Service.workers` stale no vence `isBookable=false`.
23. Shift existente no vence `isBookable=false`.
24. Block existente no crea booking eligibility.
25. Appointment histórica nunca vuelve bookable a una persona.
26. Cambiar `isBookable` no altera `Appointment.worker` ni historial.
27. Worker activo + `isBookable=false` conserva las operaciones permitidas sobre Appointments ya asignadas.
28. `Membership.isActive=false` sí revoca existing Appointment actor capability tenant.
29. Admin + `isBookable=false` conserva capacidades admin.
30. Un helper de booking eligibility no puede usarse para revocar retroactivamente Appointments existentes.
31. Worker no puede leer el DTO administrativo Team.
32. Admin A sólo lee Team A.
33. Team admin no retorna password, reset tokens, `User.business` ni `User.role` global.
34. La proyección operacional para workers no expone email, phone, inactivos ni owner metadata administrativa.
35. Ocultar Team en frontend no sustituye enforcement backend.
36. Pre-registrar un email ajeno nunca permite adquirir Membership cuando un admin intenta incorporar ese email.
37. Un contacto legacy guest no verificado nunca se transforma en autoridad tenant por email match.
38. El inicio de onboarding no permite distinguir User global existente de inexistente.
39. Membership sólo se materializa después de la aceptación/proof definida por el contrato futuro de onboarding.
40. Dos Businesses no pueden correlacionar existencia de una identidad global mediante la superficie de onboarding.
41. Un `User` global preexistente sin Membership tampoco recibe Membership inmediata por email match.
42. El mismo estado onboarding-required, si existe, describe onboarding tenant pendiente y no existencia global de User.
43. La Membership del owner actual no puede desactivarse desde Team mientras no exista transferencia de ownership.
44. El último admin activo no puede desactivarse.
45. Un segundo admin no-owner puede desactivarse sólo si permanece otro admin activo válido.
46. Cambiar bookability del owner no modifica ownership, role ni acceso.
47. Una carrera que cambia owner/admin-count durante la desactivación falla cerrada o se serializa preservando invariantes.
48. Errores DB/infraestructura de Team no se degradan silenciosamente a lista vacía.

## 21. Relación con ADR-001 y contratos anteriores

ADR-001 permanece como autoridad para identidad global y autoridad multitenant.

Este documento añade una precisión normativa:

```text
Membership.role
= clase de autoridad/acceso tenant

Membership.isBookable
= capacidad operacional tenant-scoped para nuevas reservas
```

Ambos viven en la misma relación `User + Business`, pero son conceptos ortogonales.

La incorporación de una nueva participación tenant constituye una frontera adicional. `User.email` match, existencia global de User, `User.role`, `User.business` o `Business.owner` no autorizan materializar Membership.

6.2.6-A permanece como contrato headless mínimo para Services, profesionales, slots y booking guest.

6.2.6-B permanece como contrato de public origin verificado. La trust pública no concede session/admin authority ni cambia estas reglas.

## 22. Fuera de alcance

Este PR no implementa:

- schema `isBookable`;
- migración/backfill;
- endpoints nuevos;
- cambios a Membership runtime;
- componentes React;
- vista Equipo funcional;
- onboarding de nueva participación;
- invitaciones por email;
- reset de contraseña;
- email delivery de onboarding;
- transferencia de ownership;
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
- roles nuevos;
- permisos granulares;
- soporte mutable;
- cambios de superadmin;
- multi-sucursal;
- branding/rediseño visual;
- responsive 7.8;
- cambios Railway/Vercel;
- cambios en MongoDB productivo;
- seeds o migraciones productivas.

## 23. Orden propuesto de implementación funcional

### A. Storage y contrato de bookability

- añadir `Membership.isBookable`;
- diseñar migración one-shot + verificación + cutover;
- separar booking eligibility de existing Appointment actor capability;
- retirar fallback por role y auto-horarios legacy;
- preservar índice único.

### B. Endpoints administrativos para Memberships ya existentes

- lectura Team admin-only separada de público y de proyección operacional;
- habilitar/deshabilitar bookability sobre Membership existente;
- `También presto servicios` sobre admin/owner existente;
- desactivar Membership con guardas owner/último-admin;
- aislamiento cross-tenant y respuestas estables.

**B no crea Memberships nuevas por email ni reutiliza User global por email match.**

### C. Onboarding seguro para incorporar nueva participación tenant

Antes de permitir cualquier alta nueva en Team:

- definir proof/aceptación suficiente del destinatario;
- garantizar semántica uniforme para User existente/no existente;
- impedir enumeración y correlación global;
- resolver de forma segura identidad existente o crear identidad nueva sólo después del onboarding;
- crear exactamente una Membership recién después de completar ese contrato;
- definir expiración/single-use/revocación/replay/concurrencia si el mecanismo físico utiliza material temporal.

Este PR no congela el mecanismo físico.

### D. UI Equipo

La UI funcional se construye sobre B. Antes de C sólo administra Memberships existentes:

- loading/error/empty;
- listado admin-only;
- `También presto servicios`;
- habilitar/deshabilitar nuevas reservas;
- desactivar acceso con guardas;
- sin hard delete ordinario.

La acción de incorporar una persona nueva sólo se habilita cuando C exista y haya sido revisado.

### E. Servicios

- administración de Service;
- asignación explícita de profesionales con booking eligibility;
- validación del predicado canónico.

### F. Horarios / disponibilidad

- edición real de Shift/Block;
- ninguna disponibilidad genérica automática;
- Availability usa booking eligibility.

### G. Primera reserva productiva end-to-end

Sólo después de cerrar Equipo, onboarding necesario, Servicios y Horarios debe verificarse el primer flujo productivo real completo:

```text
Membership válida
-> profesional agendable
-> Service asignado
-> Shift explícito
-> discovery público
-> slots
-> Appointment
```

## 24. Respuestas normativas inequívocas

### ¿Qué significa ser miembro de un Business?

Que existe exactamente una `Membership(User, Business)`. `isActive` determina si esa participación está vigente y `role` define su clase de autoridad/acceso.

### ¿Qué significa ser profesional agendable?

Que la Membership posee explícitamente `isBookable=true` y además se cumplen las demás condiciones para nuevas reservas.

### ¿Es `role="worker"` equivalente a profesional?

No. Puede ser `isBookable=true` o `false`.

### ¿Puede un admin/owner ser profesional?

Sí. Conserva una única Membership con `role="admin"` y `isBookable=true`.

### ¿Qué ocurre al dejar de recibir reservas?

Se deshabilita `isBookable`. La Membership permanece activa, el rol no cambia, la identidad y el historial se conservan. Las nuevas reservas se bloquean, pero no se revoca por ese solo hecho la operación permitida sobre Appointments ya asignadas.

### ¿Qué ocurre al desactivar acceso?

Cuando la operación está permitida, la Membership queda inactiva y `isBookable=false`. Se revoca participación y autoridad operacional tenant, incluidas capacidades sobre Appointments existentes basadas en esa Membership, preservando historial.

### ¿Puede desactivarse al Business.owner o al último admin desde la primera Team?

No. Permanecen protegidos por las guardas de continuidad definidas en 18.5.

### ¿Puede un admin añadir directamente a una persona escribiendo su email?

No. Mientras esa persona no posea Membership en el Business, la incorporación pertenece al onboarding futuro. La coincidencia con un User global existente no cambia esta regla.

### ¿Qué significa `TEAM_ONBOARDING_REQUIRED` si se conserva?

Que el onboarding de esa persona para ese Business no está completado. No revela si existe una cuenta global para el email.

### ¿Qué vuelve públicamente seleccionable a una persona?

Booking eligibility: Business/User/Membership activos, `isBookable=true`, Service válido/asignado y demás condiciones del contrato público.

### ¿`isBookable=false` revoca las citas ya asignadas?

No. Existing Appointment actor capability se evalúa por separado y no exige `isBookable=true`; sí exige Membership activa y coherencia/autorización de la Appointment.

### ¿Qué fuente decide autoridad tenant?

`Membership.role` de una Membership activa revalidada desde persistencia.

### ¿Qué fuente decide bookability configurada?

`Membership.isBookable` de esa misma relación tenant, con valor explícitamente `true`.

### ¿Debe existir una segunda Membership para un owner profesional?

No. Está prohibido por contrato y por el índice físico único.

### ¿Habilitar un profesional abre horarios automáticamente?

No. La disponibilidad requiere configuración explícita posterior.

### ¿Puede Team usar hard delete?

No. Hard delete queda fuera de la superficie ordinaria.

### ¿Puede un worker leer Team admin?

No. Si necesita información operacional de profesionales, consume una proyección mínima distinta.

### ¿Qué ocurre al reactivar una Membership en el futuro?

La política sobre `Service.workers`/Shifts/Blocks preservados queda pendiente. Lo único congelado es que reactivar Membership no reactiva `isBookable` automáticamente ni usa esas referencias como fallback de agendabilidad.

## 25. Criterio de cierre documental

Esta definición queda lista para revisión adversarial cuando el lector puede distinguir sin ambigüedad:

```text
identidad global
onboarding de nueva participación tenant
participación tenant
rol/autoridad tenant
bookability para nuevas reservas
asignación a Service
horario/disponibilidad
existing Appointment actor capability
reserva
```

Ninguno de esos conceptos debe volver a colapsarse bajo la palabra `worker` ni bajo una coincidencia de email.

La secuencia funcional propuesta es deliberada: primero storage/bookability; después endpoints admin para Memberships ya existentes; luego onboarding seguro; recién entonces alta de nuevas personas en UI Equipo; después Servicios, Horarios/Disponibilidad y la primera reserva productiva end-to-end.
