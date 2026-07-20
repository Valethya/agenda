# Fase 7.1 — API client unificado

## Estado

- **Fecha:** 2026-07-20
- **Estado:** implementada localmente, pendiente de commit
- **Commit base:** `9d87bc0`

## Objetivo

Establecer una única puerta de comunicación HTTP entre el frontend y el backend, sin modificar la conexión Socket.IO.

## Problemas encontrados

- Existían dos implementaciones de `apiFetch`: `src/lib/api.js` y `src/services/api.ts`.
- Cada implementación usaba un slug de respaldo diferente.
- La URL, las credenciales, los headers y el manejo de errores estaban duplicados.
- Los errores HTTP descartaban el mensaje, código y detalles enviados por el backend.
- `SaasBusinessesView` entregaba un objeto directamente como `body` a `fetch`, sin serializarlo.
- `CalendarContext` detectaba una sesión vencida buscando el texto `401` dentro del mensaje de error.

## Solución

`src/services/api.ts` queda como cliente HTTP canónico:

- normaliza `PUBLIC_API_URL`;
- conserva `credentials: "include"`;
- agrega `x-business-slug` en un único lugar;
- serializa automáticamente bodies JSON representados como objetos o arrays;
- respeta bodies nativos como `FormData`, `Blob` y `URLSearchParams`;
- admite respuestas JSON, texto y respuestas vacías;
- expone `ApiError` con `status`, `code`, `errors` y payload original;
- permite identificar errores HTTP con `isApiError`.

La página de login ahora consume el cliente TypeScript y se eliminó `src/lib/api.js`. `CalendarContext` utiliza `ApiError.status` para redirigir ante un `401`.

Socket.IO permanece separado porque no utiliza el protocolo de solicitudes HTTP del API client.

## Archivos afectados

| Archivo | Cambio |
|---|---|
| `Client/src/services/api.ts` | Cliente HTTP canónico y errores estructurados |
| `Client/src/pages/login.astro` | Migrado al cliente canónico |
| `Client/src/context/CalendarContext.tsx` | Manejo tipado del error 401 |
| `Client/src/lib/api.js` | Eliminado por duplicación |

## Verificación

- `git diff --check`: aprobado.
- Búsqueda global: una sola llamada directa a `fetch`, encapsulada en `services/api.ts`.
- `PUBLIC_API_URL=http://localhost:3000/api npm run build`: aprobado, 5 páginas generadas.
- `npm run check`: ejecutado; reporta 50 errores preexistentes en scripts Astro. No reporta errores en `services/api.ts` ni `CalendarContext.tsx`.

## Deuda detectada fuera del alcance

- `package.json` y `package-lock.json` del cliente no están sincronizados; `npm ci` no puede ejecutarse.
- El script `npm run check` requiere `@astrojs/check` y `typescript`, pero no están declarados en el proyecto.
- Persisten 50 diagnósticos TypeScript en `login.astro`, `payment-success.astro` y `payment-failed.astro`. Deben tratarse en 7.10.
- El slug de respaldo hardcodeado se conserva temporalmente y debe eliminarse en 7.9.

## Criterios de cierre

- [x] Existe un solo API client.
- [x] Todos los consumidores HTTP identificados usan el cliente canónico.
- [x] La serialización JSON está centralizada.
- [x] Los errores HTTP conservan información del backend.
- [x] El build de producción finaliza correctamente con la variable de entorno requerida.
- [x] No se mezclaron cambios de WebSocket ni tareas posteriores de la Fase 7.
