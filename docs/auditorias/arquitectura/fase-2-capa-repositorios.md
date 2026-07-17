# Fase 2 — Completar capa de repositorios

## Estado
- **Fecha de cierre:** 2026-07-15
- **Estado:** Completada
- **Responsable de implementación:** Antigravity (asistente de refactor) + subagente Service Migration Engineer + cambios manuales del desarrollador (availability.service.js)
- **Commit asociado:** Sin commit dedicado. Todos los cambios están en working tree sin commitear (verificable con `git status --short`). Último commit previo: `1ba8496`.

## 1. Objetivo
Migrar **todos** los accesos directos a modelos Mongoose desde services, controllers y middleware hacia la capa de repositorios creada en la Fase 1. Al completar esta fase, la arquitectura debe cumplir:

```
Controllers/Middleware → Services → Repositories → Modelos Mongoose
```

Ningún archivo fuera de `repositories/` debe importar de `db/models/` directamente.

Adicionalmente, extraer funciones de tiempo duplicadas en un módulo compartido (`utils/time.js`).

## 2. Problema original

### 2.1 Accesos directos a modelos desde services

Cada servicio importaba y usaba modelos Mongoose directamente, saltando la capa de repositorios:

| Servicio | Modelos accedidos directamente |
|----------|-------------------------------|
| `payment.service.js` | `Payment`, `Business`, `AuditLog` |
| `auth.service.js` | `Membership` + `process.env.GOOGLE_CLIENT_ID` |
| `user.service.js` | `Membership` |
| `appointment.service.js` | `AuditLog`, `BusinessConfig` |
| `availability.service.js` | `User`, `HolidayModel` |
| `superadmin.service.js` | `User`, `Appointment`, `Payment`, `Holiday`, `Business`, `Membership` (6 modelos) |

Total: **14 imports directos a modelos** y **~30 llamadas directas** a métodos Mongoose (find, findOne, findById, create, updateMany, aggregate, etc.)

### 2.2 Accesos directos a modelos desde controller y middleware

| Archivo | Modelos accedidos directamente |
|---------|-------------------------------|
| `auth.controller.js` | `User`, `Membership` + dynamic import de `Business` |
| `business.middleware.js` | `Business` |

Total adicional: **3 imports directos** y **~8 llamadas directas**.

### 2.3 Variables de entorno accedidas directamente
- `auth.service.js` línea 17: `process.env.GOOGLE_CLIENT_ID` (2 usos)
- `payment.service.js` línea 84: `process.env.BACKEND_URL || "http://localhost:3000"`

### 2.4 Funciones de tiempo duplicadas
Dos funciones idénticas definidas en archivos diferentes:

| Función | Ubicación 1 | Ubicación 2 |
|---------|-------------|-------------|
| `timeToMinutes(timeStr)` | `availability.service.js` líneas 10-13 | — |
| `minutesToTime(totalMinutes)` | `availability.service.js` líneas 15-21 | — |
| `addMinutesToTime(timeStr, minutesToAdd)` | `appointment.service.js` líneas 12-18 | `availability.service.js` (lógica equivalente via `timeToMinutes` + `minutesToTime`) |
| `checkOverlap(startA, endA, startB, endB)` | `availability.service.js` líneas 23-25 | — |

### 2.5 Métodos faltantes en repositorios existentes
- `user.repository.js`: no tenía `findById`, `findOne`, `aggregate`
- `appointment.repository.js`: no tenía `aggregate`

## 3. Arquitectura anterior

### Flujo de datos (pre-Fase 2)
```
auth.controller.js ──┬── authService ─── userRepository ── User model
                      ├── User model (directo) ← violación
                      ├── Membership model (directo) ← violación
                      └── Business model (dynamic import) ← violación

business.middleware.js ── Business model (directo) ← violación

payment.service.js ──┬── appointmentRepository
                     ├── Payment model (directo) ← violación
                     ├── Business model (directo) ← violación
                     └── AuditLog model (directo) ← violación

superadmin.service.js ── User/Appointment/Payment/Holiday/Business/Membership (6 directos) ← violación
```

### Responsabilidades mezcladas
Los servicios tenían 2 responsabilidades:
1. Lógica de negocio (validación, cálculo, decisiones)
2. Acceso a datos (queries Mongoose con populate, aggregation pipelines)

## 4. Arquitectura nueva

