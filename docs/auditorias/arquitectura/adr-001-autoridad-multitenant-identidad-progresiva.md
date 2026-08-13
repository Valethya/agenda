# ADR-001 — Autoridad multitenant e identidad progresiva del cliente

**Estado:** aprobado para autoridad multitenant; ampliación 6.2.5-A propuesta para revisión  
**Fecha original:** 21 de julio de 2026  
**Última revisión:** 13 de agosto de 2026  
**Base de contraste 6.2.5-A:** `master@2d0a25d3d85d731b6b37e253f04145f658727a33`  
**PR precedente verificado:** #25 merged/closed, HEAD `c326846d6a46c4a30dc6ad1ae05308d40b6f459a`  
**Ámbito:** autorización, identidad, clientes y multitenencia

Las decisiones anteriores compatibles permanecen vigentes. El código de `master` es fuente de verdad para el estado de implementación. Esta revisión aclara una distinción que debe quedar explícita antes de 6.2.5 runtime: **Membership es autoridad tenant de administradores/trabajadores; la capacidad Client es un plano independiente y nunca se deriva de Membership.**

Documento detallado de auditoría: [`fase-6.2.5-a-identidad-progresiva-cliente.md`](./fase-6.2.5-a-identidad-progresiva-cliente.md).

## Contexto

Agenda debe permitir que una persona use un Business antes de crear una cuenta y, si posteriormente obtiene valor de ella, pueda vincular una identidad global sin convertir coincidencias de contacto en permisos.

La baseline ya cerró las fronteras tenant de Appointment y neutralizó el grant inseguro por igualdad `User._id === Appointment.client`. Sin embargo, el booking guest actual todavía crea/reutiliza un `User` global mediante email/teléfono, y una cuenta no-superadmin sin Membership no completa una sesión normal. Ambos comportamientos son legacy que 6.2.5 deberá retirar por fases.

Principio rector:

> "La cuenta existe para mejorar la experiencia del cliente con el negocio, no para convertirse en una condición para usar el negocio."

## Decisión

### 1. Identidad global

`User` representa:

- identidad global autenticable;
- credenciales;
- privilegios globales explícitos de plataforma, como `superadmin`.

Una cuenta global **no requiere Membership** conceptualmente. La arquitectura objetivo admite:

```text
User autenticado
├── 0..N Memberships
└── 0..N relaciones CustomerProfile
```

Un User puede ser cliente de un Business, admin de otro y worker de un tercero. Esas capacidades son independientes.

### 2. Autoridad tenant administrativa/profesional

`Membership` activa continúa siendo la única fuente ordinaria de participación y autoridad tenant para administradores/trabajadores.

- roles físicos actuales: `admin | worker`;
- `User.role` y `User.business` legacy no autorizan operaciones tenant;
- `Business.owner` expresa propiedad, no autoridad;
- seleccionar Business aporta contexto, no rol;
- una Membership de un Business no autoriza otro Business.

**Aclaración 6.2.5:** esta regla no significa que un cliente necesite Membership. Las capacidades Client se obtienen mediante binding/capability verificados y acotados, no mediante Membership.

### 3. `superadmin`

- es privilegio global derivado de User, no rol Membership;
- puede operar el plano global conforme a políticas explícitas;
- inspección global tenant read-only permanece deny-by-default salvo política de plataforma explícita;
- seleccionar un Business no lo convierte en admin tenant;
- mutaciones tenant requieren una capacidad tenant válida o el mecanismo de soporte mutable futuro definido separadamente.

### 4. Relación cliente–Business

Se adopta una relación tenant-scoped, denominada **`CustomerProfile` como nombre conceptual de trabajo**.

Debe:

- pertenecer obligatoriamente a un Business;
- poder existir con `user = null`;
- representar continuidad operacional del cliente dentro de ese Business;
- poder vincularse posteriormente a un User mediante proceso explícito y auditable;
- no revelar a un Business las relaciones del mismo User con otros Businesses.

No se congela todavía el nombre físico ni si los contactos tenant se almacenarán embebidos o en entidad separada.

### 5. Booking guest

El booking público no exige cuenta ni contraseña.

El flujo objetivo continúa siendo:

```text
servicio → profesional → fecha/hora → datos → reservar
```

