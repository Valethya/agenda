import './setup.js';
process.env.ENABLE_PAYMENTS = "true";

import test from "node:test";
import assert from "node:assert/strict";
import pkg from "transbank-sdk";
import { connectDB } from "../src/db/db.js";
import { seedTestData, cleanTestData, teardown } from "./fixtures.js";
import Appointment from "../src/db/models/appointment.model.js";
import Payment from "../src/db/models/payment.model.js";
import Service from "../src/db/models/service.model.js";

const { WebpayPlus } = pkg;

const gatewayState = {
  buyOrder: null,
  amount: 5000,
  authorizationCode: "AUTH-RACE",
  commitCount: 0,
  blockCommit: false,
  commitStarted: null,
  releaseCommit: null,
};

WebpayPlus.Transaction.prototype.commit = async function () {
  gatewayState.commitCount += 1;
  gatewayState.commitStarted?.();
  if (gatewayState.blockCommit && gatewayState.releaseCommit) {
    await gatewayState.releaseCommit;
  }
  return {
    status: "AUTHORIZED",
    response_code: 0,
    buy_order: gatewayState.buyOrder,
    amount: gatewayState.amount,
    authorization_code: gatewayState.authorizationCode,
  };
};

const { default: app, sessionStore } = await import("../src/app.js");

await connectDB();
await cleanTestData();
const seed = await seedTestData();

const service120 = await Service.create({
  name: "Webpay race 120",
  description: "Servicio para carrera cancel/rebook",
  duration: 120,
  price: 20000,
  depositAmount: 5000,
  business: seed.business._id,
  workers: [seed.worker._id],
  isActive: true,
});

const server = app.listen(0);
const { port } = server.address();
const baseUrl = `http://localhost:${port}/api`;

