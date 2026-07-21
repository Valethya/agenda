# Plan maestro de cierre de Fase 6 y preparación de Fase 7

**Proyecto:** ATMÓSFERA Agenda
**Estado del documento:** Propuesta para aprobación
**Fecha de revisión:** 20 de julio de 2026
**Alcance:** Backend, multitenencia, seguridad, pagos, impersonación, frontend, pruebas y operación

## 1. Objetivo

Este documento transforma la revisión integral del proyecto en un plan de cambios verificable. Su propósito es cerrar correctamente la Fase 6 antes de continuar con el refactor de frontend de la Fase 7.

La recomendación central es no avanzar directamente con la tarea 7.2. Primero se debe completar una etapa de endurecimiento 6.1–6.4 para corregir fronteras de seguridad, autorización y aislamiento multitenant que un refactor del frontend no resolvería.

## 2. Principios de ejecución

Cada cambio deberá seguir este orden:

1. Documentar el comportamiento esperado y las decisiones relevantes.
2. Agregar o corregir pruebas que demuestren el problema y el resultado esperado.
3. Implementar el cambio con el menor alcance posible.
4. Ejecutar pruebas, análisis estático y build.
5. Actualizar la auditoría con resultados reproducibles.
6. Realizar un commit acotado y descriptivo.

No se considerará terminada una tarea solamente porque el código compile. Cada tarea debe cumplir su criterio de aceptación y contar con evidencia de verificación.

## 3. Resumen de prioridades

| Prioridad | Área | Motivo |
|---|---|---|
| P0 | Aislamiento multitenant | Existen operaciones que pueden consultar o modificar recursos por ID sin verificar siempre el negocio propietario. |
| P0 | Autoridad de roles y membresías | `User.role`/`User.business` y `Membership` compiten como fuentes de permisos. |
| P0 | Impersonación | La sesión principal se reemplaza, todas las pestañas comparten el cambio y la atribución de auditoría es incompleta. |
| P0 | Pagos y propiedad de citas | El inicio de pago es público y las transiciones distribuidas no son atómicas ni completamente idempotentes. |
| P1 | Pruebas y CI | El comando oficial no ejecuta todas las suites y no existe una barrera automatizada de integración. |
| P1 | Sesiones y CSRF | Las cookies cross-site requieren protección explícita para operaciones mutables. |
| P1 | Dependencias | La auditoría encontró vulnerabilidades conocidas en dependencias directas y transitivas. |
| P1 | Tipado frontend | El build funciona, pero la primera ejecución reproducible del análisis estático detectó 8 errores y 5 sugerencias. |
| P2 | Refactor frontend | Es necesario, pero debe realizarse después de estabilizar contratos y límites de autorización. |

## 4. Etapa 6.1 — Base verificable

### 6.1.1 Ejecutar todas las suites desde el comando oficial

**Cambio necesario**

- Modificar los scripts del backend para ejecutar pruebas API, integración, pagos, sesiones, validaciones, correo y WebSocket.
- Separar, si resulta útil, los comandos `test:unit`, `test:integration` y `test:all`.
- Asegurar que el comando usado en CI sea el mismo utilizado para declarar el cierre de una fase.

**Por qué es necesario**

Actualmente `npm test` solamente ejecuta `api.test.js` e `integration.test.js`. Las pruebas de pagos, seguridad WebSocket y varias pruebas unitarias quedan fuera del resultado oficial. Esto permite que una regresión pase inadvertida aunque el comando principal termine correctamente.

**Criterio de aceptación**

- Una sola orden ejecuta todas las suites relevantes.
- El número de suites y casos aparece en el informe de cierre.
- Un fallo en cualquier suite produce un código de salida distinto de cero.

### 6.1.2 Corregir fixtures y modelos de prueba

**Cambio necesario**

- Corregir el fixture que asigna al cliente una membresía con rol `worker`.
- Crear negocios, administradores, trabajadores y clientes con relaciones que representen el modelo real.
- Incorporar fixtures específicos para usuarios con múltiples membresías.

**Por qué es necesario**

Un fixture con permisos incorrectos puede ocultar defectos de autorización. Las pruebas deben reproducir el comportamiento real que se desea proteger.

**Criterio de aceptación**

- Cada identidad de prueba tiene únicamente los permisos definidos para su rol.
- Las pruebas fallan si un cliente adquiere permisos administrativos o de trabajador accidentalmente.

