# Fase 6.2.6-B — Verified Business Public Origins

**Proyecto:** ATMÓSFERA Agenda  
**Fase:** 6.2.6-B  
**Estado:** contrato aprobado preservado; implementación funcional en PR #32 Draft con correcciones adversariales; pendiente nueva revisión adversarial independiente  
**Tipo de iteración:** implementación funcional + reconciliación adversarial  
**Contrato documental aprobado:** PR #31, HEAD `3f3623f099446615039584601d6c6a7f3f4a8be0`  
**Baseline funcional verificada:** `master@ed7acfd5fed91b03cd65becd2af154f93dad027b`, merge aprobado de PR #31  
**HEAD adversarial de entrada:** `1a3654d209200737507c4022cc438ce6efb276a7`  
**Fecha:** 22 de agosto de 2026

> El contrato normativo aprobado se conserva. Los apartados de implementación física y estado se reconciliaron con PR #32. Este documento no declara 6.2.6-B cerrada ni autoriza Ready/merge; el siguiente gate es CI verde sobre el HEAD final exacto y una nueva revisión adversarial independiente.

## 1. Objetivo

6.2.6-B establece una trust root web pública, persistida, tenant-scoped y temporalmente acotada para cada `Business`.

El MVP soportará exactamente un origin público verificado por Business. El Business podrá:

- declarar `websiteUrl` como origin canónico;
- declarar `bookingUrl` dentro del mismo origin;
- demostrar control actual del hostname mediante DNS TXT;
- alcanzar `verified` exclusivamente por una comprobación server-side;
- conservar esa trust únicamente hasta un `verificationValidUntil` server-owned;
- renovar explícitamente la trust mediante una nueva prueba DNS;
- permitir que Agenda construya enlaces operativos C2 desde el origin verificado vigente.

La cardinalidad es deliberadamente tenant-scoped:

```text
Business -> máximo un verified public origin
```

pero **no** implica la relación inversa:

```text
verified public origin -> máximo un Business
```

Un mismo origin puede estar legítimamente verificado y fresh para múltiples Businesses. `verifiedOrigin` no es una clave tenant global, no debe tener un índice global `unique` y no sustituye los identificadores públicos explícitos definidos en 6.2.6-A.

La autoridad final queda expresada como:

```text
Business
  -> BusinessConfig tenant-scoped
  -> publicWeb.websiteUrl normalizada
  -> DNS TXT server-side
  -> verifiedOrigin + trustGeneration + verificationValidUntil
  -> destino C2 construido por backend
```

Nunca como:

```text
request URL/header/body
  -> destino confiable
```

Y nunca como:

```text
verified public origin
  -> session/admin authority
```

## 2. Baseline y contraste

El contrato documental fue aprobado en PR #31 sobre el HEAD `3f3623f099446615039584601d6c6a7f3f4a8be0` y fusionado en `master@ed7acfd5fed91b03cd65becd2af154f93dad027b`. Esa es la baseline funcional de PR #32.

### 2.1 Estado histórico observado al aprobar el contrato

1. `BusinessConfig` era único por `business` y todavía no contenía `websiteUrl`, `bookingUrl` ni domain verification.
2. Business Settings era internal-only. `PUT /api/business-settings` exigía sesión, Business activo, Membership vigente y `admin`.
3. `scopeBusiness` revalidaba Membership desde persistencia y aplicaba trusted authenticated panel origin. `User.role`/`User.business` legacy no sustituían Membership.
4. `updateBusinessConfigSchema` era strict y rechazaba propiedades desconocidas.
5. `GET /api/business-settings` usaba defaults read-only y no materializaba configuración.
6. C2 usaba `GUEST_APPOINTMENT_ACCESS_ORIGIN` y construía `<origin>/appointment-access#...`; bearer/challenge permanecían en fragment.
7. El worker C2 obtenía el destino sólo de `Appointment.guestContact` Appointment-scoped y no usaba `Appointment.client` ni `User.email` como fallback.
8. C2 implementaba end-to-end únicamente READ para exactamente Business + Appointment + READ.
9. La política CORS construía el allowlist desde `CORS_ORIGINS` + `FRONTEND_URL`; únicamente `FRONTEND_URL` obtenía respuestas credentialed.
10. `exchangeGuestAppointmentReadChallenge()` validaba Delivery, job/generation C2 y challenge C1 antes de emitir READ, todavía sin public-web trust generation.
11. El contrato público 6.2.6-A podía resolver Business por query, body o `x-business-id`/`x-business-slug`; un preflight `OPTIONS` no conoce body ni valores futuros de headers, por lo que preflight y tenant binding debían permanecer separados.

### 2.2 Estado funcional implementado en PR #32

PR #32 implementa ese contrato sin ampliar capability scope:

- `BusinessConfig.publicWeb` persistido tenant-scoped;
- URL policy HTTPS/443/same-origin;
- DNS TXT server-side, challenge CSPRNG hash-only y freshness;
- `verificationAttemptGeneration` y `trustGeneration` separados;
- comandos configure/verify/reverify/rotate/delete;
- CORS dinámico credentialless con preflight separado del tenant binding real;
- shared origins;
- C2 cutover sin fallback global;
- Job/Delivery ligados a publicWeb generation/origin;
- persisted authority fence worker/revocation y exchange/mint;
- lookup CORS bounded y protegido antes de Mongo;
- índice físico no unique + migración/gate remoto.

