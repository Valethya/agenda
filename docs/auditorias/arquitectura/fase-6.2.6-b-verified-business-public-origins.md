# Fase 6.2.6-B — Verified Business Public Origins

**Proyecto:** ATMÓSFERA Agenda  
**Fase:** 6.2.6-B  
**Estado:** implementación funcional en PR #32 Draft; bloqueantes adversariales corregidos; pendiente nueva revisión adversarial independiente  
**Tipo de iteración:** implementación funcional + reconciliación adversarial  
**Contrato documental aprobado:** PR #31, HEAD `3f3623f099446615039584601d6c6a7f3f4a8be0`  
**Baseline funcional:** `master@ed7acfd5fed91b03cd65becd2af154f93dad027b`, merge aprobado de PR #31  
**HEAD adversarial de entrada a esta corrección:** `1a3654d209200737507c4022cc438ce6efb276a7`  
**Fecha:** 22 de agosto de 2026

> Este documento conserva el contrato aprobado y registra su representación física real. PR #32 debe permanecer Draft. La fase no se declara cerrada ni fusionada desde este documento; el gate siguiente es una revisión adversarial independiente sobre el HEAD final con CI verde.

## 1. Objetivo e invariantes

6.2.6-B establece una trust root web pública, persistida, tenant-scoped y temporalmente acotada para cada `Business`.

El MVP soporta exactamente un origin público configurado por Business, pero un mismo origin puede pertenecer legítimamente a múltiples Businesses:

```text
Business -> máximo un publicWeb origin
verifiedOrigin -> cero, uno o múltiples Businesses
```

Por tanto `verifiedOrigin` **no es** un identificador tenant global y **no** posee índice `unique`.

La cadena de confianza es:

```text
Business
  -> BusinessConfig.publicWeb
  -> websiteUrl/bookingUrl normalizadas
  -> DNS TXT server-side
  -> verifiedOrigin + trustGeneration + verificationValidUntil
  -> CORS browser binding y/o C2 según la frontera concreta
```

Nunca:

```text
Origin / Host / Referer / body / cookie incidental
  -> tenant/session/admin authority
```

`Membership` activa con role `admin` continúa siendo la autoridad tenant para los comandos administrativos. `Business.owner`, `User.role`, `User.business` y `superadmin` sin Membership admin no sustituyen esa autoridad.

## 2. Persistencia física

`BusinessConfig` contiene `publicWeb` con la siguiente semántica:

```text
publicWeb
  websiteUrl                         client-owned
  bookingUrl                         client-owned

  verificationStatus                 server-owned
  verifiedOrigin                     server-owned
  verifiedAt                         server-owned
  verificationValidUntil             server-owned
  trustGeneration                    server-owned

  verificationMethod = dns_txt       server-owned
  challengeHash                      server-owned, select:false
  challengeIssuedAt                  server-owned
  challengeExpiresAt                 server-owned
  verificationAttemptGeneration      server-owned

  authorityFence.token               server-owned, select:false
  authorityFence.trustGeneration     server-owned
  authorityFence.expiresAt           server-owned
```

`verificationAttemptGeneration` y `trustGeneration` son enteros monotónicos distintos:

- `verificationAttemptGeneration` aumenta al emitir/rotar una prueba DNS y cerca un lookup DNS concreto;
- `trustGeneration` aumenta cuando se crea/revoca/cambia el epoch de confianza pública y atraviesa C2.

El estado `unconfigured` conserva `trustGeneration`/revision server-owned después de revocaciones. `DELETE -> recreate` no puede reutilizar una generation anterior; esto evita ABA/replay.

Los DTOs administrativos no pueden escribir campos server-owned. El PUT genérico de Business Settings sigue strict y no acepta `publicWeb` como passthrough de authority.

## 3. Política URL

Toda normalización usa la misma política server-side.

### 3.1 `websiteUrl`

Debe ser:

- absoluta;
- protocolo exactamente `https:`;
- puerto efectivo exactamente 443;
- sin username/password;
- sin query ni fragment;
- pathname vacío o `/`;
- hostname DNS válido;
- no IP literal;
- no `localhost`;
- no single-label;
- no wildcard.

