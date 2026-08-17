# Fase 6.2.5-C2 — Verified guest Appointment capabilities

## Estado y baseline

Implementación construida sobre `master` en:

`a84b5619b7f2fc0f928fff51755c8930934fcc0c`

Esa baseline corresponde al merge aprobado de 6.2.5-C1 / PR #28.

C2 conserva los contratos congelados de 6.2.5-A, 6.2.5-B, 6.2.5-C1, ADR-002 y APT-CLIENT-01.

## Objetivo

C2 introduce una autoridad guest explícita, temporal y por recurso:

`issue challenge -> trusted email delivery -> consume challenge -> Appointment capability`

Una capability C2 significa únicamente:

> quien posee este bearer puede ejecutar esta acción exacta sobre esta Appointment exacta dentro de este Business mientras el grant continúe válido.

No significa identidad histórica, Client account, CustomerProfile ownership, Membership, User authority ni continuidad entre citas.

## Alcance implementado

C2 implementa **READ end-to-end**.

Las acciones quedan conceptualmente separadas:

- `read`
- `cancel`
- `reschedule`

Pero sólo existe el mapping ejecutable:

`appointment-read-bootstrap -> read`

`cancel` y `reschedule` quedan congeladas para un incremento posterior. Cualquier combinación distinta al mapping READ implementado falla cerrada. No existe `appointment-manage` ni otro grant multipropósito.

## Persistencia

### GuestAppointmentVerificationDelivery

Registro de orquestación que vincula un challenge C1 ya emitido con:

- `verification`
- `business`
- `appointment`
- `purpose`
- `action`
- `status`: `pending | delivered | failed`
- `deliveredAt`
- `failedAt`

Este documento **no concede autoridad**. Su función es demostrar que el challenge asociado al scope exacto fue aceptado por la trusted delivery layer.

No duplica `destination` y no persiste bearer raw. C1 continúa siendo la fuente del channel/destination persistido.

C1 permanece sin campo `appointment`; C2 no rompe el contrato que separa Verification de Appointment authority.

### GuestAppointmentCapability

Campos relevantes:

- `business`
- `appointment`
- `verification` como provenance
- `action`
- `secretHash`
- `status`: `active | consumed | revoked`
- `expiresAt`
- `consumedAt`
- `revokedAt`
- timestamps

No contiene:

- `User`
- `Membership`
- `CustomerProfile`
- email/phone
- raw bearer
- historial
- permisos sobre otras Appointment

El bearer se genera con `crypto.randomBytes(32)` y se codifica `base64url`.

MongoDB almacena únicamente un SHA-256 derivado del scope físico `Business + Appointment + action + bearer`.

## Preconditions para emitir capability

El repository C2 exige simultáneamente:

1. Appointment existente dentro del `businessId` explícito;
2. Verification C1 exacta, mismo Business y purpose, en estado `consumed`;
3. Delivery C2 exacta, misma Verification, Business, Appointment, purpose y action, en estado `delivered` con `deliveredAt`.

Por tanto, estos caminos no conceden capability:

- `issue -> capability`
- `issue -> consume sin trusted delivery -> capability`
- Verification de Business A + Appointment de Business B
- proof READ -> cancel/reschedule
- bearer de Appointment A -> Appointment B

## Trusted email delivery

C2 reutiliza la infraestructura de email existente mediante un transporte sensible dedicado.

Para mensajes bearer-bearing:

- el destino usado es `issued.destination`, es decir, el destination normalizado que C1 persiste al emitir el challenge;
- no existe parámetro HTTP posterior que pueda sustituir ese email;
- no se registra destinatario;
- no se registra HTML/body;
- no se registra bearer URL;
- no se registra texto de error del proveedor;
- no se imprime preview URL de Ethereal;
- el challenge raw no se persiste.

`delivered` significa que el proveedor/transport configurado aceptó el mensaje. No se interpreta como lectura del email ni como identidad histórica.

Si el transporte no confirma aceptación, el delivery se marca `failed` cuando es posible y el challenge C1 se revoca best-effort. Aunque la revocación fallara, la ausencia de un delivery `delivered` impide que C2 emita capability.

## Contacto operacional y legacy guest User

El schema actual de Appointment no contiene un snapshot inmutable del email usado al reservar; contiene `Appointment.client -> User` y `User.email` es un arreglo que puede haber acumulado contactos legacy.

C2 **no interpreta `User.email` como autoridad**.

Para evitar elegir arbitrariamente un mailbox incorrecto:

- si la Appointment resuelve exactamente un email operacional no vacío, C2 puede enviar allí el challenge;
- si el User legacy contiene múltiples emails, C2 falla cerrado y no envía un challenge.

Esto es intencional. Resolver el snapshot de contacto de Appointment o una migración histórica queda fuera de C2 y no debe inferirse mediante matching de email, CustomerProfile u otras Appointment.