## 3. Threat model

### 3.1 Activos protegidos

- la trust root pública de cada Business;
- su freshness temporal;
- el `trustGeneration` vigente;
- el destino de enlaces guest emitidos por Agenda;
- el aislamiento entre Businesses;
- el challenge DNS vigente y su hash;
- la separación entre public CORS y authenticated panel authority;
- los challenges y capabilities C1/C2 existentes;
- `Appointment.guestContact` como único destino de entrega C2;
- Membership como autoridad tenant.

### 3.2 Adversarios y fallos relevantes

El diseño debe resistir, como mínimo:

- un navegador que aporta `Origin`, `Host`, `Referer`, `returnUrl`, URL o headers arbitrarios;
- un origin públicamente verificado que intenta convertirse en origin credentialed o panel origin;
- cookies administrativas incidentales enviadas desde un origin público;
- un preflight exitoso que intenta reutilizarse como si hubiese concedido tenant authority;
- un origin compartido legítimamente por dos Businesses que intenta provocar confusión de tenant;
- un worker tenant que intenta configurar trust sin role admin;
- un admin B que intenta mutar A;
- `Business.owner` sin Membership admin;
- roles legacy que intentan reaparecer como authority;
- `bookingUrl` de otro origin;
- uso de puertos HTTPS no estándar;
- respuestas DNS incorrectas, ausentes o fallidas;
- stale DNS result tras cambiar/rotar configuración;
- un origin que fue verificado legítimamente pero cuya prueba ya expiró;
- una Delivery C2 emitida bajo trust generation N y utilizada después de N+1;
- revocación durante el procesamiento del worker;
- enlace ya enviado cuya trust generation se revoca antes del exchange;
- filtración del raw DNS challenge por persistencia, GET, logs o errores;
- fallback accidental a la variable global C2 después del cutover;
- cross-Business origin leakage;
- ampliación accidental de C2 a CANCEL, RESCHEDULE o PAYMENT;
- Origins desconocidos que intentan usar el preflight dinámico como amplificador de consultas MongoDB;
- una revocación publicWeb posterior que intenta acortar incorrectamente una READ capability ya canjeada.

### 3.3 Semántica de la prueba DNS y freshness

DNS TXT demuestra control operativo del hostname en un punto temporal. No prueba identidad legal, propiedad registral ni control perpetuo.

Por ello `verified` no es indefinido. Una trust efectiva requiere obligatoriamente:

```text
verificationStatus == verified
AND verifiedOrigin == origin actual de websiteUrl
AND now < verificationValidUntil
AND trustGeneration == generation vigente
```

`verifiedAt` registra cuándo se obtuvo la prueba. `verificationValidUntil` limita cuánto tiempo esa prueba puede respaldar nuevas operaciones C2 y browser trust-bound.

6.2.6-B no requiere monitoring periódico ni background jobs. La expiración se verifica lazy al resolver trust, autorizar CORS público, bindear la request browser real, iniciar/revalidar delivery C2 y realizar exchange.

Una trust expirada falla cerrada aunque el documento físico conserve temporalmente `verificationStatus = verified`.

## 4. Modelo conceptual y físico

`BusinessConfig` continúa siendo la ubicación natural porque existe un único documento tenant-scoped por Business.

```text
BusinessConfig.publicWeb
  websiteUrl                         client-owned
  bookingUrl                         client-owned

  verificationStatus                 server-owned
  verifiedOrigin                     server-owned
  verifiedAt                         server-owned
  verificationValidUntil             server-owned
  trustGeneration                    server-owned revocation epoch

  verificationMethod                 server-owned constant: dns_txt
  challengeHash                      server-owned secret derivation, select:false
  challengeIssuedAt                  server-owned
  challengeExpiresAt                 server-owned
  verificationAttemptGeneration      server-owned DNS TOCTOU fence

  authorityFence.token               server-owned, select:false
  authorityFence.trustGeneration     server-owned
  authorityFence.expiresAt           server-owned
```

Las revisions no se colapsan:

- `verificationAttemptGeneration`: cerca una prueba DNS concreta y evita que un lookup viejo verifique un challenge/configuración nueva;
- `trustGeneration`: identifica el epoch de confianza pública que atraviesa C2 e invalida Deliveries/challenges C2 ya emitidos.

Ambas se representan como enteros monotónicos. El estado unconfigured conserva revision suficiente para que delete/recreate no reutilice una generation anterior.

### 4.1 Estado derivado `unconfigured`

`unconfigured` representa ausencia de pareja `websiteUrl + bookingUrl` y ausencia de trust efectiva. El DTO lo proyecta de forma estable; metadata server-owned puede persistir para anti-ABA.

### 4.2 Client-owned

El cliente administrativo puede proponer exclusivamente:

```json
{
  "websiteUrl": "https://negocio.cl",
  "bookingUrl": "https://negocio.cl/reservar"
}
```

