# Fase 6.2.5-A — Identidad progresiva del cliente

**Estado:** contrato arquitectónico propuesto para revisión  
**Naturaleza:** auditoría + contrato + documentación; **sin runtime**  
**Fecha:** 2026-08-13  
**Baseline exacta:** `master@2d0a25d3d85d731b6b37e253f04145f658727a33`  
**PR precedente:** #25 merged/closed, HEAD aprobado `c326846d6a46c4a30dc6ad1ae05308d40b6f459a`.

> "La cuenta existe para mejorar la experiencia del cliente con el negocio, no para convertirse en una condición para usar el negocio."

## 1. Baseline y alcance

Se preserva: `User` = identidad global; `Membership` activa = autoridad tenant **exclusivamente** de admin/worker; `Business.owner` no concede autoridad; `Appointment.business` es ownership tenant obligatorio; `Appointment.service.business === Appointment.business`; `Customer/client authority` no deriva de Membership; `superadmin` es privilegio global.

`APT-CLIENT-01` sigue vigente: `Appointment.client === authenticated User._id` **no** concede por sí solo read, history/list, cancel, reschedule, timeline ni otra capacidad Client. No se relaja hasta implementar un binding/capability verificable explícito.

6.2.5-A no crea modelos, tokens, email verification, login/history Client, migrations, seeds, Loyalty, Subscription, CRM, analytics, cambios Payment/Webpay, Holiday ni UI general.

## 2. Inventario actual

- `User` contiene nombre, emails/teléfonos globales, password, `role` y `business` legacy.
- `user.repository` busca email/teléfono globalmente.
- `Membership` es `{user,business,role,isActive}`, rol `admin|worker`, unique `{user,business}`.
- `tenantAuthority.service` revalida User activo + Membership activa + Business activo; no confía en `User.role`, `User.business` ni rol copiado en sesión.
- `POST /appointments` es público y tenant-scoped.
- `appointment.controller` usa `getOrCreateGuestUser(clientInfo)` y persiste ese User como `Appointment.client`.
- `Appointment.client` referencia `User` y es required; no existen `CustomerProfile`, `bookedBy`, `customer`, Verification, binding ni capability Client.
- `resolveSessionFromUser()` rechaza hoy a un User no-superadmin sin Membership; los tests fijan esa conducta.
- PR #25 ya neutralizó grants Client basados sólo en `Appointment.client` y existe regresión APT-CLIENT-01.
- notificaciones actuales recuperan contacto desde `Appointment.client`; algunos AuditLog contienen email en message/metadata.
- analytics actual agrega User/Appointment/Payment y aún usa semántica legacy; no define el futuro CRM.

## 3. Contradicciones runtime

**ID-LEGACY-01:** `getOrCreateGuestUser()` busca User por email, fallback por teléfono, agrega contactos a un User existente o crea User con password aleatorio. Un contacto no verificado puede alterar identidad global.

**ID-SESSION-01:** autenticación global está acoplada a tener Membership para establecer sesión normal.

**ID-CONTACT-01:** coincidencias globales de email/teléfono pueden colisionar por canales compartidos, typo o reutilización; no son prueba.

**ID-APPOINTMENT-01:** Appointment obliga hoy a materializar un User para todo guest.

**ID-ACTOR-01:** no existe distinción `bookedBy != customer`.

**ID-AUDIT-01:** la auditoría actual usa `userId` y puede registrar PII; futura verificación no debe filtrar secretos/PII innecesaria.

Estas son deudas de transición; no se corrigen en 6.2.5-A.

## 4. Modelo conceptual

```text
GLOBAL
User = identidad autenticable + credenciales
   |
   | explicit verified binding (0..N)
   v
TENANT
CustomerProfile* ---- Business
   |
   +--- Appointments
   +--- future Loyalty
   +--- future Subscription

SEGURIDAD
Verification / proof
Client binding
Purpose/resource-specific capability
```

`CustomerProfile` es nombre de trabajo, no nombre físico congelado.

- **User:** identidad global; puede existir con 0 Memberships y 0 CustomerProfiles.
- **CustomerProfile:** relación cliente–un Business; `business` obligatorio; puede existir con `user=null`; Business A nunca descubre relaciones del mismo User con B/C.
- **Appointment:** reserva concreta, no identidad global.
- **Verification:** evidencia acotada de control de un canal.
- **Binding:** relación explícita y auditable User↔CustomerProfile; no se deriva de strings iguales.
- **Capability:** grant mínimo sobre recurso/purpose concreto; no es identidad general.
- Nombre/email/teléfono declarados son contacto operacional; no autoridad. La forma física del contacto queda pendiente.