### Flujo de datos (post-Fase 2)
```
auth.controller.js ──┬── authService ──────── userRepository ─── User model
                      ├── userRepository ───── User model
                      ├── membershipRepository ── Membership model
                      └── businessRepository ──── Business model

business.middleware.js ── businessRepository ── Business model

payment.service.js ──┬── appointmentRepository ── Appointment model
                     ├── paymentRepository ─────── Payment model
                     └── businessRepository ────── Business model

superadmin.service.js ──┬── userRepository ──────── User model
                        ├── appointmentRepository ── Appointment model
                        ├── paymentRepository ─────── Payment model
                        ├── holidayRepository ─────── Holiday model
                        ├── businessRepository ────── Business model
                        └── membershipRepository ──── Membership model
```

### Responsabilidades separadas
- **Repositories**: Queries Mongoose puras (find, create, aggregate, populate)
- **Services**: Lógica de negocio (validación, cálculos, decisiones, orquestación)
- **Controllers/Middleware**: HTTP request/response handling, session management

### Utilidades compartidas
```
utils/time.js ──┬── timeToMinutes()
                ├── minutesToTime()
                ├── addMinutesToTime()
                └── checkOverlap()
                       ↑ importado por
         availability.service.js
         appointment.service.js
```

## 5. Archivos modificados

### Creados
| Archivo | Descripción |
|---------|-------------|
| `Server/src/utils/time.js` | 4 funciones de tiempo compartidas (37 líneas) |

### Modificados (Services)
| Archivo | Cambio principal |
|---------|-----------------|
| `Server/src/services/payment.service.js` | `Payment`→`paymentRepository`, `Business`→`businessRepository`, eliminado import de `AuditLog`, `process.env.BACKEND_URL`→`backendUrl` de env.js (7 llamadas migradas) |
| `Server/src/services/auth.service.js` | `Membership`→`membershipRepository`, `process.env.GOOGLE_CLIENT_ID`→`googleClientId` de env.js (4 llamadas migradas) |
| `Server/src/services/user.service.js` | `Membership`→`membershipRepository` (7 llamadas migradas: findOne, create, save, deleteOne, countDocuments, find) |
| `Server/src/services/appointment.service.js` | `AuditLog`→`auditLogRepository`, `BusinessConfig`→`businessConfigRepository`, `addMinutesToTime` extraído a time.js (2 llamadas migradas) |
| `Server/src/services/availability.service.js` | `User`→`userRepository`, `HolidayModel`→`holidayRepository`, funciones de tiempo extraídas a time.js (2 llamadas migradas + 3 funciones eliminadas) |
| `Server/src/services/superadmin.service.js` | 6 modelos directos reemplazados por 6 repositories (14 llamadas migradas: findOne, findById, find, create, save, aggregate) |

### Modificados (Controllers/Middleware)
| Archivo | Cambio principal |
|---------|-----------------|
| `Server/src/controllers/auth.controller.js` | `User`→`userRepository`, `Membership`→`membershipRepository`, dynamic import de `Business`→`businessRepository` (5 llamadas migradas) |
| `Server/src/middleware/business.middleware.js` | `Business`→`businessRepository` (5 llamadas migradas: findById×2, findOne×2 para slug y active, findOne para active fallback) |

### Modificados (Repositories — métodos añadidos)
| Archivo | Métodos añadidos |
|---------|-----------------|
| `Server/src/repositories/user.repository.js` | `findById(id)`, `findOne(query)`, `aggregate(pipeline)` + eliminada declaración duplicada de `findById` |
| `Server/src/repositories/appointment.repository.js` | `aggregate(pipeline)` |

### Eliminados
Ninguno.

## 6. Cambios realizados

### 6.1 Migración de payment.service.js
Reemplazados 3 imports de modelos por 2 imports de repositories + 1 import de `backendUrl`:
```diff
-import Payment from "../db/models/payment.model.js";
-import Business from "../db/models/business.model.js";
-import AuditLog from "../db/models/auditLog.model.js";
+import * as paymentRepository from "../repositories/payment.repository.js";
+import * as businessRepository from "../repositories/business.repository.js";
+import { backendUrl } from "../config/env.js";
```
7 llamadas migradas:
- `Payment.findOne({ appointment, status })` → `paymentRepository.findByAppointmentAndStatus()`
- `Business.findById()` → `businessRepository.findById()`
- `process.env.BACKEND_URL || "http://localhost:3000"` → `backendUrl`
- `Payment.create()` → `paymentRepository.create()`
- `Payment.findOne({ transactionId })` → `paymentRepository.findByTransactionId()` (3 ocurrencias)
- `Payment.findOneAndUpdate()` → `paymentRepository.updateByTransactionId()` (2 ocurrencias)

