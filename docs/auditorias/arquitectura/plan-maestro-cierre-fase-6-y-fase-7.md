# Plan maestro de cierre de Fase 6 y estado de Fase 7

**Proyecto:** ATMÓSFERA Agenda
**Estado del documento:** Plan histórico vigente; 6.2.6-A está fusionada y 6.2.6-B está implementada funcionalmente en PR #32 Draft, con correcciones adversariales y CI de runtime verde. Permanece pendiente una nueva revisión adversarial independiente y no se declara 6.2.6 completa cerrada.
**Fecha original:** 21 de julio de 2026
**Última revisión:** 22 de agosto de 2026
**Base funcional 6.2.6-B:** `master@ed7acfd5fed91b03cd65becd2af154f93dad027b`, merge aprobado de PR #31 / contrato documental 6.2.6-B
**Alcance:** Backend, multitenencia, seguridad, pagos, impersonación, frontend, pruebas y operación

## 1. Objetivo

Este documento transforma la revisión integral del proyecto en un plan de cambios verificable. Su propósito actual es cerrar correctamente la Fase 6, conservando como evidencia los refactors de Fase 7 que ya fueron fusionados.

Aunque varias tareas de Fase 7 se adelantaron y quedaron verificadas entre los PR #9 y #15, la prioridad vuelve al endurecimiento 6.2–6.4. El responsive 7.8 queda aplazado por decisión de producto hasta estabilizar arquitectura, multitenencia y datos.

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
| Cerrado | Pruebas y CI | La etapa 6.1 dejó pruebas de backend, checks de frontend, build y escaneo de secretos como barreras obligatorias de `master`. |
| P1 | Sesiones y CSRF | Las cookies cross-site requieren protección explícita para operaciones mutables. |
| P1 | Dependencias | La auditoría encontró vulnerabilidades conocidas en dependencias directas y transitivas. |
| Cerrado | Tipado frontend | El PR #15 cerró 7.10 con TypeScript estricto, 0 usos productivos de `any`, checks y build en CI. |
| Aplazado | Responsive 7.8 | Se retomará después de estabilizar arquitectura, multitenencia y datos. |

### Estado consolidado

- 6.1 está cerrada y protegida por CI.
- 6.2.1 está cerrada mediante los PR #5, #6 y #7.
- 6.2.2-A está cerrada mediante el PR #16. 6.2.2-B tiene su implementación read-only cerrada mediante los PR #17 y #19; su ejecución operativa permanece pendiente sobre la nueva baseline.
- No existen datos productivos. Las bases ficticias `agenda-dev` y `agenda` fueron eliminadas manualmente por la operadora el 31 de julio de 2026; `agenda_test` permanece como base de pruebas, sin asumir que sea el destino utilizado por cada ejecución de CI.
- La eliminación manual constituye una atestación de la operadora realizada fuera del repositorio. GitHub no demuestra el contenido previo de las bases y no almacenará capturas, URI, credenciales ni evidencia sensible; cualquier registro operativo adicional permanecerá fuera del código y sin secretos.
- 6.2.2-C se redefine para establecer una baseline preproductiva limpia de Atmósfera y DAM. El PR #20 fusionó el bootstrap fail-closed original; el PR #21 permanece Draft y adapta la definición a dos propietarios y añade el asistente local endurecido. El corte de autoridad sigue pendiente.
- 7.7 está cerrada mediante el PR #13.
- 7.9 está cerrada mediante el PR #14.
- 7.10 está cerrada mediante el PR #15.
- 7.1–7.6 también están fusionadas según el registro de cada etapa.
- 7.8 está aplazada por decisión de producto.
- PR #30 cerró 6.2.6-A. PR #31 fusionó el contrato documental 6.2.6-B en `master@ed7acfd5fed91b03cd65becd2af154f93dad027b`.
- PR #32 permanece Draft e implementa funcionalmente 6.2.6-B: publicWeb tenant-scoped, DNS TXT/freshness/generations, CORS browser binding, C2 cutover, persisted fence, storage gate e índices. Los bloqueantes adversariales conocidos fueron corregidos y CI #326 fue verde sobre el runtime corregido; el HEAD documental final requiere su propio CI verde y una revisión adversarial independiente antes de Ready/merge.

