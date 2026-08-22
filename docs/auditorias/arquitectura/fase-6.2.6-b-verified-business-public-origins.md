# Fase 6.2.6-B — Verified Business Public Origins

**Proyecto:** ATMÓSFERA Agenda  
**Fase:** 6.2.6-B  
**Estado:** contrato documental corregido tras revisión adversarial; implementación funcional no iniciada  
**Tipo de iteración:** document-only  
**Baseline verificada:** `master@ea43c0da9a11355811b5bf0c52210af86fdac335`  
**Baseline provenance:** merge aprobado de PR #30 / 6.2.6-A, `feat(6.2.6-A): formalize headless public booking contract`  
**HEAD adversarial de partida:** `056c3d7775cbe0aaa2717db1d0efcb37d9642a24`  
**Fecha:** 22 de agosto de 2026

> Este documento define el contrato que deberá implementarse y revisarse adversarialmente en una iteración posterior. No declara 6.2.6-B implementada ni 6.2.6 completa cerrada. Esta corrección no modifica comportamiento runtime.

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

La autoridad final debe quedar expresada como:

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

## 2. Baseline y contraste contra `master`

La baseline revisada permanece vigente: `master` apunta a `ea43c0da9a11355811b5bf0c52210af86fdac335`, merge commit de PR #30 / 6.2.6-A.

El HEAD adversarial de partida de PR #31 continúa siendo `056c3d7775cbe0aaa2717db1d0efcb37d9642a24`; no existía delta posterior antes de esta corrección. CI #291 sobre ese HEAD estaba en `success`.

### 2.1 Estado observado en la baseline

1. `BusinessConfig` continúa siendo único por `business` y no contiene `websiteUrl`, `bookingUrl` ni domain verification.
2. Business Settings continúa internal-only. `PUT /api/business-settings` exige sesión, Business activo, Membership vigente y `admin`.
3. `scopeBusiness` revalida Membership desde persistencia y aplica trusted authenticated panel origin. `User.role`/`User.business` legacy no sustituyen Membership.
4. `updateBusinessConfigSchema` es strict y rechaza propiedades desconocidas.
5. `GET /api/business-settings` usa defaults read-only y no materializa configuración.
6. C2 usa actualmente `GUEST_APPOINTMENT_ACCESS_ORIGIN` y construye `<origin>/appointment-access#...`; el bearer/challenge permanece en fragment.
7. El worker C2 obtiene el destino sólo de `Appointment.guestContact` Appointment-scoped y no usa `Appointment.client` ni `User.email` como fallback.
8. C2 implementa end-to-end únicamente READ para exactamente Business + Appointment + READ.
9. La política CORS actual construye el allowlist desde `CORS_ORIGINS` + `FRONTEND_URL`; únicamente `FRONTEND_URL` obtiene respuestas credentialed (`Access-Control-Allow-Credentials: true`). Un origin público admitido por CORS no adquiere por ello authority de sesión.
10. `exchangeGuestAppointmentReadChallenge()` valida Delivery entregada, job/generation C2 y challenge C1 antes de emitir la capability READ; actualmente no existe todavía vínculo con una public-web trust generation.

No se detectó contradicción de runtime con estas premisas. Los bloqueantes detectados eran contractuales.

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
- ampliación accidental de C2 a CANCEL, RESCHEDULE o PAYMENT.

### 3.3 Semántica de la prueba DNS y freshness

DNS TXT demuestra control operativo del hostname en un punto temporal. No prueba identidad legal, propiedad registral ni control perpetuo.

Por ello `verified` no es indefinido. Una trust efectiva requiere obligatoriamente:

```text
verificationStatus == verified
AND verifiedOrigin == origin actual de websiteUrl
AND now < verificationValidUntil
AND trustGeneration == generation vigente
```

`verifiedAt` registra cuándo se obtuvo la prueba. `verificationValidUntil` limita cuánto tiempo esa prueba puede respaldar nuevas operaciones C2.

6.2.6-B no requiere monitoring periódico ni background jobs. La expiración puede verificarse de forma lazy al resolver trust, al autorizar CORS público tenant-scoped, al iniciar/revalidar un delivery C2 y al realizar exchange.

Una trust expirada falla cerrada aunque el documento físico aún conserve temporalmente `verificationStatus = verified` hasta que una escritura posterior materialice la transición. Ningún path de authority puede omitir el predicado temporal.

## 4. Modelo conceptual

`BusinessConfig` continúa siendo la ubicación natural del estado porque ya existe un único documento tenant-scoped por Business.

Modelo conceptual equivalente:

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
  challengeHash                      server-owned secret derivation
  challengeIssuedAt                  server-owned
  challengeExpiresAt                 server-owned
  verificationAttemptGeneration      server-owned DNS TOCTOU fence
