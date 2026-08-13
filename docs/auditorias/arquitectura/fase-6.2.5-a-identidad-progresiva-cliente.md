# Fase 6.2.5-A — Identidad progresiva del cliente

**Estado:** contrato arquitectónico propuesto para revisión  
**Naturaleza:** auditoría + contrato + documentación; **sin runtime**  
**Fecha:** 2026-08-13  
**Baseline exacta:** `master@2d0a25d3d85d731b6b37e253f04145f658727a33`  
**HEAD adversarial de entrada:** `0505f10202ba68cb20eae2b4493312f24d0e9302`  
**PR precedente:** #25 merged/closed, HEAD aprobado `c326846d6a46c4a30dc6ad1ae05308d40b6f459a`.

> "La cuenta existe para mejorar la experiencia del cliente con el negocio, no para convertirse en una condición para usar el negocio."

6.2.5-A define fronteras de identidad y autorización. No implementa modelos, tokens, sesiones Client, claims, bindings, capabilities, migraciones ni UI.

## 1. Baseline exacta y alcance

Se preservan sin reapertura:

- `User` = identidad global autenticable;
- `Membership` activa = única autoridad tenant ordinaria para `admin|worker`;
- Membership no representa clientes;
- `User.role` / `User.business` legacy no conceden autoridad tenant;
- `Business.owner` expresa propiedad, no autoridad;
- seleccionar Business aporta contexto, no permisos;
- `superadmin` es privilegio global, no rol Membership, y no adquiere permisos admin/Client implícitos;
- `Appointment.business` es ownership tenant obligatorio;
- `Appointment.service.business === Appointment.business`;
- Client authority es independiente de Membership;
- booking público debe poder continuar sin cuenta.

`APT-CLIENT-01` permanece íntegro:

```text
Appointment.client === authenticated User._id
```

**NO concede por sí solo** read, list/history, cancel, reschedule, timeline ni otra Client capability.

Esta fase no modifica runtime, tests, migrations, seeds, Payment/Webpay, Holiday, UI ni deploy.

## 2. Inventario actual

En `master@2d0a25d3...`:

- `User` contiene nombre, arrays globales de email/teléfono, password, `role` y `business` legacy.
- `user.repository` hace lookup global por email y teléfono.
- `Membership` es `{user,business,role,isActive}`, roles `admin|worker`, unique `{user,business}`.
- `tenantAuthority.service` revalida User activo + Membership activa + Business activo y no confía en `User.role`, `User.business` ni rol copiado en sesión.
- `POST /appointments` continúa público y tenant-scoped.
- `appointment.controller` usa `getOrCreateGuestUser(clientInfo)` y persiste ese User como `Appointment.client`.
- `Appointment.client` referencia `User` y es required.
- no existen todavía CustomerProfile, Verification, claim, binding Client ni capability pública 6.2.5.
- `resolveSessionFromUser()` rechaza actualmente a un User no-superadmin sin Membership.
- PR #25 neutralizó grants Client basados sólo en `Appointment.client`.
- notificaciones actuales recuperan contacto desde `Appointment.client` y pueden registrar emails completos en AuditLog.
- ADR-002 ya define la gestión pública de Appointment con una credencial asociada a Appointment + Business + **una acción**, expirable/revocable, no persistida raw, redactada de logs/analytics y protegida frente a Referer.

## 3. Contradicciones runtime actuales

**ID-LEGACY-01 — guest→User:** `getOrCreateGuestUser()` busca User por email, fallback por teléfono, puede anexar nuevos emails/teléfonos al User encontrado y puede crear User con password aleatorio.

**ID-LEGACY-02 — provenance no confiable:** por ID-LEGACY-01, parte de `User.email`/`User.phone` puede provenir de input guest no verificado. Esos valores legacy no son automáticamente evidencia de identidad verificada, recovery confiable ni continuidad histórica.

**ID-SESSION-01:** autenticación global está acoplada actualmente a Membership para completar sesión normal.

**ID-CONTACT-01:** email/teléfono pueden ser compartidos, reciclados, reasignados, escritos con typo o añadidos por flujo legacy; una coincidencia no es proof.

**ID-APPOINTMENT-01:** Appointment obliga hoy a materializar User para guest.

