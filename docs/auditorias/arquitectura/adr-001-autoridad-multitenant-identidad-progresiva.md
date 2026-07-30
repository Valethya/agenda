# ADR-001 — Autoridad multitenant e identidad progresiva del cliente

**Estado:** Aprobado; enmienda de `superadmin` incorporada mediante el PR #16
**Fecha original:** 21 de julio de 2026
**Última revisión:** 27 de julio de 2026
**Base de contraste:** `master` después del PR #16 (`5ff906b`)
**Ámbito:** Autorización, identidad, clientes y multitenencia

La decisión arquitectónica continúa vigente. El estado de implementación se
determina mediante el código de `master`, no mediante la fecha original de este
documento. En la base contrastada, `Membership` ya participa en login, selección
de negocio y validaciones de profesionales, pero todavía no es la única autoridad
tenant. El corte definitivo corresponde a 6.2.2.

## Contexto

ATMÓSFERA Agenda admite usuarios con acceso a uno o más negocios, pero actualmente `User.role`, `User.business` y `Membership` pueden competir como fuentes de autorización. Al mismo tiempo, el flujo público necesita permitir reservas como invitado sin exigir una cuenta, una contraseña o una verificación que interrumpa la experiencia.

Una coincidencia de correo o teléfono ayuda a mantener continuidad operativa, pero no demuestra que dos reservas pertenezcan a la misma persona. Tratarla como identidad verificada podría exponer historial o permitir administrar citas ajenas.

## Decisión

### Autoridad de acceso

- `Membership` activa será la única autoridad para rol y acceso dentro de un negocio.
- `User` representará identidad global y privilegios de plataforma, como `superadmin`.
- `User.role` y `User.business` heredados no autorizarán operaciones tenant-scoped y se retirarán mediante una migración posterior.
- El negocio activo de una sesión autenticada deberá corresponder a una membresía activa.
- Toda operación tenant normal, sea de lectura o escritura, requerirá una
  `Membership` activa con el rol suficiente. Las lecturas globales excepcionales
  del plano de plataforma se rigen por una política separada y explícita.

### Tratamiento de `superadmin`

- `superadmin` es un privilegio de plataforma derivado exclusivamente de la
  identidad global. No es un rol tenant y no debe almacenarse en `Membership`.
- Una sesión global de `superadmin` autoriza rutas del plano de plataforma, como
  `/superadmin/*`, sin requerir una membresía.
- Toda inspección global de sólo lectura sobre datos de un tenant estará
  denegada de forma predeterminada y sólo podrá habilitarse mediante una
  política de plataforma explícita para esa lectura. Esa excepción no es una
  operación tenant normal.
- Abrir o seleccionar un negocio aporta únicamente contexto. La selección por
  sí sola no concede ningún rol, incluido `admin`.
- Abrir o seleccionar explícitamente un negocio no convierte al `superadmin` en
  administrador de ese tenant ni autoriza mutaciones.
- Para ejecutar una acción que requiera rol tenant, el actor debe utilizar:
  - una membresía activa con el rol tenant requerido; o
  - para la futura asistencia mutable, una sesión de soporte independiente,
    acotada y auditable según 6.4.
- La impersonación actual no constituye una excepción a esta regla. Mientras se
  sustituye en 6.4, cualquier sujeto administrativo elegido para impersonación
  deberá obtener su rol efectivo desde una membresía activa del negocio.
- Una `Membership` existente con rol `superadmin` será tratada como conflicto de
  datos porque `superadmin` no es un rol válido dentro de `Membership`. La
  migración no la corregirá automáticamente.

### Identidad del cliente

Se utilizará un modelo híbrido:

- una identidad global cuando exista una cuenta o un contacto verificado;
- un perfil tenant-scoped para la relación del cliente con cada negocio;
- un contacto probable para reservas invitadas cuyo correo o teléfono aún no haya sido verificado.

Reservar como invitado no creará una contraseña ficticia ni exigirá login. Correo y teléfono se normalizarán para seguimiento interno, pero una coincidencia no fusionará identidades ni otorgará acceso a historial.

