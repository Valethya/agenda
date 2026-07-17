# Fase 4 — Desacoplar side-effects

## Estado
- **Fecha de cierre:** 2026-07-15
- **Estado:** Completada con pendientes (Event Emitter pospuesto a Fase 8)
- **Responsable de implementación:** Antigravity (asistente de refactor)
- **Commit asociado:** Sin commit dedicado. Los cambios están en working tree sin commitear. Último commit previo: `1ba8496`.

## 1. Objetivo
Desacoplar los side-effects (correos, notificaciones WebSocket, pasarela de pagos) de la lógica de negocio principal, organizándolos en módulos con responsabilidades claras. El alcance abarcaba:

- Dividir el monolítico `utils/mailer.js` (390 líneas) en 3 módulos: transporte, plantillas y servicio de email.
- Migrar el acceso directo a modelos Mongoose desde el mailer a la capa de repositorios.
- Abstraer Socket.IO en un servicio de notificaciones y corregir su CORS.
- Extraer la lógica de Transbank SDK de `payment.service.js` a un gateway dedicado.
- Evaluar la implementación de un Event Emitter para desacoplar side-effects de la orquestación principal.

## 2. Problema original

### 2.1 Mailer monolítico (390 líneas)
`Server/src/utils/mailer.js` concentraba 4 responsabilidades diferentes:
1. **Configuración de transporte** (SMTP/Resend/Ethereal): líneas 1-56
2. **Resolución de branding** con acceso directo a modelos: líneas 58-109
3. **Envío de emails** (API REST Resend o SMTP): líneas 112-208
4. **5 plantillas HTML** con lógica de formateo: líneas 210-389

Problemas específicos:
- **Acceso directo a modelos**: `BusinessConfig.findOne()` (línea 80) y dynamic import de `Business` (línea 91)
- **Variables de entorno dispersas**: `process.env.SMTP_HOST`, `SMTP_FROM_NAME`, `RESEND_API_KEY`, `FRONTEND_URL` accedidos directamente
- **Imposible testear templates sin SMTP**: las plantillas estaban acopladas al transporte
- **Caché de branding con modelo directo**: `BusinessConfig.findOne({ business: businessId })` dentro del mailer

### 2.2 Socket.IO con CORS abierto
`Server/src/config/socket.js` (línea 9):
```js
cors: {
  origin: "*", // En producción configurar el dominio exacto del frontend
}
```
El comment "En producción configurar" nunca se implementó. Cualquier sitio web podía conectarse al WebSocket.

### 2.3 Transbank SDK acoplado a payment.service.js
`Server/src/services/payment.service.js` importaba directamente el SDK:
```js
import pkg from "transbank-sdk";
const { WebpayPlus } = pkg;
```
Y contenía la función `getTransactionInstance()` (14 líneas) que configuraba el SDK con credenciales hardcodeadas de integración. Si se quisiera cambiar de pasarela (ej: Mercadopago), habría que modificar todo el servicio de pagos.

### 2.4 Event Emitter (evaluado y pospuesto)
Los side-effects (emails, WebSocket broadcasts) se invocan directamente en los servicios:
- `appointment.service.js`: 5 llamadas a `mailer.*` + 2 a `emitAvailabilityChange`
- `payment.service.js`: 1 llamada a `mailer.*` + 1 a `emitAvailabilityChange`

Un Event Emitter desacoplaría estas llamadas, pero con solo 3 servicios consumidores y ~8 call sites, la complejidad añadida de un bus de eventos no se justifica.

## 3. Arquitectura anterior

### Mailer
```
utils/mailer.js (390 líneas, 4 responsabilidades)
├── getTransporter()          → nodemailer / Resend
├── getBrandingSettings()     → BusinessConfig model (directo) ← violación
│                             → Business model (dynamic import) ← violación
├── sendMail()                → Resend API / SMTP
├── getBaseTemplate()         → HTML base
├── sendResetPasswordEmail()  → template + sendMail
├── sendAppointmentBookedEmail()   → branding + template + sendMail
├── sendAppointmentConfirmedEmail() → branding + template + sendMail
├── sendAppointmentCancelledEmail() → branding + template + sendMail
└── sendWorkerPendingApprovalEmail() → branding + template + sendMail
```