**ID-ACTOR-01:** runtime no distingue `bookedBy != customer`.

**ID-AUDIT-01:** AuditLog admite metadata/technicalMessage flexibles y notificaciones actuales incluyen PII completa; futura identidad no debe convertir auditoría en un índice de exposición o correlación cross-tenant.

Estas deudas se documentan; no se corrigen aquí.

## 4. Modelo conceptual

```text
GLOBAL
User = identidad autenticable + credenciales
   |
   | binding explícito, vigente, tenant-scoped (0..N)
   v
TENANT
CustomerProfile* ---- Business
   |
   +--- Appointments
   +--- future Loyalty
   +--- future Subscription

SEGURIDAD
Verification / proof
claim
Appointment capability (resource grant)
```

`CustomerProfile` es nombre conceptual de trabajo, no nombre físico congelado.

- **User:** identidad global; puede existir con 0 Memberships y 0 CustomerProfiles.
- **CustomerProfile:** relación cliente–un Business; puede existir sin User; jamás expone relaciones del mismo User con otros Businesses.
- **Appointment:** reserva operacional concreta; no representa identidad global.
- **Verification:** evidencia acotada; una proof de canal demuestra control actual de ese canal, no continuidad histórica del sujeto.
- **claim:** solicitud explícita de vincular/recuperar una relación histórica.
- **binding:** reservado exclusivamente para la relación `User ↔ CustomerProfile`.
- **capability / resource grant:** grant concreto sobre una Appointment; no se denomina binding.

La forma física de estas entidades queda pendiente.

## 5. Vocabulario

| Término | Semántica congelada |
|---|---|
| visitante anónimo | sin sesión ni datos declarados |
| guest declarado | entregó datos; contacto aún no demostrado |
| guest con contacto verificado | demostró control actual de un canal para un scope/purpose; no identidad personal/histórica |
| cliente recurrente | segmentación de negocio; nunca autorización |
| User | identidad global autenticable |
| Membership | autoridad tenant admin/worker |
| CustomerProfile | relación conceptual cliente–Business tenant-scoped |
| contact | nombre/email/teléfono declarado; no autoridad |
| Verification | evidencia de una prueba concreta |
| proof | evidencia aceptable para el propósito evaluado; una proof de canal sólo prueba control actual del canal |
| claim | solicitud explícita de vincular/recuperar CustomerProfile |
| binding | relación explícita `User ↔ CustomerProfile`; nunca guest Appointment grant |
| capability | grant sobre recurso/acción concretos |
| bookedBy | actor que realiza la reserva |
| customer | persona que recibe el servicio |
| Client authority | permisos de cliente derivados de binding vigente o capability válida, no de Membership/contact match |

## 6. Trust boundaries

1. **Público→API:** datos declarados no son proof.
2. **Sesión→User:** autenticar User no prueba ownership de perfiles históricos.
3. **User→Membership:** admin/worker deriva sólo de Membership activa.
4. **User→CustomerProfile:** requiere binding explícito y vigente.
5. **Business→CustomerProfile:** lookup siempre tenant-scoped y fail-closed.
6. **Contact→CustomerProfile:** coincidencia no verificada puede ser señal/candidato, pero no puede crear continuidad autorizable ni adjuntar silenciosamente nuevas Appointments a un profile preexistente.
7. **Verification→claim:** control actual de canal no equivale a continuidad histórica del sujeto.
8. **Capability→Appointment:** cada capability concreta es Appointment + Business + **una sola acción/purpose**.
9. **Email transport:** links desde origen HTTPS confiable/configurado; nunca desde Host/Origin controlado por request.
10. **Logs/analytics:** no son autoridad ni deben actuar como índice global de identidad.

## 7. Estados conceptuales

1. **Visitante anónimo:** puede navegar recursos públicos.
2. **Guest declarado:** puede reservar con datos declarados; contacto no demostrado.
3. **Guest con contacto verificado:** control actual del canal demostrado; puede obtener, según política, una capability action-scoped de Appointment sin cuenta.
4. **Cliente recurrente:** relación/segmentación acumulada; no estado de autorización.
5. **User global:** cuenta autenticable con 0..N Memberships y 0..N CustomerProfiles.
6. **User vinculado:** posee un binding vigente, explícito y tenant-scoped con un CustomerProfile.

