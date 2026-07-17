# Fase 3 — Desacoplar auth.controller.js

## Estado
- **Fecha de cierre:** 2026-07-15
- **Estado:** Completada
- **Responsable de implementación:** Antigravity (asistente de refactor)
- **Commit asociado:** Sin commit dedicado. Los cambios están en working tree sin commitear. Último commit previo: `1ba8496`.

## 1. Objetivo
Eliminar la lógica de negocio y el acceso directo a repositorios desde `auth.controller.js`, dejándolo como un controlador HTTP puro que solo gestiona request/response y sesiones. Adicionalmente, eliminar la duplicación masiva de código entre las funciones `login` y `googleLogin`, que compartían ~130 líneas de lógica idéntica.

Alcance:
- Eliminar los imports de `userRepository`, `membershipRepository` y `businessRepository` del controller.
- Extraer la lógica de `switchBusiness` y `getCurrentUser` a `auth.service.js`.
- Centralizar la lógica duplicada de sesión login/googleLogin en una función del servicio.
- Crear un helper para el patrón repetido de `req.session.save()` + `res.json()`.

## 2. Problema original

### 2.1 Duplicación login / googleLogin
Las funciones `login` (líneas 20-92, 73 líneas) y `googleLogin` (líneas 110-182, 73 líneas) contenían lógica idéntica para configurar la sesión según 3 escenarios: superadmin, un solo negocio, o múltiples negocios. La única diferencia era la fuente del usuario:
- `login`: `authService.login(email, password)`
- `googleLogin`: `authService.loginWithGoogle(idToken)`

Cada función replicaba por separado:
- Construcción del objeto `req.session.user` para superadmin (7 líneas × 2)
- Construcción del objeto `req.session.user` para usuario con un negocio (10 líneas × 2)
- Construcción del objeto `req.session.tempUser` para selección múltiple (9 líneas × 2)
- 3 llamadas a `req.session.save()` con `res.json()` (6 líneas × 2 × 3 = 36 líneas)

### 2.2 Lógica de negocio en el controller
`auth.controller.js` importaba 3 repositorios directamente:
```js
import * as userRepository from "../repositories/user.repository.js";
import * as membershipRepository from "../repositories/membership.repository.js";
import * as businessRepository from "../repositories/business.repository.js";
```

Las funciones `switchBusiness` y `getCurrentUser` contenían lógica de negocio:

**switchBusiness (líneas 223-274)**:
- Verificación de rol superadmin y acceso a negocio vía `businessRepository.findById()`
- Verificación de membresía activa vía `membershipRepository.findActiveByUserAndBusiness()`
- Decisión de autorización: lanzamiento de `UnauthorizedError`

**getCurrentUser (líneas 277-324)**:
- Verificación de existencia del usuario vía `userRepository.findById()`
- Consulta de membresías vía `membershipRepository.findActiveByUser()`
- Mapeo de datos de membresía para el frontend

### 2.3 Patrón repetido session.save + res.json
El patrón de callback `req.session.save((err) => { ... res.json(...) })` se repetía **8 veces** en el archivo, con la misma estructura de manejo de error.

### 2.4 Métricas del archivo original
- **370 líneas** totales
- **4 imports** (1 servicio + 3 repositorios)
- **~130 líneas** de código duplicado entre login y googleLogin

## 3. Arquitectura anterior

### Flujo del controller (pre-Fase 3)
```
auth.controller.js (370 líneas)
├── register()       → authService.register()        ✅ delega
├── login()          → authService.login()            ⚠️ + 65 líneas de lógica de sesión inline
├── googleLogin()    → authService.loginWithGoogle()  ⚠️ + 65 líneas de lógica de sesión DUPLICADA
├── selectMembership()                                ⚠️ lógica inline sin servicio
├── switchBusiness() → businessRepository (directo)   ❌ accede a repos
│                    → membershipRepository (directo)  ❌ accede a repos
├── getCurrentUser() → userRepository (directo)       ❌ accede a repos
│                    → membershipRepository (directo)  ❌ accede a repos
├── forgotPassword() → authService.sendResetPassword() ✅ delega
├── resetPassword()  → authService.resetPassword()    ✅ delega
└── changePassword() → authService.updatePassword()   ✅ delega
```

