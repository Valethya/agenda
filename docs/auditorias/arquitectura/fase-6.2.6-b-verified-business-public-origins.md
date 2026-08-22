# Fase 6.2.6-B — Verified Business Public Origins

**Proyecto:** ATMÓSFERA Agenda  
**Fase:** 6.2.6-B  
**Estado:** contrato documental inicial; implementación funcional no iniciada  
**Tipo de iteración:** document-only  
**Baseline verificada:** `master@ea43c0da9a11355811b5bf0c52210af86fdac335`  
**Baseline provenance:** merge aprobado de PR #30 / 6.2.6-A, `feat(6.2.6-A): formalize headless public booking contract`  
**Fecha:** 22 de agosto de 2026

> Este documento define el contrato a revisar adversarialmente antes de escribir código. No declara 6.2.6-B implementada ni 6.2.6 completa cerrada.

## 1. Objetivo

6.2.6-B establece una trust root web pública, persistida y tenant-scoped para cada `Business`.

El MVP soportará exactamente un origin público verificado por Business. El Business podrá:

- declarar `websiteUrl` como origin canónico;
- declarar `bookingUrl` dentro del mismo origin;
- demostrar control actual del hostname mediante DNS TXT;
- alcanzar `verified` exclusivamente por una comprobación server-side;
- permitir que Agenda construya posteriormente enlaces operativos desde esa configuración verificada.

El objetivo de seguridad es eliminar la dependencia futura de una trust root global compartida por todos los Businesses sin sustituirla por datos controlados por el navegador.

La autoridad final debe quedar expresada como:

```text
Business
  -> BusinessConfig tenant-scoped
  -> publicWeb.websiteUrl normalizada
  -> publicWeb origin VERIFIED por DNS TXT server-side
  -> destino operativo construido por backend
```

Nunca como:

```text
request URL/header/body
  -> destino confiable
```

## 2. Baseline y contraste contra `master`

La baseline revisada permanece vigente: `master` apunta a `ea43c0da9a11355811b5bf0c52210af86fdac335`, que es el merge commit de PR #30 / 6.2.6-A.

El contrato se contrastó directamente contra la implementación de esa baseline.

### 2.1 Estado observado

1. `Server/src/db/models/businessConfig.model.js`
   - `BusinessConfig` continúa siendo único por `business`;
   - no contiene `websiteUrl`, `bookingUrl` ni estado de domain verification.

2. `Server/src/routes/businessConfig.routes.js`
   - Business Settings continúa siendo una superficie interna;
   - `GET /api/business-settings` pasa por `scopeBusiness` + sesión;
   - `PUT /api/business-settings` añade `isAdmin` y validación;
   - métricas y analíticas también exigen Membership admin.

3. `Server/src/middleware/business.middleware.js` + `role.middleware.js`
   - `scopeBusiness` exige sesión vigente y Business activo seleccionado;
   - revalida `Membership` desde persistencia mediante `resolveTenantAuthority`;
   - `User.role`/`User.business` y copias de sesión no sustituyen una Membership vigente;
   - `scopeBusiness` aplica además `assertTrustedAuthenticatedOrigin`;
   - `isAdmin` exige role tenant `admin` en la autoridad resuelta.

4. `Server/src/validations/common.validation.js`
   - `updateBusinessConfigSchema` utiliza objetos `strict()`;
   - propiedades desconocidas son rechazadas;
   - no existe actualmente una entrada genérica capaz de escribir estado futuro de verificación.

5. `Server/src/services/businessConfig.service.js`
   - `GET` usa `getConfigOrDefaults`;
   - leer defaults no materializa `BusinessConfig`;
   - la persistencia ocurre sólo desde comandos explícitos;
   - la respuesta evita detalles físicos de Mongoose.

6. `Server/src/security/guestAppointmentAccessUrl.js`
   - C2 usa actualmente `GUEST_APPOINTMENT_ACCESS_ORIGIN`;
   - la variable debe representar un origin HTTPS server-side;
   - `buildGuestAppointmentVerificationUrl()` construye `<origin>/appointment-access#...`;
   - `businessId`, `appointmentId`, `verificationId`, `purpose` y `challenge` permanecen en fragment, no en query.

7. `Server/src/services/guestAppointmentVerification.worker.js`
   - el worker obtiene el destino únicamente de `Appointment.guestContact`;
   - exige `channel=email`, provenance `guest-booking-input-v1` y coherencia tenant;
   - después emite el challenge C1, crea delivery y construye el access URL;
   - no utiliza `Appointment.client` ni `User.email` como fallback.

8. `Server/src/security/guestAppointmentCapability.constants.js`
   - C2 implementa end-to-end sólo `READ`;
   - `cancel` y `reschedule` existen como acciones conceptualmente distintas pero no implementadas;
   - PAYMENT no forma parte de C2.

No se detectó contradicción entre la baseline real y las premisas de esta iteración.

## 3. Threat model