## 4. Etapa 6.1 — Base verificable

**Registro de ejecución:** [`fase-6.1-base-verificable.md`](./fase-6.1-base-verificable.md)

**Estado:** cerrada y verificada el 21 de julio de 2026. Los apartados siguientes se conservan como especificación y evidencia histórica.

### 6.1.1 Ejecutar todas las suites desde el comando oficial

**Cambio necesario**

- Modificar los scripts del backend para ejecutar pruebas API, integración, pagos, sesiones, validaciones, correo y WebSocket.
- Separar, si resulta útil, los comandos `test:unit`, `test:integration` y `test:all`.
- Asegurar que el comando usado en CI sea el mismo utilizado para declarar el cierre de una fase.

**Por qué es necesario**

La suite oficial debe incluir todas las fronteras relevantes. Las pruebas que quedan fuera del comando principal permiten que una regresión pase inadvertida aunque el comando termine correctamente.

**Criterio de aceptación**

- Una sola orden ejecuta todas las suites relevantes.
- El número de suites y casos aparece en el informe de cierre.
- Un fallo en cualquier suite produce un código de salida distinto de cero.

### 6.1.2 Corregir fixtures y modelos de prueba

**Cambio necesario**

- Corregir fixtures que asignen permisos incoherentes.
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

Los fallbacks silenciosos pueden iniciar el servidor con una configuración insegura o inconsistente.

**Criterio de aceptación**

- El proceso falla inmediatamente con un mensaje claro si falta una variable crítica.
- Los controladores y servicios no leen directamente variables que ya pertenecen a la configuración central.

## 5. Etapa 6.2 — Modelo y aislamiento multitenant

**Inventario técnico:** [`fase-6.2-inventario-fallbacks-fronteras.md`](./fase-6.2-inventario-fallbacks-fronteras.md)

### 6.2.1 Eliminar la selección implícita del primer negocio

**Estado:** cerrada. Contrato fusionado mediante el PR #5; coherencia de reserva y disponibilidad mediante el PR #6; smoke productivo documentado en el PR #7.

**Cambio necesario**

- Requerir un `businessId` o slug válido en toda ruta pública dependiente de un negocio.
- Para usuarios autenticados, utilizar exclusivamente el negocio activo de la sesión validada.
- Rechazar slugs o IDs inexistentes, incluso para superadministradores.
- Reservar cualquier negocio predeterminado únicamente para fixtures o configuración explícita de desarrollo.

**Por qué es necesario**

Seleccionar el primer negocio activo convierte una petición incompleta en una operación válida sobre un tenant no elegido por el usuario.

**Criterio de aceptación**

- Una solicitud sin negocio recibe un error determinista.
- Un slug inválido nunca se redirige silenciosamente a otro negocio.

### 6.2.2 Hacer que `Membership` sea la autoridad de acceso

**Estado:** contrato documental cerrado mediante el PR #16. 6.2.2-B tiene su implementación read-only cerrada mediante los PR #17 y #19; su ejecución operativa permanece pendiente sobre la nueva baseline. La rebaseline del PR #18 registra que no existe información productiva que migrar y sustituye el backfill actual por un bootstrap limpio. La estrategia de datos y corte se define en [`fase-6.2.2-migracion-autoridad-membership.md`](./fase-6.2.2-migracion-autoridad-membership.md).

Las bases ficticias anteriores fueron eliminadas manualmente fuera del repositorio según la atestación operativa de la operadora. Ningún PR ejecutó borrados o migraciones sobre MongoDB, y GitHub no constituye evidencia del contenido previo de esas bases.

