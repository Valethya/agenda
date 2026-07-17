# Fase 5 — Refactor de servicios grandes

## Estado
- **Fecha de cierre:** 2026-07-15
- **Estado:** Completada
- **Responsable de implementación:** Antigravity (asistente de refactor)
- **Commit asociado:** Sin commit dedicado. Los cambios están en working tree sin commitear.

## 1. Objetivo
Reducir el tamaño y las responsabilidades de los 3 servicios más grandes del sistema:
- `appointment.service.js` (416 líneas) — servicio más grande del backend
- `superadmin.service.js` (388 líneas) — mezcla analytics con gestión de negocios
- `payment.service.js` (359 líneas) — ya simplificado en Fase 4 con la extracción de Transbank

El criterio de división fue la **cohesión funcional**: cada módulo resultante debe tener una responsabilidad clara y única.

## 2. Problema original

### 2.1 appointment.service.js (416 líneas)
El servicio concentraba 3 responsabilidades:
1. **Lógica de negocio de citas** (booking, confirmación, cancelación, queries)
2. **Envío de notificaciones por email** (3 bloques `setImmediate` con lógica de email + logging)
3. **Logging de auditoría** para cada operación

Los bloques de notificación (`setImmediate(async () => { ... })`) sumaban ~120 líneas duplicadas de código de email + logging de auditoría en 3 funciones: `bookAppointment`, `confirmAppointment` y `cancelAppointment`.

### 2.2 superadmin.service.js (388 líneas)
2 dominios completamente diferentes en un solo archivo:
1. **Analytics** (`getGlobalMetrics` 106 líneas, `getAdvancedAnalytics` 166 líneas): Pipelines de agregación MongoDB extensos
2. **Gestión de negocios** (`createBusiness`, `listBusinesses`, `toggleBusinessStatus`, `impersonate`): CRUD de negocios

Además, analytics era consumido por 2 controllers diferentes (`superadmin.controller.js` y `businessConfig.controller.js`), lo que evidenciaba que analytics era un dominio separado.

### 2.3 payment.service.js (359 líneas)
Ya se simplificó en Fase 4 extrayendo `getTransactionInstance()` y el SDK de Transbank a `gateways/transbank.gateway.js`. Las 359 líneas restantes son legítimas: solo 2 funciones (`initiatePayment`, `confirmPayment`) con logging de auditoría extenso necesario para trazabilidad de transacciones financieras.

## 3. Arquitectura anterior

### appointment.service.js (416 líneas)
```
appointment.service.js
├── bookAppointment()     (170 líneas) ← incluye ~55 líneas de setImmediate para emails
├── confirmAppointment()  (70 líneas)  ← incluye ~25 líneas de setImmediate
├── completeAppointment() (42 líneas)  ← sin notificaciones
├── cancelAppointment()   (80 líneas)  ← incluye ~25 líneas de setImmediate
├── getAppointmentDetails() (17 líneas)
└── getMyAppointments()   (18 líneas)
```

### superadmin.service.js (388 líneas)
```
superadmin.service.js
├── imports: mongoose, 6 repositorios, businessConfig.service, password utils, errors
├── getGlobalMetrics()       (106 líneas) → analytics
├── getAdvancedAnalytics()   (166 líneas) → analytics
├── createBusiness()         (60 líneas)  → gestión
├── listBusinesses()         (3 líneas)   → gestión
├── toggleBusinessStatus()   (11 líneas)  → gestión
└── impersonate()            (18 líneas)  → gestión
```

## 4. Arquitectura nueva

### appointment.service.js (269 líneas) + appointment.notifications.js (129 líneas)
```
appointment.service.js (269 líneas, -35%)
├── imports: repositories, availabilityService, notifications, socket, auditLogger
├── bookAppointment()       → valida, crea, emite WS, delega emails a notifications
├── confirmAppointment()    → valida permisos, actualiza BD, delega emails
├── completeAppointment()   → valida permisos, actualiza BD
├── cancelAppointment()     → valida permisos/anticipación, actualiza BD, emite WS, delega emails
├── getAppointmentDetails() → query con validación de permisos
└── getMyAppointments()     → query filtrada por rol

appointment.notifications.js (129 líneas)
├── notifyBookingCreated()       → setImmediate: email confirmación/pre-reserva + alerta worker
├── notifyAppointmentConfirmed() → setImmediate: email confirmación
└── notifyAppointmentCancelled() → setImmediate: email cancelación
```

