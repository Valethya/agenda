# ADR-001 — Autoridad multitenant e identidad progresiva del cliente

**Estado:** aprobado para autoridad multitenant; ampliación 6.2.5-A propuesta para revisión  
**Fecha original:** 21 de julio de 2026  
**Última revisión:** 13 de agosto de 2026  
**Base de contraste 6.2.5-A:** `master@2d0a25d3d85d731b6b37e253f04145f658727a33`  
**HEAD adversarial de entrada:** `0505f10202ba68cb20eae2b4493312f24d0e9302`  
**PR precedente verificado:** #25 merged/closed, HEAD `c326846d6a46c4a30dc6ad1ae05308d40b6f459a`  
**Ámbito:** autorización, identidad, clientes y multitenencia

Las decisiones anteriores compatibles permanecen vigentes. El código de `master` es fuente de verdad para el estado runtime.

Documentos relacionados:

- [`fase-6.2.5-a-identidad-progresiva-cliente.md`](./fase-6.2.5-a-identidad-progresiva-cliente.md)
- [`adr-002-agenda-headless-gestion-publica.md`](./adr-002-agenda-headless-gestion-publica.md)

**Relación con ADR-002:** 6.2.5-A complementa ADR-002 y no lo debilita. Para gestión pública de Appointment, ADR-002 ya congela una credencial asociada a **Appointment + Business + una acción**, con operaciones separadas y least privilege.

## Contexto

Agenda debe permitir que una persona reserve antes de crear una cuenta y, si posteriormente existe valor y evidencia suficiente, pueda vincular una identidad global con una relación tenant sin convertir coincidencias de contacto en permisos.

La baseline posterior al PR #25 ya neutraliza el grant inseguro por igualdad `User._id === Appointment.client`, pero conserva deuda legacy:

- booking guest crea/reutiliza User por email/teléfono mediante `getOrCreateGuestUser()`;
- el flujo puede anexar contactos no verificados a un User;
- `Appointment.client` continúa required→User;
- una cuenta no-superadmin sin Membership no completa actualmente sesión normal;
- notificaciones/auditoría legacy pueden registrar PII completa.

Principio rector:

> "La cuenta existe para mejorar la experiencia del cliente con el negocio, no para convertirse en una condición para usar el negocio."

## Decisión

### 1. Identidad global

`User` representa identidad global autenticable, credenciales y privilegios globales explícitos como `superadmin`.

Conceptualmente una cuenta global no requiere Membership:

```text
User autenticado
├── 0..N Memberships
└── 0..N relaciones CustomerProfile
```

Un User puede ser cliente de A, admin de B y worker de C. Son capacidades independientes.

### 2. Autoridad tenant administrativa/profesional

`Membership` activa continúa siendo la única fuente ordinaria de participación y autoridad tenant para administradores/trabajadores.

- roles físicos actuales: `admin | worker`;
- `User.role` / `User.business` legacy no autorizan operaciones tenant;
- `Business.owner` expresa propiedad, no autoridad;
- seleccionar Business aporta contexto, no permisos;
- Membership no representa clientes ni Client authority.

### 3. `superadmin`

`superadmin` es privilegio global derivado de User, no rol Membership.

- puede operar el plano global bajo políticas explícitas;
- inspección tenant global read-only permanece deny-by-default salvo política de plataforma explícita;
- seleccionar Business no lo convierte en admin tenant;
- no adquiere Client authority implícita;
- mutaciones tenant requieren capacidad tenant válida o el futuro mecanismo de soporte mutable separado.

### 4. Relación cliente–Business

Se adopta una relación tenant-scoped denominada **CustomerProfile como nombre conceptual de trabajo**.

Debe:

- pertenecer a un Business;
- poder existir sin User;
- representar continuidad operacional dentro de ese Business;
- poder vincularse a User sólo mediante proceso explícito;
- impedir que Business A descubra relaciones del mismo User con B/C.

No se congela nombre físico, schema ni almacenamiento de contactos.

### 5. Booking guest

El booking público no exige cuenta, contraseña ni Membership.

```text
servicio → profesional → fecha/hora → datos → reservar
```

Puede ofrecer login opcional sin revelar si el email pertenece a una cuenta. Login no congela slot; disponibilidad debe revalidarse antes de persistir.

La semántica legacy de `getOrCreateGuestUser()` se retirará en una fase runtime posterior; no se modifica en 6.2.5-A.

### 6. Contactos, provenance y no contaminación de perfiles