const loginAdmin = async () => {
  const response = await fetch(`${baseUrl}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "test-admin@example.com", password: "passwordAdmin" }),
  });
  assert.ok(response.status === 200 || response.status === 201);
  return response.headers.get("set-cookie");
};

const createLegacyPending = async ({ token, date, startTime, endTime }) => {
  const appointment = await Appointment.create({
    client: seed.client._id,
    worker: seed.worker._id,
    service: service120._id,
    business: seed.business._id,
    date: new Date(`${date}T00:00:00.000Z`),
    startTime,
    endTime,
    status: "pending_payment",
    paymentStatus: "unpaid",
  });
  await Payment.create({
    appointment: appointment._id,
    business: seed.business._id,
    amount: 5000,
    currency: "CLP",
    gateway: "webpay",
    transactionId: token,
    status: "pending",
    type: "deposit",
  });
  gatewayState.buyOrder = appointment._id.toString();
  gatewayState.amount = 5000;
  gatewayState.commitCount = 0;
  return appointment;
};

const callReturn = (token) => fetch(`${baseUrl}/payments/webpay-return?token_ws=${encodeURIComponent(token)}`, {
  method: "POST",
  redirect: "manual",
});

const bookGuest = ({ date, startTime, suffix }) => fetch(
  `${baseUrl}/appointments?businessId=${seed.business._id}`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      worker: seed.worker._id.toString(),
      service: service120._id.toString(),
      date,
      startTime,
      clientInfo: {
        firstName: "Race",
        lastName: `Guest ${suffix}`,
        email: `webpay-race-${suffix}@example.com`,
        phone: `+5697333${String(suffix).padStart(4, "0")}`,
      },
    }),
  },
);

const activeOverlaps = async ({ date, startTime, endTime }) => {
  const start = new Date(`${date}T00:00:00.000Z`);
  const end = new Date(`${date}T23:59:59.999Z`);
  return Appointment.find({
    business: seed.business._id,
    worker: seed.worker._id,
    date: { $gte: start, $lte: end },
    status: { $in: ["pending_payment", "pending", "confirmed", "completed"] },
    startTime: { $lt: endTime },
    endTime: { $gt: startTime },
  });
};

test("6.2.6-A Webpay legacy no puede resucitar una Appointment cancelada", async (t) => {
  const adminCookie = await loginAdmin();

  await t.test("AUTHORIZED después de cancel + rebooking registra reconciliación y no reactiva A", async () => {
    const date = "2099-07-06";
    const appointmentA = await createLegacyPending({
      token: "legacy-race-authorized",
      date,
      startTime: "09:00",
      endTime: "11:00",
    });

    let signalCommitStarted;
    const commitStarted = new Promise((resolve) => { signalCommitStarted = resolve; });
    let releaseCommit;
    gatewayState.releaseCommit = new Promise((resolve) => { releaseCommit = resolve; });
    gatewayState.commitStarted = signalCommitStarted;
    gatewayState.blockCommit = true;

    const callbackPromise = callReturn("legacy-race-authorized");
    await commitStarted;
    assert.equal(gatewayState.commitCount, 1);

    const cancel = await fetch(`${baseUrl}/appointments/${appointmentA._id}/cancel`, {
      method: "PATCH",
      headers: { Cookie: adminCookie },
    });
    assert.equal(cancel.status, 200);
    assert.equal((await Appointment.findById(appointmentA._id)).status, "cancelled");

    const bookingB = await bookGuest({ date, startTime: "10:00", suffix: 1 });
    assert.equal(bookingB.status, 201);
    const bookingBody = await bookingB.json();
    const appointmentBId = bookingBody.payload.appointmentId;
    assert.equal((await Appointment.findById(appointmentBId)).status, "pending");

    releaseCommit();
    const callback = await callbackPromise;
    assert.equal(callback.status, 302);
    const location = callback.headers.get("location") || "";
    assert.match(location, /payment-failed/);
    assert.match(location, /payment_authorized_reconciliation_required/);
    assert.match(location, /paymentAuthorized=true/);

    const [storedA, storedB, payment] = await Promise.all([
      Appointment.findById(appointmentA._id),
      Appointment.findById(appointmentBId),
      Payment.findOne({ transactionId: "legacy-race-authorized" }),
    ]);

    assert.equal(storedA.status, "cancelled");
    assert.equal(storedA.paymentStatus, "unpaid");
    assert.ok(["pending", "confirmed"].includes(storedB.status));
    assert.equal(payment.status, "approved");
    assert.equal(payment.reconciliationStatus, "required");
    assert.equal(payment.reconciliationReason, "appointment_state_changed");
    assert.ok(payment.authorizedAt instanceof Date);

    const overlappingActive = await activeOverlaps({ date, startTime: "09:00", endTime: "12:00" });
    assert.equal(overlappingActive.length, 1);
    assert.equal(overlappingActive[0]._id.toString(), storedB._id.toString());

    gatewayState.blockCommit = false;
    gatewayState.commitStarted = null;
    gatewayState.releaseCommit = null;
  });

  await t.test("callback AUTHORIZED normal conserva confirmación legacy", async () => {
    const appointment = await createLegacyPending({
      token: "legacy-race-normal",
      date: "2099-07-13",
      startTime: "09:00",
      endTime: "11:00",
    });
    gatewayState.blockCommit = false;
    gatewayState.commitStarted = null;
    gatewayState.releaseCommit = null;

    const response = await callReturn("legacy-race-normal");
    assert.equal(response.status, 302);
    assert.match(response.headers.get("location") || "", /payment-success/);
    assert.equal(gatewayState.commitCount, 1);

    const [storedAppointment, payment] = await Promise.all([
      Appointment.findById(appointment._id),
      Payment.findOne({ transactionId: "legacy-race-normal" }),
    ]);
    assert.equal(storedAppointment.status, "confirmed");
    assert.equal(storedAppointment.paymentStatus, "partially_paid");
    assert.equal(payment.status, "approved");
    assert.equal(payment.reconciliationStatus, "applied");
    assert.equal(payment.reconciliationReason, undefined);
    assert.ok(payment.authorizedAt instanceof Date);
  });
});

test.after(async () => {
  await teardown(server, sessionStore);
});