## 5. Vocabulario

| Término | Semántica |
|---|---|
| visitante anónimo | sin datos ni sesión |
| guest declarado | entregó datos; contacto no demostrado |
| guest verificado | demostró control de canal para scope/purpose |
| cliente recurrente | segmentación de negocio, **no autorización** |
| User | identidad global autenticable |
| Membership | autoridad tenant admin/worker |
| CustomerProfile | relación cliente–Business |
| Verification | evidencia de control de canal |
| binding | vínculo User↔CustomerProfile explícito |
| capability | permiso concreto resource/purpose-scoped |
| claim | solicitud explícita de vincular/recuperar relación |
| bookedBy | actor que realiza reserva |
| customer | receptor del servicio |

## 6. Trust boundaries

1. **Público→API:** datos de booking no confiables; contacto declarado no es proof.
2. **Sesión→User:** autenticar User no prueba ownership de perfiles históricos no vinculados.
3. **User→Membership:** admin/worker sigue derivando sólo de Membership activa.
4. **User→CustomerProfile:** historial requiere binding explícito.
5. **Business→CustomerProfile:** lookup siempre business-scoped y fail-closed.
6. **Verification→grant:** proof ligada a purpose, Business y recurso/profile.
7. **Email transport:** enlaces desde origen HTTPS confiable configurado, nunca desde `Host`/`Origin` del request.
8. **Logs/analytics:** no son autoridad y no deben contener token raw, capabilities, digests reutilizables ni PII innecesaria.

## 7. Estados conceptuales

1. **Visitante anónimo:** puede navegar lo público.
2. **Guest declarado:** nombre/email/teléfono entregados, aún no verificados; puede reservar, no obtener historial.
3. **Guest con contacto verificado:** control de canal demostrado; puede adquirir capability acotada sin cuenta.
4. **Cliente recurrente:** relación acumulada/segmentación; nunca concede permisos.
5. **User global:** cuenta autenticable con 0..N Memberships y 0..N CustomerProfiles.
6. **User vinculado:** binding explícito a un CustomerProfile; ejerce sólo capacidades Client permitidas para ese perfil.

## 8. Capacidades

| Capacidad | Fuente | Scope |
|---|---|---|
| identidad autenticada | sesión User | global; no historial implícito |
| admin/worker tenant | Membership activa | un Business |
| guest Appointment | Verification + binding al recurso | una Appointment/purposes |
| Client profile | claim + proof aceptada + binding | un CustomerProfile |
| superadmin | privilegio global | plano de plataforma según política |

Un mismo User puede ser cliente de A, admin de B y worker de C. Son capacidades independientes.

## 9. Invariantes congeladas

- **ID-INV-01:** booking público no requiere cuenta.
- **ID-INV-02:** Membership no representa clientes.
- **ID-INV-03:** nombre/email/teléfono iguales no autorizan ni fusionan.
- **ID-INV-04:** APT-CLIENT-01 permanece fail-closed.
- **ID-INV-05:** historial exige User autenticado + proof aceptada + claim explícito + binding User↔CustomerProfile.
- **ID-INV-06:** CustomerProfile siempre tenant-scoped.
- **ID-INV-07:** no existe auto-merge por colisiones.
- **ID-INV-08:** Verification es purpose/business/resource-bound, expirable y single-use.
- **ID-INV-09:** capability guest no se generaliza a otras citas/perfiles/Businesses.
- **ID-INV-10:** cambiar User.email/phone no mueve historial automáticamente.
- **ID-INV-11:** `bookedBy` y `customer` son conceptos distintos.
- **ID-INV-12:** login durante booking no bloquea slot; disponibilidad se revalida al persistir.
- **ID-INV-13:** Appointment no implica marketing consent.
- **ID-INV-14:** Loyalty/Subscription/analytics serán módulos separados que referencien CustomerProfile.
- **ID-INV-15:** precio de Service/Appointment no equivale a dinero efectivamente pagado.

## 10. Threat model

| Amenaza | Mitigación contractual |
|---|---|
| account/profile enumeration | respuestas no revelan si cuenta/perfil/historial existe |
| contact collision takeover | match de contacto nunca autoriza/mergea |
| cross-tenant IDOR | business-scoped lookup, fail-closed |
| purpose confusion | proof ligada a purpose/recurso/Business |
| replay/expiry | single-use, expiración estricta, consumo atómico |
| concurrent verification/claim | invariantes atómicas; no last-write-wins silencioso |
| legacy false ownership | `Appointment.client` no se promueve a binding |
| contact-change takeover | binding separado; probar nuevo canal |
| secret leakage | no token/capability/digest sensible en logs |
| gift disclosure | delivery intent explícito y notificación diferible |
| bookedBy/customer confusion | booker, como máximo, capability de esa Appointment |
| stale booking after login | revalidar disponibilidad antes de create |
| mass verification abuse | rate limits por purpose/destination/Business/IP |

