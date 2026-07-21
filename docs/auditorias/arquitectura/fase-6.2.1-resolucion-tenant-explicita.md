# Fase 6.2.1-A — Resolución explícita de tenant

**Proyecto:** ATMÓSFERA Agenda

**Estado:** En verificación

**Fecha:** 21 de julio de 2026

**Base:** `master` después del cierre del inventario de fallbacks y fronteras multitenant

## 1. Objetivo

Eliminar la selección implícita de negocio en el perímetro HTTP. Una solicitud tenant-scoped incompleta o contradictoria debe fallar de manera determinista y nunca operar sobre el primer negocio activo ni sobre un slug inventado por el frontend.

Esta entrega implementa el contrato de resolución. Las guardas de ownership de servicios, citas, disponibilidad, turnos, bloqueos y pagos continúan en las etapas 6.2.1-B, 6.2.3, 6.2.4 y 6.3.

## 2. Contrato implementado

### Solicitudes públicas y de clientes

- Requieren `businessId` o slug explícito.
- Pueden entregar ambos únicamente si resuelven al mismo negocio.
- Valores distintos para el mismo identificador entre query, body y headers producen `400`.
- Un `businessId` mal formado produce `400` antes de consultar MongoDB.
- Un negocio inexistente o inactivo produce el mismo `404` genérico.
- La respuesta pública no incluye el nombre ni el estado del negocio inactivo.

### Administradores y trabajadores autenticados

- El negocio se obtiene exclusivamente de la sesión.
- Query, body y headers no pueden sustituir el negocio de la sesión.
- Si el negocio asociado está inactivo, la solicitud produce `403`.

### Superadministración

- Las rutas globales de plataforma permanecen fuera de `scopeBusiness`.
- Una operación tenant-scoped requiere selección explícita.
- La ausencia o invalidez del tenant no cae en el primer negocio activo.

### Cliente frontend

- `getBusinessSlug()` retorna ausencia cuando la URL no contiene slug.
- `apiFetch()` sólo agrega `x-business-slug` cuando existe un slug explícito.
- Un header tenant proporcionado por el llamador no se sobrescribe.
- Login, sesión y rutas globales pueden ejecutarse sin un header tenant artificial.

## 3. Cambios de implementación

| Archivo | Cambio | Motivo |
|---|---|---|
| `Server/src/middleware/business.middleware.js` | Valida presencia, formato, duplicados y coherencia de identificadores; elimina ambos fallbacks al primer negocio; unifica el `404` público. | Evitar selección accidental, precedencia silenciosa y enumeración del estado del negocio. |
| `Server/src/repositories/business.repository.js` | Elimina `findFirstActive()`. | Retirar del runtime HTTP una primitiva que permitía resolver tenant por orden de la base. |
| `Client/src/services/api.ts` | Elimina `FALLBACK_BUSINESS_SLUG` y condiciona el header tenant. | Hacer visible la ausencia de contexto y conservar limpias las llamadas globales. |
| `Server/test/api.test.js` | Agrega casos públicos, autenticados y de superadministración. | Fijar el contrato con pruebas de regresión y aislamiento. |

## 4. Cobertura añadida

Las pruebas de integración verifican:

1. ausencia de tenant → `400`;
2. slug inexistente → `404` genérico;
3. ID mal formado → `400`;
4. ID y slug de negocios distintos → `400`;
5. ID y slug del mismo negocio → sólo recursos de ese negocio;
6. negocio público inactivo → `404` sin revelar su nombre;
7. admin autenticado no puede sustituir el tenant mediante query;
8. worker autenticado no puede sustituir el tenant mediante header;
9. miembro de negocio inactivo → `403`;
10. superadmin sin tenant → `400`;
11. superadmin con tenant inexistente → `404`.

Las aserciones de aislamiento exigen que la colección devuelta no esté vacía, evitando falsos positivos de `Array.every()`.

## 5. Verificación

- `git diff --check`: correcto.
- Sintaxis Node de middleware, repositorio y prueba: correcta.
- `npm run check` del frontend: 0 errores, 0 advertencias y 0 hints.
- `npm run build` del frontend con `PUBLIC_API_URL` explícita: correcto.
- Suite de integración con MongoDB: pendiente de ejecución en GitHub Actions.

El estado de este documento debe cambiar a **Completado** únicamente después de que los checks obligatorios del PR estén verdes y el cambio sea fusionado.

## 6. Fuera de alcance y riesgo residual

Esta entrega no afirma aislamiento multitenant completo. Permanecen abiertos:

- coherencia entre el tenant resuelto y los IDs de servicio o profesional al reservar;
- ownership tenant en lecturas y mutaciones por ID;
- autoridad de `Membership` en lugar de campos heredados de `User`;
- tenant explícito en turnos y bloqueos;
- correlación segura del retorno de pagos y eliminación de sus slugs de fallback.

Estos puntos están registrados en el inventario de la fase 6.2 y no deben confundirse con una regresión introducida por esta entrega.

## 7. Criterio de cierre

6.2.1-A se considera cerrada cuando:

- los checks obligatorios del PR están verdes;
- la revisión confirma que no queda ningún uso productivo de `findFirstActive()` ni `FALLBACK_BUSINESS_SLUG`;
- las rutas públicas sin tenant y las selecciones contradictorias fallan como establece el contrato;
- se realiza una prueba de humo posterior al despliegue sobre login y una agenda con slug explícito.
