# Fase 6.2.5-C1 — Verification tenant-scoped de contacto Client

**Estado:** runtime inicial corregido tras revisión adversarial  
**Fecha:** 2026-08-16  
**Baseline exacta:** `master@a642d119ea98f3fd7658ef876792ee5287a770f6`  
**HEAD adversarial de entrada:** `e61a84007ed7eed7e7b25655786c920d3ef27f5a`  
**PR precedente:** #27 merged/closed (`feat(6.2.5-B): add tenant-scoped customer profile persistence`)

## Objetivo

6.2.5-C1 introduce exclusivamente una primitiva tenant-scoped de `Verification` para emitir y consumir challenges de control actual de un canal de contacto dentro de un `Business` y para un `purpose` exacto.

> **Verification demuestra control actual de un canal para un propósito y tenant determinados. No demuestra identidad histórica, ownership de CustomerProfile, ownership de Appointment ni Client authority general.**

La regla arquitectónica continúa siendo:

```text
current channel control != historical subject continuity
```

C1 no implementa delivery real, Client session, binding, claim, historial, booking changes ni Appointment capabilities.

## Frontera challenge → delivery → consume

La semántica de seguridad queda congelada así:

```text
ISSUE -> crea un challenge pending
DELIVERY -> una trusted delivery/orchestration layer futura entrega el bearer
            exclusivamente mediante el channel/destination persistido
CONSUME -> demuestra posesión del bearer bajo Business + purpose
```

**Una Verification pending es un challenge, no prueba de control.**

**Un consume exitoso demuestra posesión del bearer. Sólo puede interpretarse como control del canal cuando el bearer fue entregado exclusivamente mediante el channel/destination persistido por una trusted delivery layer.**

**El raw bearer devuelto al issuer nunca debe enviarse directamente al claimant mediante la respuesta de emisión.**

Consecuencias obligatorias:

- `issueVerificationForBusiness()` por sí mismo no verifica un email;
- el `secret` raw retornado por issue existe sólo para trusted delivery/orchestration;
- un futuro controller HTTP de emisión no puede devolver ese bearer directamente al requester/claimant;
- un caller nunca puede inferir `email control = true` sólo porque recibió el resultado de issue;
- C2 debe implementar delivery/orquestación antes de usar consume como proof de control del canal para habilitar cualquier paso posterior;
- C1 no entrega capability ni autoridad después de consume.

No se implementa email real en este PR.

## Modelo físico

`ClientContactVerification` contiene:

- `business: ObjectId -> Business`, requerido;
- `channel: "email"`, requerido;
- `destination: String`, requerido;
- `purpose`, requerido y limitado;
- `secretHash: String`, requerido y `select: false`;
- `status: pending | consumed | revoked`;
- `expiresAt`, requerido;
- `consumedAt`, nullable;
- `revokedAt`, nullable;
- timestamps;
- sin User, Membership, CustomerProfile, Appointment, binding, claim ni Client authority.

`destination` representa el mailbox operacional al que deberá dirigirse el challenge. No es identidad personal, no es autoridad y no es clave de binding.

## Canal y normalización del mailbox

C1 soporta únicamente `email`.

La normalización operacional final es exactamente:

1. eliminar whitespace externo mediante `trim()`;
2. preservar exactamente el **local-part** en case/contenido;
3. convertir a lowercase únicamente el **domain-part**.

Ejemplos:

```text
"  Alice@Example.COM  " -> "Alice@example.com"
"alice@example.com"    -> "alice@example.com"
```

Por tanto:

```text
Alice@example.com != alice@example.com
```

a nivel de representación operacional de C1.

C1 no asume que el local-part sea case-insensitive y no transforma `Alice` en `alice`. La canonicalización del dominio sólo refleja que el domain-part del mailbox es case-insensitive; no convierte el contacto en identidad.

No se introduce parsing RFC completo, librería nueva, lookup global, deduplicación, merge, auto-binding, historial ni correlación cross-tenant.

## Purpose binding

Purposes permitidos:

- `contact-control`;
- `appointment-read-bootstrap`;
- `appointment-cancel-bootstrap`;
- `appointment-reschedule-bootstrap`.

Los purposes `appointment-*-bootstrap` no implementan ni conceden Appointment capabilities. Sólo mantienen scopes separados para impedir purpose escalation.

No existe un `emailVerified: true` global o reusable.

## Secreto y hashing

Durante issue:

1. se generan 32 bytes con `crypto.randomBytes()`;
2. se codifican como `base64url`;
3. el raw bearer se devuelve únicamente al issuer/trusted orchestration caller;
4. el raw bearer nunca se persiste;
5. se persiste SHA-256 hexadecimal derivado de:

```text
businessId + NUL + purpose + NUL + bearerSecret
```

No se usa `Math.random()`, UUID, timestamp, email, ObjectId ni dato determinista como secreto.

El bearer raw no debe aparecer en logs, errores, documentación de ejemplo, snapshots ni MongoDB.

## Tenant scope

Toda Verification pertenece exactamente a un Business.

Issue, consume y revoke requieren `businessId` explícito. El hash y el lookup de consumo están ligados efectivamente a `Business + purpose`, por lo que un bearer de Business A no funciona en B y uno de purpose X no funciona para Y.

La creación valida ObjectId estricto y existencia real del Business antes de persistir. Esto es integridad referencial, no tenant authorization.

## ObjectId strictness

IDs externos aceptados:

- `mongoose.Types.ObjectId` real;
- string hexadecimal canónico de 24 caracteres.

Se rechazan antes de query números, strings de 12 caracteres, documentos Mongoose, objetos, arrays, malformed strings, vacío, `null` y `undefined`.

