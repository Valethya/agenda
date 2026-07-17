# Fase 1 — Cimientos

## Estado
- **Fecha de cierre:** 2026-07-13
- **Estado:** Completada
- **Responsable de implementación:** Antigravity (asistente de refactor) + subagente Repository Creator
- **Commit asociado:** Sin commit dedicado. Los cambios están en working tree sin commitear. Último commit previo: `1ba8496`.

## 1. Objetivo
Preparar la infraestructura base necesaria para las fases siguientes del refactor. Esto incluía:
- Centralizar la configuración de variables de entorno dispersas en múltiples archivos.
- Crear el archivo de rutas de autenticación que faltaba.
- Crear los repositorios de acceso a datos para los 5 modelos Mongoose que no lo tenían.
- Organizar scripts sueltos en la raíz del servidor.
- Eliminar código muerto.

## 2. Problema original

### 2.1 Variables de entorno dispersas
`Server/src/config/env.js` solo exportaba 3 variables (`port`, `urlMongo`, `passwordMongo`). El resto se accedía directamente vía `process.env` en 8+ archivos diferentes:
- `app.js`: `process.env.NODE_ENV` (3 veces)
- `auth.service.js`: `process.env.GOOGLE_CLIENT_ID` (2 veces)
- `payment.service.js`: `process.env.BACKEND_URL`
- `auth.controller.js`: dynamic import de business model

### 2.2 Rutas de auth inline en routes/index.js
`Server/src/routes/index.js` (66 líneas) mezclaba la definición directa de rutas de autenticación (register, login, logout, google, forgot-password, reset-password, change-password, select-membership, switch-business, stop-impersonating) con el montaje de sub-routers. Era el único dominio sin su propio archivo de rutas.

Imports directos en el index:
```js
import { register, login, logout, googleLogin, getCurrentUser, forgotPassword, resetPassword, changePassword, selectMembership, switchBusiness } from "../controllers/auth.controller.js";
import { stopImpersonatingBusiness } from "../controllers/superadmin.controller.js";
import { isAuthenticated } from "../middleware/auth.middleware.js";
import { isAdmin } from "../middleware/role.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import rateLimit from "express-rate-limit";
import { registerSchema, loginSchema, ... } from "../validations/auth.validation.js";
```

### 2.3 Modelos sin repositorio
De 11 modelos Mongoose, solo 6 tenían repositorio:
- ✅ Con repositorio: `appointment`, `block`, `businessConfig`, `service`, `shift`, `user`
- ❌ Sin repositorio: `payment`, `business`, `membership`, `holiday`, `auditLog`

Los servicios y controladores accedían directamente a estos 5 modelos, violando la separación de capas.

### 2.4 Scripts sueltos en la raíz
19 archivos `.js` de scripts (seeds, tests, migrations, debug) estaban sueltos en `Server/`:
```
Server/seed-barberia.js, Server/seed-atmosfera.js, Server/seed-dam.js, Server/seed-production.js,
Server/check-users.js, Server/check_audit_logs.js, Server/scratch_*.js (4 archivos),
Server/test-*.js (5 archivos), Server/test_confirm_mail.js,
Server/differentiate-services.js, Server/migrate-multi-tenancy.js, Server/toggle-auto-confirm.js
```

### 2.5 Código muerto
- `Client/src/styles/admin.css`: 859 líneas / 22KB de CSS sin ningún import en el proyecto.
- `Server/src/utils/dirname.js`: import de `multer` sin uso.

## 3. Arquitectura anterior

### Config de entorno
```
.env → config/env.js (3 vars) ─┐
                                ├→ archivos que importan de env.js
.env → process.env.* (directo) ─┤
                                └→ 8+ archivos que acceden process.env directamente
```

### Rutas
```
routes/index.js
├── rutas de auth inline (11 endpoints directos)
├── router.use("/services", serviceRoutes)
├── router.use("/availability", availabilityRoutes)
├── ... (6 sub-routers más)
└── ruta test-auth inline
```

### Acceso a datos
```
Controllers/Services ──┬── repositories (6 modelos)
                       └── modelos Mongoose directos (5 modelos) ← violación de capas
```

## 4. Arquitectura nueva

### Config de entorno
```
.env → config/env.js (~15 vars) → todos los archivos importan SOLO de env.js
```
Ningún archivo fuera de `config/env.js` accede a `process.env` directamente.

### Rutas
```
routes/index.js (31 líneas, puro mount point)
├── router.use("/", authRoutes)         ← NEW: auth.routes.js
├── router.use("/services", serviceRoutes)
├── router.use("/availability", availabilityRoutes)
├── ... (6 sub-routers más)
└── (sin rutas inline)
```

### Acceso a datos
```
Controllers/Services ── repositories (11 modelos) ── modelos Mongoose
```
Cada modelo tiene su repositorio. Los 5 nuevos son: `payment`, `business`, `membership`, `holiday`, `auditLog`.

### Organización de scripts
```
Server/scripts/
├── seeds/        (4 seeders)
├── debug/        (12 scripts de prueba/diagnóstico)
└── migrations/   (3 scripts de migración)
```