El auditor exige las tres colecciones físicas, confirma el entorno, registra procedencia sanitizada, valida estados e identificadores sin inferir valores y sólo puede garantizar una vista temporal mediante sesión snapshot. La doble lectura completa es diagnóstico bloqueante y nunca habilita `safeToApply`.

El PR #19 integró la corrección que sólo admite BSON `ObjectId` físicos: referencias string, representaciones `$oid` y objetos meramente convertibles son bloqueantes y no participan en correlaciones. Esta garantía conserva `CANONICAL_SCHEMA_VERSION = 4` y `MEMBERSHIP_AUTHORITY_AUDITOR_VERSION = "1.3.0"`.

El PR #20 fusionó el comando separado de 6.2.2-C para la baseline de autoridad de Atmósfera y DAM con modos `plan` y `apply`. Exige fingerprint del destino, nombre de base, credenciales suministradas fuera del repositorio y confirmación literal para escribir.

El PR #21 añade un asistente local separado cuya API controla el bind exclusivamente a `127.0.0.1` y verifica socket, `Host` y `Origin` sin confiar en cabeceras de proxy. Recibe en memoria los datos de las dos personas propietarias, aplica JSON estricto, CSRF, límite de 32 KiB, timeouts y errores públicos estables. No persiste, registra ni devuelve credenciales y no se conecta al arranque normal, a Railway, Vercel ni al despliegue.

La ejecución operativa del bootstrap/auditor y el corte de autoridad siguen sujetos a su plan específico; este documento no los declara realizados.

**Cambio necesario**

- Utilizar la membresía activa para resolver rol y negocio.
- Reservar el rol global del usuario para privilegios de plataforma, como `superadmin`.
- Dejar de autorizar mediante `User.business` y roles heredados.
- Planificar una migración antes de eliminar campos antiguos.
- Revalidar la membresía activa al seleccionar tenant y antes de autorizar una operación.
- Mantener `superadmin` como privilegio global; seleccionar un negocio no concede automáticamente role tenant.

**Por qué es necesario**

Dos fuentes de autoridad pueden entregar resultados diferentes para la misma persona. Esto es especialmente peligroso para usuarios que pertenecen a más de un negocio.

**Criterio de aceptación**

- Toda autorización tenant-scoped obtiene rol y negocio desde una membresía activa.
- Desactivar una membresía revoca el acceso sin modificar al usuario global.
- `User.role = admin|worker` sin una membresía activa no concede acceso.
- Un `superadmin` necesita una membresía activa o una futura sesión de soporte acotada para ejecutar acciones que requieran rol tenant.

### 6.2.3 Añadir negocio a turnos y bloqueos

**Cambio necesario**

- Añadir `business` como campo obligatorio en `Shift` y `Block`.
- Cambiar el índice de turnos a `{ business, worker, dayOfWeek }`.
- Cambiar las consultas de bloqueos a `{ business, worker, date }`.
- Crear una migración controlada para documentos existentes.

**Por qué es necesario**

El horario de un profesional puede variar por negocio. Con un modelo global, un trabajador con múltiples membresías compartiría horario y bloqueos fuera de la frontera tenant.

**Criterio de aceptación**

- Un profesional puede tener horarios diferentes en dos negocios.
- Un negocio no puede consultar, modificar ni eliminar turnos o bloqueos del otro.

### 6.2.4 Aplicar ownership en repositorios y servicios

**Cambio necesario**

- Reemplazar búsquedas tenant-scoped por ID puro con consultas `{ _id, business }`.
- Aplicar el patrón a servicios, citas, pagos, turnos, bloqueos, configuraciones y auditorías.
- Pasar `businessId` explícitamente desde el controlador hasta el repositorio.

**Por qué es necesario**

Comprobar solamente que el usuario es administrador no demuestra que el recurso pertenezca a su negocio.

**Criterio de aceptación**

- Todos los endpoints por ID poseen pruebas de aislamiento entre negocio A y negocio B.
- Un ID válido de otro negocio responde como recurso inaccesible y nunca se modifica.

### 6.2.5 Implementar identidad progresiva del cliente

**Decisión aprobada**