## 8. Capacidades

| Capacidad | Fuente | Scope |
|---|---|---|
| identidad autenticada | sesión User vigente | global; no historial implícito |
| admin/worker tenant | Membership activa | un Business |
| guest Appointment read | capability `Appointment X + Business X + read` | sólo read de esa Appointment |
| guest Appointment cancel | capability `Appointment X + Business X + cancel` | sólo cancel de esa Appointment |
| guest Appointment reschedule | capability `Appointment X + Business X + reschedule` | sólo reschedule de esa Appointment |
| Client profile | claim aceptado + binding vigente | un CustomerProfile tenant-scoped |
| superadmin | privilegio global | plano de plataforma según política; no Client/tenant implícito |

**ADR-002 prevalece para gestión pública de Appointment.** Una capability emitida para una acción no autoriza otra. No se adopta un bearer genérico `read+cancel+reschedule`; una ADR futura tendría que reabrir y justificar explícitamente esa decisión.

## 9. Invariantes congeladas

- **ID-INV-01:** booking público no requiere cuenta ni Membership.
- **ID-INV-02:** Membership no representa clientes.
- **ID-INV-03:** nombre/email/teléfono iguales no autorizan, no crean binding y no auto-mergean.
- **ID-INV-04 — no profile contamination:** un contacto no verificado **NO es suficiente para adjuntar una nueva Appointment a un CustomerProfile preexistente** cuando ello pueda ampliar historial, recursos o capacidades posteriormente autorizables de ese profile.
- **ID-INV-05:** contact match sólo puede usarse como señal/candidato si no crea autoridad ni continuidad autorizada implícita.
- **ID-INV-06:** ante colisión, canal compartido, incertidumbre o proof insuficiente: no reutilizar silenciosamente profile, no auto-mergear, preservar relaciones separadas o fallar cerrado hasta resolución explícita.
- **ID-INV-07:** APT-CLIENT-01 permanece fail-closed.
- **ID-INV-08:** historial exige User autenticado + evidencia/política suficiente para el CustomerProfile concreto + claim explícito + binding vigente.
- **ID-INV-09 — channel continuity:** control actual de email/teléfono **NO prueba por sí solo continuidad histórica del sujeto** con un CustomerProfile.
- **ID-INV-10:** current channel control sólo demuestra control actual de ese canal. Ante posible reasignación/reciclaje, antigüedad, provenance dudosa o contradicción, el claim histórico falla cerrado o exige proof adicional aún no diseñada.
- **ID-INV-11:** CustomerProfile siempre tenant-scoped y puede existir sin User.
- **ID-INV-12:** no existe auto-merge por colisiones.
- **ID-INV-13:** una capability guest concreta es `Appointment + Business + una sola acción/purpose`, revocable y expirable.
- **ID-INV-14:** capability de una acción nunca concede otra acción, profile, historial, otra Appointment ni otro Business.
- **ID-INV-15:** `Appointment.client` legacy no se promueve a ownership/binding.
- **ID-INV-16:** contactos legacy potencialmente originados por `getOrCreateGuestUser()` no son trusted identity/recovery/claim evidence automáticamente.
- **ID-INV-17:** binding es explícito, persistido, auditable, tenant-scoped, **vigente y revocable/invalidadable**.
- **ID-INV-18:** binding revocado no concede Client authority; revoke/rebind son explícitos, auditables y no transfieren historial automáticamente entre Users.
- **ID-INV-19:** revocar/rebindear no reactiva capabilities antiguas; carreras binding/revoke/rebind son atómicas o fail-closed, nunca last-write-wins silencioso.
- **ID-INV-20:** User desactivado, identidad comprometida o sesión stale no conserva authority únicamente por copia stale de binding/session.
- **ID-INV-21:** cambiar email/teléfono no mueve historial automáticamente.
- **ID-INV-22:** `bookedBy` y `customer` son distintos; bookedBy no hereda historial del customer.
- **ID-INV-23:** login durante booking no congela slot; disponibilidad se revalida antes de persistir.
- **ID-INV-24:** Appointment no implica marketing consent.
- **ID-INV-25:** Loyalty/Subscription/CRM/analytics no son fuentes implícitas de Client authority.