### 6.1.3 Crear integración continua

**Cambio necesario**

Crear un pipeline que ejecute, como mínimo:

1. instalación limpia y reproducible;
2. pruebas completas del backend;
3. análisis estático del frontend;
4. build de producción;
5. auditoría de dependencias;
6. comprobación de que no se incluyan secretos.

**Por qué es necesario**

Sin CI, el estado del proyecto depende del entorno local y de verificaciones manuales. Esto aumenta el riesgo de publicar commits incompletos.

**Criterio de aceptación**

- Todo pull request muestra verificaciones automáticas.
- No se permite integrar una rama con pruebas, tipado o build fallidos.

### 6.1.4 Recuperar instalaciones reproducibles

**Cambio necesario**

- Sincronizar `package.json` y `package-lock.json` en cliente y servidor.
- Incorporar como dependencias de desarrollo las herramientas requeridas por `astro check`.
- Documentar versiones soportadas de Node y npm.

**Por qué es necesario**

Una instalación que funciona solamente por paquetes presentes localmente no puede reproducirse de forma confiable en CI o producción.

**Criterio de aceptación**

- `npm ci` funciona en ambos proyectos desde directorios limpios.
- `npm run check` y `npm run build` no dependen de instalaciones manuales adicionales.

### 6.1.5 Validar configuración al iniciar

**Cambio necesario**

- Validar variables obligatorias mediante un esquema.
- Exigir un `SESSION_SECRET` independiente.
- Eliminar el uso de `PASSWORD_MONGO` como secreto de sesión.
- Unificar los valores de frontend, backend, CORS, SMTP y Webpay en el módulo de configuración.

**Por qué es necesario**

Los fallbacks silenciosos pueden iniciar el servidor con una configuración insegura o inconsistente. El controlador de pagos, por ejemplo, utiliza un puerto frontend distinto al módulo central.

**Criterio de aceptación**

- El proceso falla inmediatamente con un mensaje claro si falta una variable crítica.
- Los controladores y servicios no leen directamente variables que ya pertenecen a la configuración central.

## 5. Etapa 6.2 — Modelo y aislamiento multitenant

### 6.2.1 Eliminar la selección implícita del primer negocio

**Cambio necesario**

- Requerir un `businessId` o slug válido en toda ruta pública dependiente de un negocio.
- Para usuarios autenticados, utilizar exclusivamente el negocio activo de la sesión validada.
- Rechazar slugs o IDs inexistentes, incluso para superadministradores.
- Reservar cualquier negocio predeterminado únicamente para fixtures o configuración explícita de desarrollo.

**Por qué es necesario**

Seleccionar el primer negocio activo convierte una petición incompleta en una operación válida sobre un tenant no elegido por el usuario. También hace que el comportamiento dependa del orden de los documentos en la base de datos.

**Criterio de aceptación**

- Una solicitud sin negocio recibe un error determinista.
- Un slug inválido nunca se redirige silenciosamente a otro negocio.

### 6.2.2 Hacer que `Membership` sea la autoridad de acceso

**Cambio necesario**

- Utilizar la membresía activa para resolver rol y negocio.
- Reservar el rol global del usuario para privilegios de plataforma, como `superadmin`.
- Dejar de autorizar mediante `User.business` y roles heredados.
- Planificar una migración antes de eliminar campos antiguos.

**Por qué es necesario**

Dos fuentes de autoridad pueden entregar resultados diferentes para la misma persona. Esto es especialmente peligroso para usuarios que pertenecen a más de un negocio.

**Criterio de aceptación**

- Toda autorización tenant-scoped obtiene rol y negocio desde una membresía activa.
- Desactivar una membresía revoca el acceso sin modificar al usuario global.

### 6.2.3 Añadir negocio a turnos y bloqueos

**Cambio necesario**

- Añadir `business` como campo obligatorio en `Shift` y `Block`.
- Cambiar el índice de turnos a `{ business, worker, dayOfWeek }`.
- Cambiar las consultas de bloqueos a `{ business, worker, date }`.
- Crear una migración controlada para documentos existentes.

**Por qué es necesario**

El horario de un profesional puede variar por negocio. Con el modelo actual, un trabajador con múltiples membresías comparte un único horario global y sus bloqueos no poseen frontera tenant.

**Criterio de aceptación**