Se persiste como origin canónico, por ejemplo:

```text
https://negocio.cl
```

`:443` explícito normaliza al mismo origin. `:8443` y otros puertos se rechazan.

### 3.2 `bookingUrl`

- absoluta;
- HTTPS;
- puerto efectivo 443;
- sin credentials/query/fragment;
- path permitido;
- `URL.origin` exactamente igual al origin normalizado de `websiteUrl`.

La igualdad se realiza por origin canónico, nunca por prefijos/sufijos de strings.

## 4. Lifecycle y freshness

Lifecycle lógico:

```text
unconfigured
  -> pending
  -> verified (fresh)
  -> effective-expired
  -> pending mediante reverify
  -> verified
```

`effective-expired` es una condición derivada: no exige job periódico ni transición física inmediata.

Una trust sólo es efectiva cuando:

```text
verificationStatus == verified
AND verifiedOrigin == origin actual de websiteUrl
AND now < verificationValidUntil
AND trustGeneration es la vigente
```

En `now == verificationValidUntil` la trust ya es inválida.

### 4.1 Parámetros físicos adoptados

Los valores se centralizan en `Server/src/config/publicWeb.constants.js`:

| Parámetro | Valor final |
|---|---:|
| pending DNS challenge TTL | 15 minutos |
| verified public trust TTL | 30 días |
| DNS lookup timeout | 3 segundos |
| `/verify`/`reverify`/rotate rate limit | 20 por IP / 15 minutos |
| dynamic public-CORS trust lookup admission | 200 por IP / 15 minutos |
| persisted authority/send fence TTL | 2 minutos |

Estos TTL son independientes de C1 y de la capability C2.

### 4.2 Retry DNS real

`POST /verify` realiza **una** resolución TXT por invocación, bounded por 3 segundos. No existe retry automático interno ni fallback HTTP. Un fallo/timeout produce `PUBLIC_WEB_DNS_UNAVAILABLE`; mientras el challenge siga pending y vigente, el operador puede invocar nuevamente `/verify`, sujeto al rate limit.

## 5. DNS TXT y secreto one-time

Único método:

```text
websiteUrl = https://negocio.cl
recordName = _agenda-verification.negocio.cl
recordType = TXT
recordValue = agenda-verification=<challenge>
```

El raw challenge se genera con:

```text
crypto.randomBytes(32).toString("base64url")
```

Su política es obligatoria:

```text
raw challenge -> memoria transitoria -> respuesta one-time -> nunca DB
hash(raw + scope) -> persistencia
```

El hash SHA-256 incorpora:

```text
Business + origin + verificationAttemptGeneration + raw challenge
```

La comparación usa `timingSafeEqual` sobre hashes válidos. El raw nunca aparece en GET, errores, logs ni persistencia y no puede reconstruirse desde el hash.

El resolver usa `node:dns` server-side y es inyectable/fakeable en tests. No existe HTTP fetch, `.well-known`, redirects ni provider integration.

## 6. DNS TOCTOU y generations

`POST /verify` captura:

```text
origin
challengeHash
verificationAttemptGeneration
trustGeneration
challengeExpiresAt
```

resuelve DNS fuera del write y después aplica un conditional update que exige que sigan vigentes exactamente:

```text
status = pending
origin
challengeHash
challengeExpiresAt > now
verificationAttemptGeneration
trustGeneration
```

Un lookup iniciado bajo attempt/generation vieja no puede verificar el estado nuevo después de rotate, origin change o reverify.

Una verificación exitosa fija:

```text
verifiedOrigin = origin actual
verifiedAt = now
verificationValidUntil = now + 30 días
```

y elimina el challenge hash/fechas utilizables.

## 7. Transiciones administrativas

Comandos implementados:

```text
PUT    /api/business-settings/public-web
POST   /api/business-settings/public-web/verify
POST   /api/business-settings/public-web/reverify
POST   /api/business-settings/public-web/verification-challenge/rotate
DELETE /api/business-settings/public-web
```

Todos exigen:

- sesión autenticada;
- Business activo seleccionado en sesión;
- Membership activa de ese Business;
- role `admin`;
- trusted authenticated panel origin.