### Dependencias del controller
```
auth.controller.js
├── import authService (servicio)
├── import userRepository (repositorio) ← violación: controller accede a datos
├── import membershipRepository (repositorio) ← violación
├── import businessRepository (repositorio) ← violación
└── import { UnauthorizedError, ValidationError }
```

## 4. Arquitectura nueva

### Flujo del controller (post-Fase 3)
```
auth.controller.js (200 líneas)
├── [helpers privados]
│   ├── saveSessionAndRespond()   → patrón session.save+res.json
│   └── handleLoginResult()       → resolveSessionFromUser + session setup
├── register()       → authService.register()            ✅ delega
├── login()          → authService.login()
│                    → handleLoginResult()                ✅ 1 línea
├── googleLogin()    → authService.loginWithGoogle()
│                    → handleLoginResult()                ✅ 1 línea
├── selectMembership()                                    ✅ lógica de selección inline (es HTTP-specific)
├── switchBusiness() → authService.switchBusiness()       ✅ delega
├── getCurrentUser() → authService.getCurrentUser()       ✅ delega
├── forgotPassword() → authService.sendResetPassword()    ✅ delega
├── resetPassword()  → authService.resetPassword()        ✅ delega
└── changePassword() → authService.updatePassword()       ✅ delega
```

### Dependencias del controller
```
auth.controller.js
├── import authService (servicio) ← único punto de acceso a lógica de negocio
└── import { UnauthorizedError, ValidationError }
```

### Nuevas funciones en auth.service.js
```
auth.service.js (de 234 a 360 líneas)
├── register()                    (existente)
├── login()                       (existente)
├── loginWithGoogle()              (existente)
├── updatePassword()               (existente)
├── sendResetPasswordEmail()       (existente)
├── resetPassword()                (existente)
├── getOrCreateGuestUser()         (existente)
├── resolveSessionFromUser(user)   ← NEW: centraliza lógica de sesión
├── switchBusiness(userId, role, businessId) ← NEW: lógica de cambio de negocio
└── getCurrentUser(sessionUser)    ← NEW: validación de usuario + membresías
```

## 5. Archivos modificados

### Modificados
| Archivo | Cambio |
|---------|--------|
| `Server/src/controllers/auth.controller.js` | Reducido de 370 a 200 líneas. Eliminados 3 imports de repositories. Login/googleLogin reducidos a 1 línea cada uno vía `handleLoginResult`. switchBusiness y getCurrentUser delegados a authService. Creados helpers `saveSessionAndRespond` y `handleLoginResult`. |
| `Server/src/services/auth.service.js` | Ampliado de 234 a ~360 líneas. Añadidas 3 funciones: `resolveSessionFromUser`, `switchBusiness`, `getCurrentUser`. Añadidos imports de `userRepository` y `businessRepository`. |

### Creados
Ninguno.

### Eliminados
Ninguno.

## 6. Cambios realizados

### 6.1 Creación de `resolveSessionFromUser` en auth.service.js
Función pura (sin I/O) que recibe el objeto `user` retornado por `login()` o `loginWithGoogle()` y retorna un objeto de decisión:
```js
// Retorna { type: "superadmin" | "single" | "needs_selection", sessionUser?, tempUser?, memberships? }
export const resolveSessionFromUser = (user) => { ... };
```
Centraliza las 3 ramas de decisión (superadmin / 1 negocio / múltiples negocios) que estaban duplicadas.

### 6.2 Creación de `handleLoginResult` en auth.controller.js
Helper privado del controller que consume `resolveSessionFromUser` y aplica el resultado a la sesión HTTP:
```js
const handleLoginResult = (req, res, next, user, successMessage) => {
  const result = authService.resolveSessionFromUser(user);
  if (result.type === "superadmin" || result.type === "single") {
    req.session.user = result.sessionUser;
    return saveSessionAndRespond(req, res, next, ...);
  }
  req.session.tempUser = result.tempUser;
  saveSessionAndRespond(req, res, next, ...);
};
```

### 6.3 Simplificación de login y googleLogin
Antes (cada uno ~65 líneas de lógica de sesión):
```js
export const login = async (req, res, next) => {
  try {
    const user = await authService.login(email, password);
    // 65 líneas de if/else para superadmin, single, needs_selection
  } catch ...
};
```
Después:
```js
export const login = async (req, res, next) => {
  try {
    const user = await authService.login(email, password);
    handleLoginResult(req, res, next, user, "Login exitoso");
  } catch ...
};
```

