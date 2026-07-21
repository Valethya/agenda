# Fase 7.3 — División de `SaasBusinessesView`

**Estado:** Implementado para revisión  
**Fecha:** 21 de julio de 2026

## Problema

`SaasBusinessesView.tsx` reunía en 592 líneas responsabilidades de presentación, consultas HTTP, mutaciones, formulario, filtrado, ordenamiento, métricas, avatares y navegación multitenant. Esto dificultaba revisar de forma aislada las acciones sensibles del superadministrador.

## Decisión

La vista principal queda como orquestador y delega en:

- `useSaasBusinesses`: carga, creación, cambio de estado e impersonación.
- `businessRules`: métricas, clasificación, búsqueda, ordenamiento, slug y ruta segura al tenant.
- `BusinessesHeader`: encabezado y métricas.
- `BusinessesToolbar`: búsqueda, orden y apertura del formulario.
- `BusinessesTable`: datos y acciones por negocio.
- `CreateBusinessModal`: estado y validación del alta.
- `BusinessAvatar`: favicon y fallback visual.

Los endpoints tipados se incorporan al cliente API común; los componentes ya no llaman `apiFetch` directamente.

## Reglas preservadas

- **Abrir panel** sólo navega a un tenant activo y no modifica la identidad del superadministrador.
- **Impersonar** continúa llamando al endpoint específico y cambia temporalmente la sesión.
- Los negocios inactivos no pueden abrirse ni impersonarse.
- Activar o suspender permanece como una acción independiente.
- Búsqueda, ordenamiento, métricas, creación y apariencia mantienen el comportamiento existente.
- Los estados `activo`, `trial` e `inactivo` ahora usan una única regla compartida.

## Pruebas agregadas

Se agregan seis pruebas para:

1. clasificación consistente de estados;
2. cálculo de métricas;
3. búsqueda por nombre, slug y dueño;
4. orden por fecha;
5. generación normalizada de slug;
6. separación entre abrir tenant e impersonar, incluyendo el bloqueo de inactivos.

El job frontend ejecuta las trece pruebas acumuladas de las fases 7.2 y 7.3.

## Verificación local

- `npm run test:frontend`: 13 pruebas aprobadas.
- `npm run check`: 0 errores, 0 advertencias, 0 sugerencias.
- `npm run build`: 5 páginas generadas correctamente con la variable de CI.
- `git diff --check`: sin errores de formato.

## Resultado

La vista queda reducida a la coordinación de la pantalla. Las reglas sensibles y las operaciones remotas pueden probarse y evolucionar sin modificar la tabla o el formulario completo.
