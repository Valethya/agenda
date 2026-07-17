# Fase 0 — Seguridad

## Estado
- **Fecha de cierre:** 2026-07-13
- **Estado:** Completada
- **Responsable de implementación:** Antigravity (asistente de refactor) + validación manual del desarrollador
- **Commit asociado:** Sin commit dedicado. Los cambios están en working tree sin commitear (verificable con `git status`). Último commit previo: `1ba8496`.

## 1. Objetivo
Corregir las vulnerabilidades de seguridad identificadas durante el análisis arquitectónico que representaban riesgos inmediatos en producción. El alcance se limitó exclusivamente a:
- Exposición de CORS abierto a cualquier origen.
- Uso del password de MongoDB como secreto de sesión.
- Errores de runtime por imports faltantes en el controlador de autenticación.
- Filtración de credenciales y datos de debug en logs de producción.
- Código de limpieza de datos ejecutándose en cada arranque del servidor.

## 2. Problema original

### 2.1 CORS abierto
En `Server/src/app.js` (líneas 49-54 originales), la política CORS aceptaba cualquier origen:
```js
origin: (origin, callback) => {
  // Permitimos cualquier origen (incluyendo solicitudes locales, apps móviles, widgets de clientes, etc.)
  return callback(null, true);
},
```
Cualquier sitio web externo podía realizar peticiones autenticadas al backend con cookies de sesión.

### 2.2 Session secret basado en password de MongoDB
En `Server/src/app.js` (línea 35 original):
```js
import { passwordMongo } from "./config/env.js";
// ...
secret: passwordMongo,
```
El password de la base de datos MongoDB Atlas (`guraJkMN7JzWv1kW`) se reutilizaba como secreto de firma de sesiones Express. Si un atacante obtenía el session secret (ej: via error stack trace), tendría acceso directo a la base de datos.

### 2.3 Imports faltantes en auth.controller.js
En `Server/src/controllers/auth.controller.js`, las clases `UnauthorizedError` y `ValidationError` se usaban en las líneas 44, 134, 187, 192, 225, 233, 256 sin estar importadas. Esto producía `ReferenceError` en runtime cuando se ejecutaban esas rutas de código (ej: login sin membresías, selección de membresía inválida).

### 2.4 Console.log de debug en producción
| Archivo | Línea(s) | Problema |
|---------|----------|----------|
| `Server/src/services/availability.service.js` | 156-171 | Bloque de 16 líneas que logueaba detalles internos del slot 16:00 en cada consulta de disponibilidad |
| `Server/src/middleware/validate.middleware.js` | 12 | `console.error("VALIDATION ERROR CAUGHT:", error)` exponía errores de validación completos en stderr |
| `Server/src/db/db.js` | 8 | `console.log("URL Mongo:", urlMongo)` imprimía la URI completa de MongoDB Atlas (incluyendo credenciales) en cada arranque |

### 2.5 Script de limpieza en conexión a BD
En `Server/src/db/db.js` (líneas 12-22), un script buscaba y modificaba documentos de usuarios en cada arranque del servidor:
```js
const workers = await User.find({ lastName: { $regex: /\(Barbero\)/ } });
for (const w of workers) {
  w.lastName = w.lastName.replace(/\s*\(Barbero\)\s*/i, '').trim();
  await w.save();
}
```
Este código era residual del seeder y no debía ejecutarse en producción.

## 3. Arquitectura anterior

### Flujo de CORS
```
Cliente (cualquier origen) → Express CORS middleware (acepta todo) → API
```
No existía validación de origen. Toda petición con `credentials: true` era aceptada.

### Flujo de Session
```
.env (PASSWORD_MONGO) → config/env.js (passwordMongo) → app.js (session({ secret: passwordMongo }))
```
El mismo valor servía para autenticar MongoDB Atlas y firmar cookies de sesión.

### Flujo de auth.controller.js
```
Ruta → auth.controller.js → authService
                           → User (modelo directo)
                           → Membership (modelo directo)
                           → ❌ UnauthorizedError (no importado)
                           → ❌ ValidationError (no importado)
```