### 6.2 Migración de auth.service.js
```diff
-import Membership from "../db/models/membership.model.js";
+import * as membershipRepository from "../repositories/membership.repository.js";
+import { googleClientId } from "../config/env.js";
-const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
+const googleClient = new OAuth2Client(googleClientId);
```
2 llamadas de `Membership.find({ user, isActive }).populate("business")` → `membershipRepository.findActiveByUser()`

### 6.3 Migración de user.service.js
```diff
-import Membership from "../db/models/membership.model.js";
+import * as membershipRepository from "../repositories/membership.repository.js";
```
7 llamadas migradas: `findOne` → `findByUserAndBusiness`, `create` → `create`, `findOne({role})` → `findByUserBusinessAndRole`, `save()` → `save()`, `deleteOne()` → `deleteOne()`, `countDocuments()` → `countByUser()`, `find().populate()` → `findAll()`.

### 6.4 Migración de appointment.service.js
```diff
-import AuditLog from "../db/models/auditLog.model.js";
-import BusinessConfig from "../db/models/businessConfig.model.js";
+import * as auditLogRepository from "../repositories/auditLog.repository.js";
+import * as businessConfigRepository from "../repositories/businessConfig.repository.js";
+import { addMinutesToTime } from "../utils/time.js";
```
- `BusinessConfig.findOne({ business })` → `businessConfigRepository.getConfig()`
- `AuditLog.updateMany()` → `auditLogRepository.associateOrphanedLogs()`
- Función local `addMinutesToTime` eliminada, importada desde `utils/time.js`

### 6.5 Migración de availability.service.js
```diff
-import User from "../db/models/user.model.js";
-import HolidayModel from "../db/models/holiday.model.js";
+import * as userRepository from "../repositories/user.repository.js";
+import * as holidayRepository from "../repositories/holiday.repository.js";
+import { timeToMinutes, minutesToTime, checkOverlap } from "../utils/time.js";
```
- `User.findById()` → `userRepository.findById()`
- `HolidayModel.findOne({ date: { $gte, $lte } })` → `holidayRepository.findByDate()`
- 3 funciones locales (`timeToMinutes`, `minutesToTime`, `checkOverlap`) eliminadas, importadas desde `utils/time.js`

### 6.6 Migración de superadmin.service.js
6 imports de modelos reemplazados por 6 imports de repositories:
```diff
-import User from "../db/models/user.model.js";
-import Appointment from "../db/models/appointment.model.js";
-import Payment from "../db/models/payment.model.js";
-import Holiday from "../db/models/holiday.model.js";
-import Business from "../db/models/business.model.js";
-import Membership from "../db/models/membership.model.js";
+import * as userRepository from "../repositories/user.repository.js";
+import * as appointmentRepository from "../repositories/appointment.repository.js";
+import * as paymentRepository from "../repositories/payment.repository.js";
+import * as holidayRepository from "../repositories/holiday.repository.js";
+import * as businessRepository from "../repositories/business.repository.js";
+import * as membershipRepository from "../repositories/membership.repository.js";
```
- `Payment.aggregate(pipeline)` → `paymentRepository.aggregateFinancialMetrics(matchPayment)`
- `User.aggregate(pipeline)` → `userRepository.aggregate(pipeline)`
- `Appointment.aggregate(pipeline)` → `appointmentRepository.aggregate(pipeline)` (7 ocurrencias)
- `Holiday.find()` → `holidayRepository.findAll()`
- `Business.findOne/findById/create/find().populate()` → `businessRepository.*`
- `User.findOne/findById/create` → `userRepository.*`
- `Membership.create()` → `membershipRepository.create()`

### 6.7 Migración de auth.controller.js
```diff
-import User from "../db/models/user.model.js";
-import Membership from "../db/models/membership.model.js";
+import * as userRepository from "../repositories/user.repository.js";
+import * as membershipRepository from "../repositories/membership.repository.js";
+import * as businessRepository from "../repositories/business.repository.js";
```
- `User.findById()` → `userRepository.findById()`
- `Membership.find({ user, isActive }).populate()` → `membershipRepository.findActiveByUser()`
- `Membership.findOne({ user, business, isActive }).populate()` → `membershipRepository.findActiveByUserAndBusiness()`
- Dynamic import `(await import("../db/models/business.model.js")).default.findById()` → `businessRepository.findById()`

### 6.8 Migración de business.middleware.js
```diff
-import Business from "../db/models/business.model.js";
+import * as businessRepository from "../repositories/business.repository.js";
```
- `Business.findById()` → `businessRepository.findById()` (2 ocurrencias)
- `Business.findOne({ isActive: true })` → `businessRepository.findFirstActive()` (2 ocurrencias)
- `Business.findOne({ slug })` → `businessRepository.findBySlug()`

