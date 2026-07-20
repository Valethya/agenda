# Fase 6 — Validaciones, Tests y Seguridad WebSocket

## Estado
- **Fecha de cierre:** 2026-07-20
- **Estado:** completada
- **Responsable de implementación:** Antigravity AI (asistido por usuario)
- **Commit o referencia asociada:** 6c3675d

---

## 1. Objetivo

Asegurar que todas las rutas de la API reciban validaciones de entrada (schemas Zod + middleware), que exista una infraestructura de testing confiable con base de datos aislada y segura, que el contrato Webpay refleje el contrato real de Transbank REST, y que las conexiones WebSocket sean autenticadas y aisladas por negocio con validación multitenant.

### Alcance original (6 puntos)
1. Validar todos los parámetros ObjectId en rutas con `:id` o `:workerId`
2. Validar body/query en rutas con payloads (`POST`, `PUT`, `PATCH`)
3. Configurar base de datos exclusiva para tests
4. Crear schema para `PUT /business-settings`
5. Verificar contratos frontend vs backend
6. Implementar autenticación WebSocket (Socket.IO)

---

## 2. Problema original

### 2.1 Validaciones ausentes
Las rutas aceptaban cualquier payload sin validación previa al controlador. Un ObjectId inválido o un body malformado podía causar errores Mongoose no controlados (CastError 500) en lugar de un 400 con mensaje descriptivo.

**Evidencia antes de la intervención:**
- `GET /services/:id` → un `:id` no hexadecimal (ej. `"abc"`) producía `CastError` 500
- `PUT /business-settings` → cualquier campo arbitrario era aceptado y persistido en MongoDB (ej. `{ hackerField: "value" }`)
- `POST /payments/webpay-return` → sin validación; un body vacío causaba NullReferenceError

### 2.2 Tests contra base de datos de desarrollo
- `integration.test.js` y `auditPayment.test.js` conectaban a la misma `MONGO_URI` del `.env`
- Datos de prueba se mezclaban con datos reales
- Tests fallaban porque los usuarios se creaban sin registros `Membership`, pero `resolveSessionFromUser` los exigía
- El modelo Shift no tiene campo `business` ni `slots`, pero el test los incluía (Mongoose los ignoraba silenciosamente)
- No había protección contra ejecución accidental en producción

### 2.3 Contrato Webpay incorrecto
- El código usaba `TBK_TOKEN_WS` como nombre del campo de cancelación
- El contrato real de Transbank REST API usa `TBK_TOKEN` (sin el sufijo `_WS`)
- Afectaba tanto el controlador (`payment.controller.js`) como el schema Zod y los tests

### 2.4 WebSocket sin autenticación
- `socket.js` aceptaba cualquier conexión sin verificar sesión
- No existía validación de pertenencia al negocio al unirse a rooms
- `calendar_update` se emitía globalmente con `io.emit()` → todos los clientes conectados recibían actualizaciones de todos los negocios

---

## 3. Arquitectura anterior

### Flujo de validación (antes)
```
Cliente → Express Router → Controller → Service → Repository → MongoDB
                ↑
          Sin validación de entrada
```

### Flujo WebSocket (antes)
```
Cliente WS → Socket.IO Server → Cualquiera se conecta
           → join_availability(workerId, date) → Se une sin verificar nada
           → calendar_update → io.emit() → Todos los clientes reciben todo
```

### Tests (antes)
```
test/*.test.js → import app → connectDB(MONGO_URI) → Base de datos de DESARROLLO
               → Usuarios sin Membership → Login falla → Tests rotos
```

---

## 4. Arquitectura nueva

### Flujo de validación (después)
```
Cliente → Express Router → validate(schema) → Controller → Service → Repository
                              ↓ (falla)
                          400 + ZodError formateado
```

**Schemas implementados:**
| Schema | Ruta protegida |
|---|---|
| `objectIdParamSchema` | `GET/DELETE /services/:id`, `POST /superadmin/:id/impersonate` |
| `workerIdParamSchema` | `GET /availability/shifts/:workerId` |
| `initiatePaymentSchema` | `POST /payments/initiate` |
| `webpayReturnSchema` | `POST/GET /payments/webpay-return` |
| `createBusinessSchema` | `POST /superadmin/businesses` |
| `createWorkerSchema` | `POST /users/workers` |
| `googleLoginSchema` | `POST /google` |
| `selectMembershipSchema` | `POST /select-membership` |
| `switchBusinessSchema` | `POST /switch-business` |
| `saveShiftSchema` | `POST /availability/shifts` |
| `updateBusinessConfigSchema` | `PUT /business-settings` |
| `superadminStatusSchema` | `PATCH /superadmin/:id/status` |