La verificación por correo será obligatoria para:

- consultar historial;
- recuperar o establecer acceso;
- vincular definitivamente un contacto;
- fusionar perfiles;
- resolver contradicciones de identidad.

SMS queda fuera del MVP. WhatsApp podrá añadirse más adelante como canal operativo sin cambiar el modelo de autoridad.

### Continuidad en el dispositivo

El sistema podrá entregar una credencial opaca, segura, revocable y de duración limitada para facilitar nuevas reservas en el mismo dispositivo. Esta credencial:

- no será una prueba de identidad;
- no habilitará historial ni información sensible;
- no autorizará operaciones tenant-scoped de administración;
- tendrá alcance explícito y será rotada o revocada según la política definida.

### Consentimiento

Las comunicaciones necesarias para prestar el servicio se registrarán separadamente del consentimiento de marketing. Reservar una cita no suscribirá automáticamente al cliente a campañas comerciales.

## Invariantes de seguridad

1. Toda autorización tenant-scoped deriva de una membresía activa y del negocio solicitado.
2. Un slug, ID o contacto inexistente no selecciona implícitamente otro negocio o identidad.
3. Una coincidencia de contacto no verificado nunca permite consultar historial ni gestionar citas anteriores.
4. Un perfil de un negocio no puede leerse o modificarse desde otro negocio.
5. La fusión de identidades requiere posesión verificada del contacto y deja evidencia de auditoría.
6. Las contraseñas aleatorias desconocidas por el cliente quedan prohibidas.
7. El privilegio global `superadmin` no concede por sí solo un rol tenant.

## Consecuencias

### Positivas

- La reserva invitada mantiene un recorrido breve.
- Los permisos dejan de depender de campos globales ambiguos.
- Un cliente puede relacionarse con distintos negocios sin compartir datos tenant-scoped indebidamente.
- La verificación se solicita sólo cuando aporta seguridad real.

### Costes y riesgos

- Se requiere migrar campos heredados y revisar todos los puntos de autorización.
- La normalización, deduplicación y fusión necesitan reglas explícitas y pruebas.
- Deben definirse retención, eliminación y tratamiento de contactos probables.
- Las consultas deberán distinguir identidad global, perfil del negocio y contacto verificado.

## Fuera de alcance del MVP

- Verificación mediante SMS.
- Verificación o automatización mediante WhatsApp.
- Un portal global con historial transversal de todos los negocios.
- Fusión automática basada sólo en coincidencias de correo o teléfono.

## Verificación requerida

- Usuario con membresía activa accede únicamente al negocio correspondiente.
- Desactivar la membresía revoca el acceso sin modificar la identidad global.
- Un `User.role` heredado no concede acceso tenant cuando falta una membresía activa.
- Una membresía activa determina el rol tenant aunque el rol heredado del usuario sea distinto.
- Un `superadmin` global no adquiere permisos administrativos tenant por seleccionar un negocio.
- Contacto probable puede reservar, pero no consultar historial.
- Verificar el contacto habilita únicamente los recursos autorizados para esa identidad.
- Negocio A no consulta ni modifica el perfil tenant-scoped del negocio B.
- Intentos de fusión contradictorios se rechazan y quedan auditados.

## Decisiones pendientes relacionadas

- Esquema definitivo y nombres de los modelos persistidos.
- Política de retención de contactos probables.
- Ejecución y verificación productiva de la migración de `User.role` y
  `User.business`, cuya estrategia está definida en
  [`fase-6.2.2-migracion-autoridad-membership.md`](./fase-6.2.2-migracion-autoridad-membership.md).
  El auditor read-only del PR #17 aún no se ha ejecutado contra producción.
  Su futura ejecución exige credencial estrictamente read-only, fingerprint
  aprobado, topología con snapshot temporal y política de conservación del
  informe; el fallback de doble lectura es sólo diagnóstico.
- Estrategia separada de migración de turnos y bloqueos para 6.2.3.
- Arquitectura de dominios y cookies para frontend y backend.