### 7.1 Origin nuevo o cambiado

- incrementa `trustGeneration`;
- incrementa `verificationAttemptGeneration`;
- revoca verified trust previa;
- crea nuevo raw challenge one-time;
- queda `pending`.

### 7.2 Booking path same-origin

Si sólo cambia el path de `bookingUrl` y la trust continúa coherent/fresh:

- conserva `trustGeneration`;
- conserva `verifiedAt`/`verificationValidUntil`;
- no crea challenge nuevo.

### 7.3 PUT normalizado idéntico

Es no-op semántico:

- no rota challenge;
- no extiende freshness;
- no cambia generations;
- no vuelve a exponer raw.

### 7.4 Reverify

`POST /reverify`:

- requiere configuración existente;
- incrementa `trustGeneration`;
- incrementa `verificationAttemptGeneration`;
- revoca el epoch previo;
- crea challenge nuevo;
- deja `pending`.

`POST /verify` sobre `verified` no renueva freshness y responde con error estable de re-verification requerida.

### 7.5 Delete

`DELETE` limpia configuración visible y pending material, incrementa el epoch cuando corresponde y conserva revision suficiente para anti-ABA. Repetir delete sobre estado ya unconfigured es visible/idempotente y no resucita generations antiguas.

## 8. GET Business Settings

`GET /api/business-settings` continúa read-only:

- no materializa BusinessConfig;
- no genera/rota challenge;
- no resuelve DNS;
- no renueva freshness;
- no produce `verified`.

El DTO `publicWeb` expone estado operativo seguro:

```text
websiteUrl
bookingUrl
verificationStatus
verificationMethod
dnsVerification.recordName/recordType/challengeExpiresAt
verifiedOrigin
verifiedAt
verificationValidUntil
trustGeneration
```

`dnsVerification.recordValue` sólo contiene el raw en la misma respuesta que acaba de emitirlo; en GET es `null`.

Nunca se exponen:

- `challengeHash`;
- `verificationAttemptGeneration`;
- `authorityFence.token`;
- internals del resolver.

## 9. CORS: tres fronteras distintas

CORS no es autenticación backend. La implementación separa físicamente:

1. public/headless trust-bound routes;
2. capability-authenticated `/read`;
3. trusted panel policy.

### 9.1 Dynamic public/headless routes

Incluyen las rutas públicas de Services, workers, slots, booking y:

```text
POST /api/guest-appointments/read/challenge
POST /api/guest-appointments/read/verify
```

El preflight no resuelve tenant. Sólo pregunta:

```text
route class pública
AND Origin normalizado
AND existe >= 1 Business activo con trust fresh para ese Origin
```

Si existe, el CORS grant es credentialless.

La request browser real después resuelve Business de forma explícita según 6.2.6-A y, antes del controller/side effect, exige que `Origin` coincida con la trust fresh **de ese Business exacto**.

Un preflight exitoso para A nunca autoriza una request real dirigida a B.

### 9.2 Shared origins

A y B pueden compartir:

```text
https://estudio.cl
```

si cada uno demostró DNS y mantiene trust fresh. El preflight sólo necesita existencia de al menos una trust; la request real vuelve a resolver A o B explícitamente. Los repositorios/recursos siguen tenant-scoped.

### 9.3 Requests sin `Origin`

Se preserva 6.2.6-A:

- server-to-server/CLI/backend callers no fallan sólo por carecer de `Origin`;
- siguen requiriendo Business explícito y todas las reglas de la ruta;
- no obtienen Membership/session/admin authority.

Las operaciones cuyo propio contrato depende de publicWeb —por ejemplo C2 antes del exchange— continúan requiriendo trust fresh internamente aunque no exista header Origin.

### 9.4 `/read` capability-authenticated

`POST /api/guest-appointments/read` es deliberadamente distinto.

Una vez que el challenge fue canjeado válidamente, la authority es la capability bearer exact-scope existente:

```text
Business + Appointment + READ + bearer
```

Por contrato, una revocación posterior de publicWeb **no acorta** la lifetime C2 ya emitida.

Por ello:

