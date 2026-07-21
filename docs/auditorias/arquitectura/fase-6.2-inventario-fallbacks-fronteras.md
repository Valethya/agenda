# Fase 6.2 — Inventario de fallbacks y fronteras multitenant

**Proyecto:** ATMÓSFERA Agenda

**Estado:** Preparación técnica; sin cambios de comportamiento

**Fecha:** 21 de julio de 2026

**Base revisada:** `master` después del merge del PR #3 (`377f54d`)

## 1. Objetivo

Localizar todas las decisiones implícitas de negocio y las fronteras relacionadas que podrían anular el aislamiento tenant. Este documento separa:

1. fallbacks que pertenecen directamente a 6.2.1;
2. problemas de ownership o autoridad descubiertos durante el rastreo;
3. defaults legítimos que pueden conservarse;
4. pruebas que deben existir antes de modificar el comportamiento.

Este inventario no autoriza todavía migraciones, cambios de modelos ni una reescritura general de autorización.

## 2. Contrato objetivo

### Solicitudes públicas tenant-scoped

- Deben identificar de forma explícita un negocio mediante un identificador admitido por el contrato.
- Negocio ausente o identificadores contradictorios producen un error de validación determinista.
- Identificador mal formado produce `400`.
- Negocio inexistente, inactivo o inaccesible no selecciona otro tenant.
- Ningún orden de inserción en MongoDB puede alterar el negocio resuelto.

### Solicitudes autenticadas de administrador o trabajador

- Utilizan exclusivamente el negocio activo de una sesión validada.
- Query, body o headers no pueden sustituir el negocio de la sesión.
- La sesión debe corresponder a una `Membership` activa.

### Superadministración

- Las rutas de plataforma permanecen fuera de `scopeBusiness`.
- Una operación tenant-scoped del superadministrador requiere selección explícita.
- Un negocio ausente o inválido nunca cae en el primer negocio activo.

### Identificadores simultáneos

- Durante la transición, una solicitud puede entregar ID y slug sólo si ambos resuelven al mismo negocio.
- Valores contradictorios o duplicados con distinto contenido producen `400`.
- La evolución del contrato headless asignará una fuente canónica por tipo de consumidor y retirará las fuentes redundantes con compatibilidad documentada.

### Negocio inactivo

- En una solicitud pública se responde `404` con un mensaje genérico, sin revelar nombre, suspensión ni configuración.
- Un miembro autenticado cuya sesión apunta al negocio recibe `403`, permitiendo a la interfaz explicar que su acceso no está disponible.
- La superadministración consulta y cambia el estado únicamente mediante rutas de plataforma explícitas.

## 3. Superficie afectada por `scopeBusiness`

El middleware se aplica globalmente a estas familias:

| Prefijo | Flujos relevantes | Tipo |
|---|---|---|
| `/services` | listado, detalle y administración de servicios | Público y autenticado |
| `/availability` | slots, turnos y bloqueos | Público y autenticado |
| `/appointments` | reserva, consulta y transiciones | Público y autenticado |
| `/payments` | inicio y retorno de Webpay | Público |
| `/users` | profesionales y administración de equipo | Público y autenticado |
| `/business-settings` | configuración, métricas y analítica | Público y autenticado |

Una corrección en el middleware cambia simultáneamente todos estos prefijos. Por eso las pruebas deben cubrir rutas representativas públicas, autenticadas y de superadministración.

## 4. Hallazgos directos de fallback

### FB-01 — Selección del primer negocio cuando falta tenant

**Ubicación:** `Server/src/middleware/business.middleware.js`, función `scopeBusiness`.

**Comportamiento actual:** si no existe `businessId` ni slug, invoca `businessRepository.findFirstActive()` y continúa con ese documento.

**Alcance:** todas las rutas incluidas en la tabla anterior cuando no entra la rama de admin/worker autenticado.

**Riesgo:** P0. Una solicitud incompleta se convierte en una operación válida sobre un tenant determinado por el orden de la base de datos.

**Corrección de 6.2.1:** eliminar el fallback y devolver un error de validación estable.

### FB-02 — Fallback de superadministrador ante negocio inexistente

**Ubicación:** `Server/src/middleware/business.middleware.js`, rama posterior a la búsqueda por ID o slug.

**Comportamiento actual:** si el identificador no resuelve y la sesión es `superadmin`, selecciona el primer negocio activo.

**Riesgo:** P0. Un error de escritura puede ejecutar la operación en un negocio distinto al solicitado.

**Corrección de 6.2.1:** responder como negocio inexistente; el privilegio global no convierte un identificador inválido en otro tenant.

### FB-03 — Slug `barberia` inyectado por el API client

**Ubicación:** `Client/src/services/api.ts`, `FALLBACK_BUSINESS_SLUG` y `getBusinessSlug()`.