### 3.1 Activos protegidos

- la trust root pública de cada Business;
- el destino de enlaces guest emitidos por Agenda;
- el aislamiento entre Businesses;
- el challenge DNS vigente;
- el estado `verified` y su evidencia temporal;
- los challenges y capabilities C1/C2 existentes;
- `Appointment.guestContact` como único destino de entrega C2;
- la autoridad tenant basada en `Membership`.

### 3.2 Adversarios y fallos relevantes

El diseño debe resistir, como mínimo:

- un navegador que envía `Origin`, `Host`, `Referer`, `returnUrl`, URLs o headers arbitrarios;
- un worker tenant que intenta configurar trust sin role admin;
- un admin del Business B que intenta mutar el Business A;
- un `Business.owner` sin Membership admin vigente;
- roles legacy en `User` que intentan reaparecer como authority;
- una configuración que apunta `bookingUrl` a otro origin;
- un atacante que conoce un challenge DNS pero no controla el DNS del hostname;
- respuestas DNS incorrectas, ausentes, parciales o temporalmente fallidas;
- verificación concurrente con cambio de origin o rotación de challenge;
- reutilización de un challenge anterior;
- filtración del challenge mediante logs, errores o DTOs posteriores;
- un fallback accidental a la variable global C2 después del cutover;
- confusión cross-Business que haga que un Business reciba el origin de otro;
- ampliación accidental de C2 a CANCEL, RESCHEDULE o PAYMENT.

### 3.3 No objetivos

DNS TXT demuestra control operativo del hostname en un punto temporal. No prueba identidad legal, propiedad registral del dominio ni control perpetuo.

6.2.6-B no introduce monitoreo periódico. Un origin verificado permanece confiable hasta que la configuración se cambie o elimine, o hasta que una fase futura defina reverificación/monitoring. `verifiedAt` debe conservar esta semántica de prueba puntual.

## 4. Modelo conceptual

`BusinessConfig` es la ubicación natural del estado porque ya existe un documento único tenant-scoped por `Business`.

El contrato conceptual añade una sección equivalente a:

```text
BusinessConfig.publicWeb
  websiteUrl                 client-owned
  bookingUrl                 client-owned

  verificationStatus         server-owned
  verifiedOrigin             server-owned
  verifiedAt                 server-owned

  verificationMethod         server-owned constant: dns_txt
  challengeHash              server-owned, secret material, never DTO
  challengeIssuedAt          server-owned
  challengeExpiresAt         server-owned
  challengeGeneration        server-owned concurrency fence
```

Los nombres físicos pueden variar durante implementación, pero las fronteras de authority no.

### 4.1 Estado derivado `unconfigured`

`unconfigured` representa la ausencia de una pareja válida `websiteUrl + bookingUrl` y de trust vigente.

No es obligatorio persistir literalmente la palabra `unconfigured`; puede ser una proyección derivada. Lo obligatorio es que la ausencia de configuración no pueda confundirse con `verified` ni materializar estado durante una lectura.

### 4.2 Client-owned

El cliente administrativo puede proponer exclusivamente:

```json
{
  "websiteUrl": "https://negocio.cl",
  "bookingUrl": "https://negocio.cl/reservar"
}
```

No puede escribir ningún campo de verificación.

### 4.3 Server-owned

Son server-owned y deben rechazarse si aparecen en un DTO de escritura:

- `verificationStatus`;
- `verifiedAt`;
- `verifiedOrigin`;
- `verificationMethod`;
- `challengeHash`;
- challenge raw;
- `challengeIssuedAt`;
- `challengeExpiresAt`;
- `challengeGeneration` o equivalente;
- cualquier alias que permita producir o simular `verified`.

## 5. Normalización y validación URL

Toda normalización debe ejecutarse server-side con una única función compartida por escritura, comparación, persistencia y resolución C2.

La normalización no puede depender de headers del request.

### 5.1 `websiteUrl`

Requisitos:

- URL absoluta;
- esquema exactamente `https:`;
- `username` vacío;
- `password` vacío;
- query vacío;
- fragment vacío;
- pathname únicamente vacío o `/` antes de normalizar;
- hostname DNS válido;
- no se aceptan IP literals;
- no se acepta `localhost` ni hostname single-label;
- no se aceptan wildcards;
- se persiste como `URL.origin`, sin slash final significativo.

Ejemplo:

```text
input:       https://negocio.cl/
normalized:  https://negocio.cl
```

El parser estándar puede normalizar casing del hostname, punycode de IDN, puerto HTTPS por defecto y otras reglas propias de URL. La persistencia debe usar la representación canónica resultante, nunca el string original.

Un puerto HTTPS no predeterminado, si está presente, forma parte del origin y por tanto de todas las comparaciones same-origin.

### 5.2 `bookingUrl`

Requisitos:

- URL absoluta;
- esquema exactamente `https:`;
- `username` vacío;
- `password` vacío;
- query vacío;
- fragment vacío;
- puede contener path;
- no puede contener wildcard host;
- su `URL.origin` normalizado debe ser exactamente igual al `websiteUrl` normalizado.

Persistencia canónica:

```text
bookingUrl = origin + pathname normalizado
```

Para path raíz puede serializarse como el origin sin slash significativo, siempre que la misma función produzca la misma representación en todas las rutas.

Válido:

```text
websiteUrl = https://negocio.cl
bookingUrl = https://negocio.cl/reservar
```

Inválido:

```text
websiteUrl = https://negocio.cl
bookingUrl = https://otro-dominio.cl/reservar
```

También es inválido un cambio sólo de puerto, porque cambia el origin.

### 5.3 Igualdad de origin

La igualdad debe realizarse sobre `URL.origin` ya normalizado, no mediante prefijos de string, sufijos de hostname ni regex parcial.

Por tanto:

```text
https://negocio.cl
!= https://sub.negocio.cl
!= https://negocio.cl:8443
!= http://negocio.cl
```

salvo que ambos lados normalizados sean literalmente el mismo origin.

## 6. Lifecycle de verificación

Lifecycle lógico:

```text
unconfigured
  -> pending
  -> verified
```

Transiciones adicionales permitidas:

```text
pending  -- origin cambia --> pending con challenge nuevo
verified -- origin cambia --> pending con trust previa revocada inmediatamente
verified -- booking path cambia dentro del mismo origin --> verified
pending  -- booking path cambia dentro del mismo origin --> pending con challenge vigente
pending  -- challenge rota --> pending con challenge nuevo
*        -- configuración se elimina --> unconfigured
```

### 6.1 Crear o cambiar configuración

`PUT /api/business-settings/public-web` debe:

1. autorizar tenant admin;
2. validar DTO estricto;
3. normalizar ambas URLs;
4. comprobar same-origin;
5. comparar contra el estado actual normalizado;
6. aplicar la transición de forma atómica.

Si el origin es nuevo o cambia:

- cualquier `verifiedOrigin` previo deja de ser confiable inmediatamente;
- `verifiedAt` anterior deja de representar trust actual;
- se genera un challenge criptográficamente aleatorio nuevo;
- sólo se persiste su hash, no el raw, si la implementación puede verificar contra los TXT resueltos mediante hash;
- aumenta `challengeGeneration` o un fence equivalente;
- el estado resultante es `pending`.

La revocación de trust anterior y la instalación del challenge nuevo deben formar una única mutación lógica. No debe existir una ventana donde el origin antiguo siga usable después de aceptar el nuevo.

### 6.2 Cambio de `bookingUrl` dentro del mismo origin

Si el `websiteUrl` normalizado conserva exactamente el mismo origin:

- modificar sólo el path de `bookingUrl` no revoca `verified`;
- no cambia `verifiedAt`;
- no genera un challenge nuevo;
- no convierte el path en trust root adicional.

Si el estado era `pending`, el challenge vigente puede conservarse porque la prueba corresponde al origin, no al path.

### 6.3 Configuración idéntica

Un `PUT` con la misma representación normalizada debe ser idempotente:

- no rota challenge;
- no cambia `verifiedAt`;
- no crea otra configuración;
- no vuelve a exponer un challenge raw ya emitido.

Si un caller perdió la respuesta one-time que contenía el challenge raw, debe usar el comando explícito de rotación definido en este contrato.

### 6.4 Challenge expiration

El challenge debe tener expiración acotada y server-owned.

La duración numérica exacta es un parámetro de implementación que debe aprobarse antes de escribir código. El contrato exige:

- `challengeExpiresAt` persistido;
- `expiresAt <= now` significa expirado;
- un challenge expirado no puede producir `verified`;
- expirar no produce `verified` ni fallback;
- la rotación genera challenge y generation nuevos.

### 6.5 Verificación exitosa

Una verificación exitosa debe:

- comprobar el TXT del hostname actual;
- comprobar el challenge vigente de la generation actual;
- transicionar atómicamente `pending -> verified` sólo si origin, challenge hash y generation siguen siendo los mismos;
- fijar `verifiedOrigin` al origin normalizado actual;
- fijar `verifiedAt` a tiempo server-side;
- consumir/eliminar el `challengeHash` utilizable y cualquier material que permita reutilizar el challenge anterior.

Si la configuración cambia mientras el resolver DNS está en curso, el resultado viejo debe descartarse. La comprobación DNS no puede verificar una generation distinta de aquella que inició la operación.

## 7. Contrato DNS TXT

6.2.6-B soporta exclusivamente DNS TXT.

No existe HTTP `/.well-known`, redirect verification ni fetch HTTP.

### 7.1 Record name

Para `websiteUrl = https://negocio.cl`:

```text
hostname de verificación:
_agenda-verification.negocio.cl
```

Para un subdominio:

```text
websiteUrl = https://agenda.negocio.cl
record name = _agenda-verification.agenda.negocio.cl
```