### Socket.IO
```
config/socket.js
├── CORS: origin: "*" ← inseguro
├── initSocket()
├── getIO()
└── emitAvailabilityChange()
```

### Transbank
```
payment.service.js
├── import pkg from "transbank-sdk"
├── getTransactionInstance() → WebpayPlus.Transaction(options)
├── initiatePayment() → tx.create()
└── confirmPayment() → tx.commit()
```

## 4. Arquitectura nueva

### Email (3 módulos)
```
services/email/
├── transporter.js (130 líneas)
│   ├── getTransporter()  → SMTP / Ethereal
│   └── sendMail()        → Resend API / SMTP (transport puro, sin branding)
│
├── templates.js (140 líneas)
│   ├── getBaseTemplate()       → HTML base (función pura)
│   ├── formatDateES()          → helper de formato
│   ├── resetPassword()         → { subject, html }
│   ├── appointmentBooked()     → { subject, html }
│   ├── appointmentConfirmed()  → { subject, html }
│   ├── appointmentCancelled()  → { subject, html }
│   └── workerPendingApproval() → { subject, html }
│
└── emailService.js (110 líneas)
    ├── getBrandingSettings()  → businessConfigRepository + businessRepository
    ├── sendResetPasswordEmail()       → templates + transporter
    ├── sendAppointmentBookedEmail()   → branding + templates + transporter
    ├── sendAppointmentConfirmedEmail() → branding + templates + transporter
    ├── sendAppointmentCancelledEmail() → branding + templates + transporter
    └── sendWorkerPendingApprovalEmail() → branding + templates + transporter
```

### Socket.IO
```
config/socket.js
├── CORS: corsOrigins (desde env.js) ← centralizado
├── initSocket()
├── getIO()
└── emitAvailabilityChange()
```

### Transbank
```
gateways/transbank.gateway.js (45 líneas)
├── getTransactionInstance()  → WebpayPlus.Transaction
├── createTransaction()      → transaction.create()
└── commitTransaction()      → transaction.commit()

payment.service.js
├── import * as transbankGateway ← ya no importa transbank-sdk
├── initiatePayment() → transbankGateway.createTransaction()
└── confirmPayment() → transbankGateway.commitTransaction()
```

## 5. Archivos modificados

### Creados
| Archivo | Descripción |
|---------|-------------|
| `Server/src/services/email/transporter.js` | Transporte de email (SMTP/Resend/Ethereal). 130 líneas. |
| `Server/src/services/email/templates.js` | 5 plantillas HTML como funciones puras. 140 líneas. |
| `Server/src/services/email/emailService.js` | Orquestador: branding + templates + transporte. 110 líneas. |
| `Server/src/gateways/transbank.gateway.js` | Encapsulación de Transbank SDK. 45 líneas. |

### Modificados
| Archivo | Cambio |
|---------|--------|
| `Server/src/services/appointment.service.js` | Import: `../utils/mailer.js` → `./email/emailService.js` |
| `Server/src/services/auth.service.js` | Import: `../utils/mailer.js` → `./email/emailService.js` |
| `Server/src/services/payment.service.js` | Import: `../utils/mailer.js` → `./email/emailService.js`. Eliminados `import pkg from "transbank-sdk"`, `const { WebpayPlus } = pkg`, y `getTransactionInstance()`. Añadido `import * as transbankGateway`. |
| `Server/src/config/socket.js` | CORS: `origin: "*"` → `corsOrigins` de env.js. Añadido JSDoc. |
| `Server/src/repositories/business.repository.js` | Añadido `findByIdPopulated(id, populateField)` |

### No eliminados (decisión consciente)
| Archivo | Razón |
|---------|-------|
| `Server/src/utils/mailer.js` | Se preserva temporalmente para evitar romper imports no descubiertos. Se eliminará cuando se confirme que no hay consumidores adicionales. |

## 6. Cambios realizados

### 6.1 División del mailer en 3 módulos