La UX puede ofrecer login opcional para usar datos guardados, pero debe permitir continuar como invitado y no revelar si el email introducido pertenece a una cuenta.

La semántica legacy de `getOrCreateGuestUser()` —lookup global por email/teléfono, append de contactos y creación de User con password aleatorio— debe retirarse en una fase runtime posterior. No se modifica en 6.2.5-A.

### 6. Contactos y verificación

Nombre, email y teléfono declarados son datos de contacto, no prueba de identidad.

Una coincidencia de contacto:

- no crea binding;
- no fusiona perfiles;
- no concede historial;
- no concede gestión de citas anteriores;
- no autoriza otro Business.

En MVP, email verification demuestra **control del canal**, no identidad legal personal.

El mecanismo futuro de Verification debe ser, como mínimo:

- token opaco, criptográficamente seguro y sin PII;
- digest almacenado server-side, no token raw;
- purpose-bound;
- business-bound;
- resource/profile-bound;
- expirable;
- single-use y replay-safe;
- consumido atómicamente;
- rate limited;
- auditable sin secretos;
- emitido mediante links con origen HTTPS confiable fijo/configurado, nunca derivado de Host/Origin controlado por request.

SMS queda fuera del MVP. Proveedor de email, thresholds y canales adicionales no se congelan aquí.

### 7. Binding y capacidad Client

Se separan dos conceptos:

**Binding User↔CustomerProfile:** relación explícita, persistida y auditable que habilita capacidades Client sobre un perfil tenant determinado.

**Capability purpose-specific:** grant mínimo sobre un recurso/purpose concreto, por ejemplo una Appointment guest verificada.

Una capability no se convierte en identidad global ni en historial general.

### 8. APT-CLIENT-01

Continúa vigente sin relajación:

```text
Appointment.client === authenticated User._id
```

no concede por sí solo:

- read;
- history/list;
- cancel;
- reschedule;
- timeline;
- ninguna otra capacidad Client.

El `Appointment.client` legacy es relación persistida histórica/operacional, **no prueba de ownership histórico verificado**.

### 9. Historial y claim

Queda prohibido:

```text
User.email === CustomerProfile.email -> historial
Appointment.client === User._id -> historial
```

El camino autorizado es:

```text
User autenticado
+ proof vigente/aceptada
+ claim explícito
+ binding User ↔ CustomerProfile
= historial autorizado de ese CustomerProfile
```

Antes de proof aceptada no se revela existencia del perfil, número de citas, fechas, servicios, profesionales ni historial sensible.

Si existe ambigüedad —canal compartido, múltiples perfiles candidatos o perfil vinculado a otro User— el sistema falla cerrado o exige una política de resolución adicional. Nunca auto-mergea.

### 10. Guest verificado sobre una Appointment

Un guest puede adquirir, según política futura, una capability sobre **una Appointment concreta** sin crear cuenta.

La capability puede incluir sólo purposes explícitos, por ejemplo read/cancel/reschedule si la fase runtime los aprueba. No concede otras Appointments, perfiles, Businesses ni historial general.

### 11. Login durante booking

Si el actor inicia login en medio de una reserva, deben preservarse servicio, profesional, fecha, hora y notas/contexto relevante. Tras volver al flujo se revalida disponibilidad e invariantes antes de persistir.

Login cambia identidad/capacidad; **no congela un slot** y no auto-vincula historial guest.

### 12. `bookedBy` y `customer`

Se congela la distinción:

```text
bookedBy = actor que realiza la reserva
customer = persona que recibe el servicio
```

Normalmente coinciden, pero deben soportarse reservas para hijos, pareja, terceros/asistentes y regalos.

Crear o pagar una Appointment para otra persona no concede historial del receptor. Puede existir una capability acotada a esa Appointment para bookedBy. El contacto del booker no identifica al customer.

Para regalos debe poder diferirse la notificación al destinatario; la UX final queda pendiente.

### 13. Cambio de contacto

Cambiar `User.email` o teléfono no mueve CustomerProfiles ni historial automáticamente. Un nuevo canal verificado requiere proof y auditabilidad propias.

La pérdida del canal antiguo requiere una política de recuperación separada; coincidencias débiles no bastan para entregar historial.