### 6.4 Creación de `switchBusiness` en auth.service.js
Extraída la lógica que estaba inline en el controller:
```js
export const switchBusiness = async (userId, userRole, businessId) => {
  if (userRole === "superadmin") {
    const targetBusiness = await businessRepository.findById(businessId);
    if (!targetBusiness) throw new ValidationError("...");
    return { businessId: targetBusiness._id, businessSlug: targetBusiness.slug };
  }
  const membership = await membershipRepository.findActiveByUserAndBusiness(userId, businessId);
  if (!membership) throw new UnauthorizedError("...");
  return { businessId: membership.business._id, businessSlug: membership.business.slug, role: membership.role };
};
```

### 6.5 Creación de `getCurrentUser` en auth.service.js
Extraída la lógica de verificación de usuario y mapeo de membresías:
```js
export const getCurrentUser = async (sessionUser) => {
  const userExists = await userRepository.findById(sessionUser.id);
  if (!userExists) return null; // señal de sesión huérfana
  let membershipsPayload = [];
  if (sessionUser.role !== "superadmin") {
    const memberships = await membershipRepository.findActiveByUser(sessionUser.id);
    membershipsPayload = memberships.map(m => ({ id, businessId, businessName, businessSlug, role }));
  }
  return { ...sessionUser, memberships: membershipsPayload };
};
```

### 6.6 Creación de `saveSessionAndRespond` en auth.controller.js
Helper para el patrón repetido:
```js
const saveSessionAndRespond = (req, res, next, statusCode, body) => {
  req.session.save((err) => {
    if (err) return next(err);
    res.status(statusCode).json(body);
  });
};
```

### 6.7 Eliminación de imports de repositories del controller
```diff
 import * as authService from "../services/auth.service.js";
-import * as userRepository from "../repositories/user.repository.js";
-import * as membershipRepository from "../repositories/membership.repository.js";
-import * as businessRepository from "../repositories/business.repository.js";
 import { UnauthorizedError, ValidationError } from "../utils/appError.js";
```

## 7. Decisiones tomadas

| Decisión | Justificación | Alternativas descartadas |
|----------|---------------|--------------------------|
| `resolveSessionFromUser` es una función pura (sin async) | No necesita acceder a la BD; solo transforma datos del usuario en estructura de sesión. Esto facilita testearla sin mocks. | (a) Hacer async con consultas — innecesario, los datos ya están disponibles |
| `resolveSessionFromUser` retorna un objeto de decisión (type + datos) en vez de modificar `req.session` directamente | El servicio no debe conocer `req` (dependencia de Express). El controller aplica los datos a la sesión. | (a) Pasar `req` al servicio — acoplaría servicio a Express; (b) Retornar una función callback — over-engineering |
| Mantener `selectMembership` inline en el controller | Su lógica opera exclusivamente sobre `req.session.tempUser` (datos ya en memoria, no BD). No hay llamadas a repos. | (a) Moverla al servicio — requeriría pasar session data de ida y vuelta sin beneficio |
| `switchBusiness` retorna un objeto parcial `{ businessId, businessSlug, role? }` | El controller aplica solo los campos retornados a la sesión existente. Si el superadmin no cambia de rol, `role` no se incluye. | (a) Retornar sesión completa — el servicio no debe conocer la estructura de sesión completa |
| `getCurrentUser` retorna `null` para usuario inexistente | El controller decide cómo manejar la sesión huérfana (destroy + clearCookie). Esta lógica es HTTP-specific y no pertenece al servicio. | (a) Lanzar error desde servicio — complicaría el manejo en controller con try/catch adicional |
| `handleLoginResult` queda en el controller (no en el servicio) | Necesita acceso a `req.session` y `res`, que son objetos de Express. Es un helper de capa HTTP. | (a) Mover al servicio — acoplaría servicio a Express |
| Los imports extra de `userRepository` y `businessRepository` en auth.service.js se colocan al final del archivo | Evita reorganizar los imports existentes del servicio. En ES modules, los imports se resuelven estáticamente independientemente de su posición. | (a) Mover al top — válido pero genera un diff más grande innecesariamente |

## 8. Riesgos conocidos