### 4.3 Server-owned

Deben rechazarse en DTO de escritura:

- `verificationStatus`;
- `verifiedAt`;
- `verificationValidUntil`;
- `verifiedOrigin`;
- `verificationMethod`;
- `trustGeneration`;
- `challengeHash`;
- challenge raw;
- `challengeIssuedAt`;
- `challengeExpiresAt`;
- `verificationAttemptGeneration`;
- `authorityFence`;
- cualquier alias que simule verified/extienda freshness/seleccione generation.

## 5. Normalización y validación URL

Toda normalización ocurre server-side mediante una única política compartida por escritura, comparación, CORS público, binding browser y resolución C2.

### 5.1 Política de puertos MVP

- protocolo exactamente `https:`;
- puerto efectivo exactamente 443;
- puerto omitido o `:443` explícito son equivalentes;
- cualquier otro puerto HTTPS, incluido `:8443`, se rechaza.

### 5.2 `websiteUrl`

Requisitos:

- URL absoluta;
- HTTPS;
- puerto efectivo 443;
- sin username/password;
- sin query/fragment;
- pathname únicamente vacío o `/`;
- hostname DNS válido;
- no IP literals;
- no `localhost` ni single-label;
- no wildcards;
- persistencia como origin canónico.

### 5.3 `bookingUrl`

Requisitos:

- URL absoluta;
- HTTPS;
- puerto efectivo 443;
- sin username/password;
- sin query/fragment;
- path permitido;
- no wildcard host;
- `URL.origin` normalizado exactamente igual al `websiteUrl` normalizado.

### 5.4 Igualdad de origin

La igualdad usa `URL.origin` canónico, nunca prefijos/sufijos de string.

```text
https://negocio.cl
!= https://sub.negocio.cl
!= http://negocio.cl
```

`:443` explícito normaliza al mismo origin. La igualdad de origin no implica igualdad de Business.

## 6. Lifecycle, freshness y generations

Lifecycle lógico:

```text
unconfigured
  -> pending
  -> verified (fresh hasta verificationValidUntil)
  -> effective-expired
  -> pending mediante re-verification
  -> verified
```

Transiciones:

```text
pending  -- origin cambia --> pending, challenge nuevo
verified -- origin cambia --> pending, trustGeneration N -> N+1
verified -- booking path cambia same-origin --> verified, conserva trustGeneration
verified -- reverify --> pending, trustGeneration N -> N+1
verified -- now >= verificationValidUntil --> trust N inválida inmediatamente
pending  -- challenge rota --> pending, verificationAttemptGeneration nueva
*        -- delete --> unconfigured, trustGeneration avanza cuando corresponde
```

### 6.1 Crear o cambiar configuración

`PUT /api/business-settings/public-web`:

1. autoriza tenant admin;
2. valida DTO strict;
3. normaliza URLs;
4. comprueba same-origin/443;
5. compara estado actual;
6. aplica transición atómica.

Origin nuevo/cambiado revoca trust previa, incrementa `trustGeneration`, crea challenge CSPRNG, persiste sólo hash, incrementa attempt generation y queda pending.

### 6.2 Cambio sólo de booking path same-origin

Con origin igual:

- trust fresh conserva verified/verifiedAt/validUntil/trustGeneration;
- no genera challenge nuevo;
- pending conserva challenge vigente salvo rotate explícito.

### 6.3 PUT idéntico

No rota challenge, no renueva freshness, no cambia generations y no re-expone raw.

### 6.4 Expiración del challenge DNS pending

`challengeExpiresAt <= now` impide verificar. Rotate crea raw nuevo y attempt generation nueva.

**Valor físico:** 15 minutos, centralizado en `PUBLIC_WEB_CHALLENGE_TTL_MS`.

### 6.5 Freshness de trust verified

Una verificación exitosa fija:

```text
verifiedAt = now
verificationValidUntil = now + 30 días
```

**Valor físico:** 30 días, centralizado en `PUBLIC_WEB_VERIFIED_TRUST_TTL_MS` y distinto de C1/C2.

Cuando `now >= verificationValidUntil`:

- origin deja de ser trust root efectiva;
- C2 no emite nuevos enlaces;
- CORS dinámico no lo considera fresh;
- request browser trust-bound no puede bindearse al Business;
- exchanges de Deliveries de esa generation fallan invalid proof;
- no existe fallback global;
- se requiere nueva prueba DNS.

### 6.6 Re-verification explícita

`POST /api/business-settings/public-web/reverify` revoca epoch actual, incrementa trust generation, genera challenge/attempt nuevos y deja pending. `/verify` sobre verified no renueva por no-op.

### 6.7 Verificación exitosa y TOCTOU DNS

`POST /verify` captura:

```text
origin
challengeHash
verificationAttemptGeneration
trustGeneration
challengeExpiresAt
```

resuelve TXT fuera del write y aplica conditional update sólo si esos valores siguen vigentes.

## 7. Contrato DNS TXT

Único método de 6.2.6-B: DNS TXT. No existe HTTP `/.well-known`, redirect verification ni HTTP fetch.