- Un profesional puede tener horarios diferentes en dos negocios.
- Un negocio no puede consultar, modificar ni eliminar turnos o bloqueos del otro.

### 6.2.4 Aplicar ownership en repositorios y servicios

**Cambio necesario**

- Reemplazar búsquedas tenant-scoped por ID puro con consultas `{ _id, business }`.
- Aplicar el patrón a servicios, citas, pagos, turnos, bloqueos, configuraciones y auditorías.
- Pasar `businessId` explícitamente desde el controlador hasta el repositorio.

**Por qué es necesario**

Comprobar solamente que el usuario es administrador no demuestra que el recurso pertenezca a su negocio. El filtro debe formar parte de la consulta, evitando lecturas y escrituras cruzadas por ID.

**Criterio de aceptación**

- Todos los endpoints por ID poseen pruebas de aislamiento entre negocio A y negocio B.
- Un ID válido de otro negocio responde como recurso inaccesible y nunca se modifica.

### 6.2.5 Definir el modelo de cuentas cliente

**Decisión necesaria**

Definir formalmente una de estas alternativas:

1. el cliente es global y sus citas se relacionan con distintos negocios;
2. el cliente posee una membresía específica por negocio;
3. existe un perfil global y perfiles tenant-scoped complementarios.

**Problemas que deben resolverse**

- `/register` crea cuentas sin membresía, pero el login las rechaza.
- Los clientes invitados reciben una contraseña aleatoria que no conocen.
- Google puede crear usuarios sin membresía.
- La asociación automática por teléfono puede unir identidades por error.

**Por qué es necesario**

Sin esta decisión no es posible definir correctamente login, historial de citas, privacidad ni deduplicación de usuarios.

**Criterio de aceptación**

- El registro, Google, reserva como invitado y consulta de citas siguen un contrato documentado y coherente.
- La vinculación de correo o teléfono requiere una prueba de posesión adecuada.

## 6. Etapa 6.3 — Autorización, sesiones y pagos

### 6.3.1 Centralizar políticas de autorización

**Cambio necesario**

- Crear políticas reutilizables para propietario de cita, trabajador asignado, administrador del negocio y superadministrador.
- Evitar comprobaciones de rol dispersas dentro de controladores y servicios.
- Incluir el negocio activo en cada decisión.

**Por qué es necesario**

Las condiciones distribuidas evolucionan de forma distinta y generan excepciones. Una política central hace que las reglas sean explícitas y comprobables.

**Criterio de aceptación**

- Confirmar, completar, cancelar, consultar detalles y consultar timeline utilizan la misma política documentada.

### 6.3.2 Proteger el inicio de pago

**Cambio necesario**

- Requerir que quien inicia el pago sea propietario de la cita, tenga autorización administrativa o presente un token firmado y limitado a esa reserva.
- No aceptar un `appointmentId` como única prueba de autorización.

**Por qué es necesario**

Los identificadores no son credenciales. Una persona que conozca o reciba un ID no debería poder provocar cambios de estado o crear transacciones para una cita ajena.

**Criterio de aceptación**

- Existen pruebas de inicio autorizado y de rechazo para citas ajenas.

### 6.3.3 Hacer idempotente y consistente el flujo Webpay

**Cambio necesario**

- Asociar token, pago, cita, negocio y monto esperado antes de confirmar.
- Validar que el callback corresponde al registro pendiente original.
- Definir el comportamiento frente a callbacks repetidos.
- Utilizar transacciones de MongoDB o una máquina de estados recuperable para actualizaciones relacionadas.
- Registrar reconciliación si Webpay confirma pero la persistencia local falla.

**Por qué es necesario**

El proveedor puede repetir callbacks y una falla puede ocurrir entre la aprobación externa y la actualización local. El flujo debe poder repetirse de forma segura.

**Criterio de aceptación**

- Repetir el mismo callback no duplica efectos ni corrompe estados.
- Monto, token, buy order, cita y negocio coinciden antes de confirmar.

### 6.3.4 No confiar en parámetros de redirección para mostrar resultados

**Cambio necesario**

- No incluir mensajes técnicos internos en la URL de error.
- Hacer que la página de resultado consulte un comprobante o estado firmado desde el backend.
- Tratar monto, código y appointment ID de la query como datos no confiables.

**Por qué es necesario**

Los parámetros de URL pueden modificarse y quedan registrados en historial, analítica y logs. Aunque no cambien el pago real, pueden presentar información falsa o filtrar detalles internos.