## 4. Arquitectura nueva

### Flujo de CORS
```
Cliente → Express CORS middleware → ¿Origen en whitelist CORS_ORIGINS? → Sí: permite / No: rechaza
```
La whitelist se configura en `.env` como `CORS_ORIGINS=http://localhost:4321,http://localhost:3000`.

### Flujo de Session
```
.env (SESSION_SECRET) → config/env.js (sessionSecret) → app.js (session({ secret: sessionSecret }))
```
Con fallback a `PASSWORD_MONGO` solo si `SESSION_SECRET` no está definido (retrocompatibilidad durante migración).

### Flujo de auth.controller.js
```
Ruta → auth.controller.js → authService
                           → import { UnauthorizedError, ValidationError } from "../utils/appError.js" ✅
```

## 5. Archivos modificados

### Modificados
| Archivo | Cambio |
|---------|--------|
| `Server/src/app.js` | CORS con whitelist, session secret independiente, imports centralizados desde env.js, `process.env.NODE_ENV` → `nodeEnv` |
| `Server/src/config/env.js` | De 5 líneas a 26 líneas. Agrega `nodeEnv`, `sessionSecret`, `backendUrl`, `frontendUrl`, `googleClientId`, `googleClientSecret`, `corsOrigins` |
| `Server/src/controllers/auth.controller.js` | Agregado `import { UnauthorizedError, ValidationError } from "../utils/appError.js"` |
| `Server/src/services/availability.service.js` | Eliminado bloque de debug console.log (16 líneas) |
| `Server/src/middleware/validate.middleware.js` | Eliminado `console.error("VALIDATION ERROR CAUGHT:", error)` |
| `Server/src/db/db.js` | Eliminado `console.log("URL Mongo:", urlMongo)`, eliminado import de User, eliminado script de limpieza de barberos (15 líneas) |
| `Server/.env` | Agregadas variables `SESSION_SECRET` y `CORS_ORIGINS` |

### Eliminados
Ninguno en esta fase.

### Creados
Ninguno en esta fase.

## 6. Cambios realizados

### 6.1 CORS con whitelist
En `app.js`, se reemplazó `return callback(null, true)` por una validación contra `allowedOrigins`:
```js
const allowedOrigins = corsOrigins.split(",").map((o) => o.trim());
// ...
origin: (origin, callback) => {
  if (!origin) return callback(null, true); // apps móviles, Postman
  if (allowedOrigins.includes(origin)) return callback(null, true);
  return callback(new Error(`Origin ${origin} no permitido por CORS`));
},
```

### 6.2 Session secret independiente
En `config/env.js`:
```js
export const sessionSecret = process.env.SESSION_SECRET || process.env.PASSWORD_MONGO;
```
En `app.js`:
```js
import { urlMongo, sessionSecret, corsOrigins, nodeEnv } from "./config/env.js";
// ...
session({ secret: sessionSecret, ... })
```

### 6.3 Import de errores en auth.controller.js
Línea 4 agregada:
```js
import { UnauthorizedError, ValidationError } from "../utils/appError.js";
```

### 6.4 Eliminación de console.logs
- `availability.service.js`: eliminadas líneas 156-171 (bloque `if (slotStart === 960)`)
- `validate.middleware.js`: eliminada línea 12 (`console.error`)
- `db.js`: eliminada línea 8 (`console.log("URL Mongo:", urlMongo)`)

### 6.5 Limpieza de db.js
Eliminado bloque completo de limpieza de apellidos de barberos (líneas 12-22) y su import de User (línea 4).

## 7. Decisiones tomadas