### 7.1 Record

```text
websiteUrl = https://negocio.cl
recordName  = _agenda-verification.negocio.cl
recordType  = TXT
recordValue = agenda-verification=<challenge>
```

### 7.2 Challenge raw: política obligatoria

```text
raw challenge
  -> memoria transitoria
  -> respuesta one-time
  -> nunca persistencia

hash/derivación(raw challenge)
  -> persistencia server-owned
```

Implementación física:

```text
crypto.randomBytes(32).toString("base64url")
SHA-256(Business + origin + verificationAttemptGeneration + raw)
```

La comparación usa `timingSafeEqual` sobre hashes válidos. Raw nunca aparece en GET, errores, logs ni DB.

### 7.3 Resolver server-side e inyectable

`resolveTxt(recordName)` usa `node:dns` por defecto y es inyectable en tests.

- sólo DNS TXT;
- no HTTP;
- recordName derivado server-side;
- timeout sanitizado;
- error fail-closed;
- attempt generation vieja no verifica estado nuevo.

**Timeout físico:** 3 segundos (`PUBLIC_WEB_DNS_TIMEOUT_MS`).

**Retry físico:** una resolución DNS por invocación de `/verify`; no existe retry automático interno. El operador puede repetir `/verify` mientras el challenge siga pending/vigente y el rate limit lo permita.

## 8. Autoridad para configurar y verificar

Cada comando exige:

- sesión autenticada vigente;
- Business vigente/activo de contexto;
- Membership vigente;
- `Membership.role = admin`;
- trusted authenticated panel origin.

No conceden authority:

- `Business.owner`;
- `User.role`/`User.business` legacy;
- seleccionar Business sin Membership;
- businessId aportado para sustituir tenant de sesión;
- verified public origin;
- CORS permitido;
- cookie incidental;
- Origin/Host/Referer/slug/email/Appointment/CustomerProfile.

`superadmin` sigue separado y no se convierte implícitamente en Membership admin.

## 9. Comandos y DTOs

Comandos implementados:

```text
PUT    /api/business-settings/public-web
POST   /api/business-settings/public-web/verify
POST   /api/business-settings/public-web/reverify
POST   /api/business-settings/public-web/verification-challenge/rotate
DELETE /api/business-settings/public-web
```

Rate limit dedicado de verify/reverify/rotate: **20 por IP / 15 minutos**.

### 9.1 Configurar public web

Request strict:

```json
{
  "websiteUrl": "https://negocio.cl",
  "bookingUrl": "https://negocio.cl/reservar"
}
```

`recordValue` sólo aparece cuando ese mismo comando acaba de emitir un raw nuevo.

### 9.2 Verificar challenge pending

Request strict `{}`. Sólo pending vigente. Verified requiere reverify explícito.

### 9.3 Re-verification / renewal

Produce pending, avanza trust generation, crea attempt/challenge nuevo. Si ya está pending no re-expone raw; se usa rotate.

### 9.4 Rotar challenge pending

Sólo pending. Invalida challenge/hash anterior, avanza attempt generation, conserva URLs y no avanza trust generation innecesariamente.

### 9.5 Limpiar configuración

DELETE visible es idempotente. Limpia URLs/challenge, revoca trust y conserva revision server-owned para anti-ABA.

## 10. GET Business Settings

`GET /api/business-settings` sigue read-only:

- no materializa BusinessConfig;
- no genera/rota challenge;
- no resuelve DNS;
- no renueva freshness;
- no produce verified.

Unconfigured proyecta URLs null/status unconfigured/method dns_txt/trustGeneration 0 para Business nunca configurado. Pending proyecta recordType/name/challengeExpiresAt y `recordValue:null`. Verified proyecta verifiedOrigin/verifiedAt/validUntil.

Nunca expone challengeHash, raw, attemptGeneration, fence token ni resolver internals.

## 11. CORS público credentialless

6.2.6-B separa:

1. **CORS preflight eligibility**;
2. **tenant binding de la request real**.

Preflight exitoso nunca sustituye el segundo paso.

### 11.1 Invariantes

```text
verified public origin fresh
  == elegible para CORS de surface pública/headless credentialless

verified public origin
  != tenant identifier único
  != trusted panel origin
  != credentialed origin
  != session authority
  != Membership authority
  != admin authority
```

Sólo la política server-controlled del panel puede conceder credentials, salvo que una ruta defina explícitamente una política más restrictiva como `/read` (siempre credentialless).

### 11.2 Cardinalidad

`verifiedOrigin` no lleva índice unique. Origin no sustituye businessId/slug. Lookup por Origin puede encontrar 0/1/múltiples Businesses.

### 11.3 Preflight `OPTIONS`

Para route class pública/headless trust-bound:

```text
route class
AND Origin normalizado
AND existe >=1 Business activo con trust fresh para Origin
-> CORS credentialless elegible
```

No selecciona tenant, no depende de body ni de valores futuros de headers y no concede authority.

### 11.4 Request real browser: binding exacto

Con header Origin, primero se resuelve Business explícito según 6.2.6-A y después, antes de controller/side effect, se exige:

```text
Business resuelto
AND request Origin normalizado
AND status verified
AND verifiedOrigin == websiteUrl origin
AND verifiedOrigin == request Origin
AND now < verificationValidUntil
AND trustGeneration vigente
```

Mismatch falla cerrado antes de mutación.

### 11.5 Shared origin válido

Business A y B pueden compartir `https://estudio.cl` si ambos demostraron DNS. Preflight puede permitir el origin; cada request real resuelve Business A o B explícitamente y mantiene aislamiento tenant.

### 11.6 Requests públicas sin `Origin`

Se preserva 6.2.6-A para server-to-server/CLI/backend callers. Ausencia de Origin no es autenticación ni invalida por sí sola la request pública. Sigue requiriéndose Business explícito y contrato de la ruta.

### 11.7 Cookies incidentales y panel authority

PublicWeb nunca vuelve credentialed una ruta ni abre internal routes. `FRONTEND_URL` conserva política independiente de panel para las rutas que correspondan.

### 11.8 `/read` bearer-authorized después del exchange

`POST /api/guest-appointments/read` consume una capability READ ya emitida. Su authority es exclusivamente:

```text
Business + Appointment + READ + bearer
```

El preflight no conoce el bearer futuro y **no** puede depender de current publicWeb freshness. Por eso esa ruta exacta admite CORS credentialless desde un Origin sintácticamente válido sin consultar publicWeb.

- `/read` no usa `bindExplicitPublicBusinessOrigin`;
- nunca devuelve `Access-Control-Allow-Credentials:true`, incluso si Origin == `FRONTEND_URL`;
- cookie admin incidental no concede nada;
- bearer ausente/inválido falla por validación/`GUEST_APPOINTMENT_CAPABILITY_INVALID_PROOF`;
- no se amplía este tratamiento a otras rutas.

`/read/challenge` y `/read/verify` continúan fresh-trust-bound para browser callers.

### 11.9 Admisión pre-lookup y lookup bounded

El CORS middleware necesita Mongo antes del limiter global `/api`, por lo que existe un limiter dedicado **antes** del lookup dinámico:

```text
PUBLIC_WEB_CORS_LOOKUP_RATE_LIMIT = 200
PUBLIC_WEB_CORS_LOOKUP_RATE_WINDOW_MS = 15 min
```

Después del presupuesto responde `429 PUBLIC_WEB_CORS_RATE_LIMITED` sin consultar MongoDB.

Se omiten del lookup/limiter dinámico las requests sin Origin, rutas no dinámicas, `/read` bearer-authorized y `FRONTEND_URL` (política panel independiente).

El lookup es existence-oriented mediante agregación:

```text
$match verifiedOrigin/status/validUntil/websiteUrl/generation
$lookup Business por _id
$unwind
$match Business.isActive=true
$limit: 1
$project _id
```

No materializa todos los Businesses que comparten Origin.

## 12. Errores públicos estables

Códigos sanitizados equivalentes:

| HTTP | Código | Semántica |
|---|---|---|
| 400 | `PUBLIC_WEB_INVALID_URL` | URL/puerto viola contrato |
| 400 | `PUBLIC_WEB_ORIGIN_MISMATCH` | booking no same-origin |
| 400 | `VALIDATION_ERROR` | DTO strict inválido |
| 401 | `UNAUTHENTICATED` | sin sesión válida |
| 403 | `TENANT_ADMIN_REQUIRED` | sin Membership admin |
| 403 | `TRUSTED_AUTHENTICATED_ORIGIN_REQUIRED` | falla panel origin |
| 409 | `PUBLIC_WEB_UNCONFIGURED` | falta configuración |
| 409 | `PUBLIC_WEB_NOT_PENDING` | operación requiere pending |
| 409 | `PUBLIC_WEB_REVERIFICATION_REQUIRED` | verify sobre verified |
| 409 | `PUBLIC_WEB_CHALLENGE_EXPIRED` | challenge vencido |
| 409 | `PUBLIC_WEB_VERIFICATION_NOT_PROVEN` | TXT no coincide |
| 409 | `PUBLIC_WEB_STATE_CHANGED` | attempt/trust state cambió |
| 409 | `PUBLIC_WEB_TRUST_EXPIRED` | trust administrativa expirada |
| 429 | `PUBLIC_WEB_CORS_RATE_LIMITED` / limiter de comando | rate limit |
| 503 | `PUBLIC_WEB_DNS_UNAVAILABLE` | resolver falló/timeout |

C2 stale proof siempre usa `GUEST_APPOINTMENT_CAPABILITY_INVALID_PROOF` sin filtrar la causa.

## 13. Idempotencia y concurrencia

### 13.1 PUT

Misma pareja normalizada: no-op, sin renewal/generation change.

### 13.2 Verify

Sólo pending. Verified requiere reverify.

### 13.3 Delete

Visible idempotente, con revision server-owned anti-replay.

### 13.4 DNS fence

```text
read attempt A / trust N
-> resolve DNS
-> conditional write WHERE attempt=A
                         AND trust=N
                         AND origin=expected
                         AND status=pending
```

