// Opt-in aislado para conservar la suite legacy de Payment sin habilitar
// Payment/Webpay por defecto en el runtime MVP.
process.env.ENABLE_PAYMENTS = "true";
await import("./auditPayment.test.js");
