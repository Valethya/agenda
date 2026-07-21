# Fase 6.1 — Base verificable de pruebas y CI

**Proyecto:** ATMÓSFERA Agenda

**Estado:** Verificado por CI; cierre condicionado a controles administrativos

**Fecha:** 21 de julio de 2026

**Rama:** `hardening/6.1-test-foundation`

## 1. Objetivo y límite de alcance

Esta etapa convierte las verificaciones existentes en una barrera reproducible antes de continuar con cambios de autorización, multitenencia, pagos o impersonación.

El alcance de esta rama se limita a:

- ejecutar todas las suites desde los scripts oficiales;
- corregir fixtures que concedían permisos falsos;
- eliminar pruebas que podían aprobar sin ejecutar su aserción principal;
- sincronizar instalaciones limpias;
- añadir CI para pruebas, tipado, build, dependencias y secretos.

No se modifica todavía el comportamiento productivo de autenticación, reservas, pagos, multitenencia ni impersonación.

## 2. Contratos de prueba definidos

### 2.1 Cliente sin membresía

El fixture `TEST_CLIENT` conserva su identidad global con rol `user`, pero ya no recibe una membresía `worker`. Esa membresía era incompatible con el modelo real y permitía que una cuenta cliente adquiriera permisos de trabajador sólo para satisfacer el login.

La prueba de integración documenta el comportamiento actual, no el comportamiento futuro deseado:

1. `POST /register` crea la cuenta;
2. el registro no crea una membresía;
3. `POST /login` rechaza la cuenta con `401` y el mensaje de que no existe un negocio asociado.

La decisión definitiva sobre cuentas cliente pertenece a la etapa 6.2.5 del plan maestro.

### 2.2 Reserva pública vigente

Mientras no se cambie el contrato de producto, la prueba usa el flujo público vigente de `POST /appointments` con `clientInfo`. La creación de la cita ahora debe retornar obligatoriamente `201`; se eliminó el condicional que permitía continuar si la reserva fallaba.

La confirmación y cancelación del escenario se ejecutan con una sesión de administrador. La prueba ya no simula un cliente mediante permisos de trabajador.

### 2.3 WebSocket y aislamiento

Las conexiones del negocio A usan al administrador real de ese negocio. Esto conserva el objetivo de las pruebas —sesión válida, acceso al trabajador propio y rechazo del trabajador ajeno— sin otorgar una membresía incorrecta al cliente.

Cada suite que usa MongoDB limpia la base exclusiva de pruebas antes de sembrar datos. Las guardas existentes exigen `NODE_ENV=test` y un nombre de base terminado en `_test`.

## 3. Comandos oficiales

| Comando | Cobertura |
|---|---|
| `npm test` | Unitaria e integración, en secuencia |
| `npm run test:unit` | Sesión, correo y esquemas de validación |
| `npm run test:integration` | API, flujo completo, pagos y WebSocket |
| `npm run test:api` | Endpoints básicos |
| `npm run test:flow` | Registro, administración, disponibilidad y citas |
| `npm run test:payment` | Pagos, auditoría e identificación progresiva |
| `npm run test:websocket` | Autenticación y aislamiento WebSocket |

Las suites que comparten MongoDB se ejecutan secuencialmente para evitar que la limpieza de una suite interfiera con otra.

## 4. Integración continua

El workflow `.github/workflows/ci.yml` se ejecuta en cada pull request hacia `master` y en cada push a `master`.

| Verificación | Contenido |
|---|---|
| Backend unit tests | `npm ci`, 75 pruebas unitarias y auditoría de dependencias productivas |
| Backend integration tests | MongoDB 7 aislado y las cuatro suites de integración |
| Frontend checks and build | `npm ci`, `astro check`, build estático y auditoría de dependencias productivas |
| Secret scan | Gitleaks 8.24.2 desde GHCR oficial sobre el árbol de archivos publicado |