### 13.5 Trust generation y linearización de delivery

Mecanismo físico implementado: `BusinessConfig.publicWeb.authorityFence` con token CSPRNG `select:false`, `trustGeneration` y `expiresAt`.

TTL del fence: **2 minutos**.

Semántica:

- acquire sólo si status/origin/generation/freshness siguen vigentes y no existe fence activo;
- confirm exige mismo token/generation y freshness;
- release sólo por token/generation propietario;
- revocaciones/config changes requieren no-active-fence;
- si revocación N->N+1 confirma antes del fence autorizado, outbound N no puede comenzar;
- wait/reclaim/fence expiry obliga revalidar;
- si el proveedor externo ya aceptó el correo antes de la revocación, no puede retirarse, pero exchange queda inválido.

El exchange usa el mismo fence antes del mint para cerrar el TOCTOU entre segunda revalidación y creación de capability.

## 14. Comportamiento C2 final

### 14.1 Resolver trust snapshot

Devuelve `{origin, trustGeneration, verificationValidUntil}` sólo para Business activo con publicWeb verified/coherent/fresh.

### 14.2 Delivery/job ligados a trustGeneration

Job/Delivery conservan como mínimo:

```text
business
publicWebTrustGeneration
trustedOrigin
```

Una Delivery N no es válida bajo N+1. Delete/origin change/expiry/reverify invalidan Delivery/challenge N; same-origin booking path no incrementa generation si trust sigue fresh.

### 14.3 Fragment y scope C2

```text
https://negocio.cl/appointment-access#businessId=...&appointmentId=...&verificationId=...&purpose=...&challenge=...
```

Bearer/challenge siguen en fragment. Authority sigue exactamente Business + Appointment + READ.

### 14.4 Destino de email

Sólo `Appointment.guestContact`. No fallback a Appointment.client/User.email/CustomerProfile/owner/body.

## 15. Orden de operaciones y worker race

```text
1. claim/reconcile job
2. resolve fresh trust snapshot
3. fail closed si no existe
4. load Appointment tenant-scoped + guestContact
5. issue C1
6. Delivery ligada a generation/origin
7. build URL
8. acquire persisted authority fence
9. confirm fence + revalidate status/origin/generation/freshness
10. iniciar outbound side effect
11. enviar sólo a guestContact
```

Pérdida de generation/freshness/fence: no send, no fallback, no bearer, artefactos fallan/revocan según C2.

## 16. Exchange C2 y revocación post-delivery

Antes de consumir C1 y antes de mint READ se revalida:

```text
Delivery.business == Business solicitado
Delivery.publicWebTrustGeneration == trustGeneration vigente
Delivery.trustedOrigin == verifiedOrigin actual
verificationStatus == verified
now < verificationValidUntil
```

Fallo => `GUEST_APPOINTMENT_CAPABILITY_INVALID_PROOF`.

Un correo/Delivery N queda inútil para exchange tras N+1, delete, origin change, expiry o reverify.

### 16.1 Capability READ ya canjeada

Una READ capability canjeada válidamente **antes** de publicWeb revocation conserva su lifetime C2 existente. La revocación invalida Delivery/challenge exchange futuro; no revoca retroactivamente el bearer ya mintado.

La superficie HTTP respeta esto: `/read` ya no depende de fresh publicWeb, mientras `/read/verify` stale continúa `INVALID_PROOF`.

## 17. Cutover desde trust root global

Estado final implementado:

```text
C2 -> BusinessConfig.publicWeb fresh verified trust tenant-scoped
```

No se acepta ni existe runtime final:

```text
verifiedOrigin ?? GUEST_APPOINTMENT_ACCESS_ORIGIN
```

No backfill implícito. Cada Business demuestra DNS aunque comparta Origin.

## 18. Invariantes de seguridad

1. Máximo un origin público por Business en MVP.
2. `verifiedOrigin` no es globalmente unique; shared origins permitidos.
3. HTTPS/443; puertos no estándar rechazados.
4. booking exact same-origin.
5. Sin credentials/query/fragment; website sin path significativo.
6. No wildcard/IP/localhost/single-label.
7. Sólo DNS TXT server-side produce verified.
8. Raw challenge nunca persiste/GET/error/log.
9. Sólo hash/derivación persistida.
10. Verified trust tiene verifiedAt/validUntil server-owned.
11. `now >= validUntil` invalida authority.
12. Reverify explícito; verify no renueva verified.
13. attemptGeneration cerca DNS TOCTOU.
14. trustGeneration cerca epoch C2 y anti-ABA.
15. Origin change/delete/expiry/reverify invalidan Delivery/challenge C2 previos.
16. Booking path same-origin no incrementa generation innecesariamente.
17. Worker no inicia outbound sobre generation revocada; persisted fence linealizable.
18. Exchange revalida generation/origin/status/freshness antes C1 y mint.
19. Stale generation produce INVALID_PROOF.
20. C2 bearer/challenge permanecen fragment.
21. C2 sigue Business + Appointment + READ.
22. Email C2 sólo guestContact.
23. Business sin fresh trust falla antes de emitir artefactos C2 cuando es posible.
24. OPTIONS decide elegibilidad CORS, nunca tenant authority.
25. Preflight no depende de body/valores futuros de headers.
26. Grant publicWeb es credentialless.
27. Request browser real resuelve Business explícito 6.2.6-A.
28. Origin browser debe coincidir con fresh trust del Business exacto.
29. Binding ocurre antes de controller/side effect.
30. Shared origin no rompe aislamiento.
31. Requests sin Origin preservan headless 6.2.6-A.
32. Public origin no se vuelve panel/session/Membership/admin authority.
33. `/read` bearer-authorized es excepción CORS exacta, siempre credentialless y no depende de current publicWeb.
34. CORS no equivale a autorización backend.
35. GET Business Settings sigue read-only.
36. C2 no conserva fallback global.
37. Dynamic CORS DB lookup está rate-limited antes de Mongo y bounded a existencia.
38. Índice publicWeb se materializa/verifica explícitamente para runtime remoto.
39. Capability READ ya mintada conserva lifetime C2 existente tras publicWeb revocation.
40. Payment/CANCEL/RESCHEDULE permanecen fuera de alcance.

