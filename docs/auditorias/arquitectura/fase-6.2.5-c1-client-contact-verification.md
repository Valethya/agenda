# Fase 6.2.5-C1 — Verification tenant-scoped de contacto Client

**Estado:** runtime inicial para revisión adversarial  
**Fecha:** 2026-08-16  
**Baseline exacta:** `master@a642d119ea98f3fd7658ef876792ee5287a770f6`  
**PR precedente:** #27 merged/closed (`feat(6.2.5-B): add tenant-scoped customer profile persistence`)

## Objetivo

6.2.5-C1 introduce exclusivamente una primitiva de `Verification`/proof para demostrar control actual de un canal de contacto de cliente dentro de un `Business` y para un `purpose` exacto.

> **Verification demuestra control actual de un canal para un propósito y tenant determinados. No demuestra identidad histórica, ownership de CustomerProfile, ownership de Appointment ni Client authority general.**

La regla arquitectónica continúa siendo:

```text
current channel control != historical subject continuity
```

No se implementan consumidores de esta proof en booking, auth, Client session, claim, binding, historial ni Appointment capabilities.

## Modelo físico

Se introduce `ClientContactVerification` con:

- `business: ObjectId -> Business`, requerido;
- `channel: "email"`, requerido;
- `destination: String`, requerido;
- `purpose`, requerido y limitado;
- `secretHash: String`, requerido y `select: false`;
- `status: pending | consumed | revoked`;
- `expiresAt`, requerido;
- `consumedAt`, nullable;
- `revokedAt`, nullable;
- `createdAt` / `updatedAt` mediante `timestamps`;
- sin `User`;
- sin `Membership`;
- sin `CustomerProfile`;
- sin `Appointment`;
- sin `binding`, `claim` o Client authority.

`destination` es una identidad **operacional del canal**, no identidad personal ni clave de autorización.

## Canal y normalización

C1 implementa únicamente el canal real `email`.

La normalización operacional es exactamente:

```text
trim()
+
toLowerCase()
```

No se realiza auto-binding, merge, historial, lookup global de User ni correlación cross-tenant a partir del email normalizado. La normalización no cambia el significado de seguridad del dato: sigue siendo contacto declarado.

SMS/teléfono queda fuera de C1. El enum de canal puede ampliarse posteriormente sin reescribir el lifecycle de Verification.

## Purpose binding

Purposes permitidos en C1:

- `contact-control`;
- `appointment-read-bootstrap`;
- `appointment-cancel-bootstrap`;
- `appointment-reschedule-bootstrap`.

Los tres purposes `appointment-*-bootstrap` **no implementan ni conceden** todavía una Appointment capability. Sólo reservan scopes explícitos para demostrar que una proof emitida para una intención no es aceptable para otra.

El hash derivado y el lookup de consumo incorporan `Business + purpose`, por lo que el mismo bearer no es portable entre tenants ni entre purposes.

No existe `emailVerified: true` global o reusable.

## Secreto y hashing

Al emitir una Verification:

1. se generan 32 bytes mediante `crypto.randomBytes()`;
2. se codifican como `base64url`;
3. el bearer raw se devuelve únicamente al caller inmediato;
4. nunca se persiste raw;
5. se persiste únicamente SHA-256 hexadecimal derivado de:

```text
businessId + NUL + purpose + NUL + bearerSecret
```

El bearer contiene 256 bits de entropía previa a encoding. No se usa `Math.random()`, timestamp, email, ObjectId ni dato determinista como secreto.

SHA-256 es apropiado aquí porque el input secreto posee alta entropía criptográfica. El contexto `Business + purpose` se incorpora además a la derivación para impedir equivalencia accidental del material persistido entre scopes.

No existe logging del bearer ni del hash en esta capa.

## Tenant scope

Toda Verification pertenece exactamente a un `Business`.

Todas las operaciones requieren `businessId` explícito:

- emisión;
- consumo;
- revocación.

La creación valida:

1. ObjectId estricto;
2. existencia real del Business;
3. sólo después persiste la Verification.