- `/read` no usa `bindExplicitPublicBusinessOrigin`;
- su preflight no puede depender de current publicWeb freshness porque no conoce el bearer futuro;
- un Origin sintácticamente válido puede obtener CORS para **esa ruta exacta**;
- el grant siempre es `credentials:false`;
- incluso si el Origin coincide con `FRONTEND_URL`, `/read` no recibe `Access-Control-Allow-Credentials: true`;
- cookie administrativa incidental no concede nada;
- bearer ausente/inválido sigue fallando por validación/`GUEST_APPOINTMENT_CAPABILITY_INVALID_PROOF`;
- esta excepción no se extiende a ninguna otra ruta pública/interna.

`/read/challenge` y `/read/verify` siguen fresh-trust-bound para browser callers.

### 9.5 Trusted panel origin

Fuera de `/read`, `FRONTEND_URL` conserva su política independiente credentialed. PublicWeb verified origin nunca se añade a `assertTrustedAuthenticatedOrigin` y nunca se convierte por ello en session/Membership/admin authority.

## 10. CORS lookup DoS y consulta bounded

El middleware CORS se ejecuta antes del limiter global de `/api`; por ello 6.2.6-B agrega una admisión dedicada **antes del lookup MongoDB** para route classes dinámicas:

```text
200 requests por IP / 15 minutos
```

Sólo entra en ese limiter una request que realmente requeriría lookup publicWeb dinámico. Se omiten sin query:

- requests sin Origin;
- rutas no dinámicas;
- `/read` bearer-authenticated;
- `FRONTEND_URL`, cuya decisión es la política independiente del panel.

Después del presupuesto permitido, la respuesta es `429 PUBLIC_WEB_CORS_RATE_LIMITED` antes de consultar MongoDB.

El lookup de preflight es existence-oriented. La agregación:

1. filtra `verifiedOrigin`, `verificationStatus=verified`, `verificationValidUntil > now`, `websiteUrl == origin` y generation válida;
2. hace `$lookup` del Business por `_id`;
3. exige `Business.isActive=true`;
4. aplica `$limit: 1`;
5. proyecta sólo `_id`.

No materializa el conjunto completo de Businesses que comparten Origin.

## 11. Índice físico y cutover de storage

La frontera CORS pública no depende de que Mongoose haya creado el índice por `autoIndex`.

Índice físico requerido y **no unique**:

```text
name: business_config_public_web_origin_fresh
key:
  publicWeb.verifiedOrigin: 1
  publicWeb.verificationStatus: 1
  publicWeb.verificationValidUntil: 1
```

El join a Business usa `_id`, cuyo índice físico ya existe.

Migración explícita:

```text
npm run migration:public-web-storage
```

`Server/scripts/migrations/public-web-storage.js`:

- conecta con `autoIndex:false`;
- inspecciona primero;
- rechaza mismo nombre/opciones incompatibles;
- nunca hace drop/recreate automático;
- crea sólo colección/índice faltante de forma no destructiva;
- verifica el índice exacto después de aplicar.

Remote/deployment runtime incorpora un gate antes de `listen()`:

```text
PUBLIC_WEB_6_2_6_B_CUTOVER=PUBLIC_WEB_6_2_6_B_STORAGE_READY
```

La confirmación por env **no** sustituye la inspección física: el servidor además verifica el índice exacto. Un indicador Railway/deployment activa el gate aunque `NODE_ENV=test`.

Local development/test puede conservar autoIndex de test; la evidencia production-like utiliza una conexión aislada con `autoIndex:false`.

## 12. C2 cutover tenant-scoped

Se eliminó el uso runtime de:

```text
GUEST_APPOINTMENT_ACCESS_ORIGIN
```

No existe:

```text
verifiedOrigin ?? GUEST_APPOINTMENT_ACCESS_ORIGIN
```

El worker resuelve:

```text
Business
-> fresh BusinessConfig.publicWeb
-> { origin, trustGeneration, verificationValidUntil }
```

Si no existe trust fresh, falla antes de emitir C1.

El access URL permanece:

```text
<trusted-origin>/appointment-access#businessId=...&appointmentId=...&verificationId=...&purpose=...&challenge=...
```