## 19. Matriz mínima de tests — implementada en el gate

### 19.1 URL validation y ports

| Caso | Resultado esperado |
|---|---|
| `http://negocio.cl` | reject |
| username/password | reject |
| query/fragment | reject |
| website con path | reject |
| booking otro origin | reject |
| `https://negocio.cl:8443` | reject |
| `https://negocio.cl:443` | allow + normaliza |
| IP/localhost/single-label/wildcard | reject |
| casing/default port | determinista |

### 19.2 Tenant authority

| Caso | Resultado esperado |
|---|---|
| admin A configura A | allow |
| worker A | 403 |
| admin B intenta A | deny |
| owner sin Membership admin | deny |
| User.role legacy | no authority |
| superadmin sin Membership admin | no tenant admin |
| public verified origin intenta interno | no authority |

El test superadmin se ejecuta en proceso independiente para no contaminarlo con el auth limiter real de 5 intentos/IP/10 min. No existe bypass productivo ni Membership artificial.

### 19.3 Verification/freshness

- config nueva pending;
- exact TXT verifies;
- wrong/absent TXT fail;
- DNS error/timeout fail closed;
- challenge exact expiry;
- stale rotate/origin lookup fail;
- raw nunca persiste/reaparece;
- exact validUntil fail;
- verify no renueva verified;
- reverify generation nueva;
- same-origin booking path conserva generation.

### 19.4 C2 generations/races

- worker N + admin revoke N antes de fence => no send;
- wait/reclaim pierde fence => revalida/no send;
- delivered N + delete/origin change/expiry/reverify => exchange INVALID_PROOF;
- C1 aún vigente + stale publicWeb => INVALID_PROOF;
- destination sólo guestContact;
- fragment preservado;
- READ único action implementado.

### 19.5 CORS/preflight/tenant binding

- fresh origin preflight credentialless;
- unknown/expired origin no grant;
- OPTIONS sin body/valor de business header;
- `Access-Control-Request-Headers` no infiere tenant;
- A Origin + B Business reject antes controller;
- mismatch mutable no deja partial mutation;
- shared Origin A/B funciona para ambos con data isolation;
- no-Origin server-to-server preserva 6.2.6-A;
- public cookie no abre internal;
- publicWeb nunca ACAC true;
- FRONTEND_URL conserva política independiente fuera de `/read`;
- `/read` preflight funciona sin current publicWeb y nunca es credentialed;
- arbitrary Origin + invalid/missing bearer no obtiene datos;
- delete/expiry/reverify después de mint no acortan capability READ ya emitida;
- stale `/read/verify` sigue INVALID_PROOF.

### 19.6 Lookup DoS/storage

- 205 unknown-origin preflights demuestran máximo 200 aggregate lookups y posteriores 429 antes de DB;
- fresh/expired/shared origins mantienen semántica correcta;
- pipeline contiene `$limit:1`;
- índice físico se prueba con `autoIndex:false`;
- índice incompatible se rechaza sin drop/recreate;
- remote startup falla si falta confirmación o índice.

### 19.7 Regression

- C1 intacto;
- guestContact único destination;
- C2 READ exact-scope;
- GET Settings read-only;
- 6.2.6-A/no-Origin intactos;
- Membership authority intacta;
- panel origin independiente;
- Payment initiation/authority no ampliados;
- CANCEL/RESCHEDULE fuera de alcance.

## 20. Criterios de aceptación funcional