| Decisión | Justificación | Alternativas descartadas |
|----------|---------------|--------------------------|
| Whitelist de orígenes vía variable de entorno | Permite configuración diferente por entorno (dev/staging/prod) sin cambiar código | (a) Hardcodear orígenes en código — no escalable; (b) Regex de orígenes — riesgo de bypass |
| Fallback de SESSION_SECRET a PASSWORD_MONGO | Evita romper sesiones existentes si el deploy no tiene la variable nueva | (a) Sin fallback — rompería sesiones al desplegar; (b) Valor por defecto hardcodeado — inseguro |
| Permitir requests sin `origin` header | Apps móviles, Postman y llamadas server-to-server no envían `Origin` | Bloquear sin origin — rompería integraciones legítimas |
| Eliminar script de limpieza de db.js en lugar de moverlo | El script era residual del seeder y no debería ejecutarse en arranques de producción | (a) Moverlo a un script de migración — innecesario si los datos ya están limpios |

## 8. Riesgos conocidos

| Riesgo | Severidad | Mitigación |
|--------|-----------|------------|
| Si `CORS_ORIGINS` no se configura en producción (Railway), solo se permitirá `FRONTEND_URL` | Media | El fallback es `process.env.FRONTEND_URL \|\| "http://localhost:4321"`. Verificar que Railway tenga la variable. |
| El fallback de SESSION_SECRET a PASSWORD_MONGO sigue activo | Media | Documentar que en producción se **debe** definir `SESSION_SECRET` con un valor único. |
| Sesiones existentes se invalidarán al cambiar el secret | Baja | Solo afecta si se define un `SESSION_SECRET` diferente; los usuarios solo necesitan re-loguearse. |
| El `.env` tiene credenciales reales en el repositorio local | Alta (preexistente) | `.env` ya está en `.gitignore` y no está trackeado por git (verificado con `git ls-files .env`). **No es un riesgo introducido por esta fase.** |

## 9. Cómo extender esta solución

### Agregar un nuevo origen CORS
Añadir el dominio a `CORS_ORIGINS` en `.env`, separado por coma:
```
CORS_ORIGINS=http://localhost:4321,https://app.miagenda.cl,https://widget.cliente.cl
```

### Agregar una nueva variable de entorno
1. Definir en `Server/.env`
2. Exportar en `Server/src/config/env.js` con valor por defecto adecuado
3. Importar desde `config/env.js` en el archivo que la necesite — **nunca usar `process.env` directamente**

## 10. Pruebas realizadas

### Pruebas automáticas
| Comando | Resultado |
|---------|-----------|
| `node --check src/index.js` | ✅ Sin errores de sintaxis |

### Validaciones manuales
| Verificación | Resultado |
|-------------|-----------|
| `.env` no trackeado por git (`git ls-files .env server/.env`) | ✅ Output vacío (no trackeado) |
| `.env` en `.gitignore` | ✅ Verificado visualmente |

### Aspectos no verificados
- No se ejecutó el servidor completo para validar que CORS rechaza orígenes no permitidos.
- No se probó el login/logout con el nuevo session secret.
- No se verificó en Railway/producción que `CORS_ORIGINS` y `SESSION_SECRET` estén configurados.
- No existen tests automatizados para estas configuraciones.

## 11. Pendientes

| Pendiente | Prioridad |
|-----------|-----------|
| Definir un `SESSION_SECRET` criptográficamente seguro en producción (Railway) | Alta |
| Configurar `CORS_ORIGINS` con los dominios reales de producción en Railway | Alta |
| Evaluar agregar rate limiting más granular por endpoint (actualmente solo en login/forgot-password) | Media |
| Considerar rotar el session secret periódicamente | Baja |

## 12. Criterios de cierre

- [x] CORS ya no acepta cualquier origen — usa whitelist configurable
- [x] Session secret es independiente del password de MongoDB
- [x] `UnauthorizedError` y `ValidationError` están importados en `auth.controller.js`
- [x] No hay `console.log` de debug en archivos de producción (`availability.service`, `validate.middleware`, `db.js`)
- [x] No hay scripts de limpieza ejecutándose en `connectDB()`
- [x] `.env` no está trackeado por git
- [x] Syntax check pasa sin errores (`node --check src/index.js`)