Utilizar una identidad global y perfiles complementarios específicos por negocio, según el [ADR-001](./adr-001-autoridad-multitenant-identidad-progresiva.md). Reservar como invitado no requerirá login, contraseña ni verificación en cada ocasión.

En el MVP:

- normalizar correo y teléfono al recibir una reserva;
- utilizar coincidencias de contacto sólo para seguimiento interno y tratarlas como identidades probables mientras no estén verificadas;
- crear o actualizar un perfil tenant-scoped con la relación entre cliente y negocio;
- permitir continuidad en el mismo dispositivo mediante una credencial opaca, segura y de duración limitada;
- no tratar esa continuidad como prueba de identidad ni utilizarla para mostrar historial o información sensible;
- no fusionar perfiles contradictorios automáticamente;
- mantener separados el consentimiento para comunicaciones operativas y el consentimiento para marketing.

La verificación por correo será opcional para reservar y obligatoria cuando sea necesario demostrar posesión del contacto, recuperar acceso, consultar historial o fusionar identidades. SMS no forma parte del MVP. WhatsApp se reserva para una etapa posterior como canal operativo.

**Criterio de aceptación**

- El registro, Google, reserva como invitado y consulta de citas siguen un contrato documentado y coherente.
- La reserva invitada nunca crea una contraseña aleatoria desconocida por el cliente.
- El sistema distingue perfiles probables de contactos verificados.
- La vinculación definitiva de correo o teléfono requiere una prueba de posesión adecuada.
- Las pruebas demuestran que un contacto no verificado no permite consultar historial ni administrar citas ajenas.

### 6.2.6 Formalizar el contrato headless mínimo de Agenda

**Decisión aprobada**

ATMÓSFERA Agenda funciona como infraestructura de reservas headless según el [ADR-002](./adr-002-agenda-headless-gestion-publica.md). La API centraliza servicios, profesionales, disponibilidad, citas, pagos, reglas y comunicaciones, pero no impone una interfaz pública única.

Las webs construidas por ATMÓSFERA son la interfaz del negocio y consumen la API para recorridos personalizados.

**Estado 6.2.6-A**

- PR #30 fue fusionado en `master@ea43c0da9a11355811b5bf0c52210af86fdac335`;
- la implementación y revisión adversarial quedaron cerradas sobre el HEAD técnico aprobado y cierre documental;
- [`fase-6.2.6-contrato-headless-minimo.md`](./fase-6.2.6-contrato-headless-minimo.md) mantiene la especificación versionable;
- tenant público se selecciona explícitamente y falla cerrado si falta/es contradictorio;
- Services/workers/availability/booking exponen proyecciones mínimas tenant-scoped;
- guest booking usa `Appointment.guestContact` sin crear identidad global;
- C2 permanece READ exact-scope y no concede cancel/reschedule/payment authority.

**Estado 6.2.6-B — implementación funcional en Draft**

El contrato aprobado está en [`fase-6.2.6-b-verified-business-public-origins.md`](./fase-6.2.6-b-verified-business-public-origins.md), fusionado mediante PR #31. PR #32 implementa el contrato sobre `master@ed7acfd5fed91b03cd65becd2af154f93dad027b`.

Implementado en PR #32:

- `BusinessConfig.publicWeb` tenant-scoped con lifecycle unconfigured/pending/verified/effective-expired;
- HTTPS/443 y `websiteUrl`/`bookingUrl` exact same-origin;
- DNS TXT server-side, raw one-time hash-only, timeout 3 s;
- challenge TTL 15 min y verified trust TTL 30 días;
- `verificationAttemptGeneration` y `trustGeneration` separados y monotónicos;
- explicit reverify/rotate/delete y anti-ABA;
- Membership admin + trusted panel Origin para comandos;
- CORS public/headless credentialless con preflight separado del binding de request real;
- shared origins sin índice unique;
- limiter específico 200/IP/15 min antes del lookup MongoDB público;
- lookup existence-oriented bounded con `$limit:1`;
- índice físico no unique `business_config_public_web_origin_fresh`, migración no destructiva `migration:public-web-storage` y startup gate remoto con `autoIndex:false` production-like;
- C2 cutover sin fallback a `GUEST_APPOINTMENT_ACCESS_ORIGIN`;
- Job/Delivery ligados a `publicWebTrustGeneration` + `trustedOrigin`;
- persisted authority fence de 2 min contra revocación concurrente;
- exchange revalida publicWeb antes de consumir C1 y antes del mint;
- `/read/challenge` y `/read/verify` siguen fresh-trust-bound para browser callers;
- `/read` ya bearer-authorized queda credentialless y no acorta una READ capability mintada antes de una revocación publicWeb.