Nombre, email y teléfono declarados son datos de contacto, no identidad ni autorización.

Una coincidencia de contacto:

- no crea binding;
- no fusiona perfiles;
- no concede historial;
- no concede gestión de citas previas;
- no autoriza otro Business;
- **no es suficiente para adjuntar una nueva Appointment a un CustomerProfile preexistente cuando ello pueda ampliar el historial, recursos o capacidades posteriormente autorizables de ese profile.**

El contact match puede ser una señal/candidato interno únicamente si no crea autoridad ni continuidad autorizada implícita.

Ante incertidumbre, colisión, canal compartido o proof insuficiente:

- no reutilizar silenciosamente el profile;
- no auto-mergear;
- no contaminar historial;
- preservar relaciones separadas o fallar cerrado hasta resolución explícita.

No se define aquí schema ni algoritmo de deduplicación.

#### Provenance legacy

Los emails/teléfonos existentes en User **no son trusted identity evidence automáticamente** porque pueden provenir de `getOrCreateGuestUser()` y de input guest no verificado.

Durante 6.2.5 runtime/migración, un contacto legacy de provenance no demostrada:

- no crea binding automáticamente;
- no autoriza claim histórico automáticamente;
- no se usa automáticamente como trusted recovery/identity provenance;
- debe distinguirse de evidencia verificada.

### 7. Verification y continuidad histórica

Una proof de email/teléfono demuestra **control actual del canal**, no identidad legal ni continuidad histórica del sujeto.

Regla congelada:

```text
current channel control != historical subject continuity
```

Por tanto, demostrar hoy control de un email/teléfono no basta por sí solo para reclamar un CustomerProfile histórico que contiene ese contacto.

Aceptar un claim histórico requiere evidencia/política suficiente para **ese CustomerProfile concreto**. Si existe posibilidad razonable de canal reasignado/reciclado, antigüedad, contradicción, pérdida de provenance o incertidumbre, el sistema debe fallar cerrado o exigir proof adicional cuya forma física no se congela aquí.

Esto aplica especialmente a:

- email reciclado;
- teléfono reasignado;
- pérdida de acceso al canal antiguo;
- profile antiguo sin binding;
- profile con provenance legacy dudosa.

### 8. Binding Client — lifecycle

El término **binding** queda reservado para:

```text
User ↔ CustomerProfile
```

Un binding válido debe ser:

- explícito;
- persistido;
- auditable;
- tenant-scoped;
- vigente;
- revocable/invalidadable.

Sólo un binding vigente concede las Client capabilities asociadas al profile según política.

- binding revocado no concede authority;
- revoke/rebind son explícitos y auditables;
- no transfieren historial automáticamente entre Users;
- no reactivan capabilities antiguas;
- carreras create/revoke/rebind se resuelven atómicamente o fail-closed, nunca por last-write-wins silencioso;
- User desactivado, identidad comprometida o sesión stale no mantiene authority únicamente por una copia stale del binding/session.

No se congela máquina de estados ni schema físico.

### 9. APT-CLIENT-01

Continúa vigente sin relajación:

```text
Appointment.client === authenticated User._id
```

no concede por sí solo:

- read;
- list/history;
- cancel;
- reschedule;
- timeline;
- ninguna otra capacidad Client.

`Appointment.client` legacy es una relación persistida histórica/operacional, no proof de ownership histórico ni binding.

### 10. Historial y claim

Queda prohibido:

```text
User.email === CustomerProfile.email -> historial
Appointment.client === User._id -> historial
current channel control -> historical ownership
```

El camino conceptual autorizado es:

```text
User autenticado
+ proof/evidencia aceptada suficiente para ese CustomerProfile
+ claim explícito
+ binding vigente User ↔ CustomerProfile
= historial autorizado de ese CustomerProfile
```

Antes de aceptar el claim no se revela existencia concreta de profile, número de citas, fechas, servicios, profesionales ni historial sensible.

Profile vinculado a otro User, múltiples candidatos, provenance dudosa o contradicción = conflicto fail-closed; nunca overwrite/merge automático. Claims concurrentes no usan last-write-wins silencioso.

### 11. Guest Appointment capability — ADR-002

Para una Appointment guest no se usa el término binding. Se usa **capability / resource grant / Appointment capability**.

Cada capability concreta queda ligada a:

```text
Appointment X
+ Business X
+ UNA acción/purpose
```

Ejemplos separados:

```text
Appointment X + read
Appointment X + cancel
Appointment X + reschedule
```

