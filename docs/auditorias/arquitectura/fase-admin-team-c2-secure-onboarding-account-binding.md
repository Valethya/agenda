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

En particular, `findByEmail(E)` sólo puede localizar internamente un candidato. Nunca constituye prueba de ownership.

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

Business, issuer, role, `isBookable`, purpose y channel no son autoridad aportable por cliente. La creación reutiliza la política C1 y fija server-side:

```text
channel = email
purpose = tenant-onboarding
role = worker
isBookable = false
status = pending
```

La emisión no consulta si existe un `User` global con el email objetivo. Su respuesta es estable y mínima:

```text
accepted
onboardingId
expiresAt
```

No expone `userExists`, candidato, otras Memberships/Businesses ni conflictos de ownership.

## Expiración

C2 fija una única ventana server-side:

```text
TENANT_ONBOARDING_TTL_MS = 15 minutos
```

El `PendingOnboarding.expiresAt` y el challenge nacen con la misma expiración. El challenge nunca puede superar al grant. No existe TTL destructivo que defina validez lógica: tanto grant como challenge se validan mediante `expiresAt > now`.

## Channel proof dedicado

C2 usa almacenamiento específico `TenantOnboardingChallenge`. No amplía `ClientContactVerification` porque sus purposes mergeados pertenecen a:

- `contact-control`;
- bootstrap de lectura/cancelación/reprogramación de Appointment.

Por tanto:

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

La comparación se realiza en tiempo constante. El challenge es single-use y se consume sólo dentro de la misma transacción que fija el account binding.

## Trusted email delivery

C2 reutiliza la infraestructura existente `sendSensitiveMail`. El mensaje sensible contiene sólo identificador de onboarding, challenge de un solo uso y expiración. No contiene password, Membership, credenciales permanentes ni información de otros tenants.

El transporte sensible no registra recipient, body, bearer, URL, provider error ni preview link. Los tests inyectan delivery en memoria; no envían email real.

Si el proveedor no acepta la entrega, C2 no devuelve el bearer y revoca de forma fail-closed el grant/challenge no entregados. No existe resend en esta fase.

## User global existente

Después de una channel proof válida, C2 puede consultar internamente el `User` candidato mediante el email canónico. Si existe, binding requiere además:

```text
User.isActive === true
AND password almacenado es una credencial bcrypt verificable
AND password aportado por claimant valida contra ESE User exacto
AND no existe ya ninguna Membership(User, Business objetivo)
```

No se usa el login tenant ni `resolveSessionFromUser`, porque todavía no existe autoridad en ese Business. No se crea Membership temporal ni se modifica la sesión.

Cuentas cuya forma de autenticación actual no permite demostrar control del User concreto —por ejemplo el sentinel histórico de Google sin password bcrypt— fallan cerrado. Recovery/claim no pertenece a C2.

Una password incorrecta no consume el challenge porque channel proof + exact-account proof + binding forman una sola transición atómica. El endpoint claimant tiene rate limit propio para acotar intentos durante los 15 minutos de vida del challenge.

## Conflicto adversarial de ownership

Caso obligatorio:

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

Control del canal no transfiere propiedad de una cuenta.

## User global nuevo

Si después del channel proof no existe User para el email probado, la propia persona puede usar:

```text
mode = new
firstName
lastName
password elegida por ella
```

C2 crea dentro de la transacción un `User` con:

```text
email = exactamente el email probado
password = bcrypt mediante helper existente
role = user
isActive = true
User.business = ausente
```

No se crea Membership. El admin nunca recibe ni establece la contraseña.

## Carrera de creación de User

La unicidad física de `User.email` es una barrera final de integridad, no proof de ownership.

Si C2 observa ausencia y antes de su insert aparece otro User con ese email:

```text
DuplicateKey/write conflict
-> abortar transacción
-> NO findByEmail fallback
-> NO bind al User aparecido
```

Si C2 gana la carrera, el actor concurrente obtiene el conflicto del índice. En ningún caso se adopta automáticamente la identidad del otro escritor.

## Persistencia del account binding

`PendingOnboarding` incorpora el subdocumento nullable:

```text
accountBinding.user
accountBinding.challenge
accountBinding.boundAt
```

El User se deriva exclusivamente de las proofs del claimant. No existe parámetro HTTP `boundUser`/`userId` para seleccionarlo.

`accountBinding`:

- identifica un único User exacto;
- queda ligado al challenge exacto;
- no contiene password ni bearer;
- no es Membership;
- no es tenant authority;
- no cambia `PendingOnboarding.status` a `consumed`;
- permite a C3 recuperar identidad sin volver a inferir por email.

No existe last-write-wins: el update exige `accountBinding=null`, grant pending y no expirado.

## Atomicidad

La operación claimant-facing:

```text
POST /api/team/onboardings/:onboardingId/bind
```

realiza en una sola transacción Mongo:

```text
validar grant continuable
-> validar challenge exacto + bearer
-> resolver/probar User exacto o crear User nuevo
-> fijar PendingOnboarding.accountBinding si sigue null
-> consumir challenge para ese mismo User
-> commit
```

Un fallo aborta todos los efectos. No puede quedar challenge consumido sin binding ni User nuevo sin el binding correspondiente por un fallo posterior de C2.

`PendingOnboarding.status` permanece `pending`; C3 será la única fase que podrá consumir el grant y crear Membership.

## Rate limits

Ventana común de 15 minutos:

- emisión administrativa: 5 requests/IP;
- binding claimant: 10 requests/IP.

El challenge tiene 256 bits de entropía, expiración y replay protection. No se introduce CAPTCHA ni proveedor externo nuevo.

## Storage y cutover

C2 depende de tres barreras físicas:

1. C1: `pending_onboarding_business_email_pending_unique`;
2. C2: `tenant_onboarding_challenge_pending_unique` sobre `{ pendingOnboarding: 1 }`, `unique:true`;
3. User: `email_1` sobre `{ email: 1 }`, `unique:true`.

El materializador C2:

```text
scripts/migrations/tenant-onboarding-account-binding-storage.js
```

no materializa C1 silenciosamente; primero exige que C1 esté ready. Luego preflighta emails User canónicos/no duplicados y challenges compatibles, materializa sus índices y vuelve a assertar el contrato físico.

El runtime ejecuta `assertTenantOnboardingRuntimeStorageReady()` antes de `listen()`. En staging/production o cualquier runtime detectado como desplegado exige además:

```text
TENANT_ONBOARDING_C2_CUTOVER=TENANT_ONBOARDING_C2_STORAGE_READY
```

Este PR no configura esa variable ni ejecuta el materializador en producción.

## Separación de guest / Appointment

Una proof `contact-control` o Appointment no puede satisfacer el lookup de `TenantOnboardingChallenge`, y un challenge Team no existe en la colección/proyección requerida por `ClientContactVerification`/Appointment capability. Los modelos, purposes, hashes y storage permanecen separados.

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
- login/session tenant artificial;
- providers de auth nuevos;
- cambios de booking, Service, Clientes, pagos o branding;
- cambios Railway/Vercel/producción;
- migraciones o datos productivos.