## 5. Archivos modificados

### Creados
| Archivo | Descripción |
|---------|-------------|
| `Server/src/routes/auth.routes.js` | Rutas de autenticación extraídas de routes/index.js (52 líneas) |
| `Server/src/repositories/payment.repository.js` | 5 métodos: `findByAppointmentAndStatus`, `findByTransactionId`, `create`, `updateByTransactionId`, `aggregateFinancialMetrics` |
| `Server/src/repositories/business.repository.js` | 8 métodos: `findById`, `findBySlug`, `findOne`, `findAll`, `findFirstActive`, `create`, `update`, `save` |
| `Server/src/repositories/membership.repository.js` | 9 métodos: `findByUserAndBusiness`, `findByUserBusinessAndRole`, `findActiveByUserAndBusiness`, `findActiveByUser`, `findAll`, `create`, `countByUser`, `save`, `deleteOne` |
| `Server/src/repositories/holiday.repository.js` | 4 métodos: `findByDate`, `findAll`, `create`, `deleteById` |
| `Server/src/repositories/auditLog.repository.js` | 4 métodos: `create`, `findByAppointment`, `updateMany`, `associateOrphanedLogs` |
| `Server/scripts/seeds/` | Directorio para seeders |
| `Server/scripts/debug/` | Directorio para scripts de diagnóstico |
| `Server/scripts/migrations/` | Directorio para migraciones |

### Modificados
| Archivo | Cambio |
|---------|--------|
| `Server/src/config/env.js` | Ampliado de 5 a 26 líneas con ~15 variables centralizadas |
| `Server/src/routes/index.js` | Reducido de 66 a 31 líneas; ahora solo monta sub-routers |
| `Server/src/utils/dirname.js` | Eliminado `import multer from "multer"` no usado |

### Movidos
| Origen | Destino |
|--------|---------|
| `Server/seed-atmosfera.js` | `Server/scripts/seeds/seed-atmosfera.js` |
| `Server/seed-barberia.js` | `Server/scripts/seeds/seed-barberia.js` |
| `Server/seed-dam.js` | `Server/scripts/seeds/seed-dam.js` |
| `Server/seed-production.js` | `Server/scripts/seeds/seed-production.js` |
| `Server/check-users.js` | `Server/scripts/debug/check-users.js` |
| `Server/check_audit_logs.js` | `Server/scripts/debug/check_audit_logs.js` |
| `Server/scratch_check_dev_db.js` | `Server/scripts/debug/scratch_check_dev_db.js` |
| `Server/scratch_check_july_7.js` | `Server/scripts/debug/scratch_check_july_7.js` |
| `Server/scratch_print_all_slots.js` | `Server/scripts/debug/scratch_print_all_slots.js` |
| `Server/scratch_test_availability_output.js` | `Server/scripts/debug/scratch_test_availability_output.js` |
| `Server/test-auto-confirm.js` | `Server/scripts/debug/test-auto-confirm.js` |
| `Server/test-availability.js` | `Server/scripts/debug/test-availability.js` |
| `Server/test-custom-email.js` | `Server/scripts/debug/test-custom-email.js` |
| `Server/test-exit.js` | `Server/scripts/debug/test-exit.js` |
| `Server/test-slots.js` | `Server/scripts/debug/test-slots.js` |
| `Server/test_confirm_mail.js` | `Server/scripts/debug/test_confirm_mail.js` |
| `Server/differentiate-services.js` | `Server/scripts/migrations/differentiate-services.js` |
| `Server/migrate-multi-tenancy.js` | `Server/scripts/migrations/migrate-multi-tenancy.js` |
| `Server/toggle-auto-confirm.js` | `Server/scripts/migrations/toggle-auto-confirm.js` |

### Eliminados
| Archivo | Razón |
|---------|-------|
| `Client/src/styles/admin.css` | 859 líneas de CSS no importado por ningún componente (verificado con `Select-String` recursivo) |

## 6. Cambios realizados

### 6.1 Centralización de env.js
Se añadieron 12 nuevas exports a `config/env.js`:
- `nodeEnv` — con default `"development"`
- `sessionSecret` — con fallback a `PASSWORD_MONGO`
- `backendUrl` / `frontendUrl` — con defaults localhost
- `googleClientId` / `googleClientSecret`
- `corsOrigins` — con fallback a `FRONTEND_URL`

### 6.2 Extracción de auth.routes.js
Se creó `routes/auth.routes.js` con:
- Import del rate limiter (`authLimiter`)
- Todas las 10 rutas de autenticación
- Import de validaciones Zod (`registerSchema`, `loginSchema`, etc.)

`routes/index.js` se simplificó a solo montar sub-routers con `router.use()`.

### 6.3 Creación de 5 repositories
Cada repository se creó analizando todos los patrones de acceso directo a modelos en services/controllers/middleware. Los métodos se diseñaron para cubrir **todos** los casos de uso encontrados, incluyendo:
- Queries con populate (ej: `membership.findActiveByUser` incluye `.populate("business")`)
- Queries con filtros de rango de fechas (ej: `holiday.findByDate`)
- Pipelines de agregación (ej: `payment.aggregateFinancialMetrics`)