**Evidencia actual**

- el HEAD adversarial de entrada `1a3654d209200737507c4022cc438ce6efb276a7` tenía CI #307 roja por fixtures, no por una decisión de seguridad aprobada;
- los tests shared-origin fueron corregidos para validar el DTO público real `id` y no reintroducir `_id`;
- el caso superadmin se aisló en un proceso propio sin tocar el auth limiter ni conceder Membership;
- se añadieron pruebas de capability-after-revocation HTTP, bounded CORS lookup y storage `autoIndex:false`;
- CI #326 fue `success` sobre `db270dbf2c046d76fd14547b1edf352bdd9f66cf`, después de reconciliar una fixture histórica 6.2.6-A con un publicWeb origin realmente verificado;
- el HEAD documental final del PR debe tener igualmente CI verde antes de revisión adversarial.

**Pendiente / no cerrado todavía**

No queda pendiente funcionalidad contractual conocida dentro de los cuatro bloqueantes de esta corrección, pero PR #32 sigue Draft y 6.2.6-B no se declara cerrada hasta completar CI del HEAD exacto final y una nueva revisión adversarial independiente. Las capabilities CANCEL/RESCHEDULE/PAYMENT, reconciliation/refund, 6.3 y 6.4 continúan fuera de alcance.

**Cambio necesario**

- ~~Definir una versión inicial mínima para servicios, profesionales, disponibilidad y creación de citas.~~ **Cerrado en 6.2.6-A.**
- Reservar confirmación, reprogramación y cancelación públicas para operaciones separadas con credenciales de acción. **READ existe en C2; las capabilities futuras continúan fuera de alcance.**
- ~~Exigir Business explícito y ownership backend en operaciones públicas.~~ **Preservado por 6.2.6-A.**
- ~~Registrar por negocio `websiteUrl`/`bookingUrl` HTTPS verificados.~~ **Implementado en PR #32; pendiente aprobación adversarial.**
- ~~Construir enlaces C2 sólo desde publicWeb trust fresh del mismo Business.~~ **Implementado en PR #32 sin fallback global; pendiente aprobación adversarial.**
- ~~Separar CORS preflight de tenant binding y proteger su lookup público.~~ **Implementado con limiter pre-lookup, query bounded e índice físico verificado; pendiente aprobación adversarial.**

**Criterio de aceptación**

- Dos webs pueden implementar recorridos visuales distintos sobre los mismos contratos.
- Business inexistente, recurso cross-tenant u Origin browser incoherente fallan determinísticamente.
- Shared Origin no comparte datos ni authority entre Businesses.
- Server-to-server sin Origin conserva el contrato headless.
- C2 stale Delivery/challenge falla `INVALID_PROOF` tras revocación.
- Una READ capability ya canjeada conserva su lifetime C2 existente aunque publicWeb se revoque después.
- Las pruebas de 6.2.6-A, C1, C2, publicWeb, tenant isolation, frontend y secret scan deben estar verdes en el HEAD exacto aprobado.
- PR #32 requiere revisión adversarial independiente antes de Ready/merge.

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

El proveedor puede repetir callbacks y una falla puede ocurrir entre la aprobación externa y la actualización local.

**Criterio de aceptación**