```

Los nombres físicos pueden variar durante implementación, pero estas dos revisions no pueden colapsarse semánticamente:

- `verificationAttemptGeneration`: cerca una prueba DNS concreta y evita que un lookup viejo verifique un challenge/configuración nueva;
- `trustGeneration`: identifica el epoch de confianza pública que atraviesa C2 y permite invalidar Deliveries/challenges C2 ya emitidos.

### 4.1 Estado derivado `unconfigured`

`unconfigured` representa ausencia de una pareja válida `websiteUrl + bookingUrl` y ausencia de trust efectiva.

No es obligatorio persistir literalmente la palabra `unconfigured`, pero el DTO debe proyectarla de forma estable. Para impedir replay después de delete, la implementación puede conservar metadata server-owned de revision aunque las URLs hayan sido limpiadas.

### 4.2 Client-owned

El cliente administrativo puede proponer exclusivamente:

```json
{
  "websiteUrl": "https://negocio.cl",
  "bookingUrl": "https://negocio.cl/reservar"
}
```

No puede escribir campos de verificación, freshness, generation ni CORS authority.

### 4.3 Server-owned

Son server-owned y deben rechazarse si aparecen en un DTO de escritura:

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
- cualquier alias que permita simular `verified`, extender freshness o seleccionar una generation.

## 5. Normalización y validación URL

Toda normalización ocurre server-side mediante una única política compartida por escritura, comparación, CORS público tenant-scoped y resolución C2.

La normalización nunca depende de headers del request.

### 5.1 Política de puertos MVP

El MVP adopta una política cerrada:

- protocolo exactamente `https:`;
- puerto efectivo exactamente 443;
- puerto omitido o `:443` explícito son equivalentes y se normalizan al origin canónico sin puerto explícito;
- cualquier puerto HTTPS no estándar, incluido `:8443`, se rechaza.

Motivo: la prueba DNS demuestra control del hostname, no control de un servicio TCP concreto en cada puerto. Restringir a 443 evita convertir una prueba de hostname en una afirmación más amplia sobre endpoints arbitrarios.

### 5.2 `websiteUrl`

Requisitos:

- URL absoluta;
- HTTPS;
- puerto efectivo 443;
- sin username/password;
- sin query/fragment;
- pathname únicamente vacío o `/` antes de normalizar;
- hostname DNS válido;
- no IP literals;
- no `localhost` ni single-label;
- no wildcards;
- persistencia como origin canónico, por ejemplo `https://negocio.cl`.

### 5.3 `bookingUrl`

Requisitos:

- URL absoluta;
- HTTPS;
- puerto efectivo 443;
- sin username/password;
- sin query/fragment;
- puede contener path;
- no wildcard host;
- `URL.origin` normalizado exactamente igual al `websiteUrl` normalizado.

Válido:

```text
websiteUrl = https://negocio.cl
bookingUrl = https://negocio.cl/reservar
```

Inválidos:

```text
https://otro-dominio.cl/reservar
https://negocio.cl:8443/reservar
```

### 5.4 Igualdad de origin

La igualdad usa `URL.origin` canónico, nunca prefijos/sufijos de string.

```text
https://negocio.cl
!= https://sub.negocio.cl
!= http://negocio.cl
```

`:443` explícito puede normalizarse al mismo origin; cualquier otro puerto se rechaza antes de la comparación.

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

`effective-expired` puede ser una condición derivada y no necesita ser un valor persistido adicional.

Transiciones relevantes:

```text
pending  -- origin cambia --> pending, challenge nuevo
verified -- origin cambia --> pending, trustGeneration N -> N+1
verified -- booking path cambia same-origin --> verified, conserva trustGeneration
verified -- reverify --> pending, trustGeneration N -> N+1
verified -- now >= verificationValidUntil --> trust N inválida inmediatamente
pending  -- challenge rota --> pending, verificationAttemptGeneration nueva
*        -- delete --> unconfigured, trustGeneration avanza
```

### 6.1 Crear o cambiar configuración

`PUT /api/business-settings/public-web` debe:

1. autorizar tenant admin;
2. validar DTO strict;
3. normalizar URLs;
4. comprobar same-origin y puerto 443;
5. comparar contra estado actual;
6. aplicar transición atómica.

Si el origin se crea o cambia:

- cualquier trust efectiva previa queda revocada;
- `trustGeneration` avanza;
- `verifiedOrigin`, `verifiedAt` y `verificationValidUntil` dejan de respaldar authority;
- se genera challenge DNS CSPRNG nuevo;
- **el raw nunca se persiste**;
- se persiste exclusivamente hash/derivación suficiente;
- `verificationAttemptGeneration` avanza;
- el estado queda `pending`.

La revocación y la nueva configuración son una sola mutación lógica.

### 6.2 Cambio sólo de booking path same-origin

Si el origin normalizado no cambia:

- una trust fresh conserva `verified`;
- conserva `verifiedAt` y `verificationValidUntil`;
- conserva `trustGeneration`;
- no genera challenge nuevo;
- no invalida Deliveries C2 de esa generation innecesariamente.

Si estaba `pending`, conserva el challenge/attempt generation vigente salvo rotación explícita.

### 6.3 PUT idéntico

Misma representación normalizada:

- no rota challenge;
- no cambia `verifiedAt`/`verificationValidUntil`;
- no cambia `trustGeneration`;
- no vuelve a exponer raw challenge.

### 6.4 Expiración del challenge DNS pending

`challengeExpiresAt` es server-owned y distinto de `verificationValidUntil`.

- `challengeExpiresAt <= now` impide verificar ese challenge;
- expirarlo no produce trust;
- rotar genera raw nuevo one-time y `verificationAttemptGeneration` nueva.

### 6.5 Freshness de trust verified

