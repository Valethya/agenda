import "./setup.js";

process.env.ENABLE_PAYMENTS = "true";
await import("./auditPayment.test.js");