- Repetir el mismo callback no duplica efectos ni corrompe estados.
- Monto, token, buy order, cita y negocio coinciden antes de confirmar.

### 6.3.4 No confiar en parámetros de redirección para mostrar resultados

**Cambio necesario**

- No incluir mensajes técnicos internos en la URL de error.
- Hacer que la página de resultado consulte un comprobante o estado firmado desde el backend.
- Tratar monto, código y appointment ID de la query como datos no confiables.

**Por qué es necesario**

Los parámetros de URL pueden modificarse y quedan registrados en historial, analítica y logs.

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

Las cookies se envían automáticamente. Si se requiere `SameSite=None`, CORS no sustituye una defensa CSRF.

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

**Criterio de aceptación**

- El token enviado por correo no existe en texto reutilizable en la base de datos.
- Una cuenta OAuth no puede autenticarse por contraseña hasta configurarla mediante un flujo verificado.

### 6.3.7 Gestionar citas mediante enlaces seguros del negocio

**Decisión aprobada**

El correo de confirmación incluirá enlaces para gestionar la cita sin exigir login. La reprogramación dirigirá a la agenda existente en la web del negocio, no a una interfaz visual genérica ni a un iframe externo.

La forma exacta de transportar y canjear la credencial debe impedir que un token reutilizable termine expuesto en logs, analítica, historial o encabezados `Referer`.

**Cambio necesario**

- Generar credenciales aleatorias con hash persistido, alcance limitado, expiración y asociación explícita a cita, negocio y acción.
- Aplicar política de un solo uso o rotación según la acción y registrar cada canje.
- Exponer operaciones separadas para confirmar, reprogramar y cancelar.
- No utilizar el ID de la cita como credencial.
- Redactar credenciales de logs y analítica y aplicar `Referrer-Policy: no-referrer`.
- Aplicar rate limiting e idempotencia.
- Mantener cita/horario originales mientras el cliente explora alternativas.
- Confirmar el nuevo horario y liberar el anterior mediante una operación recuperable/transaccional.

**Criterio de aceptación**

- Una credencial sólo permite la acción, cita y negocio para los que fue emitida.
- Abrir el enlace no libera ni cancela el horario original.
- Dos intentos concurrentes no producen reservas duplicadas ni pérdida de ambos horarios.
- Los logs y eventos de analítica no contienen credenciales reutilizables.

## 7. Etapa 6.4 — Impersonación segura

### 6.4.1 Crear un ADR antes de implementar

El ADR debe definir objetivo, actores autorizados, operaciones permitidas/prohibidas, duración, motivo, auditoría, aislamiento entre pestañas, terminación/revocación y tratamiento de acciones sensibles.

### 6.4.2 Usar una sesión independiente en otra pestaña

**Cambio necesario**

1. El superadministrador solicita iniciar soporte indicando negocio y motivo.
2. El backend genera un token aleatorio, de un solo uso y corta duración.
3. El frontend abre una ruta de canje en una pestaña independiente.
4. La ruta crea una sesión de soporte aislada.
5. El token queda invalidado inmediatamente.

**Criterio de aceptación**

- La pestaña original conserva la sesión superadministradora.
- Cerrar o terminar la sesión de soporte no modifica la sesión original.

### 6.4.3 Separar actor y sujeto

La sesión de soporte y cada evento de auditoría deberán conservar `actorId`, `subjectId`, `businessId`, `supportSessionId`, motivo, fechas y permisos efectivos.

**Criterio de aceptación**

- Toda acción permite identificar actor real, sujeto y negocio.
- Inicio, finalización, expiración y revocación generan auditoría.

### 6.4.4 Limitar capacidades

**Cambio necesario**

- Definir solo lectura como comportamiento predeterminado.
- Exigir elevación explícita para mutaciones si fueran necesarias.
- Bloquear cambios de contraseña, pagos, eliminación física y operaciones sensibles salvo decisión expresa.

## 8. Etapa 6.5 — Observabilidad, dependencias y despliegue

### 6.5.1 Ampliar el modelo de auditoría