## 10. Threat model

| Amenaza | Mitigación contractual |
|---|---|
| account/profile enumeration | respuestas no revelan si cuenta/profile/history existe |
| profile contamination por contact match | no adjuntar Appointment a profile preexistente sin base suficiente; separar/fail-closed |
| shared/recycled contact takeover | current channel control != historical subject continuity |
| legacy provenance escalation | `User.email/phone` legacy no se presume verified |
| cross-tenant IDOR | business-scoped lookup, fail-closed |
| purpose confusion | capability concreta = Appointment + Business + single action |
| replay/expiry | expiración, revocación, política de replay/uso y consumo seguro según propósito |
| concurrent verification/claim | atomicidad; no silent last-write-wins |
| concurrent binding/revoke/rebind | atomicidad o fail-closed |
| legacy false ownership | `Appointment.client` no se promueve a binding |
| contact-change takeover | cambio de canal no mueve history/binding |
| stale identity/session | revalidar identidad/binding vigente al autorizar |
| bearer leakage | no raw token en persistencia/logs/analytics/Referer |
| cross-tenant correlation | no hashes/digests globales deterministas de contactos usados como índice transversal sin necesidad operacional |
| gift disclosure | delivery intent explícito y notificación diferible |
| bookedBy/customer confusion | bookedBy, como máximo, capability action-scoped de esa Appointment |
| stale booking after login | revalidar disponibilidad antes de create |
| mass verification abuse | rate limiting; cifras quedan pendientes |

## 11. Privacidad tenant y auditoría

Business A sólo puede conocer su relación con el cliente. No recibe IDs, nombres, conteos de perfiles ni historial de B/C.

Logs, AuditLog, timeline y analytics no deben almacenar o exponer innecesariamente:

- tokens raw;
- capabilities/bearer secrets;
- passwords;
- URIs con credenciales;
- email completo innecesario;
- teléfono completo innecesario;
- digests reutilizables;
- valores normalizados sensibles;
- hashes globales/deterministas de email/teléfono que permitan correlacionar al mismo sujeto entre tenants sin necesidad operacional explícita.

La auditoría debe conservar provenance, decisiones y correlación investigable **sin convertirse en un índice global de identidad**. Una proyección funcional segura no vuelve aceptable persistir secretos innecesarios en origen.

## 12. Flujo guest y no contaminación de CustomerProfile

Objetivo UX:

```text
servicio → profesional → fecha/hora → datos → reservar
```

Puede ofrecer “¿Ya tienes cuenta? Inicia sesión para usar tus datos guardados” con **Iniciar sesión** / **Continuar como invitado**, sin account enumeration.

Una reserva guest nueva no debe requerir User ficticio en la arquitectura objetivo.

**Regla de continuidad:** email/teléfono repetido puede producir un candidato interno, pero no permite reutilizar silenciosamente un CustomerProfile ya existente si la nueva Appointment pasaría a formar parte del historial posteriormente autorizable de ese profile.

Ejemplo prohibido:

```text
Alice -> CustomerProfile P
Bob usa contacto compartido/reciclado/conocido
match(contact) -> P
Appointment de Bob -> P   // PROHIBIDO sin evidencia suficiente
```

Ante incertidumbre se preservan relaciones separadas o se falla cerrado. No se congela schema ni algoritmo de deduplicación.

## 13. Flujo authenticated y login durante booking

Arquitectura objetivo:

```text
User autenticado
├── 0..N Memberships
└── 0..N CustomerProfiles
```

El workspace administrativo sigue exigiendo Membership; la identidad global/Client no.

Si el actor inicia sesión durante booking, se preservan servicio, profesional, fecha, hora y notas/contexto relevante. Al volver se revalidan Business, Service, profesional y disponibilidad. Login cambia identidad/capacidad, **no congela slot**, no convierte contact match en binding y no auto-vincula historial guest.

## 14. Verification y capabilities públicas

### 14.1 Verification / proof

Contrato futuro mínimo, sin implementación:

