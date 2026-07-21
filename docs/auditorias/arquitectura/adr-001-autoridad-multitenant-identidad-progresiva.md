# ADR-001 — Autoridad multitenant e identidad progresiva del cliente

**Estado:** Aprobado
**Fecha:** 21 de julio de 2026
**Ámbito:** Autorización, identidad, clientes y multitenencia

## Contexto

ATMÓSFERA Agenda admite usuarios con acceso a uno o más negocios, pero actualmente `User.role`, `User.business` y `Membership` pueden competir como fuentes de autorización. Al mismo tiempo, el flujo público necesita permitir reservas como invitado sin exigir una cuenta, una contraseña o una verificación que interrumpa la experiencia.

Una coincidencia de correo o teléfono ayuda a mantener continuidad operativa, pero no demuestra que dos reservas pertenezcan a la misma persona. Tratarla como identidad verificada podría exponer historial o permitir administrar citas ajenas.

## Decisión

### Autoridad de acceso

- `Membership` activa será la única autoridad para rol y acceso dentro de un negocio.
- `User` representará identidad global y privilegios de plataforma, como `superadmin`.
- `User.role` y `User.business` heredados no autorizarán operaciones tenant-scoped y se retirarán mediante una migración posterior.
- El negocio activo de una sesión autenticada deberá corresponder a una membresía activa.

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
- Contacto probable puede reservar, pero no consultar historial.
- Verificar el contacto habilita únicamente los recursos autorizados para esa identidad.
- Negocio A no consulta ni modifica el perfil tenant-scoped del negocio B.
- Intentos de fusión contradictorios se rechazan y quedan auditados.

## Decisiones pendientes relacionadas

- Esquema definitivo y nombres de los modelos persistidos.
- Política de retención de contactos probables.
- Estrategia de migración de `User.role`, `User.business`, turnos y bloqueos.
- Arquitectura de dominios y cookies para frontend y backend.
