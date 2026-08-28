# C2 — Secure onboarding account binding

**Proyecto:** ATMÓSFERA Agenda  
**Fase:** C2 — Secure onboarding account binding  
**Baseline:** `master@3f81718a6be2e2646ca6100e5214193446dd6049`  
**Contrato padre:** `fase-admin-team-bookability-contract.md` + C1 pending onboarding storage

## Secuencia canónica

```text
C1 PendingOnboarding grant
-> C2 channel proof + exact account binding
-> C3 atomic consume + Membership
-> D2 Añadir persona UI
```

C2 termina únicamente cuando el servidor puede afirmar qué `User` global exacto controla el claimant que completó el onboarding. Ese binding no es una `Membership`, no concede autoridad tenant y no crea una sesión tenant.

Las fronteras siguen siendo distintas:

```text
admin escribió email E
!= claimant controla actualmente email E
!= claimant controla User U
!= Membership(U, Business)
```

`findByEmail(E)` sólo localiza internamente un candidato. Nunca constituye proof de ownership.

## Inicio administrativo

La superficie C2 es:

```text
POST /api/team/onboardings
```

Pasa por:

```text
scopeBusiness
-> isAuthenticated
-> isAdmin
-> rate limit
-> body allowlist
```

El Business se toma del contexto tenant autenticado y el issuer de la identidad revalidada. El body admite exclusivamente:

```json
{ "email": "persona@example.com" }
```

Business, issuer, role, `isBookable`, purpose y channel no son autoridad aportable por cliente. La creación fija server-side:

```text
channel = email
purpose = tenant-onboarding
role = worker
isBookable = false
status = pending
```

La emisión no consulta si existe un `User` global con el email objetivo y responde sólo con `accepted`, `onboardingId` y `expiresAt`.

## Expiración y reemisión

C2 fija una ventana server-side de 15 minutos:

```text
TENANT_ONBOARDING_TTL_MS = 15 * 60 * 1000
```

`PendingOnboarding.expiresAt` y el challenge nacen con la misma expiración. La validez lógica exige `expiresAt > now`.

El índice C1 sigue siendo:

```text
{ business: 1, email: 1 }
unique=true
partialFilterExpression={ status: "pending" }
```

Por ello un `pending` expirado debe salir del conjunto parcial antes de crear una intención nueva. La emisión C2 realiza dentro de la misma transacción:

```text
buscar exclusivamente Business + email canónico
AND status=pending
AND expiresAt<=now
-> status=revoked
-> revocar su challenge sólo si éste continúa status=pending
-> crear un PendingOnboarding nuevo independiente
```

No se agrega estado `expired`. No se modifica un grant `pending` todavía vigente, `consumed`, `revoked`, de otro Business ni de otro email. Si el grant expirado ya tenía `accountBinding`, éste se conserva como historial; sólo cambia su status a `revoked`. Un challenge ya `consumed` también se conserva como evidencia histórica.

Dos reemisiones concurrentes siguen teniendo el índice físico C1 como barrera final: como máximo una transacción puede dejar un nuevo grant `pending` para el mismo Business+email.

No existe resend/rotation del mismo grant.

## Channel proof dedicado

C2 usa `TenantOnboardingChallenge`, separado de `ClientContactVerification` y Appointment capabilities:

```text
ClientContactVerification/contact-control
!= TenantOnboardingChallenge/tenant-onboarding
!= Appointment capability
```

El challenge liga exactamente:

```text
PendingOnboarding
+ Business
+ channel=email
+ destination=email canónico
+ purpose=tenant-onboarding
+ expiresAt
```

Se genera un secreto de 32 bytes criptográficamente aleatorios (`base64url`, 256 bits). El raw bearer nunca se persiste. Sólo se almacena un SHA-256 derivado sobre:

```text
PendingOnboarding id
+ Business id
+ channel
+ destination
+ purpose
+ secret
```

La comparación usa `timingSafeEqual`. El challenge es single-use.

## Trusted delivery: confirmación antes de autoridad

C2 reutiliza `sendSensitiveMail`. Los tests inyectan delivery y nunca envían emails reales.

La creación del challenge y la aceptación del proveedor son dos momentos distintos. Un challenge recién creado tiene:

```text
status = pending
deliveredAt = null
```

**`status=pending` por sí solo no lo hace bindable.** El lookup claimant exige además:

```text
deliveredAt != null
```

La secuencia es:

```text
transaction: crear grant + challenge no confirmado
commit
-> trusted sensitive delivery
-> sólo si provider confirma success:
   update server-side exacto deliveredAt=now
-> recién entonces el bearer entra al conjunto bindable
```

Si provider falla, lanza error o el resultado es ambiguo, C2 no ejecuta activación. Si delivery fue aceptado pero la activación no se confirma, el endpoint también falla y el bearer permanece fuera del contrato de binding.

El cleanup que intenta revocar challenge/grant sigue existiendo para dejar un estado terminal cuando sea posible, pero **no es la barrera de seguridad**. Incluso si ese cleanup falla, `deliveredAt=null` mantiene el bearer no utilizable.

La activación nunca amplía `expiresAt`: challenge y grant conservan la expiración original.

## User global existente

Después de una channel proof válida, C2 puede consultar internamente el `User` candidato mediante el email canónico. Si existe, binding requiere además:

```text
User.isActive === true
AND password almacenado es bcrypt verificable
AND password aportado valida contra ESE User exacto
AND no existe Membership(User, Business objetivo)
```

No se usa login tenant ni `resolveSessionFromUser`. Cuentas sin proof segura del User concreto —incluido el sentinel histórico OAuth— fallan cerrado. Recovery/claim queda fuera de alcance.

## Presupuesto de exact-account proof

El rate limit por IP se conserva, pero no es la única defensa contra password guessing.

Cada `TenantOnboardingChallenge` mantiene server-side:

```text
accountProofAttempts
TENANT_ONBOARDING_ACCOUNT_PROOF_MAX_ATTEMPTS = 5
```

Después de comprobar primero el bearer correcto, C2 reserva un intento mediante un único update atómico:

```text
status=pending
AND deliveredAt!=null
AND expiresAt>now
AND accountProofAttempts<5
-> $inc accountProofAttempts
```

La reserva ocurre **fuera y antes** de la transacción de password/binding. Por ello una contraseña incorrecta no puede revertir el contador al abortar la transacción posterior.

Consecuencias:

- cambiar IP no reinicia el presupuesto lógico;
- dos o más intentos concurrentes no pueden superar cinco reservas;
- al llegar a cinco, no se ejecutan nuevas verificaciones de password;
- una contraseña correcta antes del límite todavía puede completar binding;
- un secret incorrecto falla antes del `$inc`, por lo que no permite agotar trivialmente el presupuesto sin demostrar primero channel proof.

Los errores externos permanecen genéricos y no exponen el contador ni existencia de User.

## Conflicto adversarial de ownership

```text
atacante controla User U con victim@example.com
admin emite onboarding a victim@example.com
víctima controla el buzón
víctima NO controla credenciales de U
```

Resultado:

```text
NO account binding
NO password overwrite
NO segundo User
NO Membership
```

Channel control no transfiere propiedad de una cuenta.

## User global nuevo

Si no existe User para el email probado, la propia persona puede aportar:

```text
mode = new
firstName
lastName
password elegida por ella
```

C2 crea dentro de la transacción un `User` con:

```text
email = email probado
password = bcrypt mediante helper existente
role = user
isActive = true
User.business = ausente
```

No se crea Membership. El admin nunca recibe ni establece la contraseña.

## Carrera de creación de User

La unicidad física de `User.email` es barrera de integridad, no proof de ownership.

```text
no User observado
-> aparece otro User concurrente
-> DuplicateKey/write conflict
-> abortar
-> NO findByEmail fallback
-> NO bind automático
```

## Persistencia del account binding

`PendingOnboarding` incorpora:

```text
accountBinding.user
accountBinding.challenge
accountBinding.boundAt
```

No existe parámetro HTTP `boundUser`/`userId` para elegirlo. El binding no contiene password/bearer, no es Membership, no es tenant authority y no cambia `PendingOnboarding.status` a `consumed`.

## Atomicidad claimant

`POST /api/team/onboardings/:onboardingId/bind` ejecuta:

```text
validar grant continuable
-> seleccionar challenge delivered + exacto
-> comprobar bearer
-> reservar persistentemente un account-proof attempt
-> transaction:
   revalidar grant + challenge
   probar User exacto o crear User nuevo
   fijar accountBinding si sigue null
   consumir challenge para ese mismo User
   commit
```

El contador de intentos queda deliberadamente fuera de la transacción para sobrevivir a fallos de password. La creación de User, binding y consume del challenge permanecen dentro de una única transacción.

`PendingOnboarding.status` permanece `pending`; C3 será la única fase que podrá consumirlo y crear Membership.

## Rate limits

Ventana de 15 minutos:

- emisión administrativa: 5 requests/IP;
- binding claimant: 10 requests/IP;
- exact-account proof: máximo persistente de 5 intentos por challenge, independiente de IP.

No se agrega CAPTCHA ni infraestructura externa.

## Storage y cutover

C2 depende de:

1. C1: `pending_onboarding_business_email_pending_unique`;
2. C2: `tenant_onboarding_challenge_pending_unique` sobre `{ pendingOnboarding: 1 }`, `unique:true`;
3. User: `email_1` sobre `{ email: 1 }`, `unique:true`.

El materializador `scripts/migrations/tenant-onboarding-account-binding-storage.js` no materializa C1 silenciosamente; exige C1 ready, preflighta datos e índices y materializa sólo el storage C2 requerido.

El runtime ejecuta `assertTenantOnboardingRuntimeStorageReady()` antes de `listen()`. Runtimes remotos exigen además:

```text
TENANT_ONBOARDING_C2_CUTOVER=TENANT_ONBOARDING_C2_STORAGE_READY
```

Este PR no configura esa variable ni ejecuta materialización en producción.

## Fuera de alcance preservado

C2 no implementa:

- creación, actualización o reactivación de Membership;
- onboarding de nuevos admins;
- C3 consume del PendingOnboarding;
- D2 UI «Añadir persona»;
- account recovery/claim;
- merge/transferencia de identidad;
- password reset nuevo;
- reactivación de User;
- sesión tenant artificial;
- auth providers nuevos;
- cambios de booking, Service, Clientes, pagos o branding;
- cambios Railway/Vercel/producción;
- migraciones o datos productivos.