- token opaco, criptográficamente seguro, sin PII;
- persistir sólo digest, nunca token raw;
- purpose-bound;
- business-bound;
- ligado al recurso/profile concreto requerido por el flujo;
- expiración;
- single-use cuando corresponda a la proof;
- replay-safe según política;
- consumo atómico;
- revocable cuando corresponda;
- rate limited;
- auditable sin secretos;
- outcome externo no enumerable.

Una proof de email/teléfono demuestra **control actual del canal**, no identidad legal ni continuidad histórica.

### 14.2 Protección de links/tokens — conservación ADR-002

- no construir links desde Host/Origin controlado por request;
- usar origen HTTPS confiable/configurado;
- bearer token no aparece en logs ni analytics;
- no aparece en AuditLog/timeline;
- no debe filtrarse por `Referer`;
- aplicar política equivalente a `Referrer-Policy: no-referrer` según ADR-002;
- evitar recursos de terceros antes del canje cuando un bearer viaje en URL;
- no persistir token raw;
- endpoints/operaciones públicos permanecen purpose-specific.

### 14.3 Guest Appointment capability — complemento de ADR-002

Cada credencial/capability concreta para gestión guest queda ligada a:

```text
Appointment X
+ Business X
+ UNA acción/purpose
```

Ejemplos **separados**:

```text
Appointment X + read
Appointment X + cancel
Appointment X + reschedule
```

Una capability de `read` no cancela ni reagenda. Una de `cancel` no da `read` sensible salvo el contexto mínimo requerido por esa operación. Una de `reschedule` no concede cancel.

No se usa un único bearer grant genérico multi-purpose `read+cancel+reschedule` salvo una ADR futura que reabra y justifique explícitamente el least privilege ya congelado por ADR-002.

SMS queda fuera del MVP. Proveedor de email, TTL numérico y thresholds permanecen abiertos.

## 15. History claim y continuidad histórica

Prohibido:

```text
User.email === CustomerProfile.email -> historial
Appointment.client === User._id -> historial
current email/phone control -> historical ownership
```

Camino conceptual autorizado:

```text
User autenticado
+ proof/evidencia aceptada suficiente para ESE CustomerProfile
+ claim explícito
+ binding vigente User ↔ CustomerProfile
= historial autorizado del CustomerProfile correspondiente
```

**Current channel control != historical subject continuity.**

Una proof válida sobre `persona@example.com` sólo prueba control actual del canal. No basta, por sí sola, para reclamar un profile antiguo que contiene ese email. Si existe posibilidad razonable de canal reciclado/reasignado, antigüedad, contradiction, pérdida de provenance, legacy provenance dudosa o incertidumbre, el claim falla cerrado o requiere proof adicional cuya forma física queda pendiente.

Antes de aceptar el claim no se revela existencia concreta del profile, número de citas, fechas, servicios, profesionales ni historial sensible.

Profile ya vinculado a otro User = conflicto; nunca overwrite automático. Claims concurrentes y binding concurrente deben usar atomicidad/fail-closed, no last-write-wins.

## 16. `bookedBy` y `customer`

```text
bookedBy = actor que realiza la reserva
customer = persona que recibe el servicio
```

Normalmente coinciden; también deben soportarse padre/madre→hijo, pareja→pareja, asistente→tercero y regalo.

Crear o pagar Appointment para otro **no** concede al bookedBy historial del customer. Puede conceder una capability action-scoped sobre esa Appointment conforme a ADR-002. El email del bookedBy no identifica al customer.

Para regalos, la notificación al destinatario debe poder diferirse. La forma física y UX quedan pendientes.

## 17. Transición legacy y provenance

Reglas:

```text
legacy Appointment.client != verified historical ownership
legacy User.email/User.phone != trusted verified provenance by default
```

La futura fase runtime debe retirar la semántica de `getOrCreateGuestUser()` del booking nuevo.

Durante migración/claim:

- un contacto cuya provenance pueda venir del flujo guest legacy no se considera automáticamente verificado;
- no crea binding automáticamente;
- no autoriza claim histórico automáticamente;
- no se usa automáticamente como recovery/identity provenance confiable;
- la estrategia futura debe distinguir datos legacy de evidencia verificada.

