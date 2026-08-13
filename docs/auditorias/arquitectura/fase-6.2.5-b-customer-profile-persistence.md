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

## Índices físicos

Se añade sólo:

```text
{ business: 1, createdAt: -1 }
name: customer_profile_business_created_at
```

Objetivo: soportar listados previsibles por tenant manteniendo `Business` como frontera física de consulta.

No existen índices unique por email/teléfono, índices globales de contacto ni digests deterministas de contacto.

## Repository

`Server/src/repositories/customerProfile.repository.js` expone únicamente:

- `createForBusiness(businessId, data)`;
- `findByIdAndBusiness(profileId, businessId)`;
- `findAllByBusiness(businessId, { limit, skip })`.

`businessId` es obligatorio y debe ser un ObjectId válido. `createForBusiness` proyecta una allowlist de campos operacionales y fuerza el Business recibido por argumento, evitando que `data.business` u otros campos introducidos por el caller alteren el tenant.

No se implementan `findByEmail`, `findByPhone`, deduplicación, auto-merge ni reutilización automática por contacto.

## Invariantes cubiertas por tests

Los tests añadidos verifican:

- Business obligatorio;
- existencia de CustomerProfile sin User;
- lectura propia de Business A;
- inaccesibilidad de un ID válido perteneciente a Business B cuando se consulta desde A;
- mismo email/teléfono entre Businesses sin conflicto;
- contacto repetido dentro del mismo Business sin auto-merge;
- ausencia de creación de User o Membership como side effect;
- ausencia de modificación de User existente aun cuando coincide el contacto declarado;
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
- guest capabilities ADR-002 runtime.

## Fuera de alcance confirmado

No se modifican `appointment.controller`, `Appointment.client`, `auth.service`, login/register/password recovery, Payment/Webpay, Holiday, frontend/UI ni datos existentes. No se crean scripts de migración ni escrituras sobre producción.
