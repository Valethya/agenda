import './setup.js';
process.env.ENABLE_PAYMENTS = "true";

import test from "node:test";
import assert from "node:assert/strict";
import pkg from "transbank-sdk";
import { connectDB } from "../src/db/db.js";
import { seedTestData, cleanTestData, teardown } from "./fixtures.js";
import Appointment from "../src/db/models/appointment.model.js";
import Payment from "../src/db/models/payment.model.js";

const { WebpayPlus } = pkg;

const gatewayState = {
  buyOrder: null,
  amount: 5000,
  status: "AUTHORIZED",
  responseCode: 0,
  authorizationCode: "AUTH-LEGACY",
  commitCount: 0,
  throwMessage: null,
};

WebpayPlus.Transaction.prototype.commit = async function () {
  gatewayState.commitCount += 1;
  if (gatewayState.throwMessage) {
    throw new Error(gatewayState.throwMessage);
  }
  return {
    status: gatewayState.status,
    response_code: gatewayState.responseCode,
    buy_order: gatewayState.buyOrder,
    amount: gatewayState.amount,
    authorization_code: gatewayState.authorizationCode,
  };
};

// ENABLE_PAYMENTS debe existir antes de evaluar config/env.js y routes/index.js.
const { default: app, sessionStore } = await import("../src/app.js");

await connectDB();
await cleanTestData();
const seed = await seedTestData();
const server = app.listen(0);
const { port } = server.address();
const baseUrl = `http://localhost:${port}/api`;

const createLegacyPending = async ({
  token,
  paymentBusiness = seed.business._id,
  startTime = "09:00",
  paymentAmount = 5000,
  paymentType = "deposit",
}) => {
  const hour = Number(startTime.slice(0, 2));
  const endTime = `${String(hour + 1).padStart(2, "0")}:00`;
  const appointment = await Appointment.create({
    client: seed.client._id,
    worker: seed.worker._id,
    service: seed.service._id,
    business: seed.business._id,
    date: new Date("2099-02-02T00:00:00.000Z"),
    startTime,
    endTime,
    status: "pending_payment",
    paymentStatus: "unpaid",
  });

  const payment = await Payment.create({
    appointment: appointment._id,
    business: paymentBusiness,
    amount: paymentAmount,
    currency: "CLP",
    gateway: "webpay",
    transactionId: token,
    status: "pending",
    type: paymentType,
  });

  gatewayState.buyOrder = appointment._id.toString();
  gatewayState.amount = paymentAmount;
  gatewayState.status = "AUTHORIZED";
  gatewayState.responseCode = 0;
  gatewayState.authorizationCode = "AUTH-LEGACY";
  gatewayState.commitCount = 0;
  gatewayState.throwMessage = null;

  return { appointment, payment };
};

const callReturn = (token) => fetch(`${baseUrl}/payments/webpay-return?token_ws=${encodeURIComponent(token)}`, {
  method: "POST",
  redirect: "manual",
});