Orden conceptual seguro: mantener legacy fail-closed → introducir relación tenant para nuevas reservas → implementar proof + capabilities action-scoped → desacoplar sesión Client → implementar claim/binding vigente → sólo después diseñar migración/claim histórico.

No se congela si la transición reescribe `Appointment.client`, añade otra referencia o mantiene compatibilidad.

## 18. Consentimiento

Separar:

1. comunicación operacional necesaria para la reserva;
2. marketing/promociones;
3. fidelización;
4. otras comunicaciones comerciales.

Appointment no implica marketing. Verification/claim tampoco equivale a consentimiento comercial. Retención, withdrawal y base legal quedan para revisión posterior.

## 19. CRM / Loyalty / Subscription

CustomerProfile es relación tenant, no god object. Loyalty, Subscription y analytics/CRM projections deben ser módulos/entidades separados que lo referencien.

Ninguno de esos módulos concede Client authority implícita. No almacenar métricas derivadas indiscriminadamente en CustomerProfile.

Payment sigue separado; precio de Service/Appointment no prueba pago.

## 20. Matriz de edge cases

| Caso | Contrato |
|---|---|
| guest primera reserva | sin cuenta; contact no autoriza |
| guest recurrente | recurrencia/segmentación no autoriza |
| email repetido no verificado | candidato interno; no reutilizar profile si contamina historial |
| teléfono repetido no verificado | candidato interno; no reutilizar profile si contamina historial |
| mismo email con nombres distintos | ambigüedad; separar/fail-closed |
| typo de email | no secuestra ni contamina profile |
| email compartido | control/collision no prueba sujeto único |
| teléfono compartido | control/collision no prueba sujeto único |
| email reciclado/reasignado | current control no prueba continuidad histórica |
| teléfono reasignado | current control no prueba continuidad histórica |
| profile antiguo sin binding | proof actual del canal no basta automáticamente para claim |
| profile con provenance legacy dudosa | no trusted identity evidence; proof adicional/política pendiente |
| cambio de email/teléfono | probar nuevo canal según política; no mover historial |
| pérdida de acceso al canal antiguo | recovery específico pendiente; fail-closed |
| cuenta existente | booking no enumera; login opcional |
| cuenta creada tras varias reservas guest | claim/binding explícito requerido |
| profile vinculado a otro User | conflicto; no overwrite |
| profiles potencialmente duplicados | conservar separados hasta resolución explícita |
| merge/split | futuro, explícito, auditable; nunca automático por contact match |
| verification replay | rechazar según política de uso |
| token expirado/revocado | rechazar |
| token usado dos veces | rechazar cuando single-use |
| dos verificaciones concurrentes | consumo/state atómico |
| dos claims concurrentes | no last-write-wins; atomicidad/fail-closed |
| binding vs revoke/rebind concurrente | atomicidad/fail-closed |
| binding revocado | no Client authority |
| User desactivado/comprometido | no authority por sesión/binding stale |
| historial legacy | Appointment.client/contact legacy no ownership automático |
| capability read usada para cancel | rechazar |
| capability cancel usada para reschedule | rechazar |
| capability de Appointment X usada en Y | rechazar |
| capability Business A usada en B | rechazar |
| bookedBy != customer | bookedBy no obtiene profile/history del customer |
| regalo | notificación recipient diferible |
| padre/madre reservando para hijo | actor/receptor separados |
| pareja reservando para pareja | actor/receptor separados |
| asistente reservando para tercero | actor/receptor separados |
| User que además tiene Membership | capacidades independientes |
| mismo User relacionado con múltiples Businesses | profiles aislados por Business |
| cross-tenant | fail-closed sin filtrar existencia ni correlación |

Ninguna collision se resuelve por merge automático.

## 21. Estrategia futura de implementación

Orden orientativo, no schema congelado:

1. introducir persistencia tenant para la relación cliente–Business (nombre físico por decidir), con repositories business-scoped;
2. cambiar nuevas reservas guest para no crear User ficticio y preparar semántica bookedBy/customer;
3. implementar Verification y credenciales públicas compatibles con ADR-002, una acción por capability;
4. desacoplar sesión global Client de Membership, conservando workspace tenant protegido;
5. implementar claims y binding lifecycle: create/revoke/rebind, vigente, tenant-scoped y auditable;
6. habilitar historial sólo tras binding vigente y política/evidencia suficiente;
7. auditar provenance legacy y diseñar transición/migración separada;
8. mantener Loyalty/Subscription/CRM fuera del core de identidad.