### Flujo WebSocket (después)
```
Cliente WS → Socket.IO Server
          → io.engine.use(sessionMiddleware) → Parsea cookie de sesión
          → io.use() → Verifica session.user → Rechaza anónimos con "No autorizado"
          → Conecta → Auto-join business:${businessId}
          → join_availability(workerId, date) → Verifica Membership del worker en el MISMO negocio
          → Si worker es de otro negocio → Emite ws_error ("El trabajador no pertenece a su negocio")
          → calendar_update → io.to(business:${businessId}).emit() → Aislamiento multitenant
```

### Tests (después)
```
test/setup.js → process.env.NODE_ENV = 'test'
              → Requiere MONGO_TEST_URI (Ej: mongodb://.../agenda_test)
              → Safety check 1: aborta si NODE_ENV no es "test"
              → Safety check 2: aborta si la DB no termina en "_test"
              → Safety check 3: no deriva URIs automáticamente

test/fixtures.js → seedTestData() → Negocio A y Negocio B (para pruebas multitenant)
                 → cleanTestData() → Protegido con doble validación de entorno y DB name
                 → teardown() → Cierra conexiones

test/*.test.js → import './setup.js' (PRIMERA línea)
               → import app → connectDB → Base de datos agenda_test (aislada)
```

---

## 5. Archivos modificados

### Archivos nuevos
| Archivo | Descripción |
|---|---|
| `test/setup.js` | Bootstrap de test: redirige MONGO_URI a `agenda_test`, safety check |
| `test/fixtures.js` | Seeds deterministas: Business, Users, Memberships, Service, Shifts |
| `test/unit/websocket.auth.test.js` | Tests de autenticación WebSocket (3 tests) |

### Archivos modificados
| Archivo | Cambio |
|---|---|
| `src/validations/common.validation.js` | Corregido `TBK_TOKEN_WS` → `TBK_TOKEN`; agregado `updateBusinessConfigSchema` con `.strict()` |
| `src/controllers/payment.controller.js` | Corregido `TBK_TOKEN_WS` → `TBK_TOKEN` en webpayReturn |
| `src/routes/businessConfig.routes.js` | Aplicado `validate(updateBusinessConfigSchema)` a `PUT /` |
| `src/config/socket.js` | Autenticación: session sharing, rechazo anónimos, validación de membership en `join_availability`, `calendar_update` scoped a `business:${businessId}` |
| `src/app.js` | Extraído `sessionMiddleware` como export nombrado |
| `src/controllers/availability.controller.js` | Pasado `businessId` a `emitAvailabilityChange` |
| `src/services/appointment.service.js` | Pasado `businessId` a `emitAvailabilityChange` |
| `src/services/payment.service.js` | Pasado `businessId` a `emitAvailabilityChange` |
| `test/api.test.js` | Agregado `setup.js` + `seedTestData()` para DB de test |
| `test/integration.test.js` | Reescrito con `setup.js` + `fixtures.js`; usuarios con Memberships |
| `test/auditPayment.test.js` | Agregado `setup.js` + Membership para worker; corregido Shift (removido `business`/`slots` inexistentes); garantizado día laborable |
| `test/unit/validation.schemas.test.js` | Corregidos tests `TBK_TOKEN_WS` → `TBK_TOKEN`; agregados 15 tests de `updateBusinessConfigSchema`; test que verifica rechazo de `TBK_TOKEN_WS` |
| `package.json` | Agregado `socket.io-client` como devDependency |

---

## 6. Resultados de verificación

### Tests unitarios (80/80 ✅)
```
▶ objectIdParamSchema           4/4  ✅
▶ workerIdParamSchema           2/2  ✅
▶ initiatePaymentSchema         5/5  ✅
▶ webpayReturnSchema            9/9  ✅
▶ createBusinessSchema          7/7  ✅
▶ createWorkerSchema            3/3  ✅
▶ googleLoginSchema             3/3  ✅
▶ selectMembershipSchema        2/2  ✅
▶ switchBusinessSchema          2/2  ✅
▶ saveShiftSchema               9/9  ✅
▶ updateBusinessConfigSchema   15/15 ✅
▶ resolveSessionFromUser        5/5  ✅
▶ Email Templates              12/12 ✅
▶ WebSocket Authentication      3/3  ✅  (anónimo, autenticado, join válido)
▶ WebSocket Multitenant         2/2  ✅  (rechazo cross-business, calendar_update scoped)
```

### Tests de integración (15/15 ✅)
```
▶ api.test.js                   5/5  ✅  (health, settings, services, 404)
▶ integration.test.js           5/5  ✅  (registro, login, booking, confirm, cancel)
▶ auditPayment.test.js          5/5  ✅  (pago aprobado, duplicados, clientInfo, bloqueo)
```

### Total: 95/95 tests pasan ✅