| Riesgo | Severidad | Mitigación |
|--------|-----------|------------|
| El login retorna status 201 para usuario con 1 negocio y 200 para superadmin. El `handleLoginResult` usa un ternario para diferenciar. | Baja | Se preservó el comportamiento original. Idealmente debería unificarse a 200 pero cambiaría la API. |
| `selectMembership` sigue con lógica inline en el controller | Baja | Documentado como decisión consciente: opera solo sobre datos de sesión en memoria. |
| Los imports de `userRepository` y `businessRepository` están al final de `auth.service.js` | Baja | Funciona correctamente en ES modules (hoisting estático). Es un detalle estético. |
| No se probó el flujo completo de login con credenciales reales | Media | Se verificó con `GET /api/me` (sin sesión → 401). Login completo requiere credenciales válidas en la BD. |

## 9. Cómo extender esta solución

### Agregar un nuevo método de autenticación (ej: Apple Sign In)
1. Crear `loginWithApple(token)` en `auth.service.js` que retorne el mismo formato que `login()` y `loginWithGoogle()`
2. Crear el handler en `auth.controller.js`:
```js
export const appleLogin = async (req, res, next) => {
  try {
    const { identityToken } = req.body;
    const user = await authService.loginWithApple(identityToken);
    handleLoginResult(req, res, next, user, "Login con Apple exitoso");
  } catch (error) {
    next(error);
  }
};
```
3. Agregar la ruta en `auth.routes.js`

### Agregar lógica de negocio a un endpoint de auth
Siempre colocar la lógica en `auth.service.js`, no en el controller. El controller solo debe:
1. Extraer datos del request (`req.body`, `req.params`, `req.session`)
2. Llamar al servicio
3. Aplicar resultado a la sesión si corresponde
4. Enviar respuesta HTTP

## 10. Pruebas realizadas

### Pruebas automáticas
| Comando | Resultado |
|---------|-----------|
| `node --check src/index.js` | ✅ Sin errores de sintaxis |

### Validaciones manuales
| Verificación | Comando / Método | Resultado |
|-------------|-----------------|-----------|
| Servidor arranca sin errores | `npm run dev` | ✅ `server running at port 3000` + `[DB]Mongo conectado` |
| `GET /api/me` sin sesión | `Invoke-RestMethod` | ✅ 401 `"No hay sesión activa"` |
| auth.controller.js no importa repositories | `Select-String "from.*repositories"` en controllers/ | ✅ Solo availability.controller.js tiene repos (esperado) |
| Reducción de líneas | `Measure-Object -Line` | ✅ 370 → 200 líneas (46% reducción) |

### Aspectos no verificados
- **No se probó el flujo de login** con credenciales reales (email/password).
- **No se probó el flujo de Google Login** (requiere token OAuth válido).
- **No se probó switchBusiness** (requiere sesión autenticada + businessId válido).
- **No se probó selectMembership** (requiere sesión temporal con múltiples membresías).
- **No existen tests unitarios** para `resolveSessionFromUser`, `switchBusiness`, `getCurrentUser`.

## 11. Pendientes

| Pendiente | Prioridad | Fase sugerida |
|-----------|-----------|---------------|
| Tests unitarios para `resolveSessionFromUser` (función pura, fácilmente testeable) | Media | Fase 6 |
| Tests unitarios para `switchBusiness` y `getCurrentUser` con mocks de repos | Media | Fase 6 |
| Unificar status codes de login (201 vs 200) en una decisión de API consistente | Baja | Backlog |
| Mover imports de `userRepository`/`businessRepository` al top de `auth.service.js` | Baja | Próximo refactor estético |
| Evaluar extraer `selectMembership` al servicio si gana complejidad en el futuro | Baja | Si se requiere |

## 12. Criterios de cierre

- [x] `auth.controller.js` no importa ningún repositorio directamente
- [x] Lógica duplicada entre `login` y `googleLogin` eliminada vía `resolveSessionFromUser` + `handleLoginResult`
- [x] `switchBusiness` delegado a `authService.switchBusiness()`
- [x] `getCurrentUser` delegado a `authService.getCurrentUser()`
- [x] Patrón `session.save + res.json` centralizado en `saveSessionAndRespond`
- [x] Controller reducido de 370 a 200 líneas (46% reducción)
- [x] Servidor arranca sin errores
- [x] `GET /api/me` responde correctamente (401 sin sesión)
- [x] Syntax check pasa (`node --check src/index.js`)