**Comportamiento actual:** todas las solicitudes del cliente agregan `x-business-slug: barberia` cuando la URL no contiene slug, incluso llamadas globales como login, sesión o superadministración.

**Riesgo:** P0 para llamadas tenant-scoped. Oculta la ausencia de contexto y hace que el backend reciba una selección que el usuario no realizó.

**Corrección de 6.2.1:** retornar ausencia cuando no exista slug y agregar el header sólo si hay un contexto explícito. Las rutas globales deben seguir funcionando sin header; las tenant-scoped serán rechazadas por el backend si falta negocio.

### FB-04 — Slug de pago sustituido por `barberia`

**Ubicaciones:**

- `Server/src/services/payment.service.js` al construir `returnUrl`;
- `Server/src/controllers/payment.controller.js` al procesar retorno y errores.

**Comportamiento actual:** si no puede resolverse el negocio o falta el slug de query, la redirección utiliza `barberia`.

**Riesgo:** P1 por destino y marca incorrectos; puede crecer a P0 si la página usa parámetros no confiables para exponer o gestionar información.

**Tratamiento:** no conservar el fallback. El retorno debe derivar negocio y destino desde el pago persistido o una credencial correlacionada, nunca desde una query manipulable. La solución completa pertenece a 6.3.3, 6.3.4 y al ADR-002.

## 5. Ambigüedades del contrato de entrada

### IN-01 — Múltiples fuentes con precedencia silenciosa

`scopeBusiness` acepta `businessId` y slug desde query, body y headers. Actualmente:

- `businessId` tiene precedencia sobre slug;
- query tiene precedencia sobre body y body sobre header;
- valores contradictorios no producen error.

**Riesgo:** P1. Distintas capas pueden creer que autorizaron negocios diferentes.

**Decisión propuesta para 6.2.1:** una solicitud representa un único tenant lógico. Si entrega más de un identificador, todos deben resolver al mismo negocio o la solicitud se rechaza. A medio plazo el contrato headless deberá escoger una fuente canónica por tipo de consumidor.

### IN-02 — `businessId` sin validación previa en el middleware

Un ID mal formado llega a `Business.findById()` antes de la validación específica de cada ruta y puede convertirse en un error de Mongoose no operacional.

**Riesgo:** P1. Respuesta `500` o comportamiento inconsistente ante entrada inválida.

**Corrección de 6.2.1:** validar el formato antes de consultar y devolver `400`.

## 6. Fronteras adyacentes descubiertas

Estos hallazgos no son fallbacks, pero pueden neutralizar la corrección de 6.2.1. Deben recibir pruebas negativas y mantenerse abiertos para sus etapas correspondientes.

### FR-01 — La reserva ignora el negocio resuelto por el middleware

`appointment.controller.js` no pasa `req.businessId` a `bookAppointment()`. El servicio vuelve a derivar el negocio desde el servicio solicitado.

**Hipótesis que debe probarse:** una solicitud declara negocio A, pero entrega servicio y profesional de B; el sistema puede crear la cita en B.

**Riesgo:** P0. El contexto explícito de la API podría no limitar la operación.

**Etapa:** 6.2.4, con una guarda temprana incorporada en el cierre real de 6.2.1 si la prueba confirma el bypass.

### FR-02 — Servicios por ID no incluyen ownership

Detalle, actualización y eliminación consultan `Service.findById(id)`. `updateService()` recibe `businessId`, pero sólo lo usa para detectar colisiones de nombre; `deleteService()` ni siquiera lo recibe.

**Riesgo:** P0. Admin A podría leer, modificar o eliminar un servicio de B conociendo su ID.

**Etapa:** 6.2.4.

### FR-03 — Citas autorizadas por rol sin verificar negocio

Confirmar, completar, cancelar y consultar detalles cargan la cita por ID. Para un usuario con rol `admin`, varias políticas conceden acceso sin comparar `appointment.business` con el negocio activo.

**Riesgo:** P0. Un administrador de A podría operar una cita de B por ID.

**Etapas:** 6.2.4 y 6.3.1.

### FR-04 — Turnos y bloqueos carecen de frontera tenant

Los repositorios consultan por trabajador, día o ID sin negocio. Un administrador puede modificar trabajadores ajenos porque el controlador comprueba el rol, no la membresía del profesional en el negocio activo.

**Riesgo:** P0.

**Etapas:** 6.2.3 y 6.2.4; requiere migración antes de imponer el campo obligatorio.

### FR-05 — Disponibilidad consulta autoridad heredada del usuario

`availability.service.js` intenta comprobar `worker.business` sólo cuando el campo existe. Esto no representa correctamente a un profesional con múltiples membresías y omite la validación cuando el campo heredado está ausente.

**Riesgo:** P0.

