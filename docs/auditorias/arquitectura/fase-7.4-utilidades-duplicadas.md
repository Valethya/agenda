# Fase 7.4 — Extracción de utilidades duplicadas

## Objetivo

Eliminar duplicaciones verificadas del frontend sin convertir reglas específicas de una pantalla en abstracciones globales. La extracción se limita a contratos puros, reutilizables y comprobables de calendario, tiempo e identidad visual.

## Inventario y decisión

| Familia | Duplicación encontrada | Decisión |
| --- | --- | --- |
| Límites semanales | Cálculo lunes-domingo repetido en `Topbar`, `CalendarWeekView` y `ProfessionalScheduleCard` | Centralizar en `utils/calendarDate.ts` |
| Horas y duración | Conversión `HH:mm` y cálculo de spans repetidos en vistas diaria/semanal y tarjeta de horarios | Centralizar en `utils/time.ts` |
| Avatares de personas | Misma paleta e iniciales repetidas en la vista diaria y tarjeta de horarios | Centralizar en `utils/avatar.ts` |
| Avatares de negocios | Misma paleta base, hash e iniciales significativas encapsulados dentro de `BusinessAvatar` | Reutilizar `utils/avatar.ts`, conservando la quinta variante exclusiva para negocios |

No se extrajeron formatos de títulos, fechas o reglas de negocio usados por una única pantalla. Mantenerlos cerca de su consumidor evita una API genérica artificial.

## Cambios realizados

- `calendarDate.ts` define inicio, fin y días de una semana con lunes como primer día.
- `time.ts` expone conversión a minutos, normalización respecto del inicio visual del calendario y cálculo de spans.
- `avatar.ts` conserva paletas separadas para personas y negocios, y centraliza sus reglas de iniciales.
- Cinco consumidores dejaron de mantener implementaciones locales: `Topbar`, `CalendarWeekView`, `CalendarDayView`, `ProfessionalScheduleCard` y `BusinessAvatar`.
- El límite semanal incluye el domingo completo hasta `23:59:59.999`.
- Las duraciones visuales soportan rangos que cruzan medianoche.

## Contratos cubiertos por pruebas

- semana que cruza de año;
- domingo como último día de semana;
- conversión de horas y posicionamiento relativo;
- duraciones regulares y nocturnas;
- iniciales y selección estable de gradientes para personas y negocios.

## Verificación

- `npm run test:frontend`: 19 pruebas aprobadas, 0 fallidas;
- `npm run check`: 0 errores, 0 advertencias y 0 sugerencias;
- `npm run build`: 5 páginas generadas correctamente;
- `git diff --check`: sin errores de whitespace en el alcance de la fase.

## Fuera de alcance

- unificación estructural de `CalendarDayView` y `CalendarWeekView`, reservada para la fase 7.6;
- eliminación de fallbacks de datos heredados;
- cambios visuales o funcionales en navegación, impersonación o selección de negocio;
- refactor de formatos exclusivos de una pantalla.