Una verificación exitosa debe fijar server-side:

```text
verifiedAt = now
verificationValidUntil = now + VERIFIED_TRUST_TTL
```

El valor exacto de `VERIFIED_TRUST_TTL` queda pendiente de aprobación humana, pero su existencia es obligatoria.

Cuando `now >= verificationValidUntil`:

- el origin deja de ser una trust root efectiva inmediatamente;
- C2 no puede emitir nuevos enlaces;
- CORS dinámico tenant-scoped no puede considerar esa prueba fresh;
- exchanges de Deliveries ligadas a esa generation fallan como invalid proof;
- no existe fallback al origin global;
- se requiere nueva prueba DNS.

No se necesita job periódico: cada frontera de authority debe comparar `now` con `verificationValidUntil`.

### 6.6 Re-verification explícita

Debe existir un comando explícito para renovar una trust ya verified o efectivamente expirada:

```text
POST /api/business-settings/public-web/reverify
```

Semántica:

1. exige configuración existente cuyo origin no cambió;
2. revoca el epoch de trust actual y avanza `trustGeneration`;
3. limpia la capacidad de la prueba anterior para respaldar C2;
4. genera un challenge DNS nuevo;
5. persiste sólo hash/derivación;
6. avanza `verificationAttemptGeneration`;
7. deja estado `pending`;
8. devuelve raw challenge sólo en esta respuesta one-time.

La renovación crea deliberadamente una ventana fail-closed hasta que la nueva prueba DNS complete `/verify`.

`POST /verify` no puede ser un no-op permanente sobre `verified`: sólo comprueba un challenge pending vigente. Si se invoca estando verified sin haber iniciado re-verification, debe devolver un error estable equivalente a `PUBLIC_WEB_REVERIFICATION_REQUIRED` o `PUBLIC_WEB_NOT_PENDING` y no extender la freshness.

### 6.7 Verificación exitosa y TOCTOU DNS

`POST /verify` debe capturar:

```text
origin
challengeHash
verificationAttemptGeneration
trustGeneration
```

resolver TXT server-side y efectuar un conditional write únicamente si esos valores continúan vigentes.

Una verificación exitosa:

- confirma TXT exacto;
- fija `verifiedOrigin` al origin actual;
- fija `verifiedAt` y `verificationValidUntil`;
- consume/elimina `challengeHash` utilizable;
- no cambia `trustGeneration` nuevamente si la generation fue creada al configurar/reverify;
- descarta cualquier resultado DNS de attempt generation vieja.

## 7. Contrato DNS TXT

Único método de 6.2.6-B: DNS TXT.

No existe HTTP `/.well-known`, redirect verification ni HTTP fetch.

### 7.1 Record

Para `websiteUrl = https://negocio.cl`:

```text
recordName  = _agenda-verification.negocio.cl
recordType  = TXT
recordValue = agenda-verification=<challenge>
```

Para subdominio:

```text
websiteUrl = https://agenda.negocio.cl
recordName = _agenda-verification.agenda.negocio.cl
```

### 7.2 Challenge raw: política obligatoria

La política ya no es preferencia sino invariante:

```text
raw challenge
  -> memoria transitoria
  -> respuesta one-time de emisión/rotación/reverify
  -> nunca persistencia

hash/derivación(raw challenge)
  -> persistencia server-owned
```

El raw challenge:

- nunca se persiste;
- nunca aparece en `GET /business-settings`;
- nunca aparece en errores;
- nunca aparece en logs;
- nunca puede reconstruirse desde el hash.

Durante `/verify`, los TXT candidatos con prefijo exacto `agenda-verification=` se derivan/hash-ean y se comparan contra la derivación vigente. TXT completos con el secret no deben loggearse.

### 7.3 Resolver server-side e inyectable

Interfaz conceptual:

```text
resolveTxt(recordName) -> TXT records
```

Requisitos:

- sólo DNS TXT;
- no HTTP fetch;
- recordName derivado del hostname normalizado server-side;
- fake resolver inyectable para tests;
- errores/timeout sanitizados;
- DNS error permanece fail-closed;
- challenge/attempt generation vieja no verifica estado nuevo.

## 8. Autoridad para configurar y verificar

Configurar, reverify, rotate, delete o verify es tenant-interno.

Cada comando exige:

- User/sesión autenticada vigente;
- Business vigente y activo;
- Business de contexto de sesión;
- Membership vigente para ese Business;
- `Membership.role = admin`;
- trusted authenticated panel origin vigente.

No conceden authority:

- `Business.owner` por sí solo;
- `User.role` o `User.business` legacy;
- seleccionar Business sin Membership;
- `businessId` aportado para sustituir tenant de sesión;
- verified public origin;
- CORS permitido;
- cookie incidental;
- `Origin`, `Host`, `Referer`, slug, email, Appointment o CustomerProfile.

`superadmin` sigue separado y no se convierte implícitamente en Membership admin.

## 9. Comandos y DTOs

El PUT genérico de BusinessConfig no puede escribir server-owned trust fields.

### 9.1 Configurar public web

```text
PUT /api/business-settings/public-web
```

Request strict:

```json
{
  "websiteUrl": "https://negocio.cl",
  "bookingUrl": "https://negocio.cl/reservar"
}
```

Respuesta al emitir challenge nuevo:

```json
{
  "status": "success",
  "data": {
    "publicWeb": {
      "websiteUrl": "https://negocio.cl",
      "bookingUrl": "https://negocio.cl/reservar",
      "verificationStatus": "pending",
      "verificationMethod": "dns_txt",
      "verifiedOrigin": null,
      "verifiedAt": null,
      "verificationValidUntil": null,
      "trustGeneration": 1,
      "dnsVerification": {
        "recordType": "TXT",
        "recordName": "_agenda-verification.negocio.cl",
        "recordValue": "agenda-verification=<one-time-challenge>",
        "challengeExpiresAt": "<server timestamp>"
      }
    }
  }
}
```

`recordValue` sólo aparece cuando este mismo comando acaba de emitir un raw nuevo.

### 9.2 Verificar challenge pending

```text
POST /api/business-settings/public-web/verify
```

Request strict: `{}`.

Sólo opera sobre `pending` con challenge vigente. Tras TXT correcto devuelve, conceptualmente:

```json
{
  "publicWeb": {
    "websiteUrl": "https://negocio.cl",
    "bookingUrl": "https://negocio.cl/reservar",
    "verificationStatus": "verified",
    "verificationMethod": "dns_txt",
    "verifiedOrigin": "https://negocio.cl",
    "verifiedAt": "<server timestamp>",
    "verificationValidUntil": "<server timestamp>",
    "trustGeneration": 1,
    "dnsVerification": null
  }
}
```

Invocar `/verify` estando verified no renueva ni extiende nada y no se trata como éxito idempotente de renovación.

### 9.3 Re-verification / renewal

```text
POST /api/business-settings/public-web/reverify
```

Request strict: `{}`.

Produce `pending`, avanza `trustGeneration`, crea attempt generation/challenge nuevos y devuelve raw DNS sólo one-time.

Si ya está `pending`, no debe re-exponer el raw existente. El operador que perdió el raw usa `/verification-challenge/rotate`.

### 9.4 Rotar challenge pending

```text
POST /api/business-settings/public-web/verification-challenge/rotate
```

Sólo `pending`.

- invalida challenge/hash anteriores;
- avanza `verificationAttemptGeneration`;
- no avanza `trustGeneration` si ya no existe una trust efectiva que revocar;
- devuelve raw nuevo one-time;
- conserva URLs.

### 9.5 Limpiar configuración

```text
DELETE /api/business-settings/public-web
```

Idempotente respecto del estado visible.

Debe:

- limpiar URLs y pending challenge material;
- revocar trust efectiva;
- avanzar `trustGeneration` cuando exista un epoch anterior que deba invalidarse;
- invalidar cualquier Delivery/challenge C2 de generations anteriores;
- proyectar `unconfigured`.

Una implementación puede conservar una revision/tombstone server-owned para que delete no haga posible reutilizar una generation anterior.

## 10. GET Business Settings

`GET /api/business-settings` sigue semánticamente read-only:

- no materializa BusinessConfig;
- no genera/rota challenge;
- no resuelve DNS;
- no renueva freshness;
- no produce `verified`.

Shape estable:

### 10.1 Unconfigured

```json
{
  "publicWeb": {
    "websiteUrl": null,
    "bookingUrl": null,
    "verificationStatus": "unconfigured",
    "verificationMethod": "dns_txt",
    "verifiedOrigin": null,
    "verifiedAt": null,
    "verificationValidUntil": null,
    "trustGeneration": 0,
    "dnsVerification": null
  }
}
```

`trustGeneration` puede ser mayor que 0 después de revocaciones previas; 0 es el default de un Business nunca configurado.

### 10.2 Pending

```json
{
  "publicWeb": {
    "websiteUrl": "https://negocio.cl",
    "bookingUrl": "https://negocio.cl/reservar",
    "verificationStatus": "pending",
    "verificationMethod": "dns_txt",
    "verifiedOrigin": null,
    "verifiedAt": null,
    "verificationValidUntil": null,
    "trustGeneration": 2,
    "dnsVerification": {
      "recordType": "TXT",
      "recordName": "_agenda-verification.negocio.cl",
      "recordValue": null,
      "challengeExpiresAt": "<server timestamp>"
    }
  }
}
```

### 10.3 Verified

```json
{
  "publicWeb": {
    "websiteUrl": "https://negocio.cl",
    "bookingUrl": "https://negocio.cl/reservar",
    "verificationStatus": "verified",
    "verificationMethod": "dns_txt",
    "verifiedOrigin": "https://negocio.cl",
    "verifiedAt": "<server timestamp>",
    "verificationValidUntil": "<server timestamp>",
    "trustGeneration": 2,
    "dnsVerification": null
  }
}
```

Nunca exponer:

- `challengeHash`;
- raw challenge;
- `verificationAttemptGeneration` si no es necesario para UX;
- resolver internals;
- stack/driver details.

## 11. CORS público credentialless

6.2.6-B integra verified public origins con la superficie headless pública sin mezclarlos con la frontera autenticada.

### 11.1 Invariantes

```text
verified public origin
  == elegible para CORS de surface pública/headless credentialless

verified public origin
  != trusted panel origin
  != credentialed origin
  != session authority
  != Membership authority
  != admin authority
```

