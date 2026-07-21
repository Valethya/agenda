# Fase 7.2 — División de `CalendarContext`

**Estado:** Implementado para revisión  
**Fecha:** 21 de julio de 2026

## Problema

`CalendarContext` concentraba en un único proveedor tres responsabilidades independientes:

1. autenticación, ámbito global/tenant y cambio de negocio;
2. navegación y selección dentro del calendario;
3. carga de datos, mutaciones de citas y sincronización WebSocket.

Esto hacía que un cambio de fecha pudiera notificar a consumidores de sesión, que la consola global del superadministrador dependiera de la carga del calendario y que el selector multinegocio quedara acoplado a datos ajenos a la sesión.

## Decisión

Se divide el contexto en tres proveedores:

- `SessionContext`: usuario autenticado, ámbito de sesión, cierre de sesión y cambio de negocio.
- `CalendarNavigationContext`: fecha, vista, profesional y cita seleccionados.
- `CalendarDataContext`: citas, profesionales, turnos, configuración, acciones y WebSocket.

`CalendarContext` permanece como un proveedor de composición para navegación y datos. `AdminDashboard` agrega `SessionProvider` como frontera exterior.

## Reglas de negocio preservadas

- El superadministrador sin `slug` permanece en la consola global y no consulta endpoints de calendario.
- El superadministrador con `slug` explícito puede abrir la vista operativa de un tenant.
- Un administrador o trabajador con más de una membresía activa ve **Cambiar negocio ▾** bajo el nombre del negocio, en la esquina superior izquierda.
- Con una sola membresía el selector no aparece.
- El selector de membresías no aparece para el superadministrador; su acceso global continúa en **Negocios SaaS**.
- El WebSocket sólo se conecta dentro de un tenant.
- Las vistas exclusivas de SaaS no pueden activarse mediante la URL para usuarios regulares.

## Pruebas agregadas

`Client/test/sessionPolicy.test.ts` cubre siete escenarios:

1. superadministrador global sin `slug`;
2. superadministrador dentro de un tenant mediante `slug`;
3. redirección al negocio activo de una sesión regular;
4. selector visible para admin y worker con varias membresías;
5. selector oculto con una membresía y para superadmin;
6. vista semanal y filtro propio por defecto para worker;
7. rechazo de vistas SaaS para una sesión regular.

El workflow de CI ejecuta estas pruebas antes de `astro check` y del build.

## Verificación local

- `npm run test:context`: 7 pruebas aprobadas.
- `npm run check`: 0 errores, 0 advertencias, 0 sugerencias.
- `npm run build`: 5 páginas generadas correctamente con `PUBLIC_API_URL` de CI.

## Resultado esperado

La separación reduce el acoplamiento, evita conexiones y consultas tenant desde la consola global y permite evolucionar sesión, calendario y sincronización por separado sin alterar el flujo visible aprobado en producción.