No se usa `mongoose.isValidObjectId()` como frontera externa.

## Lifecycle

### pending

Estado inicial de un challenge emitido.

**pending no es proof.** Puede transicionar una sola vez a `consumed` o `revoked`, y deja de ser válido inmediatamente cuando:

```text
expiresAt <= now
```

### consumed

Indica que el bearer correcto fue presentado bajo el Business y purpose correctos mientras el challenge seguía pending y vigente.

Por sí mismo significa posesión del bearer. Sólo equivale a control actual del canal si el bearer fue entregado previamente y de forma exclusiva mediante el channel/destination persistido por trusted delivery.

No concede identidad histórica, CustomerProfile, Appointment ownership, Client session ni capability.

### revoked

Transición terminal de invalidación explícita antes de expiración. Una Verification revoked no puede consumirse ni reactivarse.

### expired

Estado lógico derivado de `expiresAt`; no se persiste como status. No existe tolerancia implícita:

```text
expiresAt <= now => invalid
```

La expiración se valida en runtime y no depende de TTL cleanup.

## Consumo, replay y revocación

Consume usa un único `findOneAndUpdate()` con Business, purpose, secretHash, `status: pending` y `expiresAt > now`.

La transición es atómica a `consumed`. Dos consumos concurrentes sólo pueden producir un éxito.

Revoke usa una transición atómica equivalente sobre `pending` no expirado. No existe `read -> check -> save`.

## Errores

Service mantiene códigos estables:

- `CLIENT_CONTACT_VERIFICATION_INVALID_INPUT`;
- `CLIENT_CONTACT_VERIFICATION_INVALID_PROOF`.

La invalidación de bearer produce el mensaje estable `Verification no válida` y no incluye bearer, hash, email completo, valor normalizado, URI, credenciales ni stack sensible.

## Índice declarado

```text
{
  business: 1,
  purpose: 1,
  secretHash: 1,
  status: 1,
  expiresAt: 1
}
name: client_verification_business_purpose_secret_status_expiry
```

Es tenant-first, no unique y no indexa destination/email/phone.

`autoIndex` continúa habilitado sólo en test. C1 no afirma materialización física productiva y no añade DDL ni migración.

## Superficie introducida

Repository:

- `createForBusiness(...)`;
- `consumeForBusiness(...)`;
- `revokeForBusiness(...)`.

Service:

- `issueVerificationForBusiness(...)` — **challenge issuance only**;
- `consumeVerificationForBusiness(...)` — bearer possession under tenant + purpose;
- `revokeVerificationForBusiness(...)`.

El nombre existente `issueVerificationForBusiness` se conserva para evitar churn innecesario dentro del mismo Draft, pero su contrato queda explícitamente restringido a emisión de challenge. No debe interpretarse como `verify`.

No existen lookup global por email/bearer, `verifyCustomer`, claim, history, binding ni Appointment capability.

## Tests

Unit tests cubren, además de las garantías previas:

- `Alice@example.com` conserva `Alice`;
- `Alice@example.com` y `alice@example.com` no se conflan;
- whitespace externo se elimina;
- `Alice@Example.COM` se representa como `Alice@example.com`;
- raw bearer no se persiste;
- challenge emitido permanece `pending`.

Integration tests existentes continúan cubriendo:

- Business obligatorio e inexistente fail-closed;
- mismo contacto con Verification independiente en A/B;
- bearer de A inválido en B;
- purpose X inválido en Y;
- raw secret ausente de MongoDB y hash distinto del raw;
- expiración exacta;
- consumed single-use;
- revoked inválido;
- consumo concurrente con exactamente un éxito;
- ausencia de side effects sobre User/Membership/CustomerProfile/Appointment;
- User existente con mismo email sin modificación;
- CustomerProfile existente con mismo email sin modificación.

La suite backend continúa ejecutando `appointment-ownership-boundary.test.js`; APT-CLIENT-01 no se modifica.

## Decisiones congeladas preservadas

- User = identidad global autenticable.
- Membership = única autoridad tenant ordinaria admin/worker.
- Client no es rol Membership.
- Business.owner y superadmin no conceden Client authority.
- CustomerProfile puede existir sin User y no concede authority por sí mismo.
- Contact match no es proof, binding, claim, ownership ni history.
- current channel control != historical subject continuity.
- Verification no crea/modifica User ni Membership.
- Verification no crea binding ni fusiona CustomerProfiles.
- Verification no reclama Appointment ni transfiere history.
- Verification no concede Client session ni capability general.
- APT-CLIENT-01 permanece fail-closed.
- bookedBy y customer siguen siendo conceptos distintos.

## Fuera de alcance

No se modifica Appointment runtime, booking, auth, User, Membership, CustomerProfile lifecycle, `getOrCreateGuestUser()`, password recovery, Payment/Webpay, Holiday, frontend, websocket, migrations ni datos productivos.

No se implementa email delivery real, Client session, binding, claim, history, Appointment bearer capability, read/cancel/reschedule ni C2.

## Deuda deliberadamente pendiente para 6.2.5-C2

C2 deberá implementar/decidir antes de usar consume como proof de control del canal:

- trusted delivery/orchestration real;
- separación segura entre respuesta de issue al requester y material de delivery;
- anti-enumeration y rate limiting del entrypoint público;
- política de reemisión/rotación/cleanup;
- consumidores concretos de la proof;
- cualquier capability ADR-002 específica a Appointment + Business + una acción;
- materialización física controlada de índices cuando corresponda.

C1 no adelanta esas decisiones.
