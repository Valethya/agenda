# Fase 7.10 — Tipado TypeScript estricto

## Objetivo

Cerrar el refactor frontend con una configuración TypeScript explícita, contratos compartidos para las respuestas de la API y cero usos productivos de `any`.

## Inventario inicial

- El frontend no tenía `tsconfig.json`; `astro check` validaba los archivos Astro, pero no existía un contrato estricto y versionado para todo `src` y las pruebas.
- Existían 15 usos explícitos de `any`, concentrados en `services/api.ts` y `utils/time.ts`.
- Al activar `strict`, TypeScript detectó cuatro errores de aplicación:
  - una referencia de trabajador incompatible en la vista mensual;
  - identificadores opcionales usados como obligatorios en `Topbar`;
  - una función de limpieza de WebSocket que retornaba el socket;
  - un cuerpo JSON incompatible con el contrato del cliente API.
- La configuración recibida desde el backend descartaba `workingHours`, por lo que las vistas de calendario no podían usar los límites horarios persistidos.

## Decisiones

### Configuración y CI

- `Client/tsconfig.json` extiende `astro/tsconfigs/strict`.
- El alcance incluye componentes React, utilidades, scripts Astro y pruebas TypeScript.
- `npm run typecheck` ejecuta `tsc --noEmit`.
- GitHub Actions ejecuta el chequeo estricto como un paso independiente y obligatorio dentro del trabajo frontend.

### Contratos compartidos

- Se incorporan tipos para respuestas API, sesión, identidad, configuración, horarios y referencias pobladas de entidades.
- `apiFetch` usa `unknown` como tipo predeterminado. Cada consumidor debe declarar el contrato que espera.
- Las respuestas de cambio de negocio e impersonación usan una identidad de sesión distinta del usuario completo cargado por `/me`.
- Las páginas de login reutilizan los contratos compartidos en lugar de mantener interfaces parciales propias.

### Calendario

- `Shift.worker` y `Appointment.worker` comparten una referencia tipada que admite identificador o entidad poblada.
- Los cálculos de días libres y límites horarios reciben estructuras explícitas.
- `getBusinessConfigData` conserva `workingHours`; el calendario vuelve a derivar sus límites desde la configuración persistida.

## Resultado

- Cero usos productivos de `any`.
- Modo estricto sin errores.
- `astro check` sin errores, advertencias ni sugerencias.
- 28 pruebas frontend aprobadas.
- Build estático aprobado con la variable pública de API requerida.
- `git diff --check` sin errores.

## Límite del tipado

TypeScript verifica el contrato durante el desarrollo, pero no valida por sí solo el JSON recibido en tiempo de ejecución. El backend continúa siendo la autoridad de validación mediante sus schemas. Si la API se abre a clientes externos o incorpora respuestas de terceros no controladas, deberá añadirse validación de respuesta en la frontera del frontend.