Email verification prueba **control del canal**, no identidad legal. Si un canal verificado corresponde a múltiples perfiles/candidatos, la proof por sí sola no obliga a aceptar el claim: debe fallar cerrado o exigir política adicional sin revelar candidatos.

## 11. Privacidad tenant

Business A sólo puede conocer su relación con el cliente. No debe recibir IDs/nombres/conteos de CustomerProfiles del mismo User en B/C ni historial transversal. Conocer un ObjectId no concede acceso. Un cambio de contacto global y uno operacional tenant son eventos distintos y no deben propagarse silenciosamente entre sí.

## 12. Flujo guest

Objetivo:

```text
servicio → profesional → fecha/hora → datos → reservar
```

La UX puede ofrecer “¿Ya tienes cuenta? Inicia sesión para usar tus datos guardados” con **Iniciar sesión** / **Continuar como invitado**, sin revelar si el email pertenece a una cuenta.

Una nueva reserva guest no debe necesitar User ficticio. Coincidencias de contacto pueden servir como señal interna, nunca como autorización.

## 13. Flujo authenticated y login durante booking

La sesión objetivo permite:

```text
User autenticado
├── 0..N Memberships
└── 0..N CustomerProfiles
```

El workspace administrativo sigue exigiendo Membership; la identidad global no.

Si el actor inicia sesión durante booking, se preservan servicio, profesional, fecha, hora y notas/contexto. Al volver se revalida Business, Service, profesional y disponibilidad. Login cambia identidad/capacidad, **no congela el slot** ni auto-vincula historial guest.

## 14. Verification

Contrato futuro mínimo, sin implementación aquí:

- token opaco, criptográficamente seguro y sin PII;
- sólo digest persistido server-side;
- purpose-bound;
- business-bound;
- resource/profile-bound;
- expiración estricta;
- single-use;
- replay-safe;
- consumo atómico;
- rate limited;
- auditable sin secretos;
- origen HTTPS confiable fijo;
- outcome externo no enumerable.

SMS queda fuera del MVP. Proveedor de email y thresholds quedan pendientes.

## 15. History claim

Prohibido:

```text
User.email === CustomerProfile.email -> historial
Appointment.client === User._id -> historial
```

Autorizado conceptualmente:

```text
User autenticado
+ proof vigente/aceptada
+ claim explícito
+ binding User ↔ CustomerProfile
= historial autorizado de ese CustomerProfile
```

Antes de proof aceptada no se revela existencia de perfil, número de citas, fechas, servicios, profesionales ni historial sensible. Profile ya vinculado a otro User o contacto ambiguo = conflicto fail-closed, nunca overwrite/merge automático.

## 16. `bookedBy` y `customer`

```text
bookedBy = actor que realiza la reserva
customer = persona que recibe el servicio
```

Normalmente son la misma persona, pero deben soportarse padre/madre→hijo, pareja→pareja, asistente→tercero y regalo.

Crear o pagar una Appointment para otro puede conceder al bookedBy una capability acotada a esa Appointment, nunca historial completo del customer. El email del booker no identifica al receptor. En regalos, la notificación al customer debe poder diferirse.

## 17. Transición legacy

Regla:

```text
legacy Appointment.client != verified historical ownership
```

La fase runtime futura debe retirar del booking nuevo la semántica de `getOrCreateGuestUser()`: lookup global por email/teléfono, append de contactos y User/password aleatorio para guests.

Orden seguro: mantener legacy fail-closed; introducir relación tenant para nuevas reservas; implementar proof/capability; luego claim/binding; sólo después planificar migración/claim histórico con inventario, idempotencia, rollback y auditoría. No auto-merge.

No se congela todavía si la migración final reescribe `Appointment.client`, añade nueva referencia o mantiene compatibilidad.

## 18. Consentimiento

Separar:

1. comunicación operacional necesaria;
2. marketing/promociones;
3. fidelización;
4. otras comunicaciones comerciales.

Crear Appointment no implica marketing. Retención/withdrawal/base legal requieren revisión posterior de producto/legal.

## 19. CRM / Loyalty / Subscription

CustomerProfile es relación tenant, no god object. Loyalty, Subscription y analytics projections deben ser entidades/módulos independientes que lo referencien. Evitar métricas derivadas indiscriminadas dentro del perfil.

Payment sigue separado; `Service.price`/precio de Appointment no prueba pago.