El pipeline usa Node.js 24. La auditoría bloquea vulnerabilidades críticas; las vulnerabilidades altas existentes permanecen visibles y deben resolverse en la etapa de dependencias, sin ocultarlas ni aplicar actualizaciones mayores automáticas.

Después del primer pipeline exitoso se deben configurar estas verificaciones como obligatorias en la protección de `master`.

## 5. Evidencia local

Entorno de verificación: Node.js 24.14.0 y npm 11.9.0.

| Verificación | Resultado |
|---|---|
| `Server: npm ci` | Correcto, 246 paquetes instalados desde lockfile |
| `Server: npm run test:unit` | 75/75 pruebas, 19 suites, 0 fallos |
| `Client: npm ci` | Correcto después de sincronizar dependencias opcionales faltantes en el lockfile |
| `Client: npm run check` | 0 errores, 0 advertencias, 0 sugerencias |
| `Client: npm run build` | 5 páginas estáticas, build correcto |
| Auditoría backend | 0 críticas; 14 vulnerabilidades conocidas de menor severidad, incluidas 8 altas |
| Auditoría frontend | 0 críticas; 9 vulnerabilidades conocidas de menor severidad, incluidas 3 altas |
| `git diff --check` | Sin errores de whitespace |
| Sintaxis de `ci.yml` | YAML válido |

Las suites con MongoDB no pudieron ejecutarse en el entorno local de preparación porque no dispone de un servidor MongoDB. Su resultado fue confirmado posteriormente por CI.

## 5.1 Evidencia de CI

Ejecución confirmada: [CI #5](https://github.com/Valethya/agenda/actions/runs/29832330810), commit `fc466f3`, 21 de julio de 2026.

| Job | Resultado |
|---|---|
| Backend unit tests | 75/75 pruebas, 19 suites, 0 fallos |
| Backend integration tests — API | 5/5 pruebas, 0 fallos |
| Backend integration tests — flujo | 5/5 pruebas, 0 fallos |
| Backend integration tests — pagos | 5/5 pruebas, 0 fallos |
| Backend integration tests — WebSocket | 5/5 pruebas, 2 suites, 0 fallos |
| Frontend checks and build | Correcto |
| Secret scan | Correcto, 0 hallazgos en el árbol actual |

Resultado agregado del backend: **95/95 pruebas, 0 fallos**.

## 6. Seguridad de secretos

Se eliminó de una auditoría histórica una credencial que estaba escrita literalmente. También se reemplazaron URI con credenciales embebidas en tres scripts de depuración por la variable de entorno obligatoria `MONGO_URI`; al hacerlo se corrigieron sus rutas de importación desde `Server/scripts/debug`. El script de confirmación exige además `APPOINTMENT_ID` y `ADMIN_USER_ID`, por lo que no conserva identificadores operativos.

Gitleaks detectó tres falsos positivos de alta entropía en fixtures de validación. Esos valores fueron reemplazados por sentinelas explícitamente sintéticos, sin cambiar los contratos comprobados, y el escaneo final confirmó cero hallazgos.

La redacción evita que esos secretos permanezcan en el árbol actual, pero no los elimina de commits anteriores. Si las credenciales no fueron rotadas previamente, deben rotarse en el proveedor; reescribir el historial no sustituye la rotación.

## 7. Criterios de cierre

Estado de los criterios:

- [x] los cuatro jobs de CI están verdes en el pull request;
- [x] los comandos oficiales confirman 95/95 pruebas de backend sin fallos;
- [x] el resultado real de integración está registrado en este documento;
- [x] las verificaciones están configuradas como obligatorias para `master`;
- [ ] se confirmó la rotación de cualquier credencial histórica todavía vigente.

La implementación técnica de la fase 6.1 está verificada y `master` está protegida por los cuatro jobs del pipeline. No debe declararse cerrada administrativamente ni mezclarse con cambios de la etapa 6.2 hasta confirmar la rotación de cualquier credencial histórica todavía vigente.
