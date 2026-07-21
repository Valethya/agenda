# Selector de tenant para superadministrador

## Objetivo

Evitar que una sesión de `superadmin` sin tenant explícito intente cargar endpoints del calendario y termine mostrando un error genérico. La entrada global debe permitir elegir un negocio sin alterar la identidad de la sesión.

## Decisión

- `/admin` y `/admin?view=saas-negocios` abren la lista global de negocios cuando la sesión pertenece a un `superadmin` y no existe `slug`.
- Mientras no exista `slug`, `CalendarContext` no consulta configuración, profesionales, citas ni turnos de un tenant.
- «Abrir panel» navega a `/admin?slug=<slug>` y conserva la identidad de `superadmin`.
- «Impersonar» continúa siendo una acción separada: llama al endpoint de impersonación y cambia temporalmente la sesión.
- Volver a «Negocios SaaS» elimina el `slug` de la URL para abandonar de forma explícita el contexto del negocio anterior.
- Los negocios inactivos no pueden abrirse ni impersonarse.

## Matriz de comportamiento

| Entrada o acción | Contexto resultante | ¿Cambia la sesión? | ¿Carga endpoints tenant? |
| --- | --- | --- | --- |
| `superadmin` abre `/admin` | Selector global | No | No |
| «Abrir panel» | Tenant indicado por `slug` | No | Sí |
| «Impersonar» | Tenant y usuario impersonado | Sí | Sí |
| «Negocios SaaS» | Selector global sin `slug` | No | No |

## Motivo de seguridad

La selección de tenant y la impersonación tienen propósitos distintos. El selector aporta contexto explícito a las solicitudes multitenant; la impersonación permite reproducir permisos y experiencia de otro usuario. Mantener ambas acciones separadas reduce cambios de sesión accidentales y hace auditable la intención del operador.

## Verificación esperada

1. Iniciar sesión como `superadmin` sin negocio asociado.
2. Confirmar que la entrada muestra «Negocios registrados» y no el error de carga del panel.
3. Abrir un negocio activo y comprobar que la URL incluye su `slug` y que el calendario carga.
4. Volver a «Negocios SaaS» y comprobar que la URL ya no contiene `slug`.
5. Confirmar que «Impersonar» conserva su banner y su flujo de finalización independiente.