Una capability emitida para una acción no autoriza otra.

No se adopta un bearer genérico multi-purpose `read+cancel+reschedule` salvo que una ADR futura reabra y justifique explícitamente la decisión ya congelada por ADR-002.

Una capability guest:

- no es identidad global;
- no concede CustomerProfile;
- no concede historial general;
- no concede otras Appointments ni Businesses;
- es expirable y revocable;
- respeta política de replay/uso;
- usa secreto no derivado del Appointment ID;
- no persiste token raw;
- mantiene operaciones/endpoints purpose-specific.

### 12. Protección de links/tokens

Se conserva íntegramente ADR-002:

- links desde origen HTTPS confiable/configurado;
- nunca construir destino desde Host/Origin controlado por request;
- bearer token no aparece en logs ni analytics;
- no aparece en AuditLog/timeline;
- no se filtra por `Referer`;
- aplicar `Referrer-Policy: no-referrer` o política equivalente que conserve esa garantía;
- evitar recursos de terceros antes del canje cuando el bearer viaje en URL;
- persistir digest/representación no raw, nunca token raw;
- endpoints públicos separados y purpose-specific.

### 13. Login durante booking

Si el actor inicia login en medio del booking se preservan servicio, profesional, fecha, hora y notas/contexto. Al regresar se revalidan Business, Service, profesional y disponibilidad antes de persistir.

Login cambia identidad/capacidad, **no congela slot**, no convierte contact match en binding y no auto-vincula historial guest.

### 14. `bookedBy` y `customer`

```text
bookedBy = actor que realiza la reserva
customer = persona que recibe el servicio
```

Normalmente coinciden, pero deben soportarse reservas para hijos, pareja, terceros/asistentes y regalos.

Crear o pagar Appointment para otra persona no concede historial del customer. BookedBy puede recibir únicamente una capability action-scoped de esa Appointment conforme a ADR-002. El contacto del booker no identifica al customer.

Para regalos debe poder diferirse la notificación al destinatario. La forma física/UX queda pendiente.

### 15. Cambio de contacto

Cambiar `User.email`/teléfono no mueve CustomerProfiles, binding ni historial automáticamente.

Un nuevo canal requiere proof según política. La pérdida del canal antiguo requiere recovery separado; current-channel proof nueva no demuestra por sí sola continuidad histórica.

### 16. Auditoría, PII y correlación cross-tenant

Logs, AuditLog, timeline y analytics no deben almacenar/exponer innecesariamente:

- tokens raw;
- capabilities/bearer secrets;
- passwords;
- URIs con credenciales;
- email completo innecesario;
- teléfono completo innecesario;
- digests reutilizables;
- valores normalizados sensibles;
- hashes globales/deterministas de email/teléfono que permitan correlacionar al mismo sujeto entre tenants sin necesidad operacional explícita.

La auditoría debe permitir investigación y provenance sin transformarse en un índice global de identidad.

### 17. Consentimiento

Las comunicaciones necesarias para prestar el servicio permanecen separadas de:

- marketing/promociones;
- fidelización;
- otras comunicaciones comerciales.

Crear Appointment, verificar canal, hacer claim o crear binding no concede consentimiento de marketing.

### 18. Extensibilidad

CustomerProfile es la relación tenant que futuros módulos pueden referenciar, pero no debe convertirse en god object.

Preferir módulos/entidades separados para:

- Loyalty;
- Subscription;
- analytics/CRM projections;
- otras capacidades futuras.

Ninguno de esos módulos concede Client authority implícita. Payment permanece separado y precio de Service/Appointment no equivale a dinero pagado.

## Invariantes de seguridad

