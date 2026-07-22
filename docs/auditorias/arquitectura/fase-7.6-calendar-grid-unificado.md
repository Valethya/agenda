# Fase 7.6 — Lógica compartida de calendario diario y semanal

## Estado previo

`CalendarDayView` y `CalendarWeekView` repetían la mayor parte de la construcción de la cuadrícula: horas, filtrado de citas, días libres, descansos, duración de tarjetas y línea de hora actual. La única diferencia esencial era el eje de columnas:

- la vista diaria distribuye profesionales para una fecha;
- la vista semanal distribuye siete fechas para un profesional.

La fase 7.5 no requirió un cambio adicional: la paleta y las iniciales de avatares ya fueron centralizadas en `utils/avatar.ts`, migradas y probadas durante la fase 7.4 mediante el PR #11.

## Decisión

No se fusionan ambas pantallas en un componente monolítico. Se conserva en cada vista su encabezado y composición, y se comparte el modelo normalizado de columnas y las capas repetidas.

### Modelo común

Cada columna contiene:

- una clave estable;
- una fecha;
- un profesional opcional;
- el identificador opcional del profesional.

Esto permite expresar ambos modos con las mismas reglas sin condicionales de presentación repartidos por la interfaz.

### Capas compartidas

- `calendarGridRules.ts`: columnas, filtrado de citas, resolución de turnos, solapamientos y línea temporal.
- `useCalendarTimeline.ts`: actualización controlada de la hora actual.
- `CalendarGridLayers.tsx`: celdas horarias, días libres, descansos, citas y línea temporal.

## Invariantes conservadas

- La vista diaria sigue mostrando profesionales como columnas.
- La vista semanal sigue mostrando lunes a domingo.
- Sin profesional seleccionado, la semana mantiene visibles las citas de todos.
- Con profesional seleccionado, citas, descansos y días libres quedan acotados a esa persona.
- El alto de cada fila permanece en 52 px.
- Los solapamientos horizontales continúan aplicándose en la vista semanal.
- Los encabezados y estilos CSS existentes no se reemplazan.

## Pruebas

Se cubren:

1. columnas diarias por profesional;
2. columnas semanales lunes-domingo;
3. filtrado simultáneo por fecha y profesional;
4. días libres y descansos;
5. distribución de citas solapadas;
6. visibilidad de la línea de hora actual.

## Verificación

- `npm run test:frontend`: 24 pruebas aprobadas, 0 fallidas;
- `npm run check`: 0 errores, 0 advertencias y 0 sugerencias;
- `npm run build`: 5 páginas generadas correctamente;
- `git diff --check`: sin errores de whitespace en el alcance de la fase.

## Fuera de alcance

- cambios de diseño o responsive;
- reglas hardcodeadas de disponibilidad;
- SVG de navegación;
- cambios en creación, edición o estados de citas.