### superadmin.service.js (94 líneas) + analytics.service.js (223 líneas)
```
analytics.service.js (223 líneas)
├── imports: mongoose, appointmentRepo, paymentRepo, userRepo, holidayRepo
├── getGlobalMetrics()       → finanzas, usuarios, citas, top servicios
└── getAdvancedAnalytics()   → concurrencia, tendencias, feriados

superadmin.service.js (94 líneas, -76%)
├── imports: userRepo, businessRepo, membershipRepo, businessConfig, password, errors
├── re-export { getGlobalMetrics, getAdvancedAnalytics } from analytics.service.js
├── createBusiness()
├── listBusinesses()
├── toggleBusinessStatus()
└── impersonate()
```

## 5. Archivos modificados

### Creados
| Archivo | Líneas | Descripción |
|---------|--------|-------------|
| `Server/src/services/analytics.service.js` | 223 | Servicio de analytics con getGlobalMetrics y getAdvancedAnalytics |
| `Server/src/services/appointment.notifications.js` | 129 | Helpers de notificación por email para el ciclo de vida de citas |

### Modificados
| Archivo | Antes | Después | Cambio |
|---------|-------|---------|--------|
| `Server/src/services/appointment.service.js` | 416 | 269 | -35%. Eliminados 3 bloques setImmediate (emails). Import de mailer reemplazado por notifications. |
| `Server/src/services/superadmin.service.js` | 388 | 94 | -76%. Eliminadas getGlobalMetrics y getAdvancedAnalytics (movidas a analytics.service.js). Re-exported para compatibilidad. |

### No modificados (backward compatible)
| Archivo | Razón |
|---------|-------|
| `Server/src/controllers/superadmin.controller.js` | Sigue importando `* as superadminService` — funciona gracias al re-export |
| `Server/src/controllers/businessConfig.controller.js` | Sigue importando `* as superadminService` — funciona gracias al re-export |
| `Server/src/controllers/appointment.controller.js` | Sigue importando `* as appointmentService` — misma API pública |

## 6. Cambios realizados

### 6.1 Extracción de notificaciones de appointment.service.js
3 bloques `setImmediate(async () => { ... })` con email + logging reemplazados por funciones en `appointment.notifications.js`:

```diff
-  setImmediate(async () => {
-    try {
-      const populated = await appointmentRepository.findById(newAppointment._id);
-      if (populated && populated.client.email) {
-        // ... 55 líneas de lógica de email + logging
-      }
-    } catch (mailError) { ... }
-  });
+  notifyBookingCreated(newAppointment._id, client, initialStatus);
```

### 6.2 Extracción de analytics de superadmin.service.js
Las 2 funciones de analytics (~270 líneas) movidas a `analytics.service.js`. El `superadmin.service.js` re-exporta para mantener compatibilidad:

```js
// Re-exportar analytics para mantener compatibilidad con los consumers existentes
export { getGlobalMetrics, getAdvancedAnalytics } from "./analytics.service.js";
```

Los imports de `superadmin.service.js` se redujeron:
```diff
-import mongoose from "mongoose";
-import * as appointmentRepository from "../repositories/appointment.repository.js";
-import * as paymentRepository from "../repositories/payment.repository.js";
-import * as holidayRepository from "../repositories/holiday.repository.js";
```

### 6.3 payment.service.js — decisión de no dividir
Se evaluó y se determinó que las 359 líneas son legítimas:
- Solo 2 funciones exportadas (`initiatePayment`, `confirmPayment`)
- El volumen se debe al logging de auditoría (obligatorio para transacciones financieras)
- Ya se simplificó en Fase 4 (extracción de Transbank SDK)

## 7. Decisiones tomadas

| Decisión | Justificación | Alternativas descartadas |
|----------|---------------|--------------------------|
| Re-export de analytics desde superadmin.service | 0 cambios en consumers (superadmin.controller, businessConfig.controller). Migración transparente. | (a) Cambiar imports en controllers — innecesario y riesgoso |
| Notificaciones como módulo separado (`appointment.notifications.js`) | Los setImmediate son side-effects puros que no afectan el resultado de la función principal. Separarlos clarifica la lógica de negocio. | (a) Dejarlos inline — demasiadas líneas; (b) Event Emitter — pospuesto a Fase 8 |
| No dividir `payment.service.js` | Solo tiene 2 funciones. El logging de auditoría es necesario para trazabilidad financiera. Dividir crearía módulos demasiado pequeños. | (a) Extraer logging — las llamadas a logEvent son específicas de cada paso del flujo de pago |
| `analytics.service.js` no re-importa desde `superadmin.service.js` | Elimina cualquier riesgo de dependencia circular. Analytics es independiente. | (a) Importar desde superadmin — crearía dependencia circular |

