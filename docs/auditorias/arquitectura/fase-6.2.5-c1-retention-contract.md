# 6.2.5-C1 — Contrato compartido de retención de ClientContactVerification

**Estado:** resolución de la deuda de cleanup declarada en 6.2.5-C1, materializada por el cutover de 6.2.5-C2.

Este contrato no cambia qué demuestra una `ClientContactVerification`: sigue demostrando únicamente posesión del bearer bajo `Business + purpose`, y sólo puede interpretarse como control actual del canal cuando hubo trusted delivery exclusiva al `channel/destination` persistido.

## Política compartida

Todas las `ClientContactVerification` son evidencia temporal y usan la misma política física, independientemente de `purpose`:

- `contact-control`;
- `appointment-read-bootstrap`;
- `appointment-cancel-bootstrap`;
- `appointment-reschedule-bootstrap`.

La autoridad lógica termina exactamente cuando:

```text
expiresAt <= now
```

No existe grace period de autoridad. El TTL sólo gobierna cleanup posterior.

La política física común es:

```text
{ expiresAt: 1 }
expireAfterSeconds: 3600
name: client_verification_expiry_retention_ttl
```

Por tanto, una Verification se vuelve elegible para eliminación física una hora después de su `expiresAt`. El índice no usa `partialFilterExpression`, `sparse` ni filtro por purpose; `contact-control` está incluido exactamente igual que los purposes de bootstrap de Appointment.

MongoDB TTL es eventual y no participa en consume/revoke ni extiende la validez lógica.

## Ownership operacional del DDL

C1 originalmente dejó la política de cleanup y la materialización física productiva como deuda deliberada para C2. C2 resuelve esa deuda mediante `migration:guest-appointment-capability-storage`, pero el TTL sobre `ClientContactVerification` es un **contrato compartido C1**, no una política exclusiva de C2.

Por ser storage compartido, el índice TTL sólo se activa después de un preflight global read-only y después de verificar todos los índices estructurales C1/C2. Una migración que falla durante preflight o durante la fase estructural no puede activar un TTL nuevo sobre C1.

## No cambia autoridad

Esta retención no introduce User binding, CustomerProfile ownership, Appointment ownership, Client session, history, claims ni continuidad histórica.

La regla sigue siendo:

```text
current channel control != historical subject continuity
```