**transporter.js**: Extrae `getTransporter()` y `sendMail()` del mailer original. La firma de `sendMail` cambió de:
```js
// Antes: branding mezclado con transporte
sendMail({ to, subject, html, businessId })
```
A:
```js
// Después: transporte puro, branding resuelto externamente
sendMail({ to, subject, html, fromName, replyTo, bccEmail })
```

**templates.js**: 5 funciones que retornan `{ subject, html }`. Reciben datos + branding como parámetros, no los resuelven internamente. Son funciones puras sin I/O.

**emailService.js**: Orquesta las 3 capas:
1. Resuelve branding vía `businessConfigRepository.getConfig()` y `businessRepository.findByIdPopulated()`
2. Genera template vía `templates.*`
3. Envía vía `transporter.sendMail()`

### 6.2 Migración de branding a repositorios
El mailer original accedía directamente a modelos:
```js
// Antes
const config = await BusinessConfig.findOne({ business: businessId });
const Business = (await import("../db/models/business.model.js")).default;
const business = await Business.findById(businessId).populate("owner");
```
Después:
```js
// Después
const config = await businessConfigRepository.getConfig(businessId);
const business = await businessRepository.findByIdPopulated(businessId, "owner");
```

### 6.3 CORS de Socket.IO centralizado
```diff
-origin: "*", // En producción configurar el dominio exacto del frontend
+const allowedOrigins = corsOrigins.split(",").map((o) => o.trim());
+origin: allowedOrigins,
```

### 6.4 Extracción de Transbank a gateway
```diff
-import pkg from "transbank-sdk";
-const { WebpayPlus } = pkg;
-const getTransactionInstance = () => { ... };
-const tx = getTransactionInstance();
-const response = await tx.create(buyOrder, sessionId, amount, returnUrl);
+import * as transbankGateway from "../gateways/transbank.gateway.js";
+const response = await transbankGateway.createTransaction(buyOrder, sessionId, amount, returnUrl);
```

## 7. Decisiones tomadas

| Decisión | Justificación | Alternativas descartadas |
|----------|---------------|--------------------------|
| Dividir mailer en 3 archivos dentro de `services/email/` | Cada archivo tiene una responsabilidad clara. La carpeta `email/` agrupa el dominio. | (a) Mantener en `utils/` — viola SRP; (b) 2 archivos — templates y branding quedarían mezclados |
| Templates como funciones puras que retornan `{ subject, html }` | Permite testear templates sin SMTP/mocks. El subject se genera junto con el HTML para mantener coherencia. | (a) Templates como strings con `export const TEMPLATE_X = "..."` — menos flexible, sin formateo dinámico |
| No eliminar `utils/mailer.js` aún | Podría haber consumidores en scripts de debug/migration no descubiertos. Se eliminará al confirmar. | (a) Eliminar inmediatamente — riesgo de romper scripts |
| Posponer Event Emitter a Fase 8 | Solo 8 call sites en 3 servicios. Un bus de eventos añadiría indirección sin beneficio proporcional al tamaño del proyecto. El lugar natural es Bull/BullMQ. | (a) Implementar Node.js EventEmitter — añadiría complejidad de debugging; (b) Implementar con un EventBus custom — over-engineering |
| `transbank.gateway.js` solo expone `createTransaction` y `commitTransaction` | Son las únicas 2 operaciones usadas en el proyecto. Si se necesitan otras (refund, status), se añaden al gateway. | (a) Exponer toda la API del SDK — YAGNI |
| Socket.IO usa la misma `corsOrigins` que Express CORS | Consistencia: un solo lugar para configurar orígenes permitidos. | (a) Variables separadas para WS y HTTP — innecesario y propenso a desincronización |

## 8. Riesgos conocidos