## 8. Riesgos conocidos

| Riesgo | Severidad | Mitigación |
|--------|-----------|------------|
| Re-export puede ocultar la ubicación real del código | Baja | Los re-exports están documentados con comentario explícito. Se eliminará cuando todos los consumers migren directamente a analytics.service.js |
| `appointment.notifications.js` accede al appointmentRepository directamente | Baja | Es un módulo de servicio, no un controller. Accede a repos para re-fetch de datos populados (necesario para email templates) |
| `payment.service.js` sigue siendo grande (359 líneas) | Baja | La complejidad es legítima (2 funciones con logging de auditoría extenso). No hay lógica duplicada ni responsabilidades mezcladas |

## 9. Cómo extender esta solución

### Agregar una nueva notificación de cita
1. Crear la función en `appointment.notifications.js`:
```js
export const notifyAppointmentRescheduled = (appointmentId, userId) => {
  setImmediate(async () => {
    // ... fetch populated, send email, log event
  });
};
```
2. Importar y llamar desde `appointment.service.js`

### Agregar una nueva métrica de analytics
1. Crear la función en `analytics.service.js`
2. Si debe ser accesible vía superadmin API, re-exportarla desde `superadmin.service.js`

## 10. Pruebas realizadas

### Pruebas automáticas
| Comando | Resultado |
|---------|-----------|
| `node --check src/index.js` | ✅ Sin errores de sintaxis |

### Validaciones manuales
| Verificación | Comando / Método | Resultado |
|-------------|-----------------|-----------|
| Servidor arranca sin errores | `npm run dev` | ✅ `server running at port 3000` + `[DB]Mongo conectado` |
| `GET /api/health` | `Invoke-RestMethod` | ✅ `{ success: true, message: "API running" }` |
| appointment.service.js reducido | `Measure-Object -Line` | ✅ 416 → 269 líneas (-35%) |
| superadmin.service.js reducido | `Measure-Object -Line` | ✅ 388 → 94 líneas (-76%) |
| Re-exports funcionan (imports no rotos) | Servidor arranca y carga sin errores | ✅ |

### Aspectos no verificados
- No se probó `bookAppointment` con datos reales para verificar que las notificaciones se envían
- No se probó `getGlobalMetrics` / `getAdvancedAnalytics` para verificar que los re-exports funcionan en runtime
- No existen tests unitarios para ninguno de los módulos nuevos

## 11. Pendientes

| Pendiente | Prioridad | Fase sugerida |
|-----------|-----------|---------------|
| Tests unitarios para `analytics.service.js` (pipelines de MongoDB) | Media | Fase 6 |
| Tests unitarios para `appointment.notifications.js` (con mocks) | Media | Fase 6 |
| Migrar consumers de analytics directamente (eliminar re-export) | Baja | Backlog |
| Evaluar si `payment.service.js` necesita refactor adicional cuando se agreguen más pasarelas | Baja | Si se requiere |

## 12. Métricas de impacto

| Servicio | Antes | Después | Reducción | Módulo extraído |
|----------|-------|---------|-----------|----------------|
| `appointment.service.js` | 416 | 269 | -35% (147 líneas) | `appointment.notifications.js` (129) |
| `superadmin.service.js` | 388 | 94 | -76% (294 líneas) | `analytics.service.js` (223) |
| `payment.service.js` | 418→359 (Fase 4) | 359 | 0% (ya simplificado) | `transbank.gateway.js` (Fase 4) |
| **Total** | **1,222** | **722** | **-41%** | **+352 líneas en módulos nuevos** |

## 13. Criterios de cierre

- [x] `appointment.service.js` reducido a menos de 300 líneas
- [x] Notificaciones de email extraídas a `appointment.notifications.js`
- [x] `superadmin.service.js` reducido a menos de 100 líneas
- [x] Analytics extraído a `analytics.service.js`
- [x] Re-exports mantienen compatibilidad con consumers existentes
- [x] `payment.service.js` evaluado — complejidad justificada
- [x] Syntax check pasa sin errores
- [x] Servidor arranca y responde correctamente
- [x] Ningún import roto en controllers