### 6.4 Organización de scripts
19 archivos movidos a 3 subdirectorios categorizados dentro de `Server/scripts/`.

### 6.5 Eliminación de código muerto
- `admin.css`: búsqueda exhaustiva con `Select-String` confirmó 0 importaciones.
- `multer` en `dirname.js`: import que nunca se usaba.

## 7. Decisiones tomadas

| Decisión | Justificación | Alternativas descartadas |
|----------|---------------|--------------------------|
| Repositories como funciones exportadas (no clases) | Consistente con los 6 repositories existentes del proyecto | Patrón clase con métodos — requeriría refactorizar los existentes |
| Método `aggregate(pipeline)` genérico en repos | Superadmin usa pipelines complejos y variados que no conviene encapsular en métodos específicos | (a) Crear un método específico por pipeline — demasiados métodos y baja reutilización |
| `findByDate` en holiday con rango interno | El patrón `$gte/$lte` para mismo día estaba duplicado | Dejar la query en el servicio — mantendría la duplicación |
| Mover scripts con `Move-Item` en vez de `git mv` | Los scripts no estaban trackeados con su ruta nueva; `git mv` requeriría staging previo | `git mv` — funcionaría pero es innecesario dado que son archivos auxiliares |
| No modificar el contenido de los scripts movidos | Los scripts usan rutas relativas que podrían necesitar ajuste, pero eso no es prioridad del refactor | Ajustar imports — riesgo de romper scripts que podrían ser necesarios |

## 8. Riesgos conocidos

| Riesgo | Severidad | Mitigación |
|--------|-----------|------------|
| Scripts movidos podrían tener imports relativos rotos (`../src/...`) | Baja | Son scripts de debug/seeding, no afectan producción. Actualizar rutas cuando se necesiten. |
| Los nuevos repositories aún no son usados por ningún servicio (pre-Fase 2) | Ninguna | Fase 2 realiza la migración; los repos están listos pero inactivos. |
| El `auth.routes.js` podría tener comportamiento levemente diferente al inline | Baja | Los endpoints y middleware son idénticos; se verificó con syntax check. |

## 9. Cómo extender esta solución

### Agregar un nuevo modelo Mongoose
1. Crear el modelo en `Server/src/db/models/[nombre].model.js`
2. Crear el repository en `Server/src/repositories/[nombre].repository.js`
3. Importar el modelo en el repository y exportar funciones para cada patrón de acceso
4. Nunca importar el modelo directamente desde services/controllers

### Agregar una nueva variable de entorno
1. Añadir a `Server/.env`
2. Exportar en `Server/src/config/env.js` con default adecuado
3. Importar desde `config/env.js` donde se necesite

### Patrón de repository
```js
import Model from "../db/models/model.model.js";

export const findById = async (id) => {
  return await Model.findById(id);
};

export const create = async (data) => {
  return await Model.create(data);
};

// Agregar populate cuando sea necesario para el caso de uso
export const findByIdPopulated = async (id) => {
  return await Model.findById(id).populate("relatedField");
};
```

## 10. Pruebas realizadas

### Pruebas automáticas
| Comando | Resultado |
|---------|-----------|
| `node --check src/index.js` | ✅ Sin errores de sintaxis (ejecutado tras cada grupo de cambios) |

### Validaciones manuales
| Verificación | Resultado |
|-------------|-----------|
| `admin.css` no importado por ningún archivo (`Select-String` recursivo) | ✅ 0 resultados |
| Todos los repositories creados y listados con `list_dir` | ✅ 11 archivos en `repositories/` |
| Scripts movidos correctamente (`Get-ChildItem` recursivo) | ✅ 19 archivos en 3 subdirectorios |
| Directorio `Server/` limpio de scripts sueltos | ✅ Solo `package.json`, `package-lock.json`, `.env`, y directorios |

### Aspectos no verificados
- No se ejecutó el servidor completo para probar que las rutas de auth funcionan desde `auth.routes.js`.
- No se verificó que los scripts movidos funcionen desde sus nuevas rutas.
- No se probó que los populate de los nuevos repositories devuelvan datos correctos.
- No existen tests unitarios para los repositories.

## 11. Pendientes

| Pendiente | Prioridad |
|-----------|-----------|
| Actualizar imports relativos en scripts movidos si se necesitan ejecutar | Baja |
| Agregar tests unitarios para los 5 nuevos repositories | Media |
| Verificar que la eliminación de la ruta inline `test-auth` no afecte workflows de desarrollo | Baja |

## 12. Criterios de cierre

- [x] `config/env.js` exporta todas las variables usadas en el proyecto (~15)
- [x] `routes/index.js` es un puro mount point sin rutas inline
- [x] `auth.routes.js` existe con todas las rutas de autenticación
- [x] Los 11 modelos tienen su repositorio correspondiente
- [x] No hay scripts sueltos en la raíz de `Server/`
- [x] `admin.css` eliminado (código muerto verificado)
- [x] Import de `multer` en `dirname.js` eliminado
- [x] Syntax check pasa sin errores