1. BusinessConfig representa un public origin por Business sin unicidad global inversa.
2. URL policy HTTPS/443/same-origin determinista.
3. Sólo tenant admin configura/verify/reverify/rotate/delete.
4. DNS TXT server-side/injectable único método.
5. Raw challenge sólo respuesta one-time.
6. Freshness acotada server-owned.
7. Reverify exige nueva prueba.
8. trustGeneration invalida stale Delivery/challenge.
9. worker delivery fenced contra revocación.
10. exchange revalida antes C1 y mint.
11. same-origin booking path preserva trust.
12. CORS separa preflight de tenant binding.
13. shared origin soportado sin tenant confusion.
14. no-Origin preserva headless.
15. FRONTEND_URL conserva política independiente.
16. public origin no adquiere auth/admin authority.
17. Business sin fresh trust falla donde corresponde.
18. `GUEST_APPOINTMENT_ACCESS_ORIGIN` dejó de ser trust root runtime C2.
19. fragment/guestContact/READ intactos.
20. tests forman parte del gate oficial.
21. `/read` ya mintado conserva lifetime C2 tras revocación publicWeb.
22. lookup CORS está bounded/rate-limited e indexado físicamente.
23. nueva revisión adversarial debe aprobar el HEAD final antes de Ready/merge.

## 21. Decisiones físicas adoptadas

1. **Pending DNS challenge TTL:** 15 minutos.
2. **Verified public trust TTL:** 30 días.
3. **DNS timeout:** 3 segundos. **Retry:** una resolución por invocación; sin retry automático/fallback; nuevo `/verify` explícito mientras siga vigente.
4. **Verification rate limit:** 20/IP/15 min.
5. **Public CORS lookup admission:** 200/IP/15 min antes de Mongo.
6. **Generations:** enteros monotónicos en `BusinessConfig.publicWeb`; attempt incrementa por challenge, trust por epoch/revocación; tombstone/revision evita ABA.
7. **Linearización:** persisted authority fence CSPRNG + trustGeneration + expiresAt, TTL 2 min, acquire/confirm/release por CAS predicates.
8. **Dynamic CORS lookup:** aggregation existence-oriented, active Business, `$limit:1`, shared origins soportados.
9. **Índice físico:** no unique `business_config_public_web_origin_fresh` sobre `verifiedOrigin + verificationStatus + verificationValidUntil`.
10. **Storage policy:** `npm run migration:public-web-storage`, no destructive drop/recreate, test production-like `autoIndex:false`, remote startup gate `PUBLIC_WEB_6_2_6_B_CUTOVER=PUBLIC_WEB_6_2_6_B_STORAGE_READY` más inspección física real.
11. **Bearer `/read`:** CORS credentialless independiente de current publicWeb; bearer exact-scope es authority.
12. **Error C2 stale:** `GUEST_APPOINTMENT_CAPABILITY_INVALID_PROOF` uniforme.

Ninguna decisión amplía capability ni convierte Origin en tenant authority.

## 22. Deuda fuera de alcance

No pertenece a 6.2.6-B:

- múltiples origins por Business;
- wildcard domains;
- HTTP well-known/fetch/redirect verification;
- monitoring/reverification periódica;
- certificate management/custom domain provisioning;
- DNS provider integrations;
- OAuth Client;
- Client accounts/login;
- User ↔ CustomerProfile binding;
- Client history/timeline;
- CANCEL capability;
- RESCHEDULE capability;
- PAYMENT capability;
- nuevo Webpay initiation;
- refund/reconciliation workflow;
- rediseño amplio Payments;
- CSRF general 6.3;
- Holiday tenantization;
- 6.3;
- 6.4.

## 23. Restricción de esta corrección

Esta corrección trabaja exclusivamente los bloqueantes adversariales de PR #32:

- capability READ ya canjeada vs publicWeb revocada;
- lookup CORS dinámico antes del limiter global;
- CI rojo por fixtures;
- reconciliación documental/physical storage evidence.

No se inicia ninguna capability nueva ni fase posterior.

## 24. Evidencia CI

HEAD adversarial de entrada: `1a3654d209200737507c4022cc438ce6efb276a7`, CI #307 failure por fixtures shared-origin/superadmin.

Correcciones:

- shared-origin valida DTO público `id`, no reintroduce `_id`;
- superadmin test aislado sin tocar auth limiter ni Membership authority;
- fixture 6.2.6-A histórica usa ahora un publicWeb origin HTTPS realmente verificado en lugar de tratar `CORS_ORIGINS` como trust root;
- nuevos tests cubren `/read` post-revocation, lookup admission, bounded aggregation y storage/index `autoIndex:false`.

CI #326 sobre `db270dbf2c046d76fd14547b1edf352bdd9f66cf`: **success** para backend unit, backend integration, frontend checks/build y Gitleaks.

Los commits documentales posteriores requieren nuevamente CI verde sobre el HEAD final exacto antes de la revisión adversarial. El resultado exacto de ese último run debe contrastarse en PR #32; este documento no puede auto-certificar un workflow que se ejecuta después de su propio commit.

## 25. Estado de cierre

PR #31/contrato está merged en `master@ed7acfd5fed91b03cd65becd2af154f93dad027b`.

PR #32 permanece **Draft**, abierto y sin merge. Los bloqueantes adversariales conocidos de esta corrección están implementados, pero 6.2.6-B no se declara cerrada hasta que:

1. el HEAD final exacto tenga CI verde;
2. una nueva revisión adversarial independiente apruebe código/tests/storage/documentación;
3. exista autorización posterior explícita para cualquier Ready/merge.

**No marcar Ready. No hacer merge. 6.2.6 completa continúa abierta.**