El record name se deriva exclusivamente del hostname normalizado de `websiteUrl`.

### 7.2 Record value

```text
agenda-verification=<challenge>
```

El challenge debe generarse con CSPRNG y entropía suficiente para no ser predecible.

Conocer el challenge no concede authority. La prueba consiste en conseguir que el TXT exacto aparezca bajo el record name correcto del hostname configurado.

### 7.3 Persistencia del challenge

Diseño preferido:

```text
raw challenge -> sólo respuesta one-time
hash(raw challenge) -> persistencia
```

Durante verificación, el resolver devuelve los TXT. El backend extrae únicamente candidatos con el prefijo exacto `agenda-verification=` y compara hash(candidate) contra el hash vigente con una comparación segura.

No es necesario persistir el raw para verificar.

Consecuencia deliberada: después de la respuesta one-time, `GET /business-settings` no puede reconstruir el `recordValue`. Si el operador lo pierde, rota el challenge mediante un comando explícito.

### 7.4 Resolver server-side e inyectable

La implementación futura debe encapsular la resolución en una interfaz inyectable, conceptualmente:

```text
resolveTxt(recordName) -> TXT records
```

Requisitos:

- sólo resolver DNS TXT;
- no realizar HTTP fetch;
- no resolver una URL aportada por un request público;
- permitir fake resolver en tests;
- distinguir `no matching TXT` de fallo operacional del resolver;
- sanitizar errores del resolver antes de responder o loggear;
- no loggear challenge raw ni TXT completos que puedan contenerlo.

### 7.5 DNS error semantics

- TXT correcto y vigente: puede avanzar a `verified`;
- TXT ausente o incorrecto: permanece `pending`;
- resolver error/timeout: permanece `pending` y falla cerrado;
- challenge expirado: permanece no verificado hasta rotación;
- challenge de generation anterior: no verifica.

## 8. Autoridad para configurar y verificar

Configurar, rotar, limpiar o verificar public web trust es una operación tenant-interna.

Cada comando debe exigir:

- sesión/User autenticado vigente;
- Business vigente y activo;
- Business seleccionado como contexto de la sesión;
- Membership vigente para ese mismo Business;
- `Membership.role = admin`;
- trusted authenticated panel origin según la política interna vigente.

No conceden authority:

- `Business.owner` por sí solo;
- `User.role` legacy;
- `User.business` legacy;
- seleccionar un Business sin Membership vigente;
- un `businessId` enviado en body/query/header que intente sustituir el tenant de sesión;
- `Origin`, `Host` o `Referer` públicos;
- `slug` público;
- email del Business;
- Appointment o CustomerProfile.

`superadmin` continúa siendo un privilegio global separado. No se transforma implícitamente en `Membership admin` para estos comandos. Si una futura política de plataforma permite soporte mutable, deberá definirse fuera de este contrato.

## 9. Comandos y endpoints

6.2.6-B debe usar comandos dedicados. El PUT genérico de `BusinessConfig` no debe adquirir capacidad de escribir campos server-owned.

### 9.1 Configurar public web

```text
PUT /api/business-settings/public-web
```

Request DTO estricto:

```json
{
  "websiteUrl": "https://negocio.cl",
  "bookingUrl": "https://negocio.cl/reservar"
}
```

No se acepta `businessId` en el body. El Business se obtiene de la autoridad tenant interna.

Respuesta cuando se crea una verification `pending` nueva:

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

`recordValue` sólo aparece cuando este comando acaba de emitir un challenge nuevo.

Un PUT idempotente posterior sobre la misma configuración no vuelve a exponerlo.

### 9.2 Verificar challenge vigente

```text
POST /api/business-settings/public-web/verify
```

Request:

```json
{}
```

Sin campos adicionales.

Semántica:

1. cargar configuración tenant-scoped actual;
2. exigir `pending` con challenge vigente;
3. capturar origin + recordName + hash + generation actuales;
4. resolver TXT server-side;
5. comparar;
6. efectuar transición condicional sólo si la generation no cambió.

Respuesta exitosa:

```json
{
  "status": "success",
  "data": {
    "publicWeb": {
      "websiteUrl": "https://negocio.cl",
      "bookingUrl": "https://negocio.cl/reservar",
      "verificationStatus": "verified",
      "verificationMethod": "dns_txt",
      "verifiedOrigin": "https://negocio.cl",
      "verifiedAt": "<server timestamp>",
      "dnsVerification": null
    }
  }
}
```

Un segundo `POST /verify` cuando el estado ya es `verified` debe ser idempotente: devuelve el estado verificado actual y no necesita una nueva consulta DNS.

### 9.3 Rotar challenge pending

```text
POST /api/business-settings/public-web/verification-challenge/rotate
```

Request:

```json
{}
```

Sólo se permite cuando existe configuración `pending`.

Debe:

- invalidar challenge/hash/generation anteriores;
- generar challenge CSPRNG nuevo;
- aumentar generation;
- devolver el nuevo `recordValue` one-time;
- conservar `websiteUrl` y `bookingUrl` actuales;
- mantener `pending`.

No debe usarse como comando genérico para reconfigurar domains.

### 9.4 Limpiar configuración

```text
DELETE /api/business-settings/public-web
```

Debe ser idempotente.

Efecto:

- elimina `websiteUrl` y `bookingUrl`;
- elimina challenge/hash y metadata de pending;
- elimina `verifiedOrigin`/`verifiedAt`;
- revoca toda trust C2 derivada de esa configuración;
- la proyección vuelve a `unconfigured`.

## 10. GET Business Settings y DTO administrativo

`GET /api/business-settings` continúa semánticamente read-only.

Leer:

- no materializa `BusinessConfig`;
- no genera challenge;
- no rota challenge;
- no dispara DNS;
- no produce `verified`.

El DTO existente debe ampliarse con una shape estable `publicWeb`, tanto si existe documento como si se están proyectando defaults.

### 10.1 `unconfigured`

```json
{
  "publicWeb": {
    "websiteUrl": null,
    "bookingUrl": null,
    "verificationStatus": "unconfigured",
    "verificationMethod": "dns_txt",
    "verifiedOrigin": null,
    "verifiedAt": null,
    "dnsVerification": null
  }
}
```

### 10.2 `pending`

El GET administrativo puede devolver información no secreta suficiente para explicar qué hostname se está verificando:

```json
{
  "publicWeb": {
    "websiteUrl": "https://negocio.cl",
    "bookingUrl": "https://negocio.cl/reservar",
    "verificationStatus": "pending",
    "verificationMethod": "dns_txt",
    "verifiedOrigin": null,
    "verifiedAt": null,
    "dnsVerification": {
      "recordType": "TXT",
      "recordName": "_agenda-verification.negocio.cl",
      "recordValue": null,
      "challengeExpiresAt": "<server timestamp>"
    }
  }
}
```

`recordValue: null` expresa deliberadamente que el raw no se reconstruye desde persistencia. El panel puede ofrecer rotación si el operador perdió el valor one-time.

### 10.3 `verified`

```json
{
  "publicWeb": {
    "websiteUrl": "https://negocio.cl",
    "bookingUrl": "https://negocio.cl/reservar",
    "verificationStatus": "verified",
    "verificationMethod": "dns_txt",
    "verifiedOrigin": "https://negocio.cl",
    "verifiedAt": "<server timestamp>",
    "dnsVerification": null
  }
}
```

Nunca exponer:

- `challengeHash`;
- generation/fence físico si no es necesario para UX;
- IDs de subdocumentos;
- detalles del resolver;
- stack traces;
- challenge raw después de la respuesta de emisión/rotación.

## 11. Errores públicos estables

Los nombres exactos pueden alinearse con el error envelope común durante implementación, pero el contrato exige códigos estables y sanitizados equivalentes a los siguientes:

| HTTP | Código contractual | Semántica |
|---|---|---|
| 400 | `PUBLIC_WEB_INVALID_URL` | websiteUrl o bookingUrl viola el contrato URL |
| 400 | `PUBLIC_WEB_ORIGIN_MISMATCH` | bookingUrl no comparte origin exacto |
| 400 | `VALIDATION_ERROR` | campos desconocidos, tipos inválidos o body no estricto |
| 401 | `UNAUTHENTICATED` | no existe sesión válida |
| 403 | `TENANT_ADMIN_REQUIRED` | no existe Membership admin vigente |
| 403 | `TRUSTED_AUTHENTICATED_ORIGIN_REQUIRED` | falla la frontera del panel autenticado |
| 409 | `PUBLIC_WEB_UNCONFIGURED` | verify/rotate requiere configuración inexistente |
| 409 | `PUBLIC_WEB_NOT_PENDING` | operación requiere pending y el estado no lo está |
| 409 | `PUBLIC_WEB_CHALLENGE_EXPIRED` | challenge vigente venció |
| 409 | `PUBLIC_WEB_VERIFICATION_NOT_PROVEN` | DNS respondió pero no contiene el TXT vigente |
| 409 | `PUBLIC_WEB_STATE_CHANGED` | origin/challenge generation cambió durante verificación |
| 429 | `RATE_LIMITED` | límite de frecuencia para comandos costosos, si aplica |
| 503 | `PUBLIC_WEB_DNS_UNAVAILABLE` | resolver DNS falló o agotó timeout |

Un error DNS no debe devolver:

- challenge raw;
- TXT completos;
- hostname interno del resolver;
- stack;
- mensajes técnicos del driver.

## 12. Idempotencia y concurrencia

### 12.1 PUT

Misma pareja normalizada:

```text
same websiteUrl + same bookingUrl
-> no-op semántico
```

No rota challenge ni renueva `verifiedAt`.