**Criterio de aceptación**

- La información mostrada proviene del backend y coincide con un pago autorizado.
- Los errores públicos utilizan códigos estables, no mensajes internos.

### 6.3.5 Endurecer sesiones y CSRF

**Cambio necesario**

- Regenerar el identificador de sesión después de login y elevaciones de privilegio.
- Validar `Origin` en operaciones mutables.
- Incorporar protección CSRF compatible con la arquitectura de dominios elegida.
- Definir cookie, dominio, `SameSite`, `Secure` y expiración por entorno.
- Revocar o actualizar sockets al cambiar negocio o sesión.

**Por qué es necesario**

Las cookies se envían automáticamente. Si se requiere `SameSite=None`, CORS no sustituye una defensa CSRF. Además, los sockets conservan datos capturados durante el handshake.

**Criterio de aceptación**

- Una petición cross-site no autorizada no puede ejecutar acciones mutables.
- Cambiar de negocio desconecta o reautentica la conexión WebSocket anterior.

### 6.3.6 Endurecer recuperación y autenticación externa

**Cambio necesario**

- Guardar un hash del token de recuperación, no el token utilizable.
- Invalidar tokens anteriores al solicitar uno nuevo.
- No almacenar `OAUTH_USER_NO_PASSWORD` como contraseña normal.
- Definir cómo una cuenta OAuth agrega una contraseña posteriormente.
- Revisar la política mínima de contraseña.

**Por qué es necesario**

Una filtración de base de datos no debería convertir tokens de recuperación en credenciales utilizables. Las cuentas OAuth también necesitan un estado explícito, no una contraseña ficticia.

**Criterio de aceptación**

- El token enviado por correo no existe en texto reutilizable en la base de datos.
- Una cuenta OAuth no puede autenticarse por contraseña hasta configurarla mediante un flujo verificado.

## 7. Etapa 6.4 — Impersonación segura

### 6.4.1 Crear un ADR antes de implementar

El ADR debe definir:

- objetivo del modo soporte;
- actores autorizados;
- operaciones permitidas y prohibidas;
- duración máxima;
- requisito de motivo;
- atribución de auditoría;
- aislamiento entre pestañas;
- terminación y revocación;
- tratamiento de acciones sensibles.

**Por qué es necesario**

La impersonación es una capacidad de alto privilegio. Su comportamiento debe ser una decisión de arquitectura, no una consecuencia accidental de sustituir datos en la sesión.

### 6.4.2 Usar una sesión independiente en otra pestaña

**Cambio necesario**

1. El superadministrador solicita iniciar soporte indicando negocio y motivo.
2. El backend genera un token aleatorio, de un solo uso y corta duración.
3. El frontend abre una ruta de canje en una pestaña independiente.
4. La ruta crea una sesión de soporte aislada.
5. El token queda invalidado inmediatamente.

**Por qué es necesario**

Abrir `target="_blank"` sin una sesión independiente no sirve: las pestañas comparten la cookie actual y la consola principal también queda impersonando.

**Criterio de aceptación**

- La pestaña original conserva la sesión superadministradora.
- Cerrar o terminar la sesión de soporte no modifica la sesión original.

### 6.4.3 Separar actor y sujeto

**Cambio necesario**

La sesión de soporte y cada evento de auditoría deberán conservar:

- `actorId`: superadministrador real;
- `subjectId`: usuario representado;
- `businessId`;
- `supportSessionId`;
- motivo;
- fecha de inicio y expiración;
- permisos efectivos.

**Por qué es necesario**

Registrar solamente al usuario impersonado atribuye la acción a la persona equivocada y elimina trazabilidad administrativa.

**Criterio de aceptación**

- Toda acción realizada en modo soporte permite identificar actor real, sujeto y negocio.
- Inicio, finalización, expiración y revocación generan eventos de auditoría.

### 6.4.4 Limitar capacidades

**Cambio necesario**

- Definir modo de solo lectura como comportamiento predeterminado.
- Exigir una elevación explícita para acciones mutables, si estas son necesarias.
- Bloquear cambios de contraseña, pagos, eliminación física y otras operaciones sensibles salvo decisión expresa.

**Por qué es necesario**

El objetivo de soporte normalmente es diagnosticar. Entregar todos los permisos del propietario aumenta innecesariamente el impacto de un error o abuso.