La verificación sólo demuestra:

`current channel control`

No demuestra:

`historical subject continuity`.

## URLs sensibles

Las URLs de verificación se construyen únicamente desde:

`GUEST_APPOINTMENT_ACCESS_ORIGIN`

La configuración debe ser un origin HTTPS explícito sin:

- credenciales;
- path distinto de `/`;
- query;
- fragment.

C2 nunca usa para construir el enlace:

- `Host`
- `Origin`
- `Referer`
- `X-Forwarded-Host`
- headers del requester
- slug o tenant derivado de sesión

El challenge se coloca en el **fragmento** (`#...`) de `/appointment-access`, no en query string. El fragmento no se envía en la petición HTTP inicial ni en el header Referer.

La página claimant elimina el fragmento mediante `history.replaceState` antes del primer POST y no carga recursos de terceros.

## Superficie HTTP

Rutas públicas C2:

- `POST /api/guest-appointments/read/challenge`
- `POST /api/guest-appointments/read/verify`
- `POST /api/guest-appointments/read`

Todas exigen `businessId` explícito dentro del body. No usan `scopeBusiness`, porque esa abstracción también acepta fuentes de tenant como sesión, slug o headers.

Los schemas son `strict` y rechazan campos adicionales como:

- `email`
- `action`
- tenant alternativo

La emisión responde siempre `202 Accepted` de forma genérica para reducir enumeración de citas/contactos.

`verify` y `read` devuelven errores públicos estables y no exponen errores internos.

Las respuestas sensibles incluyen:

- `Cache-Control: no-store`
- `Referrer-Policy: no-referrer`

Los endpoints tienen budgets de rate limit separados, incluido un límite más estricto para issuance de email.

## Claimant mínimo

`/appointment-access` es únicamente un claimant técnico para completar READ end-to-end.

No es un frontend Client ni crea sesión.

Características:

- `credentials: omit`;
- no `localStorage`;
- no `sessionStorage`;
- no cookies de Client;
- no historial;
- no listado de citas;
- no cancel/reschedule;
- bearer sólo en memoria;
- elimina el challenge del fragmento antes del exchange;
- usa el capability READ una vez y no lo conserva.

## READ projection

La lectura guest devuelve exclusivamente:

- Appointment id;
- Business: id, name, slug;
- Service: id, name, duration;
- professional: id, firstName, lastName;
- date;
- startTime;
- endTime;
- status;
- paymentStatus.

No devuelve:

- `Appointment.client`;
- emails/teléfonos;
- notes;
- CustomerProfile;
- User authority;
- Membership;
- historial;
- timeline.

## Lifecycle

READ es single-use.

Transiciones admitidas:

- `active -> consumed` al ejecutar READ correctamente;
- `active -> revoked` mediante revocación interna;
- `active` deja de ser utilizable cuando `expiresAt <= now`.

Una capability consumida, revocada o expirada no vuelve a activarse y no se acepta en replay.

TTL inicial de READ: 10 minutos desde emisión de capability.

## Contratos que permanecen intactos

C2 no modifica la autoridad de:

- User como identidad global autenticable;
- Membership como autoridad tenant ordinaria admin/worker;
- CustomerProfile como dato tenant sin autoridad;
- Business.owner;
- superadmin;
- Appointment.client bajo APT-CLIENT-01.

En particular:

`Appointment.client === authenticated User._id`

sigue sin conceder read/list/history/cancel/reschedule/timeline.

La autoridad READ guest proviene exclusivamente del bearer C2 correctamente scoped.

## Fuera de alcance

No se implementan:

- Client account/login/session;
- User <-> CustomerProfile binding;
- CustomerProfile claim;
- Client history/list/timeline;
- recuperación de citas antiguas;
- matching histórico por email/teléfono;
- deduplicación/merge/split;
- Appointment.client como autoridad;
- cambios a `getOrCreateGuestUser()`;
- password recovery;
- Membership Client;
- OAuth Client;
- loyalty/subscription/CRM/marketing consent;
- frontend Client completo;
- SMS;
- migración masiva o data migration;
- cancel/reschedule end-to-end;
- fase 6.2.5-D.

## Verificación automatizada

Las suites C2 verifican, entre otros:

- issue no expone bearer al requester;
- trusted delivery usa el destination persistido por C1;
- delivery no confirmado no puede generar capability;
- C1 issue directo sin delivery C2 no puede generar capability;
- purpose/action mapping fail-closed;
- aislamiento cross-tenant;
- aislamiento cross-Appointment;
- secreto raw ausente de MongoDB;
- hash distinto del bearer;
- READ projection mínima;
- single-use/replay denial;
- expiración estricta `expiresAt <= now`;
- revocación terminal;
- rechazo de User legacy con múltiples emails;
- origin HTTPS confiable;
- validaciones HTTP strict;
- C1 sigue sin `appointment`.