Sólo la política interna server-controlled vigente del panel puede conceder `Access-Control-Allow-Credentials: true`. En la baseline, esa política está vinculada a `FRONTEND_URL`; 6.2.6-B no la sustituye.

Un origin público verificado debe recibir, cuando corresponda, CORS únicamente para rutas públicas/headless y con credenciales deshabilitadas/omitidas.

La verificación DNS de un origin no lo añade a `assertTrustedAuthenticatedOrigin` ni a ninguna allowlist credentialed.

### 11.2 CORS tenant-scoped

Un grant dinámico de CORS público debe demostrar server-side que:

```text
request Origin normalizado
== verifiedOrigin fresh del Business solicitado
```

Business A no obtiene por su origin permiso de navegador para leer como si fuese Business B.

El mecanismo físico puede variar, pero debe conservar:

- freshness (`now < verificationValidUntil`);
- `trustGeneration` vigente;
- Business solicitado explícitamente según el contrato público;
- route class pública/headless;
- `credentials: false`.

### 11.3 Preflight `OPTIONS`

La decisión CORS de un preflight no puede depender del body porque un preflight no transporta el body de la operación futura como fuente de authority.

La implementación deberá resolver el Business de forma preflight-safe a partir del target de ruta/identificadores explícitos permitidos por el contrato público o de un índice server-side derivado del Origin. Si no puede determinar de forma segura el Business y su trust fresh, falla cerrado.

No usar body, `Referer`, cookie, session role ni un header arbitrario aportado por la web como prueba de domain trust.

### 11.4 Cookies incidentales

Incluso si un navegador envía accidentalmente una cookie administrativa desde un verified public origin:

- el CORS público no se vuelve credentialed;
- la cookie no convierte una ruta pública en interna;
- las rutas internas continúan exigiendo trusted authenticated panel origin + sesión + Membership según su política;
- el origin público no obtiene internal/admin data.

Si un mismo string de origin coincide también con `FRONTEND_URL`, cualquier permiso credentialed existe por la política independiente del panel, no por `publicWeb.verified`.

## 12. Errores públicos estables

Los nombres exactos pueden alinearse con el envelope común durante implementación, pero deben existir códigos sanitizados equivalentes:

| HTTP | Código | Semántica |
|---|---|---|
| 400 | `PUBLIC_WEB_INVALID_URL` | URL o puerto viola contrato |
| 400 | `PUBLIC_WEB_ORIGIN_MISMATCH` | bookingUrl no same-origin |
| 400 | `VALIDATION_ERROR` | DTO strict inválido |
| 401 | `UNAUTHENTICATED` | sin sesión válida |
| 403 | `TENANT_ADMIN_REQUIRED` | sin Membership admin |
| 403 | `TRUSTED_AUTHENTICATED_ORIGIN_REQUIRED` | falla panel origin |
| 409 | `PUBLIC_WEB_UNCONFIGURED` | falta configuración |
| 409 | `PUBLIC_WEB_NOT_PENDING` | operación requiere pending |
| 409 | `PUBLIC_WEB_REVERIFICATION_REQUIRED` | verify sobre verified no renueva trust |
| 409 | `PUBLIC_WEB_CHALLENGE_EXPIRED` | challenge DNS vencido |
| 409 | `PUBLIC_WEB_VERIFICATION_NOT_PROVEN` | TXT no coincide |
| 409 | `PUBLIC_WEB_STATE_CHANGED` | attempt/trust generation cambió |
| 409 | `PUBLIC_WEB_TRUST_EXPIRED` | trust administrativa expirada |
| 429 | `RATE_LIMITED` | límite de comando costoso |
| 503 | `PUBLIC_WEB_DNS_UNAVAILABLE` | resolver falló/timeout |

C2 no debe filtrar cuál de estas razones invalidó un proof. Una Delivery/challenge ligada a generation vieja, expirada o revocada debe producir el mismo `GUEST_APPOINTMENT_CAPABILITY_INVALID_PROOF` que otros proofs inválidos.

Nunca incluir raw challenge, TXT completos, stack o resolver internals.

## 13. Idempotencia y concurrencia

### 13.1 PUT

Misma pareja normalizada: no-op semántico; no renueva freshness ni generation.

### 13.2 Verify

`POST /verify` sólo verifica `pending`. `verified -> verified` no es un renewal idempotente; requiere `/reverify`.

### 13.3 Delete

Delete visible es idempotente, pero debe conservar suficiente revision server-owned para que una generation revocada no reaparezca.

### 13.4 DNS fence

```text
read pending attemptGeneration A / trustGeneration N
-> resolve DNS
-> conditional write WHERE attemptGeneration=A
                         AND trustGeneration=N
                         AND origin=expected
                         AND status=pending
```

No blind update de `status=verified`.

### 13.5 Trust generation y linearización de delivery

La implementación futura debe definir una frontera de autorización de envío linealizable respecto de revocación de `trustGeneration`.

Semántica obligatoria:

- si la revocación N -> N+1 se confirma antes de que el worker cruce la frontera autorizada de envío, el worker N no puede enviar;
- una vez confirmada la revocación, ningún nuevo outbound delivery puede comenzar bajo N;
- el worker debe revalidar origin + generation + status + freshness inmediatamente antes del side effect externo;
- el mecanismo físico puede ser CAS/fence/lease/mutex tenant-scoped equivalente, pero un simple snapshot leído al inicio del job no basta;
- cualquier espera/reclaim que haga perder el fence obliga a revalidar antes del envío.