Añadir, cuando corresponda, `businessId`, actor/sujeto, request/correlation ID, resultado, IP/user-agent con retención y origen operacional.

### 6.5.2 Resolver duplicación de correo y accesos directos a modelos

- Eliminar o migrar el módulo antiguo de mailer.
- Emitir eventos de dominio para citas/pagos.
- Hacer que NotificationService procese eventos sin acoplar dominio al canal.
- Mantener correo como canal MVP y permitir WhatsApp posteriormente.
- Evitar accesos directos a modelos cuando existe repositorio.
- Centralizar logging.

### 6.5.3 Actualizar dependencias de forma controlada

- Evaluar vulnerabilidades reportadas por `npm audit`.
- Aplicar primero parches compatibles y volver a ejecutar pruebas.
- Documentar riesgos no corregibles y mitigaciones.

### 6.5.4 Corregir arranque y despliegue

- Esperar MongoDB y gates críticos antes de `listen()`.
- Incorporar readiness/graceful shutdown.
- Documentar despliegue.
- Mantener estrategia explícita de migraciones/índices.

6.2.6-B ya añade un gate remoto adicional que verifica el índice físico publicWeb antes de abrir HTTP y no confía sólo en `autoIndex`.

## 9. Fase 7 — Refactor frontend reconciliado

La tarea 7.1 quedó implementada y fusionada mediante el PR #1. Su registro se encuentra en [`fase-7.1-api-client-unificado.md`](./fase-7.1-api-client-unificado.md). El slug predeterminado se retiró posteriormente en 6.2.1 mediante el PR #5.

### Orden recomendado

1. **7.1 Unificar API client:** completado mediante el PR #1 y ajustado para tenant explícito en el PR #5.
2. **7.10 Completar tipado TypeScript:** completado mediante el PR #15; TypeScript estricto es barrera de CI.
3. **7.2 Dividir CalendarContext:** completado mediante el PR #9.
4. **7.3 Dividir SaasBusinessesView:** completado mediante el PR #10.
5. **7.4 Extraer utilidades duplicadas:** completado mediante el PR #11.
6. **7.5 Extraer paleta de colores de avatar:** completado dentro del PR #11.
7. **7.6 Unificar CalendarDayView y CalendarWeekView:** completado mediante el PR #12.
8. **7.7 Extraer SVG de Sidebar:** completado mediante el PR #13.
9. **7.9 Eliminar correos, slugs y reglas hardcodeadas:** completado mediante el PR #14.
10. **7.8 Implementar diseño responsive:** aplazado por decisión de producto hasta cerrar los bloques críticos de arquitectura, multitenencia y datos.

### 7.10 Completar tipado antes de dividir componentes

**Estado:** completada mediante el PR #15 con configuración estricta versionada, 0 usos productivos de `any`, pruebas frontend, `astro check`, `tsc --noEmit` y build aprobados.

### 7.2 Dividir CalendarContext

Separar SessionContext, CalendarDataContext y CalendarViewContext cuando se retome esta línea.

### 7.3 Dividir SaasBusinessesView

Separar capa de datos, tabla, filtros, métricas y formulario de creación; evitar reglas comerciales hardcodeadas.

### 7.4–7.9 Eliminar duplicaciones y datos hardcodeados

Mantener utilidades/paletas/grid compartidos y evitar correos/slugs de demostración en lógica productiva.

### 7.8 Responsive como cierre

**Estado:** aplazado por decisión de producto. No forma parte del siguiente bloque crítico.

## 10. Matriz mínima de pruebas de seguridad

