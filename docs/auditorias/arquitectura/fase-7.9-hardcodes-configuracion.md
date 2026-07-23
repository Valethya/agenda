# Fase 7.9 — Reglas de negocio sin hardcodes de tenant

## Objetivo

Eliminar decisiones productivas basadas en correos, slugs o marcas concretas. El slug se conserva exclusivamente como identificador público del negocio.

## Cambios

| Antes | Ahora | Motivo |
| --- | --- | --- |
| El frontend elegía etiquetas y navegación por slug | `BusinessConfig.uiSettings` define etiquetas y módulos | Un negocio nuevo no requiere cambios de código |
| Correos de ejemplo determinaban días libres | Sólo los turnos persistidos determinan disponibilidad | Un correo nunca debe ser una regla de agenda |
| Una lista de slugs simulaba negocios en trial | `Business.subscriptionStatus` expresa `active` o `trial` | El estado comercial debe ser dato de dominio |
| El avatar inventaba dominios desde el slug | Iniciales y gradiente determinista | Evita consultas a dominios inexistentes o ajenos |
| Webpay recibía el slug en la URL de retorno | El backend recupera el negocio desde `Payment.business` | El tenant no depende de una query manipulable |
| Las pantallas de pago asumían `atmosfera` | Usan el slug validado por backend o una ruta neutral | No atribuyen una operación a un tenant incorrecto |

## Compatibilidad

- Los negocios existentes reciben por defecto las etiquetas `Profesional` / `Profesionales` y la navegación completa.
- Los negocios sin `subscriptionStatus` se consideran activos; los inactivos siguen gobernados por `isActive`.
- Un profesional sin turnos configurados se considera no disponible los siete días. Es un cierre seguro y evita inventar horas.
- Los enlaces públicos continúan usando `slug`; sólo se elimina su uso como condición de negocio.

## Verificación

- Pruebas frontend.
- `astro check` y build estático.
- Pruebas unitarias backend.
- Integración completa en CI con `MONGO_TEST_URI` aislada.
- `git diff --check` sobre el conjunto publicado.

## Fuera de alcance

Los scripts de seed, migración y depuración conservan identidades ficticias porque describen datasets explícitos y no participan en decisiones productivas. La identidad visual propia del producto Atmósfera tampoco se considera una regla multitenant.
