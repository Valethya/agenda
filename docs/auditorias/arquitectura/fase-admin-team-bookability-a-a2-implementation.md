# Admin Team / Bookability — implementación A + A2

Este documento registra la implementación de A + A2. No altera las decisiones normativas de `fase-admin-team-bookability-contract.md` ni ADR-001.

## Storage canónico

`Membership.isBookable` es el estado tenant-scoped que decide capacidad para **nuevas** reservas. El schema usa BSON boolean, `default:false` y `required:true`. Sólo `isBookable === true` es condición positiva. `role`, `User.role`, `User.business`, `Business.owner`, `Service.workers`, Shift, Block y Appointments históricas no se usan como fallback de bookability.

La autoridad tenant continúa derivando de Membership activa y `role`; `isBookable` no concede autoridad.

## Migración one-shot

Archivo: `Server/scripts/migrations/membership-bookability.js`.

Comando npm: `migration:membership-bookability`.

La migración tiene modos `plan` y `apply`, argumentos estrictos, fingerprint del destino, confirmación literal, provenance/SHA para apply remoto, logs sin secretos, verificación física post-apply e idempotencia. No crea ni elimina índices.

Para Memberships pre-cutover sin boolean canónico, el backfill es:

- Membership/User/Business inactivo -> `false`;
- admin activo -> `false`;
- worker + Membership/User/Business activos -> `true`.

Un boolean canónico existente se preserva. `admin + isBookable=true` es válido cuando las demás invariantes son válidas. Datos ambiguos o físicamente contradictorios bloquean apply en vez de conceder bookability.

## Cutover gate

Archivo: `Server/src/db/membership-bookability-cutover-gate.js`.

Confirmación exacta:

`ADMIN_TEAM_BOOKABILITY_CUTOVER=ADMIN_TEAM_BOOKABILITY_STORAGE_READY`

En runtime remoto el gate se ejecuta antes de `listen()`, después de los gates existentes. Un indicador de deployment prevalece sobre `NODE_ENV=test`. El startup falla cerrado si falta la confirmación o si el storage físico no cumple el contrato, incluido el índice único exacto `{ user:1, business:1 }`.

## Nuevas reservas

El predicado base exige Business activo, User activo, Membership activa en el mismo Business e `isBookable === true`. Para un Service se exige además Service activo, mismo Business y presencia actual del User en `Service.workers`.

Discovery público mantiene la proyección mínima existente. Availability revalida el predicado antes de producir slots. La creación de Appointment vuelve a resolver la elegibilidad inmediatamente antes de materializar la reserva; un slot previamente observado no es un grant durable.

## Appointments existentes

La capacidad sobre una Appointment ya creada está separada de booking eligibility. Un actor profesional puede operar la Appointment que conserva `Appointment.worker == User` aunque `isBookable=false` o haya salido actualmente de `Service.workers`, siempre que User, Business y Membership tenant continúen activos y las políticas de transición lo permitan.

No se modifica `Appointment.worker` ni se reescribe historial. Membership inactiva sí revoca esta capacidad.

## A2 — hardening legacy

`POST /api/users/workers` y `DELETE /api/users/workers/:id` quedan fail-closed y no-mutating hasta las fases posteriores. El POST no busca User global por email, no consume password para materializar identidad y no crea User, Membership ni Shift. El DELETE no interpreta `hard=true` como permiso de hard delete.

`GET /api/internal/users/workers` se conserva únicamente como proyección operacional tenant-scoped para consumidores actuales. Devuelve identificador, nombre y apellido de participantes activos necesarios operacionalmente; no expone email, phone, User.role, User.business, Membership administrativa ni otros tenants.

Al cerrarse `createWorker()` desaparece también la creación automática de horarios. Ausencia de Shift continúa significando ausencia de slots.

## Cutover productivo futuro

Este PR **no ejecuta** el cutover. Una operación futura y explícitamente autorizada debe: inspeccionar plan, revisar hallazgos y fingerprint, autorizar destino/SHA, ejecutar apply, verificar storage físico, activar la confirmación exacta del gate, desplegar conjuntamente A+A2, superar startup gate y realizar smoke tests. Si la verificación no pasa, el comportamiento esperado es fail-closed.

No se incluyen secretos ni URIs reales en este procedimiento.