Un `businessId` sintácticamente válido pero inexistente falla cerrado y no crea documentos huérfanos.

Esta comprobación es integridad referencial, no autorización tenant. C1 no introduce `Membership`, `Business.owner`, `superadmin` ni `Business.isActive` como fuentes de Client authority.

## ObjectId strictness

Los IDs externos aceptados son exclusivamente:

- instancia real `mongoose.Types.ObjectId`; o
- string hexadecimal canónico de 24 caracteres.

Se rechazan antes de query:

- números;
- strings de 12 caracteres;
- documentos Mongoose usados como ID;
- objetos;
- arrays;
- malformed strings;
- vacío;
- `null`;
- `undefined`.

No se usa `mongoose.isValidObjectId()` como frontera externa.

## Lifecycle

### pending

Estado inicial después de issue.

Puede transicionar exactamente una vez a:

- `consumed`; o
- `revoked`.

También se vuelve inválida de inmediato si:

```text
expiresAt <= now
```

La expiración no requiere cambiar físicamente `status` a `expired`.

### consumed

Representa una proof consumida con éxito. `consumedAt` se fija en la misma operación atómica.

Una Verification consumed no puede volver a consumirse ni revocarse.

### revoked

Representa invalidación explícita antes de expiración. `revokedAt` se fija atómicamente.

Una Verification revoked no puede consumirse ni reactivarse.

### expired

Es un estado lógico derivado de `expiresAt`, no un valor persistido de `status`.

No existe tolerancia implícita:

```text
expiresAt <= now => invalid
```

Esto se verifica en runtime aunque el documento continúe físicamente en MongoDB.

El reloj de seguridad se obtiene dentro del service mediante `new Date()`. Los callers de `issue/consume/revoke` no pueden suministrar un `now` alternativo para revivir proofs expirados. El repository recibe el instante ya resuelto por la capa de dominio y conserva la comparación exacta `$gt`.

## Consumo y replay prevention

El consumo usa una única operación `findOneAndUpdate()` con filtro:

- `business` correcto;
- `purpose` correcto;
- `secretHash` correcto;
- `status: pending`;
- `expiresAt > now`.

Y transición atómica:

```text
pending -> consumed
consumedAt = now
```

No existe secuencia vulnerable `read -> comprobar -> save`.

Por diseño, dos consumos concurrentes del mismo proof sólo pueden hacer match con `pending` una vez. El test de integración exige exactamente:

```text
1 fulfilled
1 rejected
```

## Revocación

`revokeVerificationForBusiness()` exige:

- `verificationId`;
- `businessId`;
- `purpose`.

La transición también es atómica y sólo acepta `pending` no expirado. No existe endpoint ni administración compleja en C1.

Una revocación no crea User, binding, claim, sesión ni capability.

## Errores

La capa de service usa códigos estables:

- `CLIENT_CONTACT_VERIFICATION_INVALID_INPUT`;
- `CLIENT_CONTACT_VERIFICATION_INVALID_PROOF`.

La invalidación de bearer devuelve el mensaje estable:

```text
Verification no válida
```

No incorpora:

- bearer secret;
- hash;
- email;
- valor normalizado;
- Mongo URI;
- credenciales;
- stack sensible.

C1 no crea endpoint público, por lo que la política HTTP final queda para el consumer futuro. La superficie queda preparada para mapear errores sin construir un oracle de clientes.

## Índice declarado

El schema declara únicamente el índice funcional nuevo:

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

Soporta la consulta real de consumo atómico.

Propiedades:

- tenant-first;
- no `unique`;
- no indexa `destination`;
- no indexa email/teléfono;
- no crea índice global de contacto.

Como el modelo usa:

```text
autoIndex: process.env.NODE_ENV === "test"
```

la declaración del schema **no afirma materialización física en producción**. C1 no añade DDL ni migración productiva. La materialización controlada será una precondición operacional antes de un futuro cutover que dependa del índice.

No se declara TTL index. La seguridad de expiración depende de la comparación runtime exacta, no de eliminación eventual de MongoDB.