---

## 7. Contrato frontend ↔ backend (Punto 5)

### Llamadas frontend identificadas
| Frontend (api.ts / api.js) | Endpoint backend | Schema aplicado | Estado |
|---|---|---|---|
| `POST /login` body: `{email, password}` | `POST /api/login` | Validado por controlador | ✅ |
| `POST /select-membership` body: `{membershipId}` | `POST /api/select-membership` | `selectMembershipSchema` | ✅ |
| `GET /me` | `GET /api/me` | Sin body (GET) | ✅ |
| `POST /logout` | `POST /api/logout` | Sin body | ✅ |
| `GET /users/workers` | `GET /api/users/workers` | Sin body (GET) | ✅ |
| `GET /appointments/my` | `GET /api/appointments/my` | Sin body (GET) | ✅ |
| `GET /availability/shifts/:workerId` | `GET /api/availability/shifts/:workerId` | `workerIdParamSchema` | ✅ |
| `PATCH /appointments/:id/confirm` | `PATCH /api/appointments/:id/confirm` | `objectIdParamSchema` (vía ruta) | ✅ |
| `PATCH /appointments/:id/complete` | `PATCH /api/appointments/:id/complete` | `objectIdParamSchema` (vía ruta) | ✅ |
| `PATCH /appointments/:id/cancel` | `PATCH /api/appointments/:id/cancel` | `objectIdParamSchema` (vía ruta) | ✅ |
| `POST /switch-business` body: `{businessId}` | `POST /api/switch-business` | `switchBusinessSchema` | ✅ |
| `GET /business-settings` | `GET /api/business-settings` | Sin body (GET) | ✅ |
| `POST /superadmin/businesses/:id/impersonate` | `POST /api/superadmin/businesses/:id/impersonate` | `objectIdParamSchema` | ✅ |
| `POST /stop-impersonating` | `POST /api/stop-impersonating` | Sin body | ✅ |
| `GET /superadmin/businesses` | `GET /api/superadmin/businesses` | Sin body (GET) | ✅ |
| `PATCH /superadmin/businesses/:id/status` | `PATCH /api/superadmin/businesses/:id/status` | `superadminStatusSchema` | ✅ |
| `POST /superadmin/businesses` body: `{name, slug, ...}` | `POST /api/superadmin/businesses` | `createBusinessSchema` | ✅ |
| `GET /superadmin/metrics` | `GET /api/superadmin/metrics` | Sin body (GET) | ✅ |

### Rutas sin consumidor frontend identificado
| Endpoint | Nota |
|---|---|
| `PUT /business-settings` | No se encontró llamada en el frontend actual. Schema aplicado de todas formas. |
| `POST /google` body: `{idToken}` | Google OAuth. No se encontró en el código Astro/React actual. Puede usarse desde otro flujo. Schema aplicado con `googleLoginSchema`. |
| `POST /register` | Solo usado en tests. Schema validado por controlador. |

---

## 8. Corrección del contrato Transbank

### Antes (incorrecto)
```js
// payment.controller.js
const tbkToken = req.body?.TBK_TOKEN_WS || req.query?.TBK_TOKEN_WS;

// common.validation.js
TBK_TOKEN_WS: z.string().optional(),
```

### Después (correcto, según contrato REST Transbank)
```js
// payment.controller.js
const tbkToken = req.body?.TBK_TOKEN || req.query?.TBK_TOKEN;

// common.validation.js
TBK_TOKEN: z.string().optional(),
```

**Flujos documentados en el schema:**
- **Normal (pago completado):** Transbank envía `token_ws`
- **Abortado/cancelado por usuario:** Transbank envía `TBK_TOKEN` + `TBK_ORDEN_COMPRA` + `TBK_ID_SESION`
- **Timeout:** Puede llegar sin ningún token

---

## 9. Diagrama de arquitectura WebSocket

```
┌─────────────────────────────────────────────────┐
│                  Frontend (Astro/React)          │
│  io.connect() + cookie de sesión                │
└──────────────────┬──────────────────────────────┘
                   │
         ┌─────────▼──────────┐
         │  Socket.IO Server  │
         │                    │
         │ 1. io.engine.use   │◄── sessionMiddleware (compartido con Express)
         │    (parsea cookie) │
         │                    │
         │ 2. io.use()        │◄── Verifica session.user → "No autorizado"
         │    (auth guard)    │
         │                    │
         │ 3. connection      │
         │    auto-join       │──► room: business:${businessId}
         │                    │
         │ 4. join_availability│
         │    validates       │──► MembershipModel.findOne({user: workerId,
         │    membership      │      business: socket.data.businessId})
         │                    │
         │ 5. emit scoped     │──► calendar_update → solo business:${businessId}
         └────────────────────┘
```