| Recurso | Caso permitido | Caso que debe rechazarse |
|---|---|---|
| Servicio | Admin A modifica servicio A | Admin A modifica servicio B |
| Cita | Cliente autorizado consulta su cita | Caller sin authority consulta cita ajena |
| Cita | Admin A confirma cita A | Admin A confirma cita B |
| Turno | Worker A modifica su turno en A | Worker A modifica turno ajeno/de otro negocio |
| Bloqueo | Admin A elimina bloqueo A | Admin A elimina bloqueo B |
| Pago | Actor autorizado inicia pago | Usuario ajeno inicia pago por ID |
| Cliente invitado | Contacto probable acumula seguimiento interno | Contacto no verificado consulta historial |
| PublicWeb | Browser Origin fresh opera Business exacto | Origin A intenta operar Business B |
| C2 pre-exchange | Delivery generation vigente puede canjear | Delivery stale/revocada canjea |
| C2 post-exchange | READ bearer válido conserva su TTL | Cookie/Origin sin bearer obtiene datos |
| Webpay | Callback válido confirma una vez | Callback repetido duplica efectos |
| WebSocket | Miembro A entra a sala A | Miembro A entra a sala B |
| Impersonación | Token válido crea sesión aislada | Token reutilizado/expirado crea sesión |
| Sesión | Cambio de negocio autorizado | Usuario selecciona negocio sin membresía |

## 11. Definición de cierre de Fase 6

La Fase 6 sólo podrá declararse terminada cuando se cumplan, entre otras, estas condiciones:

- todas las suites oficiales y CI estén verdes;
- no exista fallback al primer negocio activo;
- operaciones tenant-scoped filtren por negocio;
- Membership sea authority tenant;
- identidad progresiva esté documentada/probada;
- contrato headless no dependa de UI pública específica;
- trust pública por Business tenga storage/freshness/revocation verificables;
- gestión pública use credenciales exact-scope;
- pagos sean autorizados/idempotentes/reconciliables;
- sesiones incorporen protección CSRF acorde al despliegue;
- impersonación sea aislada/auditable;
- dependencias tengan mitigación aceptada;
- build, análisis estático, pruebas y secretos terminen sin errores.

## 12. Decisiones que deben aprobarse antes de implementar

1. ~~Modelo definitivo de identidad y membresía de clientes.~~ **Aprobado:** ADR-001.
2. ~~Modelo de integración de agenda pública.~~ **Aprobado:** ADR-002.
3. ~~Destino de enlaces públicos.~~ **Aprobado para READ/bootstrap por publicWeb tenant-scoped en 6.2.6-B; capabilities futuras siguen separadas.**
4. Arquitectura de dominios frontend/backend necesaria para cookies y CSRF general de 6.3.
5. Alcance del modo soporte.
6. Política de retención/auditoría.
7. Estrategia de migración de campos heredados de User para 6.2.2: aprobada/documentada pero su ejecución operativa conserva sus gates.
8. Estrategia de migración para turnos/bloqueos cuando corresponda.
9. Política de compatibilidad/actualización de dependencias.

Los parámetros físicos de 6.2.6-B que antes estaban pendientes ya fueron concretados en su documento normativo y PR #32: TTLs, DNS timeout/retry, rate limits, representations de generations, persisted fence y migration/index strategy.

## 13. Siguiente bloque de trabajo recomendado

La fuente de verdad funcional de 6.2.6-B parte de `master@ed7acfd5fed91b03cd65becd2af154f93dad027b`, que contiene el merge aprobado de PR #31.

PR #32 es el bloque activo y debe permanecer **Draft**. La implementación funcional y las correcciones adversariales conocidas están presentes; CI #326 fue verde sobre el runtime corregido. El siguiente gate no es iniciar 6.3 ni ampliar capabilities: es obtener CI verde sobre el HEAD documental final y realizar una **nueva revisión adversarial independiente** de PR #32.

Deuda que permanece fuera de 6.2.6-B:

1. capabilities públicas separadas para CANCEL/RESCHEDULE/PAYMENT;
2. workflow operativo de reconciliation/refund para Payments que lo requieran;
3. monitoring DNS periódico;
4. CSRF general/sesiones de 6.3;
5. impersonación de 6.4;
6. otras deudas explícitas de fases posteriores.

**6.2.6-B no se declara cerrada ni fusionada desde este plan. 6.2.6 completa continúa abierta.**