Bearer/challenge siguen en fragment; no se mueven a query.

Destination de email sigue siendo exclusivamente `Appointment.guestContact`. No existe fallback a `Appointment.client`, `User.email`, CustomerProfile, owner o request body.

C2 continúa exactamente:

```text
one Business + one Appointment + READ
```

No CANCEL/RESCHEDULE/PAYMENT.

## 13. Job/Delivery y publicWeb generation

Job y Delivery C2 persisten como mínimo:

```text
business
publicWebTrustGeneration
trustedOrigin
```

`job.generation` y `publicWebTrustGeneration` continúan siendo fences diferentes.

Una Delivery N nunca puede ser válida bajo publicWeb generation N+1.

Revocan el exchange de una Delivery previa:

- delete;
- origin change;
- trust expiry;
- reverify;
- otra futura revocación explícita del mismo epoch.

Cambiar sólo `bookingUrl` path same-origin conserva la generation si la trust sigue fresh.

## 14. Fence físico worker/revocation

La linearización usa `BusinessConfig.publicWeb.authorityFence`:

```text
token              CSPRNG base64url, select:false
trustGeneration
expiresAt
```

TTL físico del lease: **2 minutos**.

Flujo worker:

```text
1. claim/reconcile C2 job
2. resolve fresh publicWeb snapshot
3. fail closed si no existe
4. load Appointment tenant-scoped + guestContact
5. issue C1
6. persist Delivery ligada a origin/generation
7. build URL
8. acquire persisted publicWeb fence para origin/generation fresh
9. confirm fence + freshness inmediatamente antes del outbound side effect
10. iniciar send
11. release fence
```

Las transiciones administrativas que revocan/cambian trust requieren que no exista un fence activo. Si la revocación confirmó antes de adquirir/cruzar el fence, el outbound N no puede comenzar. Si el send externo ya comenzó antes de la revocación linealizada, el correo no puede retirarse, pero su Delivery/challenge queda inutilizable para exchange una vez cambie/expire la trust.

El fence tiene owner token y generation; otro worker no puede confirmarlo/liberarlo como propio. Expiración/reclaim obliga a revalidar.

## 15. Exchange C2

Antes de consumir C1 se comprueba que Delivery/Job siguen ligados al Business, Appointment, purpose/action y publicWeb trust actual:

```text
Delivery.business == Business
Delivery.publicWebTrustGeneration == current trustGeneration
Delivery.trustedOrigin == current verifiedOrigin
status == verified
now < verificationValidUntil
```

Después de consumir C1 y **antes de mint** se vuelve a cercar con el mismo persisted publicWeb fence y se confirma freshness/generation/origin. Esto cierra el TOCTOU entre segunda revalidación y creación de la READ capability.

Cualquier stale proof responde:

```text
GUEST_APPOINTMENT_CAPABILITY_INVALID_PROOF
```

sin distinguir expiry/revocation/generation/origin mismatch.

### 15.1 Capability ya canjeada

Una READ capability que fue emitida válidamente **antes** de delete/expiry/reverify conserva su TTL/lifetime C2 existente. PublicWeb revocation invalida Delivery/challenge exchange futuro, no reescribe retroactivamente la authority del bearer ya mintado.

El HTTP/CORS de `/read` implementa expresamente esa distinción (§9.4).

## 16. Errores públicos

Códigos operativos relevantes:

- `PUBLIC_WEB_INVALID_URL`
- `PUBLIC_WEB_ORIGIN_MISMATCH`
- `PUBLIC_WEB_UNCONFIGURED`
- `PUBLIC_WEB_NOT_PENDING`
- `PUBLIC_WEB_REVERIFICATION_REQUIRED`
- `PUBLIC_WEB_CHALLENGE_EXPIRED`
- `PUBLIC_WEB_VERIFICATION_NOT_PROVEN`
- `PUBLIC_WEB_STATE_CHANGED`
- `PUBLIC_WEB_TRUST_EXPIRED`
- `PUBLIC_WEB_DNS_UNAVAILABLE`
- `PUBLIC_WEB_CORS_RATE_LIMITED`
- `GUEST_APPOINTMENT_CAPABILITY_INVALID_PROOF`