### 12.2 Verify

`POST /verify` repetido después de éxito:

```text
verified -> verified
```

No crea otra prueba ni otra trust root.

### 12.3 Delete

Eliminar una configuración inexistente debe mantener `unconfigured` sin error destructivo.

### 12.4 Fence de generation

El resolver DNS es una operación externa y puede tardar. Por ello, la futura implementación debe evitar TOCTOU:

```text
read pending generation N
-> resolve DNS
-> conditional write WHERE generation=N AND origin=expected AND status=pending
```

Si mientras tanto otro admin cambia origin o rota challenge, el write de la verificación vieja no debe aplicar.

No se acepta una implementación que haga:

```text
resolve old challenge
-> blind update status=verified
```

## 13. Comportamiento C2 final de 6.2.6-B

### 13.1 Nueva trust resolution

El estado final debe resolver el destino C2 así:

```text
job.business
  -> Business vigente
  -> BusinessConfig de ese mismo Business
  -> publicWeb.verificationStatus == verified
  -> verifiedOrigin coincide con websiteUrl origin actual
  -> trusted origin tenant-scoped
  -> <verified-origin>/appointment-access#<fragment C2 actual>
```

`bookingUrl` no se convierte en un `returnUrl` arbitrario y su path no redefine el endpoint C2. Su relación de seguridad es demostrar que la agenda pública declarada pertenece al mismo origin verificado.

### 13.2 Fragment C2 permanece intacto

Debe conservarse la propiedad actual:

```text
https://negocio.cl/appointment-access#businessId=...&appointmentId=...&verificationId=...&purpose=...&challenge=...
```

El fragmento no se mueve a query params.

No se introducen:

- `?challenge=`;
- `?token=`;
- `returnUrl` público;
- redirect URL tomada del request.

### 13.3 C2 scope permanece intacto

6.2.6-B no cambia la authority C2:

```text
exactly one Business
+ exactly one Appointment
+ exactly one implemented purpose/action READ
```

No añade:

- CANCEL;
- RESCHEDULE;
- PAYMENT.

### 13.4 Destino de email permanece intacto

El worker debe continuar enviando únicamente al `Appointment.guestContact` Appointment-scoped coherente con el Business.

No fallback a:

- `Appointment.client`;
- `User.email`;
- CustomerProfile;
- Business owner;
- request body.

### 13.5 Fail closed sin origin verified

Si el Business está:

- `unconfigured`;
- `pending`;
- con estado inconsistente;
- con `verifiedOrigin` que no coincide con el origin configurado;
- sin `BusinessConfig` materializado;

debe fallar cerrado.

No enviar email y no construir enlace alternativo.

## 14. Orden de operaciones C2

La implementación futura debe resolver la trust root verificada antes de emitir artefactos de verificación C1/C2 siempre que el flujo lo permita.

Orden objetivo del worker:

```text
1. claim/reconcile job según reglas C2 existentes
2. resolver verified public origin para job.business
3. si no existe: fail closed y terminar
4. cargar Appointment tenant-scoped y guestContact coherente
5. si no existe destination: fail closed
6. emitir challenge C1 vigente
7. crear/adjuntar delivery
8. construir access URL desde verified origin ya resuelto
9. comenzar delivery
10. enviar exclusivamente a guestContact
```

La condición mínima obligatoria es que la falta de trust root falle antes de `issueVerificationForBusiness()` y antes de cualquier email.

No crear challenges C1/C2 innecesarios cuando el Business carece de destino web confiable.

En cualquier fallo:

- no enviar email;
- no exponer bearer;
- no usar `Appointment.client`;
- no usar `User.email`;
- no usar request origin;
- conservar fail-closed.

## 15. Estrategia de cutover desde `GUEST_APPOINTMENT_ACCESS_ORIGIN`

El objetivo no es mantener dos trust roots permanentes.

### 15.1 Estado pre-cutover

Hoy:

```text
C2 -> GUEST_APPOINTMENT_ACCESS_ORIGIN global
```

### 15.2 Estado post-cutover

Después de implementar y verificar 6.2.6-B:

```text
C2 -> BusinessConfig.publicWeb.verifiedOrigin tenant-scoped
```

### 15.3 Regla de migración

La implementación funcional deberá realizar el cambio como un cutover explícito:

1. introducir persistencia, comandos y verificación DNS;
2. cubrirlos con pruebas;
3. introducir resolver tenant-scoped de origin verificado;
4. cambiar C2 para depender únicamente de ese resolver;
5. eliminar la lectura runtime de `GUEST_APPOINTMENT_ACCESS_ORIGIN` del flujo C2;
6. eliminar/documentar la variable como legacy no usada cuando CI demuestre el nuevo camino.

No se acepta como estado final:

```text
verifiedOrigin ?? GUEST_APPOINTMENT_ACCESS_ORIGIN
```

ni:

```text
if production use verified; else global
```

