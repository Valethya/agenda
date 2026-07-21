# Fase 6.2.1-B — Coherencia tenant en reserva y disponibilidad

**Proyecto:** ATMÓSFERA Agenda

**Estado:** Listo para revisión

**Fecha:** 21 de julio de 2026

**Base:** `master` después del merge del PR #5 (`ded92b9`)

## 1. Objetivo

Impedir que una solicitud resuelta para el negocio A utilice un servicio o profesional perteneciente únicamente al negocio B. La resolución explícita introducida en 6.2.1-A sólo es efectiva si las referencias internas de la operación respetan el mismo tenant.

## 2. Bypass confirmado

El controlador de reservas recibía `req.businessId`, pero no lo entregaba a `bookAppointment()`. El servicio cargaba el servicio por ID puro y adoptaba `service.business` como negocio de la cita. Por tanto, una petición con contexto A y servicio de B podía terminar persistida en B.

La variante `isSuggestion` omitía por completo la consulta de disponibilidad. Eso también evitaba la comprobación heredada del profesional y permitía combinar un servicio de A con un trabajador exclusivo de B.

Además, el controlador resolvía o creaba al invitado antes de comprobar estas referencias, dejando una escritura secundaria aunque la reserva debiera rechazarse.

## 3. Contrato implementado

- `req.businessId` es la autoridad tenant de una reserva.
- El servicio se consulta mediante `{ _id, business }`; un ID ajeno o inexistente produce el mismo `404` genérico.
- El profesional debe existir, estar activo y poseer una `Membership` activa con rol `worker` en el negocio resuelto.
- La comprobación ocurre antes de crear o actualizar al invitado.
- `bookAppointment()` recibe y persiste el negocio resuelto; no lo deriva del servicio solicitado.
- Las sugerencias están exentas de disponibilidad horaria, pero no de coherencia tenant.
- La consulta pública de slots aplica las mismas fronteras de servicio y membresía.

## 4. Cambios acotados

| Archivo | Cambio | Motivo |
|---|---|---|
| `Server/src/controllers/appointment.controller.js` | Ejecuta la guarda tenant antes de resolver al invitado y pasa `businessId` al servicio. | Evitar efectos secundarios y pérdida del contexto resuelto. |
| `Server/src/services/appointment.service.js` | Valida servicio y profesional contra el tenant; persiste el tenant recibido. | Cerrar el bypass de reserva normal y sugerida. |
| `Server/src/services/availability.service.js` | Consulta servicio por negocio y exige membresía activa del profesional. | Alinear slots públicos con la misma autoridad tenant. |
| `Server/src/repositories/service.repository.js` | Añade `findByIdAndBusiness()`. | Hacer que la frontera exista en la consulta y no sólo después de cargar datos. |
| `Server/test/api.test.js` | Añade pruebas cross-tenant y verifica ausencia de escrituras secundarias. | Fijar regresiones P0 con dos negocios reales. |

## 5. Pruebas negativas

1. Tenant A + servicio de B → `404`, sin cita ni usuario invitado nuevo.
2. Tenant A + servicio de A + profesional de B + `isSuggestion` → `404`, sin cita ni usuario invitado nuevo.
3. Disponibilidad de A + profesional exclusivo de B → `404`.
4. Los flujos válidos existentes de reserva, disponibilidad y pago continúan cubiertos por la suite de integración.

Los mensajes públicos usan “no está disponible” para no confirmar si el recurso existe en otro tenant.

## 6. Decisiones de alcance

Esta entrega utiliza `Membership` únicamente para comprobar que el profesional pertenece activamente al negocio de la operación. No migra todavía toda la autorización de sesiones ni elimina `User.business`; ese trabajo permanece en 6.2.2.

Tampoco modifica modelos de turnos o bloqueos, ni corrige mutaciones administrativas por ID. Esas fronteras pertenecen a 6.2.3 y 6.2.4.

## 7. Verificación requerida

- `git diff --check`.
- Sintaxis Node de los archivos modificados.
- Suite unitaria backend.
- Suite de integración backend con MongoDB.
- Frontend check/build y secret scan sin regresiones.

## 8. Evidencia de verificación

- PR: `#6` — `hardening/6.2.1-b-booking-coherence` → `master`.
- GitHub Actions: CI `#19` (`29856567929`).
- `Backend unit tests`: aprobado.
- `Backend integration tests`: aprobado con MongoDB y los tres casos negativos de esta entrega.
- `Frontend checks and build`: aprobado.
- `Secret scan`: aprobado.

El documento cambiará a **Completado** después del merge y la prueba de humo correspondiente.