Errores DNS/C2 son sanitizados; no incluyen raw TXT/challenge, stack ni driver/resolver internals.

## 17. Tests incorporados al gate oficial

`npm run test:public-web-trust` ejecuta:

```text
publicWebStorage.test.js
publicWebTrust.test.js
publicWebSuperadminAuthority.test.js
publicWebCorsAdmission.test.js
publicWebCapabilityHttp.test.js
publicWebC2Revocation.test.js
```

Además se mantienen las suites C1/C2, headless 6.2.6-A, Business Settings, tenant isolation, payments y demás regresiones.

Cobertura específica añadida/corregida:

### URL/DNS/lifecycle

- http/credentials/query/fragment/path/puerto 8443/IP/localhost/single-label/wildcard reject;
- `:443` canonicaliza;
- exact TXT verifies;
- wrong/absent TXT no verifica;
- timeout/error fail closed;
- stale lookup tras rotate/origin change -> state changed;
- exact challenge expiry;
- raw ausente de DB/GET/error;
- `/verify` no renueva verified;
- reverify crea generation nueva;
- same-origin booking path conserva generation;
- delete/recreate anti-ABA.

### Authority

- Membership admin configura;
- worker deny;
- cross-tenant/unknown fields deny;
- owner sin Membership no obtiene tenant authority;
- `User.role` legacy no concede authority;
- superadmin sin Membership admin se prueba en proceso independiente y recibe 403 tenant.

El caso superadmin se aisló para no convertir accidentalmente el auth limiter de 5 intentos/IP/10 min en el objeto del test. El limiter productivo no fue aumentado, eliminado ni bypasseado.

### CORS/DoS/storage

- fresh Origin permite preflight credentialless;
- unknown/expired Origin no concede grant dinámico;
- OPTIONS no depende de body/future header values;
- actual Origin A + Business B fail closed antes de side effect;
- shared Origin A/B funciona con DTO público real (`service.id`, nunca `_id`);
- no-Origin preserva headless;
- public cookie no abre internal routes;
- `/read` bearer endpoint siempre credentialless;
- 205 unknown Origins demuestran 200 DB lookups máximos y posteriores 429 antes de Mongo;
- lookup pipeline contiene `$limit:1`;
- migration/index se valida con `autoIndex:false`;
- índice incompatible se rechaza sin drop/recreate;
- startup remoto bloquea si falta confirmación o índice físico.

### Capability post-revocation

HTTP end-to-end cubre:

```text
fresh trust
-> C2 delivery
-> valid exchange
-> READ capability
-> delete / exact expiry / reverify
-> browser POST /read
-> capability sigue válida
```

También:

- arbitrary Origin + invalid bearer -> `INVALID_PROOF`;
- bearer ausente -> validation fail;
- admin cookie incidental no ayuda;
- `/read` nunca ACAC true, incluso para panel Origin;
- stale `/read/verify` después de revocación -> `INVALID_PROOF`;
- old Delivery no vuelve a ser exchangeable.

## 18. Evidencia CI de la corrección

El HEAD adversarial de entrada `1a3654d209200737507c4022cc438ce6efb276a7` tenía CI #307 roja por dos fixtures de test:

1. shared-origin buscaba `_id` aunque el DTO público contractualmente expone `id`;
2. el caso superadmin acumulaba demasiados logins dentro del mismo proceso y chocaba con el auth limiter productivo.

Ambos se corrigieron sin cambiar el DTO, el limiter ni la arquitectura de autoridad.

Una ejecución posterior sobre `e07ca6874fe6886f8a86c920040dd99414ab504e` demostró verdes todas las nuevas suites 6.2.6-B, pero detectó una fixture histórica de 6.2.6-A que todavía trataba `CORS_ORIGINS` como suficiente trust root para browser routes. Esa fixture fue reconciliada para usar un publicWeb origin HTTPS realmente verificado; runtime no fue debilitado.

La ejecución CI completa exacta del HEAD documental final debe verificarse en PR #32 antes de la nueva revisión adversarial. No se declara cierre si ese HEAD no está verde.