La variable global puede existir transitoriamente durante desarrollo del PR sólo si ningún commit declarado listo mantiene un fallback funcional. El gate final de 6.2.6-B debe demostrar una sola fuente de trust C2.

### 15.4 No backfill implícito de confianza

No convertir el valor actual de `GUEST_APPOINTMENT_ACCESS_ORIGIN` en `verified` para todos los Businesses.

Cada Business debe obtener su propia prueba DNS.

No existe un migration shortcut que conceda trust por:

- compartir frontend actual;
- haber usado históricamente la variable global;
- ser propiedad del mismo operador;
- tener owner/admin conocido.

## 16. Invariantes de seguridad

1. Existe como máximo un origin público verificado por Business en el MVP.
2. `bookingUrl` comparte exactamente el origin de `websiteUrl`.
3. Sólo HTTPS.
4. No username/password/query/fragment en URLs configuradas.
5. `websiteUrl` no contiene path significativo.
6. No wildcards.
7. Sólo DNS TXT puede producir `verified`.
8. DNS se verifica server-side.
9. El navegador nunca escribe `verified` ni campos equivalentes.
10. Challenge raw no se persiste cuando hash suficiente permite verificar.
11. Challenge raw no se loggea.
12. Cambiar origin revoca trust previa antes de usar el nuevo.
13. Cambiar sólo booking path same-origin conserva trust del origin.
14. Eliminar configuración revoca trust.
15. `GET /business-settings` no materializa ni verifica.
16. Membership admin vigente es la autoridad tenant ordinaria.
17. `Business.owner` no sustituye Membership.
18. `User.role` legacy no sustituye Membership.
19. `superadmin` no se convierte implícitamente en tenant admin.
20. `Origin`, `Host`, `Referer`, `returnUrl`, slug o body público no son trust roots.
21. C2 usa exclusivamente el verified origin del Business de la Appointment/job.
22. C2 mantiene el bearer/challenge en fragment.
23. C2 mantiene exactamente Business + Appointment + READ.
24. C2 mantiene `Appointment.guestContact` como único destination de email.
25. Business sin verified origin falla cerrado y no recibe enlace alternativo.
26. El estado final no conserva fallback permanente a `GUEST_APPOINTMENT_ACCESS_ORIGIN`.
27. Un resultado DNS para generation vieja nunca verifica generation nueva.
28. 6.2.6-B no amplía Payment authority.

## 17. Matriz mínima de tests futuros

### 17.1 URL validation

| Caso | Resultado esperado |
|---|---|
| `http://negocio.cl` | reject |
| `https://user@negocio.cl` | reject |
| `https://user:pass@negocio.cl` | reject |
| `https://negocio.cl?x=1` | reject |
| `https://negocio.cl#x` | reject |
| website `https://negocio.cl/foo` | reject |
| booking `https://otro.cl/reservar` | reject |
| booking mismo host pero distinto puerto | reject por origin mismatch |
| IP literal | reject |
| localhost/single-label | reject |
| wildcard | reject |
| casing/default port/IDN equivalentes | normalización determinista |
| mismo input repetido | misma persistencia canónica |

### 17.2 Tenant authority

| Caso | Resultado esperado |
|---|---|
| admin A configura A | allow |
| worker A configura A | 403 |
| admin B intenta configurar A | deny/fail closed |
| `Business.owner` sin Membership admin | 403 |
| `User.role=admin` legacy sin Membership | 403 |
| Business seleccionado sin Membership vigente | 403 |
| superadmin sin Membership admin usa endpoint tenant | no authority implícita |
| Origin autenticado no confiable | reject |

### 17.3 Verification

| Caso | Resultado esperado |
|---|---|
| config nueva | `pending` |
| TXT exacto | `verified` |
| TXT incorrecto | sigue no verified |
| TXT ausente | sigue pending |
| DNS error/timeout | fail closed, pending |
| challenge expirado | no verifica |
| challenge viejo tras rotación | no verifica |
| rotación | generation nueva; raw anterior inválido |
| origin cambia desde verified | revoca inmediatamente y queda pending |
| origin cambia mientras DNS lookup corre | resultado viejo no aplica |
| booking path cambia same-origin verified | conserva verifiedAt/trust |
| booking path cambia same-origin pending | conserva challenge vigente |
| PUT idéntico | no rota/no renueva |
| verify repetido sobre verified | success idempotente, sin nueva DNS |
| delete repetido | unconfigured idempotente |
| GET pending | no expone challenge raw/hash |
| GET unconfigured | no crea documento/challenge |

### 17.4 C2 cutover