### 14. Consentimiento

Las comunicaciones necesarias para prestar el servicio se separan de:

- marketing/promociones;
- fidelización;
- otras comunicaciones comerciales.

Crear una Appointment no concede consentimiento de marketing.

### 15. Extensibilidad

CustomerProfile es la relación tenant que futuros módulos pueden referenciar, pero no debe convertirse en god object.

Preferir módulos/entidades separados para:

- Loyalty;
- Subscription;
- analytics projections/segments;
- otras capacidades CRM.

No almacenar indiscriminadamente métricas derivadas o estados financieros en CustomerProfile.

Payment permanece separado. Precio de Service/Appointment no equivale a dinero pagado.

## Invariantes de seguridad

1. La autoridad tenant administrativa/profesional deriva de Membership activa y Business correcto.
2. Customer/client authority **no** deriva de Membership ni de Business.owner.
3. Un User puede autenticarse conceptualmente sin Membership.
4. `CustomerProfile` es siempre tenant-scoped y puede existir sin User.
5. Contact match no concede autorización, binding ni merge.
6. `APT-CLIENT-01` permanece fail-closed hasta binding/capability verificable.
7. Historial requiere claim explícito y binding válido.
8. No hay auto-merge de identidad por nombre/email/teléfono.
9. Verification/capability es purpose-, Business- y resource/profile-scoped.
10. Un Business no descubre relaciones CustomerProfile del mismo User en otros Businesses.
11. `bookedBy` y `customer` son responsabilidades distintas.
12. Cambiar contacto no reasigna historial automáticamente.
13. Login durante booking no reserva el slot.
14. Crear Appointment no implica marketing consent.
15. Secretos de Verification/capabilities no deben registrarse en logs/timeline.

## Consecuencias

### Positivas

- la primera reserva sigue siendo de baja fricción;
- identidad global y relación comercial tenant dejan de competir;
- una cuenta puede aportar continuidad sin ser requisito de uso;
- perfiles de distintos negocios quedan aislados;
- historial se recupera mediante prueba y claim, no por coincidencias;
- reservas para terceros dejan de forzar una identidad falsa;
- Loyalty/Subscription/CRM pueden crecer sin contaminar autoridad.

### Costes y riesgos

- se necesita retirar gradualmente la semántica guest basada en User;
- sesiones Client y workspace admin deberán desacoplarse;
- legacy `Appointment.client` requiere transición/claim explícito;
- shared contacts, merge/split y recovery requieren políticas humanas antes de automatizar;
- la auditoría de identidad debe evitar PII y secretos.

## Decisiones explícitamente pendientes

- nombres físicos definitivos de CustomerProfile/Verification/binding/capability;
- contactos embebidos versus entidad tenant separada;
- retención de guest/contactos;
- prueba adicional para canales compartidos/ambiguos;
- recovery sin canal previamente verificado;
- política y permisos de merge/split;
- forma física de `bookedBy/customer` y snapshots históricos;
- operations y TTL de capabilities guest;
- thresholds/rate limits y proveedor de email;
- umbral de sugerencia de cuenta recurrente;
- dominios/cookies/return-to del login Client;
- estrategia concreta de migración de `Appointment.client` legacy;
- evolución de AuditLog/identity audit;
- política legal de consentimientos comerciales;
- Loyalty, Subscription, analytics, SMS, WhatsApp y Payment.

## Verificación requerida para fases runtime

Como mínimo:

- guest reserva sin cuenta/User ficticio;
- no account/profile enumeration;
- User con cero Memberships establece sesión Client global;
- Membership revocada no elimina identidad global;
- login mid-booking conserva intención y revalida slot;
- verification rechaza purpose/Business/resource mismatch, expiry, replay y doble consumo;
- concurrencia de verification/claim es atómica;
- capability guest no escala a historial/otro Business;
- contacto igual y `Appointment.client` no conceden historial;
- claim válido crea sólo binding autorizado;
- perfiles ya ligados/ambiguos fallan cerrado;
- bookedBy distinto no accede al historial del customer;
- CustomerProfile cross-tenant es inaccesible;
- tokens/capabilities/digests no aparecen en logs/timeline.

`APT-CLIENT-01` debe conservarse como test de regresión durante toda 6.2.5.