## 20. Matriz de edge cases

| Caso | Contrato |
|---|---|
| guest primera reserva | sin cuenta; contacto no autoriza |
| guest recurrente | continuidad posible; recurrencia no autoriza |
| email repetido no verificado | candidato, no link/merge |
| teléfono repetido | candidato, no link/merge |
| mismo email/nombres distintos | ambigüedad, no auto-resolución |
| typo email | no secuestra historial |
| email/teléfono compartido | canal compartido no prueba persona única |
| cambio email | probar nuevo canal; no mover historial |
| pérdida acceso email | recovery alternativo pendiente; fail-closed |
| cuenta existente | booking no enumera; login opcional |
| cuenta creada tras guests | claim/binding requerido |
| profile ligado a otro User | conflicto; no overwrite |
| perfiles duplicados | conservar hasta resolución explícita |
| merge/split | futuro, explícito y auditable |
| verification replay/expired/double-use | rechazar |
| verificaciones concurrentes | consumo/state atómico |
| claims concurrentes | binding atómico; no silent overwrite |
| historial legacy | no ownership automático |
| bookedBy != customer | capability mínima de Appointment |
| regalo | notificación recipient diferible |
| padre/madre, pareja, asistente | separar actor/receptor |
| User + Membership | capacidades independientes |
| User multi-Business | perfiles aislados por Business |
| cross-tenant | fail-closed sin filtrar existencia |

Ninguna collision se resuelve por merge automático.

## 21. Estrategia futura de implementación

1. introducir persistencia tenant de CustomerProfile (nombre físico por decidir), con `user` opcional y repositories business-scoped;
2. cambiar nuevas reservas guest para no crear User ficticio y preparar `bookedBy/customer`;
3. implementar Verification + capabilities de Appointment bajo §14;
4. desacoplar sesión global Client de Membership, conservando workspace tenant protegido;
5. implementar claim/binding e historial sólo sobre profiles vinculados;
6. auditar datos legacy y ejecutar transición/migración en fase separada, con autorización explícita;
7. dejar Loyalty/Subscription/CRM después del core de identidad.

## 22. Test matrix requerida para runtime

- guest booking sin User ficticio; repetidos/shared contacts sin grants;
- account/profile enumeration negativa;
- User con 0 Memberships obtiene sesión global Client;
- Membership revocada no destruye identidad global;
- login mid-booking conserva estado y revalida slot;
- Verification: digest, purpose/Business/resource mismatch, expiry, replay, double-use, concurrency, rate limits, trusted origin;
- capability guest sólo sobre Appointment/purposes permitidos, nunca history general/cross-tenant;
- email match y `Appointment.client` no conceden history;
- claim válido crea un único binding; conflict/concurrency fail-closed;
- no revelar count/detalles antes de proof;
- contacto cambiado no mueve profiles;
- bookedBy/customer normal y terceros/regalo;
- legacy Appointment nunca otorga grant Client automático;
- tokens/capabilities/digests no aparecen en logs/timeline;
- PII cross-tenant no aparece en respuestas.

APT-CLIENT-01 permanece como regresión obligatoria en cada subfase.

## 23. Decisiones pendientes / revisión humana

1. nombres físicos definitivos de CustomerProfile, Verification, binding/capability;
2. contactos embebidos versus entidad tenant separada;
3. cardinalidad/contacto primario e índices no ambiguos;
4. retención/eliminación de guests/contactos declarados;
5. proof adicional para canales compartidos/ambigüedad;
6. recovery sin acceso al canal previamente verificado;
7. política y permisos de merge/split;
8. forma física de bookedBy/customer y snapshots históricos;
9. operations/TTL exactos de capability guest;
10. thresholds/rate limits y proveedor de email;
11. threshold de sugerencia de cuenta frecuente;
12. dominios/cookies/return-to para login Client;
13. estrategia concreta de migración de `Appointment.client` legacy;
14. evolución de auditoría de identidad sin PII/secrets;
15. política legal de consentimientos comerciales;
16. Loyalty, Subscription, analytics, SMS, WhatsApp y Payment siguen sin congelar.

### Decisiones congeladas por 6.2.5-A

Guest booking sin cuenta; User global; Membership sólo admin/worker tenant; Client authority independiente; relación cliente–Business tenant-scoped capaz de existir sin User; contacto no es identidad; proof verificable; no auto-merge; APT-CLIENT-01; history mediante claim+binding; capability guest mínima; `bookedBy/customer`; cambio de contacto sin movimiento automático de historial; login no congela slot; aislamiento cross-tenant; consentimientos separados; módulos futuros referencian CustomerProfile.