1. Autoridad tenant administrativa/profesional deriva de Membership activa + Business correcto.
2. Client authority no deriva de Membership, Business.owner, superadmin, contact match ni segmentación.
3. User puede existir conceptualmente sin Membership.
4. CustomerProfile es tenant-scoped y puede existir sin User.
5. Contact match no concede autorización, binding ni merge.
6. Contact match no puede contaminar silenciosamente un CustomerProfile autorizable adjuntándole nuevas Appointments sin base suficiente.
7. Current channel control no prueba historical subject continuity.
8. Contactos legacy potencialmente originados por `getOrCreateGuestUser()` no son trusted provenance automáticamente.
9. APT-CLIENT-01 permanece fail-closed.
10. Historial requiere claim explícito + evidencia suficiente para el profile + binding vigente.
11. Binding significa sólo `User ↔ CustomerProfile`; es explícito, persistido, auditable, tenant-scoped y revocable.
12. Binding revocado no concede authority; revoke/rebind no transfieren historial ni reactivan grants antiguos.
13. Carreras de claim/binding/revoke/rebind son atómicas o fail-closed; nunca silent last-write-wins.
14. Guest Appointment capability significa `Appointment + Business + una acción/purpose`.
15. Capability de una acción no concede otra ni profile/history.
16. ADR-002 permanece vigente y 6.2.5-A lo complementa.
17. Business A no descubre relaciones CustomerProfile del mismo User en B/C.
18. `bookedBy` y `customer` son responsabilidades distintas.
19. Cambiar contacto no reasigna historial.
20. Login durante booking no reserva slot.
21. Crear Appointment/Verification/claim/binding no implica marketing consent.
22. Secrets/PII no convierten AuditLog/analytics en fuente de exposición o correlación cross-tenant.
23. Loyalty/Subscription/CRM/analytics no son fuentes implícitas de Client authority.

## Consecuencias

### Positivas

- primera reserva mantiene baja fricción;
- identidad global y autoridad tenant siguen separadas;
- una cuenta aporta continuidad sin ser requisito;
- contact collisions no contaminan historial autorizado;
- proof actual de canal no puede secuestrar historia antigua automáticamente;
- binding tiene lifecycle revocable;
- least privilege de ADR-002 permanece intacto;
- reservas para terceros no fuerzan identidad falsa;
- módulos futuros no contaminan autoridad.

### Costes y riesgos

- se requiere retirar gradualmente guest→User legacy;
- sesiones Client y workspace admin deberán desacoplarse;
- provenance legacy necesita auditoría antes de migración/claim;
- shared/recycled contacts, recovery y merge/split requieren políticas posteriores;
- lifecycle de binding necesitará atomicidad y revocación;
- auditoría de identidad deberá reducir PII/correlación.

## Decisiones explícitamente pendientes

Permanecen deliberadamente abiertas:

- nombre físico CustomerProfile/Verification/capability/binding;
- schema exacto;
- contactos embebidos vs entidad separada;
- índices concretos;
- cardinalidad/contacto primario;
- TTL numérico;
- proveedor de email;
- thresholds numéricos de rate limit;
- estructura exacta de sesión Client;
- forma física de `bookedBy/customer` y snapshots;
- algoritmo de deduplicación;
- política concreta merge/split;
- recovery específico y proof adicional;
- estrategia concreta de migración legacy;
- retención/eliminación;
- threshold de sugerencia de cuenta recurrente;
- dominios/cookies/return-to;
- evolución concreta de identity audit;
- política legal de consentimientos comerciales;
- SMS/WhatsApp;
- Loyalty;
- Subscription;
- CRM/analytics;
- Payment.

## Verificación requerida para fases runtime

Como mínimo:

- guest reserva sin cuenta/User ficticio;
- contact match no verificado no adjunta Appointment a profile preexistente autorizable;
- shared/repeated contacts preservan separación o fallan cerrado;
- email reciclado/teléfono reasignado no permiten claim sólo con current-channel proof;
- profile antiguo sin binding/provenance legacy dudosa requiere política/evidencia adicional;
- legacy `User.email/phone` no se presume verified;
- no account/profile enumeration;
- User con 0 Memberships obtiene futura sesión Client global;
- Membership revocada no elimina identidad global;
- login mid-booking conserva intención y revalida slot;
- Verification rechaza scope/purpose/Business/resource mismatch, expiry/revocation/replay según política y carreras;
- links usan trusted origin y no Host/Origin controlado por request;
- token raw/capability/secrets no aparecen en logs, AuditLog, timeline, analytics ni Referer;
- capability `Appointment X + read` no cancela/reagenda;
- capability `Appointment X + cancel` no autoriza otra acción;
- capability no escala a otra Appointment/Business/profile/history;
- email match y `Appointment.client` no conceden history;
- claim válido crea sólo binding autorizado;
- profile ya ligado a otro User falla cerrado;
- claims concurrentes no usan last-write-wins;
- revoke/rebind concurrentes son atómicos/fail-closed;
- binding revocado no autoriza;
- User desactivado/comprometido no conserva authority por stale session/binding;
- bookedBy distinto no accede al historial del customer;
- CustomerProfile cross-tenant es inaccesible;
- logs/analytics no introducen correlación transversal mediante contactos o hashes globales deterministas.

`APT-CLIENT-01` permanece como test de regresión durante toda 6.2.5.