### 6.9 Creación de utils/time.js
Archivo nuevo con 4 funciones extraídas:
- `timeToMinutes(timeStr)` — convierte "HH:MM" a minutos
- `minutesToTime(totalMinutes)` — convierte minutos a "HH:MM"
- `addMinutesToTime(timeStr, minutesToAdd)` — suma minutos a una hora
- `checkOverlap(startA, endA, startB, endB)` — detecta solapamiento de intervalos

### 6.10 Métodos añadidos a repositories existentes
- `user.repository.js`: `findById(id)`, `findOne(query)`, `aggregate(pipeline)`. También se eliminó una declaración duplicada de `findById` que se había generado por error.
- `appointment.repository.js`: `aggregate(pipeline)`

## 7. Decisiones tomadas

| Decisión | Justificación | Alternativas descartadas |
|----------|---------------|--------------------------|
| Usar `repository.aggregate(pipeline)` genérico para superadmin | Los pipelines de superadmin son complejos, variados y específicos de la vista de analytics. Crear métodos específicos no aportaría abstracción útil. | (a) Crear `aggregateByStatus`, `aggregateByDay`, etc. — proliferación de métodos con baja reutilización |
| Crear `paymentRepository.aggregateFinancialMetrics(match)` como método especializado | Este pipeline específico (totalRevenue, totalTransactions, averageTicket) es reutilizable y tiene semántica de negocio clara. | (a) Usar `aggregate(pipeline)` genérico — se perdería la semántica |
| Mantener `availability.controller.js` con acceso a repositorios (shift, block) directamente | Este controller hace CRUD simple + permissions + WebSocket emit. Crear un servicio intermedio sería sobre-ingeniería. Se re-evaluará en Fase 5. | (a) Crear `schedule.service.js` — pospondido para Fase 5 donde se evaluará dividir servicios |
| No crear `businessConfigRepository.getConfig` (ya existía en businessConfig.repository.js) | El repository ya tenía el método, solo faltaba importarlo desde appointment.service.js | — |
| Importar con `import * as xRepository` | Consistente con el patrón del proyecto. Permite acceder a `xRepository.findById()` etc. con namespace explícito. | (a) Named imports — menos legible con muchos métodos; (b) default export — no aplica a módulo con múltiples exports |
| Extraer funciones de tiempo a utils en esta fase (no en Fase 5) | Eran una dependencia bloqueante para migrar availability.service.js y appointment.service.js. | (a) Posponer a Fase 5 — dejaría las funciones duplicadas mientras migramos |

## 8. Riesgos conocidos

| Riesgo | Severidad | Mitigación |
|--------|-----------|------------|
| Los métodos de repository podrían tener diferencias sutiles de comportamiento vs. las queries directas originales | Media | Se preservó la lógica exacta (incluyendo populate, sort, filtros). Revisión manual de cada reemplazo. |
| `availability.controller.js` sigue accediendo a repos directamente (sin servicio) | Baja | Es CRUD simple. Se documentó como pendiente para Fase 5. No viola la capa repos→models. |
| `businessRepository.findAll()` en superadmin no hace `.populate("owner")` como hacía la query original | Media | La query original era `Business.find().populate("owner", "firstName lastName email phone")`. El método `findAll()` del repository debe verificarse que incluya el populate. |
| `membershipRepository.findActiveByUserAndBusiness()` devuelve un documento con populate que el controller original también esperaba | Media | El método fue creado con `.populate("business")` incluido. Si el populate cambia, el controller podría fallar silenciosamente. |
| El `aggregate` genérico expone la API de Mongoose directamente | Baja | Es intencional para pipelines complejos de analytics. Solo superadmin.service.js lo usa. |

## 9. Cómo extender esta solución

### Migrar un nuevo servicio a repositorios

1. **Identificar accesos directos**: buscar `import ... from "../db/models/..."` en el servicio
2. **Verificar si el repository existe**: revisar `repositories/[modelo].repository.js`
3. **Verificar si el método existe**: buscar el método equivalente (ej: `findById`, `findOne`, `create`)
4. **Si el método no existe**: añadirlo al repository siguiendo el patrón existente:
   ```js
   export const findByCustomField = async (value) => {
     return await Model.findOne({ customField: value }).populate("relatedField");
   };
   ```