| Caso | Resultado esperado |
|---|---|
| Business A verified origin A | link origin A |
| Business B verified origin B | link origin B |
| A/B concurrentes | cero cross-Business leakage |
| A pending | no link/no email |
| A unconfigured | no link/no email |
| config inconsistent | fail closed |
| request `Host` malicioso | no altera destination |
| request `Origin` malicioso | no altera destination |
| request `Referer` malicioso | no altera destination |
| `returnUrl` arbitrario | campo no existe/no funciona |
| link C2 | challenge sólo en fragment |
| worker | email sólo a `guestContact` |
| Appointment.client presente | no se usa como fallback |
| User.email coincidente | no se usa como fallback |
| global env todavía configurada | no se usa después del cutover |
| C2 capability | sigue exactamente READ |

### 17.5 Regression

- `GET /business-settings` continúa read-only;
- defaults no materializan `BusinessConfig`;
- `DEFAULT_SLOT_DURATION_MINUTES`/slotDuration canónico no cambia;
- C1 permanece intacto;
- C2 READ permanece intacto;
- booking headless de 6.2.6-A permanece intacto;
- Membership continúa siendo autoridad tenant;
- `Appointment.guestContact` permanece Appointment-scoped;
- Payment initiation y Payment authority no se amplían;
- CANCEL/RESCHEDULE continúan fuera de alcance;
- routing público/internal de 6.2.6-A no cambia accidentalmente.

## 18. Criterios de aceptación de 6.2.6-B funcional futura

La implementación futura no podrá considerarse cerrada hasta que:

1. `BusinessConfig` pueda representar un único public origin con lifecycle seguro.
2. `websiteUrl` y `bookingUrl` se validen y normalicen determinísticamente.
3. `bookingUrl` sea estrictamente same-origin.
4. sólo tenant admin vigente pueda configurar/verificar/rotar/limpiar.
5. DNS TXT sea el único método de verification.
6. resolver DNS sea server-side e inyectable.
7. challenge raw no se persista/loggee cuando hash es suficiente.
8. origin change revoque trust previa atómicamente.
9. same-origin booking path change conserve trust.
10. verify sea seguro frente a race con origin/challenge rotation.
11. GET continúe read-only y DTO sea estable.
12. C2 use únicamente verified origin tenant-scoped.
13. Business sin verified origin falle cerrado antes de emitir challenge C1/C2 siempre que corresponda.
14. `GUEST_APPOINTMENT_ACCESS_ORIGIN` deje de ser trust root runtime C2.
15. challenge/bearer C2 permanezca en fragment.
16. destination siga siendo `Appointment.guestContact`.
17. capability siga exactamente Business + Appointment + READ.
18. tests URL/authority/verification/cutover/regression estén incorporados al gate oficial.
19. una revisión adversarial posterior apruebe código + tests + cutover.

## 19. Decisiones que requieren revisión humana antes de implementar

El contrato fija la arquitectura, pero estos parámetros deben revisarse explícitamente antes de escribir o aprobar código:

1. **TTL numérico del challenge DNS.** Debe ser acotado; el valor exacto todavía no se fija.
2. **Timeout/retry policy del resolver DNS.** Debe ser pequeño, determinista y fail-closed sin transformar errores temporales en verification failure permanente.
3. **Rate limit del endpoint `/verify`.** Debe impedir abuso del resolver sin convertir la administración normal en frágil.
4. **Política de hostname público especial.** El contrato ya rechaza IP, localhost y single-label; durante implementación debe revisarse si se bloquearán además TLDs especiales/reservados mediante allow/deny explícito.
5. **Representación física del fence de concurrencia.** `challengeGeneration` es la semántica requerida; puede implementarse con versión/revision equivalente siempre que el conditional write sea demostrable.
6. **Envelope exacto de errores.** Los códigos anteriores son contractuales; deben encajar sin regresión en la infraestructura común de errores.

Ninguno de estos puntos autoriza ampliar el alcance funcional.

## 20. Deuda fuera de alcance

No pertenece a 6.2.6-B:

- múltiples verified origins por Business;
- wildcard domains;
- HTTP well-known verification;
- HTTP fetchers de verificación;
- redirect verification;
- continuous/periodic domain monitoring;
- certificate management;
- custom domain provisioning;
- DNS provider integrations;
- OAuth Client;
- Client accounts/login;
- `User <-> CustomerProfile` binding;
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

La posibilidad de que el control DNS cambie después de `verifiedAt` se reconoce como deuda deliberada de monitoring/reverification y no se resuelve ocultamente en este MVP.

## 21. Restricción de esta iteración

Esta iteración modifica únicamente documentación Markdown.

No se implementan:

- modelos;
- schemas;
- controllers;
- repositories;
- services;
- routes;
- middleware;
- DNS resolver;
- tests;
- variables de entorno;
- worker C2;
- cutover runtime.

Cualquier necesidad de código detectada por este contrato debe esperar revisión adversarial y aprobación explícita.

## 22. Estado de cierre documental

6.2.6-A está merged en `master@ea43c0da9a11355811b5bf0c52210af86fdac335`.

6.2.6-B pasa a ser el bloque activo, pero esta iteración es exclusivamente documental.

6.2.6 completa continúa abierta.

**Document-only contract iteration. No runtime behavior changed.**