**Criterio de aceptación**

- Las acciones sensibles poseen pruebas de denegación durante impersonación.

## 8. Etapa 6.5 — Observabilidad, dependencias y despliegue

### 6.5.1 Ampliar el modelo de auditoría

**Cambio necesario**

Añadir, cuando corresponda:

- `businessId`;
- `actorId` y `subjectId`;
- `requestId` o correlation ID;
- resultado de la operación;
- IP y user agent con política de retención;
- origen normal, soporte, sistema o callback externo.

**Por qué es necesario**

El registro actual está orientado a citas y pagos, pero no permite reconstruir completamente acciones multitenant o de impersonación.

### 6.5.2 Resolver duplicación de correo y accesos directos a modelos

**Cambio necesario**

- Eliminar o migrar el módulo antiguo `utils/mailer.js`.
- Evitar accesos directos a modelos desde controladores, WebSocket y utilidades cuando existe una capa de repositorios.
- Centralizar logging en el logger estructurado.

**Por qué es necesario**

La duplicación permite que correcciones de seguridad o branding se apliquen en un módulo y no en el otro. Los accesos directos también evitan políticas comunes de negocio.

### 6.5.3 Actualizar dependencias de forma controlada

**Cambio necesario**

- Evaluar las vulnerabilidades reportadas por `npm audit`.
- Actualizar primero parches compatibles y volver a ejecutar pruebas.
- Revisar especialmente Astro/Vite, Socket.IO/`ws`, Multer, Nodemailer y dependencias transitivas del SDK de Transbank.
- Documentar riesgos sin actualización disponible y mitigaciones aplicadas.

**Por qué es necesario**

La revisión encontró vulnerabilidades conocidas de severidad alta. No todas serán explotables, pero deben evaluarse antes de producción.

### 6.5.4 Corregir arranque y despliegue

**Cambio necesario**

- Esperar la conexión a MongoDB antes de aceptar tráfico.
- Corregir la diferencia `client`/`Client` al servir archivos estáticos en Linux.
- Incorporar readiness y graceful shutdown.
- Documentar despliegue independiente o conjunto de cliente y servidor.
- Definir estrategia de migraciones e índices.

**Por qué es necesario**

El servidor puede aceptar solicitudes antes de disponer de base de datos y la diferencia de mayúsculas puede romper el frontend estático en Linux.

**Criterio de aceptación**

- El servicio no anuncia disponibilidad hasta completar sus dependencias críticas.
- La terminación deja de aceptar tráfico y cierra servidor, sockets, sesiones y MongoDB ordenadamente.

## 9. Fase 7 — Refactor frontend revisado

La tarea 7.1, unificación del cliente API, puede conservarse como base provisional. Sin embargo, el cliente todavía debe eliminar el slug predeterminado, completar contratos y adaptarse a las decisiones multitenant.

### Orden recomendado

1. **7.1 Unificar API client:** conservar y ajustar después de estabilizar contratos.
2. **7.10 Completar tipado TypeScript:** mover antes de los refactors estructurales.
3. **7.2 Dividir CalendarContext.**
4. **7.3 Dividir SaasBusinessesView.**
5. **7.4 Extraer utilidades duplicadas.**
6. **7.5 Extraer paleta de colores de avatar.**
7. **7.6 Unificar CalendarDayView y CalendarWeekView.**
8. **7.7 Extraer SVG de Sidebar.**
9. **7.9 Eliminar correos, slugs y reglas hardcodeadas.**
10. **7.8 Implementar diseño responsive.**

### 7.10 Completar tipado antes de dividir componentes

**Cambio necesario**

- Corregir los 8 errores y 5 sugerencias detectados por la primera ejecución reproducible de `astro check`.
- Tipar usuario, membresías, respuestas API, configuración y errores.
- Eliminar `any`, `as any` y `@ts-ignore` injustificados.
- Validar los valores de `view` provenientes de la URL.

**Por qué es necesario**

El tipado incompleto impide utilizar TypeScript como red de seguridad durante la separación de contextos y componentes.

### 7.2 Dividir CalendarContext

**Cambio necesario**

Separar como mínimo:

- `SessionContext`: usuario, negocio activo, configuración, logout y cambio de espacio;
- `CalendarDataContext`: citas, profesionales, turnos, acciones y sincronización;
- `CalendarViewContext`: fecha, vista, filtros y selección.

