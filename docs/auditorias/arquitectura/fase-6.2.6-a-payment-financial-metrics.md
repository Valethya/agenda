# 6.2.6-A — Semántica financiera de Payment

Este addendum documenta únicamente el hardening financiero restante de 6.2.6-A. No amplía el alcance de Payments ni declara cerrada toda 6.2.6.

## Snapshot esperado vs monto autorizado

`Payment.amount` conserva el monto esperado de la transacción local que originó el Payment. Es evidencia del snapshot económico original y no se sobrescribe por cambios posteriores de `Service.price` o `Service.depositAmount`, ni por el monto que finalmente reporte el gateway.

`Payment.authorizedAmount`, cuando existe, conserva por separado el monto que Webpay reportó como efectivamente autorizado.

Por tanto, un caso de reconciliación puede preservar simultáneamente:

```text
Payment.amount = 5000
Payment.authorizedAmount = 7000
Payment.status = approved
Payment.reconciliationStatus = required
Payment.reconciliationReason = amount_mismatch
```

La reconciliación requerida no destruye ni reemplaza ninguno de los dos valores.

## Métricas financieras

Las métricas financieras de Payments `approved` usan como monto económico efectivo:

```text
authorizedAmount ?? amount
```

Esto mantiene compatibilidad con Payments legacy que no tienen `authorizedAmount` y refleja el monto realmente autorizado cuando ese snapshot externo sí existe.

Ejemplos contractuales:

```text
approved legacy:
amount = 4000
authorizedAmount ausente
=> métricas = 4000

approved normal:
amount = 5000
authorizedAmount = 5000
=> métricas = 5000

approved con amount mismatch:
amount = 5000
authorizedAmount = 7000
=> métricas = 7000
```

`totalRevenue` y `averageTicket` usan ese monto efectivo; `totalTransactions` conserva su significado actual y cuenta Payments aprobados. El filtro por `Business` continúa aplicándose antes de la agregación, por lo que un Payment de otro tenant no entra en las métricas del Business consultado.

Este cambio no implementa refund workflow, payment capability, un nuevo inicio de pago ni un rediseño amplio de reconciliación financiera.