## Superficie introducida

Repository:

- `createForBusiness(...)`;
- `consumeForBusiness(...)`;
- `revokeForBusiness(...)`.

Service:

- `issueVerificationForBusiness(...)`;
- `consumeVerificationForBusiness(...)`;
- `revokeVerificationForBusiness(...)`.

No existen:

- lookup global por email;
- lookup global por bearer;
- `verifyCustomer()`;
- `claimProfile()`;
- `getClientHistory()`;
- binding;
- Appointment capability.

## Tests

Unit tests cubren:

- schema requerido;
- enums limitados;
- ausencia de relaciones de autoridad;
- definición exacta del índice;
- ausencia de unique/global contact index;
- frontera ObjectId estricta antes de query;
- purpose inválido antes de query;
- bearer malformado antes de query;
- generación criptográfica y forma del bearer;
- normalización operacional exacta;
- persistencia sólo de hash.

Integration tests cubren:

- Business obligatorio;
- Business inexistente fail-closed;
- mismo contacto con proofs independientes A/B;
- bearer A inválido en B;
- purpose X inválido para Y;
- bearer inválido;
- raw secret ausente de MongoDB;
- hash distinto del raw secret;
- expiración exacta `expiresAt <= now`;
- single-use;
- revocación;
- carrera concurrente con exactamente un consumo exitoso;
- ausencia de side effects sobre User/Membership/CustomerProfile/Appointment;
- User existente con mismo email sin modificación;
- CustomerProfile existente con mismo email sin modificación.

La suite backend conserva y ejecuta `appointment-ownership-boundary.test.js`; APT-CLIENT-01 no se modifica.

## Decisiones congeladas preservadas

- `User` = identidad global autenticable.
- `Membership` = única autoridad tenant ordinaria admin/worker.
- Client no es Membership.
- `Business.owner` no concede Client authority.
- `superadmin` no concede Client authority.
- CustomerProfile pertenece a un Business y puede existir sin User.
- CustomerProfile/contact no concede autoridad por sí mismo.
- Contact match no es proof/binding/claim/ownership/history.
- current channel control != historical subject continuity.
- Verification no crea/modifica User.
- Verification no crea Membership.
- Verification no crea binding.
- Verification no fusiona CustomerProfiles.
- Verification no reclama Appointments.
- Verification no concede Client session.
- Verification no concede otra capability.
- APT-CLIENT-01 permanece fail-closed.
- bookedBy y customer permanecen conceptos distintos.

## Fuera de alcance de C1

No se modifica:

- `appointment.controller.js`;
- `appointment.service.js`;
- `appointment.model.js`;
- `auth.service.js`;
- `auth.controller.js`;
- User model;
- Membership model;
- `getOrCreateGuestUser()`;
- password recovery;
- booking;
- Payment/Webpay;
- Holiday;
- frontend/UI;
- websocket;
- seeds;
- migraciones existentes;
- datos productivos.

Tampoco se implementan:

- Client session;
- login Client;
- binding `User ↔ CustomerProfile`;
- claim;
- historial Client;
- guest Appointment capabilities;
- bearer capability read/cancel/reschedule;
- migración `Appointment.client`;
- `bookedBy/customer` físico;
- deduplicación/merge/split de CustomerProfile;
- recuperación de historial;
- delivery real de email/SMS.

## Deuda deliberadamente pendiente para 6.2.5-C2

C1 entrega sólo la proof primitive. C2 deberá decidir e implementar, sin asumir que Verification ya concede autoridad:

- consumer concreto de la proof;
- delivery/orquestación si corresponde;
- rate limiting y anti-abuse en el entrypoint real;
- política HTTP estable y anti-enumeration;
- cómo una proof aceptada habilita exactamente el siguiente paso sin escalar purpose;
- cualquier capability ADR-002 por Appointment + Business + una acción;
- rotación/reemisión y cleanup operacional;
- materialización física controlada de índices cuando sea requerida.

C1 no adelanta ninguna de esas decisiones.