Esto evita la carrera `read N -> admin revokes N -> worker sends N`.

Si un delivery ya fue aceptado externamente antes de que la revocación linealice, el correo no puede retirarse, pero su exchange debe quedar invalidado inmediatamente por la nueva generation.

## 14. Comportamiento C2 final

### 14.1 Resolver trust snapshot

El resolver C2 debe devolver un snapshot equivalente a:

```text
{
  origin,
  trustGeneration,
  verificationValidUntil
}
```

sólo si:

```text
Business vigente
AND publicWeb.verificationStatus == verified
AND publicWeb.verifiedOrigin == origin actual de websiteUrl
AND now < publicWeb.verificationValidUntil
AND trustGeneration vigente
```

Si no, fail closed.

### 14.2 Delivery/job ligados a trustGeneration

Todo job/Delivery C2 que llegue a la fase de emisión debe conservar el snapshot de public-web trust utilizado, como mínimo:

```text
business
publicWebTrustGeneration
trustedOrigin
```

Puede almacenar además `verificationValidUntil` como snapshot diagnóstico, pero authority siempre se revalida contra el estado actual.

Una Delivery emitida bajo generation N no puede ser válida bajo N+1.

Revocan N para C2:

- origin change;
- delete;
- trust expiry;
- inicio de re-verification/renewal;
- cualquier revocación explícita futura del mismo trust epoch.

No revoca N innecesariamente:

- cambiar únicamente `bookingUrl` path dentro del mismo origin mientras la trust sigue fresh.

### 14.3 Fragment y scope C2 permanecen intactos

URL:

```text
https://negocio.cl/appointment-access#businessId=...&appointmentId=...&verificationId=...&purpose=...&challenge=...
```

No mover bearer/challenge a query. No `returnUrl` público.

Authority sigue exactamente:

```text
one Business + one Appointment + READ
```

No CANCEL, RESCHEDULE ni PAYMENT.

### 14.4 Destino de email

Únicamente `Appointment.guestContact` coherente con el Business.

No fallback a `Appointment.client`, `User.email`, CustomerProfile, owner o request body.

## 15. Orden de operaciones y worker race

Orden objetivo:

```text
1. claim/reconcile job C2
2. resolve fresh trust snapshot {origin, trustGeneration, validUntil}
3. si no existe -> fail closed antes de issueVerificationForBusiness()
4. cargar Appointment tenant-scoped + guestContact
5. emitir C1 challenge
6. crear/adjuntar Delivery ligada a trustGeneration + trustedOrigin
7. construir access URL desde trustedOrigin
8. adquirir/cruzar frontera de delivery autorizada para esa misma generation
9. revalidar status=verified + same origin + same generation + freshness
10. sólo entonces iniciar side effect externo
11. enviar exclusivamente a guestContact
```

La frontera de los pasos 8-10 debe estar serializada/fenced respecto de revocaciones del mismo Business. No basta comprobar trust una vez al inicio.

En cualquier pérdida de generation/freshness/fence:

- marcar/fallar el intento según reglas C2 existentes;
- revocar artefactos C1 emitidos si corresponde;
- no enviar email;
- no exponer bearer;
- no usar fallback.

## 16. Exchange C2 y revocación post-delivery

`exchangeGuestAppointmentReadChallenge()` debe añadir una revalidación server-side de public-web trust antes de consumir el proof C1 y antes de crear la capability READ.

Debe comprobar que la Delivery entregada:

```text
business == Business solicitado
publicWebTrustGeneration == trustGeneration vigente
trustedOrigin == verifiedOrigin actual
verificationStatus == verified
now < verificationValidUntil
```

Si cualquiera falla:

```text
GUEST_APPOINTMENT_CAPABILITY_INVALID_PROOF
```

aunque:

- el correo se haya entregado correctamente;
- el C1 challenge no haya alcanzado su TTL natural;
- la Appointment siga existiendo;
- el mismo hostname vuelva a aparecer posteriormente.

Consecuencia: un correo emitido bajo generation N queda criptográficamente inútil para exchange después de N+1.

Este blocker atraviesa Delivery/challenge exchange. No redefine en esta iteración la vida de una capability READ que ya fue canjeada válidamente antes de la revocación; esa capability conserva el contrato C2 existente salvo decisión posterior explícita.

## 17. Cutover desde trust root global

Estado actual:

```text
C2 -> GUEST_APPOINTMENT_ACCESS_ORIGIN global
```

Estado final:

```text
C2 -> BusinessConfig.publicWeb fresh verified trust tenant-scoped
```

Cutover obligatorio:

1. implementar persistencia/lifecycle/freshness/generations;
2. implementar DNS verification + re-verification;
3. implementar CORS público credentialless tenant-scoped;
4. ligar C2 Delivery/job a `trustGeneration`;
5. revalidar generation antes de outbound delivery y en exchange;
6. cambiar C2 para depender sólo del resolver tenant-scoped;
7. eliminar la lectura runtime de `GUEST_APPOINTMENT_ACCESS_ORIGIN` del flujo C2.

No se acepta estado final:

```text
verifiedOrigin ?? GUEST_APPOINTMENT_ACCESS_ORIGIN
```

No backfill implícito de trust desde la variable global. Cada Business requiere su prueba DNS propia.

## 18. Invariantes de seguridad

1. Máximo un origin público verificado por Business en el MVP.
2. HTTPS obligatorio y puerto efectivo 443; puertos no estándar rechazados.
3. `bookingUrl` exact same-origin con `websiteUrl`.
4. Sin username/password/query/fragment; website sin path significativo.
5. No wildcard/IP/localhost/single-label.
6. Sólo DNS TXT server-side puede producir verified.
7. Raw DNS challenge nunca se persiste, aparece en GET, errores ni logs.
8. Persistencia contiene sólo hash/derivación suficiente.
9. Verified trust posee `verifiedAt` y `verificationValidUntil` server-owned.
10. `now >= verificationValidUntil` invalida authority aun sin background job.
11. Existe re-verification explícita; `/verify` no extiende trust verified por no-op.
12. `verificationAttemptGeneration` cerca DNS TOCTOU.
13. `trustGeneration` cerca el epoch de public trust que atraviesa C2.
14. Origin change, delete, expiry/reverification invalidan Deliveries/challenges C2 de generations anteriores.
15. Same-origin booking path change no incrementa trust generation innecesariamente.
16. Worker no puede iniciar outbound delivery sobre una generation revocada; debe existir fence linealizable.
17. Exchange revalida generation + origin + status + freshness.
18. Stale generation produce C2 `INVALID_PROOF` aunque C1 TTL siga vigente.
19. C2 mantiene bearer/challenge en fragment.
20. C2 sigue exactamente Business + Appointment + READ.
21. Email C2 sigue sólo a `Appointment.guestContact`.
22. Business sin fresh verified trust falla cerrado antes de emitir artefactos cuando sea posible.
23. Verified public origin puede obtener sólo CORS público/headless credentialless.
24. Verified public origin no se convierte en trusted panel/credentialed/session/Membership/admin authority.
25. Sólo política interna del panel puede conceder `Access-Control-Allow-Credentials: true`.
26. Preflight no depende del body.
27. Business A/B conservan aislamiento de origin y datos.
28. GET Business Settings continúa read-only.
29. Estado final C2 no conserva fallback global.
30. Payment/CANCEL/RESCHEDULE permanecen fuera de alcance.

## 19. Matriz mínima de tests futuros

### 19.1 URL validation y ports

| Caso | Resultado esperado |
|---|---|
| `http://negocio.cl` | reject |
| username/password | reject |
| query/fragment | reject |
| website con path | reject |
| booking otro origin | reject |
| `https://negocio.cl:8443` | reject |
| `https://negocio.cl:443` | allow + normaliza a origin estándar |
| IP/localhost/single-label/wildcard | reject |
| casing/default port/IDN equivalente | normalización determinista |

### 19.2 Tenant authority

| Caso | Resultado esperado |
|---|---|
| admin A configura A | allow |
| worker A | 403 |
| admin B intenta A | deny |
| owner sin Membership admin | 403 |
| User.role legacy | no authority |
| superadmin sin Membership admin | no authority tenant implícita |
| public verified origin intenta endpoint interno | no authority |

### 19.3 Verification, freshness y re-verification

| Caso | Resultado esperado |
|---|---|
| config nueva | pending |
| TXT exacto | verified + `verifiedAt` + `verificationValidUntil` |
| TXT incorrecto/ausente | no verified |
| DNS error/timeout | fail closed |
| challenge expirado | no verifica |
| challenge viejo tras rotate | no verifica |
| raw después de emisión | no existe en persistencia/GET/log/error |
| freshness vigente | resolver C2 permite trust |
| `now == verificationValidUntil` | expirada, fail closed |
| verification expirada | bloquea C2 |
| `/verify` sobre verified | no renueva por no-op |
| `/reverify` | revoca generation anterior y crea pending/challenge nuevo |
| re-verification exitosa | renueva `verifiedAt`/`verificationValidUntil` bajo generation nueva |
| origin cambia durante DNS lookup | resultado viejo no aplica |
| same-origin booking path change | conserva trustGeneration/freshness |

### 19.4 C2 generation y races

| Caso | Resultado esperado |
|---|---|
| Business A origin A / B origin B | links aislados |
| worker lee generation N, admin cambia a N+1 antes de delivery | no se envía enlace N |
| worker espera/reclaim y pierde fence N | revalida y no envía |
| email creado/entregado bajo N, luego origin revocado | exchange N = `INVALID_PROOF` |
| delete después de delivery N | exchange N = `INVALID_PROOF` |
| origin change después de delivery N | exchange N = `INVALID_PROOF` |
| trust expiry después de delivery N | exchange N = `INVALID_PROOF` |
| reverify N -> N+1 | challenges N inválidos |
| same-origin booking path change | Delivery N sigue válida si trust sigue fresh |
| C1 challenge aún dentro de TTL pero trust generation vieja | `INVALID_PROOF` |
| request Host/Origin/Referer/returnUrl arbitrario | no altera destination |
| fragment C2 | bearer/challenge sólo fragment |
| destination | sólo `guestContact` |
| Appointment.client/User.email | nunca fallback |
| capability | exactamente READ |