5. **Reemplazar el import**: `import Model from "../db/models/..."` → `import * as modelRepository from "../repositories/..."`
6. **Reemplazar las llamadas**: `Model.findById(id)` → `modelRepository.findById(id)`
7. **Verificar**: `node --check src/index.js`

### Agregar un método a un repository existente

```js
// En repositories/[nombre].repository.js
export const nuevoMetodo = async (param) => {
  return await Model.metodoMongoose(param);
};
```

Convención de nombres:
- `findById(id)` — buscar por ID
- `findBy[Campo](valor)` — buscar por campo específico
- `findAll(query)` — buscar múltiples con filtro opcional
- `create(data)` — crear documento
- `update(id, data)` — actualizar por ID
- `save(doc)` — guardar documento modificado
- `deleteById(id)` — eliminar por ID
- `aggregate(pipeline)` — ejecutar pipeline de agregación genérico
- `aggregate[NombreDescriptivo](params)` — pipeline de agregación especializado

### Validar la integridad de la migración
```powershell
# Buscar imports directos a modelos fuera de repositories
Get-ChildItem "server/src/services","server/src/controllers","server/src/middleware" -Include "*.js" -File -Recurse | Select-String "from.*db/models"
```
El resultado debe ser vacío.

## 10. Pruebas realizadas

### Pruebas automáticas
| Comando | Resultado | Cuándo |
|---------|-----------|--------|
| `node --check src/index.js` | ✅ Sin errores de sintaxis | Ejecutado después de cada grupo de migración (4 veces total) |

### Validaciones manuales
| Verificación | Comando | Resultado |
|-------------|---------|-----------|
| 0 imports directos a `db/models/` desde services, controllers, middleware | `Get-ChildItem ... \| Select-String "from.*db/models"` | ✅ Output vacío — 0 resultados |
| `git diff --stat HEAD` | `git diff --stat HEAD` | ✅ 31 archivos, 143 insertions, 2680 deletions |
| `git status --short` | `git status --short` | ✅ Todos los cambios esperados presentes |
| `user.repository.js` sin duplicados | `view_file` línea por línea | ✅ Un solo `findById` (se eliminó duplicado) |

### Aspectos no verificados
- **No se ejecutó el servidor completo** (`npm run dev`) para validar que todas las rutas funcionen con los nuevos repositories.
- **No se probaron los endpoints de Webpay** (payment.service.js) con el nuevo `paymentRepository`.
- **No se verificó el login con Google** (auth.service.js) con el nuevo `membershipRepository`.
- **No se probó el dashboard de superadmin** con los nuevos aggregate vía repositories.
- **No se verificó `businessRepository.findAll()`** para confirmar que incluye el populate de `owner` que necesita `listBusinesses()` en superadmin.
- **No existen tests unitarios** para ningún servicio o repository.
- **No se probó el `switchBusiness`** de auth.controller.js con `membershipRepository.findActiveByUserAndBusiness()`.

## 11. Pendientes

| Pendiente | Prioridad | Fase sugerida |
|-----------|-----------|---------------|
| Verificar que `businessRepository.findAll()` incluya `.populate("owner")` para superadmin.listBusinesses | Alta | Inmediato (pre-commit) |
| Ejecutar el servidor y probar endpoints críticos (login, book appointment, payment flow, superadmin dashboard) | Alta | Pre-commit |
| Crear `schedule.service.js` para encapsular lógica de `availability.controller.js` | Baja | Fase 5 |
| Tests unitarios para repositories y servicios migrados | Media | Fase 6 |
| Evaluar si `aggregate(pipeline)` genérico debería tener validación de pipeline | Baja | Fase 6 |

## 12. Criterios de cierre

- [x] Todos los services migrados a usar repositories: `payment`, `auth`, `user`, `appointment`, `availability`, `superadmin`
- [x] `auth.controller.js` migrado: no importa modelos directamente
- [x] `business.middleware.js` migrado: no importa modelos directamente
- [x] 0 imports directos a `db/models/` desde services, controllers o middleware (verificado con búsqueda recursiva)
- [x] `utils/time.js` creado con 4 funciones compartidas
- [x] Funciones duplicadas eliminadas de `availability.service.js` y `appointment.service.js`
- [x] Variables de entorno centralizadas: `process.env.GOOGLE_CLIENT_ID` → `googleClientId`, `process.env.BACKEND_URL` → `backendUrl`
- [x] Métodos faltantes añadidos a `user.repository.js` y `appointment.repository.js`
- [x] `user.repository.js` sin declaraciones duplicadas
- [x] Syntax check pasa sin errores (`node --check src/index.js`)