## 22. Test matrix requerida para fases runtime

Como mínimo:

- guest booking sin User ficticio;
- contact match no verificado no adjunta Appointment a CustomerProfile preexistente autorizable;
- contacto repetido/shared preserva profiles separados o falla cerrado;
- email reciclado y teléfono reasignado no permiten claim sólo con proof actual;
- profile antiguo sin binding requiere política/evidencia suficiente, no current-channel-only;
- provenance legacy de `getOrCreateGuestUser()` no se trata como verified;
- pérdida de acceso al canal antiguo falla cerrado hasta recovery válido;
- account/profile enumeration negativa;
- User con 0 Memberships obtiene sesión global Client futura;
- Membership revocada no destruye identidad global;
- login mid-booking conserva estado y revalida slot;
- Verification rechaza purpose/Business/resource mismatch, expiry/revocation/replay según política, doble consumo y carreras;
- trusted origin; no Host/Origin request-controlled para links;
- token raw/capability/secrets no aparecen en persistencia indebida, logs, AuditLog, timeline, analytics ni Referer;
- no recursos third-party antes de canje cuando bearer viaja en URL;
- capability `Appointment X + read` no autoriza cancel/reschedule;
- capability `Appointment X + cancel` no autoriza read/history/reschedule fuera del contexto mínimo de cancel;
- capability no escala a otra Appointment/Business/profile/history;
- email match y `Appointment.client` no conceden history;
- claim válido crea sólo binding autorizado;
- profile ligado a otro User falla cerrado;
- claims concurrentes no usan last-write-wins;
- revoke/rebind concurrentes son atómicos/fail-closed;
- binding revocado no autoriza;
- User desactivado/comprometido no conserva Client authority por stale session/binding;
- no revelar count/detalles antes de claim aceptado;
- cambio de contacto no mueve profiles/history;
- bookedBy/customer normal y terceros/regalo;
- CustomerProfile cross-tenant es inaccesible;
- logs/analytics no introducen correlación cross-tenant mediante contactos o hashes globales deterministas.

`APT-CLIENT-01` permanece como regresión obligatoria durante toda 6.2.5.

## 23. Decisiones explícitamente pendientes / revisión humana

Permanecen abiertas deliberadamente:

1. nombre físico de CustomerProfile y entidades de Verification/capability/binding;
2. schema exacto;
3. contactos embebidos vs entidad separada;
4. índices concretos;
5. cardinalidad/contacto primario;
6. TTL numérico;
7. proveedor de email;
8. thresholds numéricos de rate limit;
9. estructura exacta de sesión Client;
10. forma física de bookedBy/customer y snapshots;
11. algoritmo de deduplicación;
12. política concreta de merge/split;
13. recovery específico y proof adicional;
14. estrategia concreta de migración legacy;
15. retención/eliminación;
16. umbral de sugerencia de cuenta recurrente;
17. dominios/cookies/return-to Client;
18. evolución concreta del identity audit;
19. política legal de consentimientos comerciales;
20. SMS/WhatsApp;
21. Loyalty;
22. Subscription;
23. CRM/analytics;
24. Payment.

### Decisiones congeladas por 6.2.5-A

Guest booking sin cuenta; User global; Membership sólo admin/worker tenant; Client authority independiente; CustomerProfile tenant-scoped capaz de existir sin User; contacto declarado no es identidad; contact match no contamina profiles autorizables; current channel control no prueba historical subject continuity; legacy contacts no son trusted provenance automáticamente; claim explícito; binding User↔CustomerProfile explícito, persistido, auditable, tenant-scoped, vigente y revocable; ambigüedad fail-closed; no auto-merge; APT-CLIENT-01; capability pública compatible con ADR-002 como Appointment + Business + **una acción**; bookedBy/customer separados; cambio de contacto no mueve historial; login no congela slot; aislamiento cross-tenant; auditoría sin secretos/correlación innecesaria; consentimientos separados; módulos futuros no conceden authority.