| Riesgo | Severidad | Mitigación |
|--------|-----------|------------|
| `utils/mailer.js` original todavía existe (código muerto) | Baja | No está importado por ningún servicio activo. Se eliminará tras verificación completa. |
| emailService.js importa `frontendUrl` de env.js para reset password; si no está definido, usa `http://localhost:5173` | Baja | Verificar que Railway tenga `FRONTEND_URL` configurado. |
| Los templates no se verificaron visualmente (rendering HTML) | Media | Los templates son idénticos al original (copy-paste preservando todo el HTML). Se recomienda enviar un email de prueba. |
| `transbank.gateway.js` hardcodea credenciales de integración (pruebas) | Media (preexistente) | Este riesgo ya existía. El gateway facilita la migración a producción: solo hay que cambiar un archivo. |
| Las firmas de `emailService.*` deben coincidir exactamente con las de `mailer.*` | Alta | Se verificó que los 3 consumidores (`appointment.service.js`, `auth.service.js`, `payment.service.js`) usan las mismas firmas. |

## 9. Cómo extender esta solución

### Agregar una nueva plantilla de email
1. Crear la función en `services/email/templates.js`:
```js
export const newTemplate = (data, branding) => ({
  subject: `Asunto - ${branding.businessName}`,
  html: getBaseTemplate("Título", `<p>Contenido con ${data.campo}</p>`, branding),
});
```
2. Crear el método público en `services/email/emailService.js`:
```js
export const sendNewEmail = async (email, data) => {
  const businessId = data.business?._id || data.business || null;
  const branding = await getBrandingSettings(businessId);
  const template = templates.newTemplate(data, branding);
  const meta = getMailMeta(branding);
  await sendMail({ to: email, ...template, ...meta, businessId });
};
```

### Cambiar de pasarela de pagos (ej: Mercadopago)
1. Crear `gateways/mercadopago.gateway.js` con `createTransaction` y `commitTransaction`
2. En `payment.service.js`, cambiar el import:
```diff
-import * as transbankGateway from "../gateways/transbank.gateway.js";
+import * as paymentGateway from "../gateways/mercadopago.gateway.js";
```
3. El resto del servicio no cambia (mismo contrato de API).

### Agregar un nuevo canal de notificación (ej: push notifications)
Añadir una nueva función exportada en `config/socket.js`:
```js
export const emitNewNotification = (userId, data) => {
  if (io) {
    io.to(`user:${userId}`).emit("notification", data);
  }
};
```

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
| Import de mailer redirigido en 3 servicios | `Select-String 'from.*utils/mailer'` | ✅ 0 resultados en services (solo mailer.js original) |
| `payment.service.js` no importa `transbank-sdk` | `Select-String 'transbank-sdk'` en services/ | ✅ Solo en `gateways/transbank.gateway.js` |

### Aspectos no verificados
- **No se envió un email de prueba** para verificar que el transporte funciona con la nueva estructura.
- **No se probó un flujo de pago** Transbank con el gateway extraído.
- **No se verificó el rendering visual** de las plantillas HTML.
- **No se probó el WebSocket** con el nuevo CORS centralizado.
- **No existen tests unitarios** para transporter, templates, emailService, ni transbank.gateway.

## 11. Pendientes

| Pendiente | Prioridad | Fase sugerida |
|-----------|-----------|---------------|
| Eliminar `utils/mailer.js` original (código muerto) | Media | Pre-commit |
| Enviar email de prueba para validar transporter.js | Media | Pre-deploy |
| Tests unitarios para templates (funciones puras, sin mocks) | Media | Fase 6 |
| Event Emitter / Job Queue para side-effects asíncronos | Baja | Fase 8 |
| Migrar credenciales Transbank de integración a producción | Alta (pre-producción) | Deploy |

## 12. Criterios de cierre

- [x] `mailer.js` dividido en 3 módulos con responsabilidades claras
- [x] Branding migrado de modelos directos a repositorios (`businessConfigRepository`, `businessRepository`)
- [x] 3 servicios consumidores redirigidos a `email/emailService.js`
- [x] Socket.IO CORS centralizado (ya no usa `origin: "*"`)
- [x] Transbank SDK extraído a `gateways/transbank.gateway.js`
- [x] `payment.service.js` no importa `transbank-sdk` directamente
- [x] Event Emitter evaluado y pospuesto con justificación documentada
- [x] Syntax check pasa sin errores
- [x] Servidor arranca y responde correctamente
