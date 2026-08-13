# Fase 6.2.5-B — Persistencia tenant-scoped de CustomerProfile

**Estado:** runtime inicial implementado para revisión  
**Fecha:** 2026-08-13  
**Baseline exacta:** `master@9de475bed7439e69b079d407106d181d035afe3f`  
**Contrato precedente:** fase 6.2.5-A / PR #26 merged

## Objetivo

Introducir únicamente la primitive física `CustomerProfile` y un repository tenant-scoped, sin cambiar todavía booking, auth, sesión Client, Verification, claim, binding, guest capabilities ni migraciones legacy.

## Schema físico implementado

`CustomerProfile` contiene:

- `business: ObjectId -> Business`, requerido;
- `firstName: String`, opcional, trim, default `""`;
- `lastName: String`, opcional, trim, default `""`;
- `email: String`, opcional, trim, default `""`;
- `phone: String`, opcional, trim, default `""`;
- `createdAt` / `updatedAt` mediante `timestamps`;
- sin `versionKey`.

`email` y `phone` son datos operacionales declarados. No son identidad verificada, proof, binding ni autoridad.

Deliberadamente `CustomerProfile` no contiene referencia `User`, `Membership`, claim, binding, Verification ni campo de autoridad Client.

## Índice declarado y materialización física

El schema declara el índice tenant-first alineado con el orden estable del repository:

```text
{ business: 1, createdAt: -1, _id: -1 }
name: customer_profile_business_created_at_id
```

`Business` permanece como primer campo y `_id` es el desempate deliberado del sort `{ createdAt: -1, _id: -1 }`.

Esta declaración **no equivale a afirmar que el índice ya exista físicamente en MongoDB de runtime/producción**. El modelo mantiene:

```text
autoIndex: process.env.NODE_ENV === "test"
```

Por lo tanto:

- los tests verifican la definición exacta declarada en el schema;
- 6.2.5-B no introduce migración, DDL productivo ni script de escritura real;
- la materialización física controlada del índice deberá verificarse/ejecutarse como precondición antes de un futuro cutover que dependa operacionalmente de él;
- este PR no afirma una garantía física que todavía no haya sido verificada en el entorno destino.

No se declaran índices unique por email/teléfono, índices globales de contacto ni digests deterministas de contacto.

## Repository

`Server/src/repositories/customerProfile.repository.js` expone únicamente:

- `createForBusiness(businessId, data)`;
- `findByIdAndBusiness(profileId, businessId)`;
- `findAllByBusiness(businessId, { limit, skip })`.

### Frontera ObjectId

`businessId` y `profileId` aceptan exclusivamente:

- una instancia BSON/Mongoose `ObjectId`; o
- una representación hexadecimal de 24 caracteres.

Se rechazan números, strings de 12 caracteres, documentos Mongoose usados como identificador, objetos/arrays arbitrarios, strings malformados, vacío, `null` y `undefined`.

### Creación

`createForBusiness()`:

1. valida estrictamente `businessId`;
2. comprueba que corresponda a un `Business` existente;
3. falla cerrado si el identificador es sintácticamente válido pero el Business no existe;
4. proyecta una allowlist de campos operacionales;
5. fuerza el Business recibido por argumento, por lo que `data.business` no puede cambiar el tenant.

La comprobación de esta fase es de **existencia/integridad referencial**. No introduce autorización tenant ni congela una política sobre `Business.isActive`.

### Lecturas

`findByIdAndBusiness()` y `findAllByBusiness()` garantizan:

- ObjectIds sintácticamente válidos bajo la frontera estricta anterior;
- filtro explícito por `business` en la propia consulta;
- un profile de otro tenant no es recuperable mediante `findByIdAndBusiness(profileId, businessId)`;
- un Business sintácticamente válido pero inexistente produce naturalmente `null`/lista vacía.

La existencia, actividad y autoridad para operar sobre el Business son precondiciones que corresponden a capas superiores. El repository no debe convertirse en una fuente de autorización tenant.

### Paginación

Los defaults son:

```text
limit = 100
skip = 0
```

Se aplican **sólo cuando el parámetro fue omitido**. Si `limit` o `skip` fueron suministrados, deben ser números enteros finitos:

- `limit`: `1..100`;
- `skip`: `>= 0`.

Se rechazan sin coerción negativos, cero para `limit`, `NaN`, `Infinity/-Infinity`, fracciones, strings —incluidos strings numéricos—, objetos, arrays, `null` y `undefined` suministrado explícitamente. Las pruebas verifican que los valores inválidos fallen antes de ejecutar `CustomerProfile.find()`.

No se implementan `findByEmail`, `findByPhone`, deduplicación, auto-merge ni reutilización automática por contacto.

## Invariantes cubiertas por tests

Los tests añadidos verifican:

- Business obligatorio;
- existencia de CustomerProfile sin User;
- Business forzado por el argumento de creación;
- Business sintácticamente válido pero inexistente falla cerrado al crear;
- lectura propia de Business A;
- inaccesibilidad de un ID válido perteneciente a Business B cuando se consulta desde A;
- mismo email/teléfono entre Businesses sin conflicto;
- contacto repetido dentro del mismo Business sin auto-merge;
- ausencia de creación de User o Membership como side effect;
- ausencia de modificación de User existente aun cuando coincide el contacto declarado;
- frontera ObjectId estricta para `businessId` y `profileId`;
- defaults de paginación sólo por omisión;
- `limit`/`skip` válidos;
- rechazo de negativos, `NaN`, infinitos, fracciones, strings y objetos/arrays antes de consultar;
- definición exacta del índice declarado `{ business: 1, createdAt: -1, _id: -1 }`;
- ausencia de referencia User/binding en CustomerProfile;
- ausencia de índices unique/globales por contacto;
- superficie del repository limitada a operaciones tenant-scoped.

La suite existente `appointment-ownership-boundary.test.js` continúa cubriendo APT-CLIENT-01 y permanece sin cambios.

## Decisiones que permanecen pendientes

6.2.5-B no implementa ni congela:

- Verification o proof;
- claim;
- binding `User ↔ CustomerProfile`;
- lifecycle create/revoke/rebind del binding;
- Client session;
- guest booking cutover;
- `bookedBy/customer` físico;
- historial Client;
- deduplicación o merge/split;
- provenance compleja de contactos;
- migración de Appointments/User legacy;
- cambios a `getOrCreateGuestUser()`;
- guest capabilities ADR-002 runtime;
- materialización productiva del índice declarado.

## Fuera de alcance confirmado

No se modifican `appointment.controller`, `Appointment.client`, `auth.service`, login/register/password recovery, Payment/Webpay, Holiday, frontend/UI ni datos existentes. No se crean scripts de migración ni escrituras sobre producción.