### 19.5 CORS

| Caso | Resultado esperado |
|---|---|
| verified + fresh origin A consume endpoint público A desde navegador | CORS allow credentialless |
| origin A no verified/expired | no grant dinámico por publicWeb |
| verified origin A intenta leer Business B como B | fail closed / sin grant tenant B |
| verified public origin con cookie admin | no obtiene rutas internas |
| verified public origin | sin `Access-Control-Allow-Credentials: true` por publicWeb |
| verified origin intenta convertirse en trusted authenticated origin | reject/no authority |
| `FRONTEND_URL` legítimo | conserva conducta credentialed existente |
| preflight OPTIONS sin body | decisión no depende del body |
| Origin/Business contradictorios | fail closed |

### 19.6 Regression

- C1 permanece intacto;
- `Appointment.guestContact` permanece Appointment-scoped y único destination C2;
- C2 READ permanece Business + Appointment + READ;
- Business Settings GET sigue read-only y defaults no materializan;
- `DEFAULT_SLOT_DURATION_MINUTES` no cambia;
- booking headless 6.2.6-A permanece intacto;
- Membership continúa siendo authority tenant;
- trusted authenticated panel boundary permanece independiente;
- Payment initiation/authority no se amplían;
- CANCEL/RESCHEDULE permanecen fuera de alcance.

## 20. Criterios de aceptación funcional futuros

6.2.6-B funcional no podrá considerarse cerrada hasta que:

1. BusinessConfig represente un único public origin con lifecycle seguro.
2. URL normalization aplique HTTPS/443/same-origin determinista.
3. sólo tenant admin configure/verify/reverify/rotate/delete.
4. DNS TXT sea único método y resolver sea server-side/injectable.
5. raw challenge jamás se persista ni reaparezca después de la respuesta one-time.
6. verified trust tenga freshness acotada server-owned.
7. re-verification renueve mediante nueva prueba DNS real.
8. `trustGeneration` invalide C2 stale deliveries/challenges.
9. worker delivery esté fenced frente a revocación concurrente.
10. exchange revalide generation/origin/status/freshness.
11. same-origin booking path preserve trust sin invalidación innecesaria.
12. verified public origins se integren sólo con CORS headless credentialless tenant-scoped.
13. `FRONTEND_URL` conserve su política legítima e independiente de credenciales.
14. verified public origin nunca adquiera authenticated/session/admin authority.
15. Business sin fresh verified trust falle cerrado.
16. `GUEST_APPOINTMENT_ACCESS_ORIGIN` deje de ser trust root runtime C2.
17. fragment, guestContact y READ scope C2 permanezcan intactos.
18. tests de freshness, worker race, post-delivery revocation y CORS formen parte del gate oficial.
19. una revisión adversarial posterior apruebe código + tests + cutover.

## 21. Decisiones que requieren revisión humana antes de implementar

El contrato fija las garantías; permanecen como parámetros de implementación a aprobar:

1. **TTL numérico del challenge DNS pending.**
2. **TTL numérico de verified public trust (`verificationValidUntil - verifiedAt`).** Debe ser acotado y distinto del TTL C1/C2.
3. **Timeout/retry policy del resolver DNS.**
4. **Rate limit de `/verify`, `/reverify` y rotate.**
5. **Política adicional para hostnames especiales/reservados**, sobre los bloqueos ya definidos.
6. **Representación física de `verificationAttemptGeneration` y `trustGeneration`.** Debe demostrar conditional writes y no permitir ABA/replay tras delete/recreate.
7. **Mecanismo físico de linearización worker vs revocation.** CAS/fence/lease/mutex equivalente que impida comenzar un outbound send tras revocación confirmada.
8. **Mecanismo físico del CORS público tenant-scoped y resolución preflight-safe del Business.** Debe conservar `credentials:false` y no depender de body.
9. **Envelope exacto de errores.** Los códigos contractuales deben integrarse sin exponer estado sensible.

Ninguno autoriza ampliar la capability.

## 22. Deuda fuera de alcance

No pertenece a 6.2.6-B:

- múltiples verified origins por Business;
- wildcard domains;
- HTTP well-known/fetch/redirect verification;
- monitoring/reverification periódica o background continuous checks;
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
- rediseño amplio de Payments;
- CSRF general de 6.3;
- Holiday tenantization;
- 6.3;
- 6.4.

La reverificación **explícita y bajo demanda** y la freshness acotada sí pertenecen a 6.2.6-B; únicamente el monitoring periódico queda fuera.

## 23. Restricción de esta iteración

Esta iteración modifica únicamente documentación Markdown y, si corresponde, metadata documental del PR.

No se implementan modelos, controllers, repositories, services, routes, middleware, resolver DNS, CORS runtime, tests, worker C2, manifests, workflows ni cutover.

## 24. Estado de cierre documental

6.2.6-A está merged en `master@ea43c0da9a11355811b5bf0c52210af86fdac335`.

6.2.6-B continúa como bloque activo exclusivamente documental. Los bloqueantes de freshness, cross-C2 generation/revocation y CORS público credentialless quedan incorporados al contrato, pero **ninguno está implementado en runtime**.

6.2.6 completa continúa abierta.

**Document-only contract iteration. No runtime behavior changed.**