**Etapas:** 6.2.2–6.2.4.

### FR-06 — Inicio de pago público autorizado sólo por appointment ID

El middleware resuelve un negocio, pero `initiatePayment()` carga la cita por ID y no compara su negocio ni exige propiedad o credencial de acción.

**Riesgo:** P0.

**Etapa:** 6.3.2. Debe añadirse prueba de rechazo antes de modificar el flujo.

## 7. Defaults revisados que no son fallbacks tenant productivos

| Patrón | Clasificación | Motivo |
|---|---|---|
| `memberships[0]` en `resolveSessionFromUser()` | Permitido con prueba | Sólo se ejecuta después de comprobar que existe exactamente una membresía activa. |
| Slug `barberia` en seeds y migraciones nominales | Permitido y explícito | Son herramientas dirigidas a un dataset concreto; no resuelven tenant durante una petición. |
| Etiquetas visuales por defecto | Deuda P2 | No conceden acceso, aunque deben moverse a configuración en 7.9. |
| Branding genérico cuando un correo no tiene negocio | Deuda P1 | Evita fallar una notificación, pero debe desaparecer de flujos que contractualmente requieren tenant. |
| Configuración local explícita de desarrollo | Permitido | Debe estar aislada del comportamiento de producción y documentada. |

## 8. Pruebas requeridas antes de implementar 6.2.1

### Middleware y rutas públicas

1. `GET /services` sin negocio responde `400` y no devuelve servicios del primer negocio.
2. Slug inexistente responde `404` y no cae en otro negocio.
3. `businessId` mal formado responde `400`.
4. Negocio inactivo responde según la política pública acordada y nunca expone otro tenant.
5. Identificadores contradictorios se rechazan.
6. Slug válido de A devuelve únicamente recursos de A.
7. Cambiar el orden de creación de A y B no cambia ningún resultado.

### Sesiones

8. Admin A no puede sustituir su negocio mediante query, body o headers.
9. Worker A tampoco puede sustituir el negocio de su sesión.
10. Superadmin sin selección tenant recibe error en rutas tenant-scoped.
11. Superadmin con slug inexistente recibe `404` y nunca opera en A o B.

### Frontend

12. `getBusinessSlug()` no inventa un slug cuando la URL no lo contiene.
13. `apiFetch()` no agrega `x-business-slug` a una llamada global sin tenant.
14. Una llamada tenant-scoped sin contexto termina en un error explícito, no en `barberia`.

### Guardas contra bypass adyacente

15. Reservar con slug A y servicio o profesional de B se rechaza.
16. Admin A no consulta, modifica ni elimina un servicio de B.
17. Admin A no confirma, completa ni cancela una cita de B.
18. Iniciar pago para una cita ajena o de otro negocio se rechaza.

Los casos 15–18 pueden permanecer rojos de forma documentada únicamente en una rama local de diagnóstico. No deben publicarse como CI obligatorio hasta acompañarse de la corrección acotada correspondiente.

## 9. Secuencia de implementación recomendada

### PR 6.2.1-A — Contrato de resolución tenant

- pruebas 1–14;
- eliminar `findFirstActive()` del runtime HTTP;
- eliminar el fallback especial de superadministrador;
- validar formato y conflictos de identificadores;
- eliminar `FALLBACK_BUSINESS_SLUG` del cliente;
- conservar rutas globales sin header tenant;
- actualizar fixtures que dependían del primer negocio.

### PR 6.2.1-B — Guardas mínimas de coherencia

- pasar `req.businessId` a disponibilidad y reserva;
- rechazar servicio o profesional que no pertenezca al negocio resuelto;
- añadir las pruebas negativas confirmadas durante el inventario;
- no introducir todavía la migración de turnos y bloqueos.

### Trabajos posteriores

- 6.2.2: reemplazar autoridad heredada por `Membership`.
- 6.2.3: migrar turnos y bloqueos para incluir negocio.
- 6.2.4: aplicar `{ _id, business }` en repositorios y servicios.
- 6.3: centralizar políticas de citas y pagos.

## 10. Criterio de salida de la preparación

- [x] Fallbacks runtime localizados y clasificados.
- [x] Superficie de rutas afectadas documentada.
- [x] Defaults legítimos separados de decisiones tenant.
- [x] Bypasses adyacentes registrados sin mezclarlos en una sola implementación.
- [x] Matriz de pruebas definida.
- [x] Contrato transitorio de identificadores múltiples definido: deben resolver al mismo tenant.
- [x] Política de negocio inactivo definida: `404` público, `403` para miembro autenticado.
- [ ] Estrategia de migración de turnos y bloqueos aprobada.

La implementación acotada de 6.2.1 puede comenzar. La migración de datos continúa bloqueada hasta disponer de estrategia, respaldo y verificación específicos.