## 19. Comandos/gates esperados

Backend:

```text
npm run test:unit
npm run test:public-web-trust
npm run test:guest-appointment-capability
npm run test:integration
```

CI además mantiene:

- frontend policy tests;
- Astro checks;
- TypeScript strict checks;
- production build;
- production dependency audits según política del repo;
- Gitleaks.

Storage pre-deploy:

```text
npm run migration:public-web-storage
PUBLIC_WEB_6_2_6_B_CUTOVER=PUBLIC_WEB_6_2_6_B_STORAGE_READY
```

La variable de cutover es una atestación operativa adicional, no un bypass de la inspección física.

## 20. Invariantes de seguridad finales

1. Máximo un publicWeb origin por Business; shared origins permitidos.
2. `verifiedOrigin` no es unique global ni tenant identifier.
3. HTTPS/443 exacto; no wildcard/IP/localhost/single-label.
4. bookingUrl exact same-origin.
5. Sólo DNS TXT server-side produce verified.
6. Raw challenge nunca persiste ni reaparece.
7. Trust verified tiene freshness de 30 días y `now >= validUntil` invalida.
8. Reverify es explícito; verify no renueva verified.
9. attemptGeneration cerca DNS TOCTOU.
10. trustGeneration cerca revocación/C2 y es anti-ABA.
11. Membership admin + trusted panel Origin es autoridad administrativa.
12. public Origin/CORS/cookie/owner/legacy role/superadmin global no sustituyen Membership.
13. Dynamic CORS preflight no selecciona tenant.
14. Request browser real fresh-trust-bound se bindea al Business exacto antes del controller.
15. Shared origin mantiene aislamiento tenant.
16. No-Origin preserva 6.2.6-A.
17. Dynamic publicWeb DB lookup está rate-limited antes de Mongo y bounded a existencia.
18. Índice físico no unique se migra/verifica explícitamente con autoIndex:false production-like.
19. `/read/challenge` y `/read/verify` dependen de fresh trust para browser callers.
20. `/read` ya canjeado depende exclusivamente de capability exact-scope y siempre es credentialless.
21. Job/Delivery guardan publicWeb generation + origin.
22. Worker outbound está cercado linealizadamente contra revocación.
23. Exchange revalida trust antes de C1 y antes de mint.
24. Stale Delivery/challenge -> `INVALID_PROOF`.
25. Capability READ ya mintada conserva lifetime existente tras publicWeb revocation.
26. C2 bearer/challenge permanecen en fragment.
27. Email C2 usa sólo `Appointment.guestContact`.
28. No runtime fallback `GUEST_APPOINTMENT_ACCESS_ORIGIN`.
29. C2 sigue exactamente Business + Appointment + READ.
30. CANCEL/RESCHEDULE/PAYMENT, 6.3 y 6.4 permanecen fuera de alcance.

## 21. Deuda fuera de alcance

No pertenece a 6.2.6-B:

- múltiples origins por Business;
- wildcard domains;
- HTTP verification/`.well-known`/redirect fetch;
- monitoring DNS periódico;
- certificate/custom-domain provisioning;
- DNS provider integrations;
- Client login/accounts/OAuth;
- User↔CustomerProfile binding;
- Client history/timeline;
- CANCEL capability;
- RESCHEDULE capability;
- PAYMENT capability;
- nuevo Webpay initiation;
- refund/reconciliation redesign;
- CSRF general 6.3;
- Holiday tenantization;
- 6.3;
- 6.4.

## 22. Estado de cierre

PR #31 y el contrato documental están fusionados en `master@ed7acfd5fed91b03cd65becd2af154f93dad027b`.

PR #32 implementa funcionalmente 6.2.6-B y permanece **Draft**. Los bloqueantes adversariales conocidos de capability-after-revocation, lookup DB pre-rate-limit, CI fixtures y reconciliación física han sido abordados en la rama funcional.

6.2.6-B **no se declara cerrada todavía**: requiere CI verde sobre el HEAD exacto final y una nueva revisión adversarial independiente. No marcar Ready ni hacer merge desde esta iteración.