**Por qué es necesario**

El contexto actual combina responsabilidades y provoca renderizados amplios. También mezcla bootstrap, navegación, acciones y WebSocket.

### 7.3 Dividir SaasBusinessesView

**Cambio necesario**

- Separar capa de datos, tabla, filtros, métricas y formulario de creación.
- Sustituir `alert` por estados de interfaz consistentes.
- Obtener trial/plan desde el dominio, no inferirlo mediante slugs.

**Por qué es necesario**

El componente mezcla demasiadas responsabilidades y contiene reglas comerciales hardcodeadas difíciles de probar.

### 7.4–7.9 Eliminar duplicaciones y datos hardcodeados

**Cambio necesario**

- Eliminar reglas de días libres basadas en correos concretos.
- Mover etiquetas profesionales y navegación a configuración de negocio.
- Extraer colores y utilidades compartidas.
- Compartir cálculo de grilla y disposición entre vistas.
- Sustituir fallbacks de slug por una selección explícita de negocio.

**Por qué es necesario**

Los datos de demostración incorporados en la lógica productiva generan resultados incorrectos para nuevos negocios y dificultan el crecimiento SaaS.

### 7.8 Responsive como cierre

**Cambio necesario**

- Definir primero flujos móviles para calendario, menú, modales y tablas SaaS.
- Establecer breakpoints y criterios de accesibilidad.
- Probar teclado, foco, contraste, scroll y tamaños táctiles.

**Por qué es necesario**

El responsive debe aplicarse cuando la estructura de componentes ya sea estable; hacerlo antes aumentaría el retrabajo.

## 10. Matriz mínima de pruebas de seguridad

| Recurso | Caso permitido | Caso que debe rechazarse |
|---|---|---|
| Servicio | Admin A modifica servicio A | Admin A modifica servicio B |
| Cita | Cliente consulta su cita | Cliente consulta cita ajena |
| Cita | Admin A confirma cita A | Admin A confirma cita B |
| Turno | Worker A modifica su turno en A | Worker A modifica turno ajeno o de otro negocio |
| Bloqueo | Admin A elimina bloqueo A | Admin A elimina bloqueo B |
| Pago | Propietario inicia pago | Usuario ajeno inicia pago por ID |
| Webpay | Callback válido confirma una vez | Callback repetido duplica efectos |
| WebSocket | Miembro A entra a sala A | Miembro A entra a sala B |
| Impersonación | Token válido crea sesión aislada | Token reutilizado o expirado crea sesión |
| Sesión | Cambio de negocio autorizado | Usuario selecciona negocio sin membresía |

## 11. Definición de cierre de Fase 6

La Fase 6 podrá declararse terminada cuando se cumplan todas estas condiciones:

- todas las suites se ejecutan mediante el comando oficial;
- CI se encuentra activo y verde;
- no existe fallback al primer negocio activo;
- las operaciones tenant-scoped filtran por negocio;
- turnos y bloqueos poseen `businessId` y datos migrados;
- `Membership` es la autoridad de permisos tenant;
- el modelo de cuentas cliente está documentado;
- pagos son autorizados, idempotentes y reconciliables;
- sesiones cuentan con protección CSRF acorde al despliegue;
- impersonación utiliza una sesión independiente y auditable;
- las vulnerabilidades de dependencias fueron corregidas o aceptadas con mitigación documentada;
- build, análisis estático y pruebas terminan sin errores.

## 12. Decisiones que deben aprobarse antes de implementar

1. Modelo definitivo de identidad y membresía de clientes.
2. Arquitectura de dominios de frontend y backend, necesaria para cookies y CSRF.
3. Alcance permitido del modo soporte: solo lectura o escritura limitada.
4. Política de retención y contenido de auditoría.
5. Estrategia de migración para turnos, bloqueos y campos heredados de usuario.
6. Política de compatibilidad y actualización de dependencias.

## 13. Primer bloque de trabajo recomendado

El primer bloque debe ser pequeño y no modificar todavía el modelo de datos:

1. corregir scripts de pruebas;
2. corregir fixtures;
3. añadir casos de aislamiento que actualmente deberían fallar;
4. establecer CI;
5. redactar ADR de autoridad multitenant;
6. aprobar migración de turnos y bloqueos.

Este orden crea una red de seguridad antes de aplicar cambios de autorización o migraciones.