test("Payment legacy callback preservado sin reabrir payment authority", async (t) => {
  await t.test("callback autorizado confirma Appointment y aprueba Payment del mismo Business", async () => {
    const { appointment } = await createLegacyPending({ token: "legacy-approved" });
    const response = await callReturn("legacy-approved");
    assert.equal(response.status, 302);
    assert.match(response.headers.get("location") || "", /payment-success/);
    assert.equal(gatewayState.commitCount, 1);

    const [storedAppointment, storedPayment] = await Promise.all([
      Appointment.findById(appointment._id),
      Payment.findOne({ transactionId: "legacy-approved" }),
    ]);
    assert.equal(storedAppointment.status, "confirmed");
    assert.equal(storedAppointment.paymentStatus, "partially_paid");
    assert.equal(storedPayment.status, "approved");
    assert.equal(storedPayment.business.toString(), seed.business._id.toString());
    assert.equal(storedPayment.amount, 5000);
    assert.equal(storedPayment.authorizedAmount, 5000);
    assert.equal(storedPayment.reconciliationStatus, "applied");
  });

  await t.test("callback rechazado cancela Appointment y marca Payment rejected", async () => {
    const { appointment } = await createLegacyPending({ token: "legacy-rejected", startTime: "10:00" });
    gatewayState.status = "FAILED";
    gatewayState.responseCode = -1;

    const response = await callReturn("legacy-rejected");
    assert.equal(response.status, 302);
    assert.match(response.headers.get("location") || "", /payment-failed/);
    assert.equal(gatewayState.commitCount, 1);

    const [storedAppointment, storedPayment] = await Promise.all([
      Appointment.findById(appointment._id),
      Payment.findOne({ transactionId: "legacy-rejected" }),
    ]);
    assert.equal(storedAppointment.status, "cancelled");
    assert.equal(storedPayment.status, "rejected");
  });

  await t.test("Payment y Appointment de Businesses distintos fallan antes del commit externo", async () => {
    const { appointment } = await createLegacyPending({
      token: "legacy-cross-business",
      paymentBusiness: seed.businessB._id,
      startTime: "11:00",
    });

    const response = await callReturn("legacy-cross-business");
    assert.equal(response.status, 302);
    assert.match(response.headers.get("location") || "", /payment-failed/);
    assert.equal(gatewayState.commitCount, 0);

    const [storedAppointment, storedPayment] = await Promise.all([
      Appointment.findById(appointment._id),
      Payment.findOne({ transactionId: "legacy-cross-business" }),
    ]);
    assert.equal(storedAppointment.status, "pending_payment");
    assert.equal(storedAppointment.paymentStatus, "unpaid");
    assert.equal(storedPayment.status, "pending");
  });

  await t.test("buy_order distinto al Payment pending falla cerrado después del único commit esperado", async () => {
    const { appointment } = await createLegacyPending({ token: "legacy-buy-order", startTime: "12:00" });
    gatewayState.buyOrder = seed.businessB._id.toString();

    const response = await callReturn("legacy-buy-order");
    assert.equal(response.status, 302);
    assert.match(response.headers.get("location") || "", /payment-failed/);
    assert.equal(gatewayState.commitCount, 1);

    const [storedAppointment, storedPayment] = await Promise.all([
      Appointment.findById(appointment._id),
      Payment.findOne({ transactionId: "legacy-buy-order" }),
    ]);
    assert.equal(storedAppointment.status, "pending_payment");
    assert.equal(storedPayment.status, "pending");
  });

  await t.test("Service mutable no redefine el amount/type del Payment pending", async () => {
    const { appointment } = await createLegacyPending({
      token: "legacy-payment-snapshot",
      startTime: "13:00",
      paymentAmount: 5000,
      paymentType: "deposit",
    });

    seed.service.depositAmount = 6000;
    await seed.service.save();

    gatewayState.amount = 5000;
    const response = await callReturn("legacy-payment-snapshot");

    seed.service.depositAmount = 5000;
    await seed.service.save();

    assert.equal(response.status, 302);
    assert.match(response.headers.get("location") || "", /payment-success/);

    const [storedAppointment, storedPayment] = await Promise.all([
      Appointment.findById(appointment._id),
      Payment.findOne({ transactionId: "legacy-payment-snapshot" }),
    ]);
    assert.equal(storedAppointment.status, "confirmed");
    assert.equal(storedAppointment.paymentStatus, "partially_paid");
    assert.equal(storedPayment.status, "approved");
    assert.equal(storedPayment.amount, 5000);
    assert.equal(storedPayment.type, "deposit");
    assert.equal(storedPayment.authorizedAmount, 5000);
    assert.equal(storedPayment.reconciliationStatus, "applied");
    assert.equal(storedPayment.reconciliationReason, undefined);
  });

  await t.test("AUTHORIZED amount mismatch registra reconciliación sin activar Appointment", async () => {
    const { appointment } = await createLegacyPending({
      token: "legacy-amount-mismatch",
      startTime: "14:00",
      paymentAmount: 5000,
    });
    gatewayState.amount = 7000;

    const response = await callReturn("legacy-amount-mismatch");
    assert.equal(response.status, 302);
    const location = new URL(response.headers.get("location"));
    assert.equal(location.pathname, "/payment-failed");
    assert.equal(location.searchParams.get("reason"), "payment_authorized_reconciliation_required");
    assert.equal(location.searchParams.get("paymentAuthorized"), "true");

    const [storedAppointment, storedPayment] = await Promise.all([
      Appointment.findById(appointment._id),
      Payment.findOne({ transactionId: "legacy-amount-mismatch" }),
    ]);
    assert.equal(storedAppointment.status, "pending_payment");
    assert.equal(storedAppointment.paymentStatus, "unpaid");
    assert.equal(storedPayment.status, "approved");
    assert.equal(storedPayment.amount, 5000);
    assert.equal(storedPayment.authorizedAmount, 7000);
    assert.equal(storedPayment.type, "deposit");
    assert.equal(storedPayment.reconciliationStatus, "required");
    assert.equal(storedPayment.reconciliationReason, "amount_mismatch");
    assert.ok(storedPayment.authorizedAt instanceof Date);
  });

  await t.test("redirect técnico usa reason estable y nunca filtra error.message", async () => {
    const sensitiveText = "sensitive-provider-secret-should-never-leak";
    const { appointment } = await createLegacyPending({
      token: "legacy-sensitive-error",
      startTime: "15:00",
    });
    gatewayState.throwMessage = sensitiveText;

    const response = await callReturn("legacy-sensitive-error");
    assert.equal(response.status, 302);
    const locationRaw = response.headers.get("location") || "";
    const location = new URL(locationRaw);
    assert.equal(location.pathname, "/payment-failed");
    assert.equal(location.searchParams.get("reason"), "server_error");
    assert.equal(location.searchParams.has("message"), false);
    assert.equal(locationRaw.includes(sensitiveText), false);
    assert.equal(decodeURIComponent(locationRaw).includes(sensitiveText), false);

    const [storedAppointment, storedPayment] = await Promise.all([
      Appointment.findById(appointment._id),
      Payment.findOne({ transactionId: "legacy-sensitive-error" }),
    ]);
    assert.equal(storedAppointment.status, "pending_payment");
    assert.equal(storedPayment.status, "pending");
    gatewayState.throwMessage = null;
  });
});

test.after(async () => {
  await teardown(server, sessionStore);
});
