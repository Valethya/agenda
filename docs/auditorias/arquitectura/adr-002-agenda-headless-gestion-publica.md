# ADR-002 — Agenda headless y gestión pública de citas

**Estado:** Aprobado
**Fecha:** 21 de julio de 2026
**Ámbito:** API pública, experiencia de reserva y enlaces operativos

## Contexto

ATMÓSFERA construye webs cuya reserva debe sentirse como parte natural de la experiencia del negocio. Una agenda visual única o embebida limitaría la personalización, añadiría cambios de contexto y dificultaría recorridos como un formulario de contacto con progressive disclosure.

La lógica de disponibilidad, citas, pagos y comunicaciones sí debe permanecer centralizada para evitar implementaciones incompatibles. Además, el MVP necesita permitir confirmar, cancelar o reagendar desde un correo sin obligar al cliente a iniciar sesión.

## Decisión

### Contrato headless

ATMÓSFERA Agenda será infraestructura de reservas headless:

- la API será responsable de servicios, profesionales, disponibilidad, citas, pagos, reglas y comunicaciones;
- la web del negocio será responsable de presentación, orden de pasos, contenido y composición visual;
- ninguna regla de dominio dependerá de la estructura particular de un formulario consumidor;
- todas las operaciones públicas identificarán de forma explícita un negocio válido.

La primera versión del contrato se limitará a los recorridos necesarios para el MVP. Ampliar la API para terceros será compatible con estos contratos, pero no forma parte de esta implementación inicial.

### URLs del negocio

Cada negocio podrá configurar:

- `websiteUrl`, como origen público principal;
- `bookingUrl`, como destino del flujo de reserva o reprogramación.

Ambas deberán usar HTTPS en producción y pertenecer a dominios previamente verificados. Los enlaces se construirán desde configuración persistida; una URL enviada por el navegador nunca determinará el destino de un correo.

### Gestión sin login

Los correos operativos podrán contener enlaces para confirmar, cancelar o reagendar. Cada acción utilizará una credencial:

- aleatoria y no derivada del ID de la cita;
- almacenada sólo como hash;
- asociada a una cita, negocio y acción;
- expirable, revocable y sometida a una política de uso o rotación;
- redactada de logs, eventos y analítica.

La web del negocio canjeará la credencial por el contexto mínimo necesario. Los endpoints de confirmación, cancelación y reprogramación permanecerán separados para no ampliar accidentalmente el alcance autorizado.

### Reprogramación

Abrir el enlace no modificará la cita. Mientras el cliente explora disponibilidad se conservará el horario original. Al confirmar:

1. se volverá a validar el nuevo horario;
2. se reservará el nuevo cupo;
3. se actualizará la cita;
4. se liberará el horario anterior;
5. se registrará la transición y se enviará una nueva confirmación.

Los pasos se ejecutarán mediante una transacción de MongoDB o una máquina de estados recuperable e idempotente.

## Invariantes de seguridad y operación

1. Cada solicitud pública posee un negocio explícito; nunca existe fallback al primer negocio.
2. Un recurso de otro tenant se considera inaccesible aunque su ID sea válido.
3. Una credencial sólo autoriza la cita, negocio y acción indicados.
4. Los endpoints públicos aplican rate limiting e idempotencia.
5. La credencial reutilizable no aparece en logs, analítica ni encabezados `Referer`.
6. Se aplica `Referrer-Policy: no-referrer` y se evitan recursos de terceros antes del canje.
7. La respuesta de contexto entrega únicamente datos necesarios para representar la acción.
8. Fallar durante una reprogramación no puede perder el horario original ni ocupar dos horarios definitivamente.

## Contrato mínimo del MVP

- consultar servicios públicos del negocio;
- consultar profesionales públicos del negocio;
- consultar disponibilidad;
- crear una cita invitada;
- obtener contexto limitado mediante una credencial de acción;
- confirmar, cancelar o reagendar mediante operaciones separadas;
- consultar el resultado mínimo de una operación autorizada.

Versionado público general, claves para integradores externos y un portal de desarrolladores quedan fuera del MVP.

## Consecuencias

### Positivas

- Cada web conserva su identidad y puede diseñar un recorrido propio.
- El dominio de reservas permanece consistente y reutilizable.
- Reagendar no obliga a construir una agenda visual genérica de ATMÓSFERA.
- El mismo núcleo podrá servir en el futuro a webs de terceros.

### Costes y riesgos

- Los contratos y códigos de error deben mantenerse compatibles.
- CORS, CSRF, cookies y dominios requieren una decisión de despliegue explícita.
- Cada web consumidora debe implementar correctamente estados de carga, error y concurrencia.
- Los tokens en URLs exigen protección adicional frente a filtraciones indirectas.

## Alternativas descartadas

- **Agenda visual única de ATMÓSFERA:** rompe continuidad de marca y limita recorridos personalizados.
- **Iframe embebido:** dificulta integración visual, navegación, accesibilidad y comunicación entre contextos.
- **Lógica de reservas implementada en cada web:** duplica reglas críticas y produce comportamientos incompatibles.
- **ID de cita como credencial:** carece de secreto, alcance y revocación adecuados.

## Verificación requerida

- Dos interfaces visualmente distintas reservan mediante el mismo contrato.
- Negocio inexistente, slug inválido y recurso de otro tenant se rechazan de forma determinista.
- Credencial alterada, vencida, revocada o usada para otra acción se rechaza.
- Abrir un enlace de reprogramación no cambia ni libera el horario original.
- Dos confirmaciones concurrentes no duplican reservas.
- Fallo intermedio recupera un estado consistente.
- Logs y analítica no contienen credenciales reutilizables.

## Decisiones pendientes relacionadas

- Topología definitiva de dominios de frontend y backend.
- Estrategia CSRF y política exacta de cookies.
- Duración, uso único y rotación por tipo de acción.
- Política de compatibilidad y versionado cuando se abra la API a terceros.
