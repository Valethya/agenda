import './setup.js';
import test from "node:test";
import assert from "node:assert";

process.env.ENABLE_PAYMENTS = "true";

const { default: app, sessionStore } = await import("../src/app.js");
const { connectDB } = await import("../src/db/db.js");
const { seedTestData, cleanTestData, teardown } = await import("./fixtures.js");
const { default: Appointment } = await import("../src/db/models/appointment.model.js");
const { default: Payment } = await import("../src/db/models/payment.model.js");

await connectDB();
await cleanTestData();
const seed = await seedTestData();

const appointment = await Appointment.create({
  client: seed.client._id,
  worker: seed.worker._id,
  service: seed.service._id,
  business: seed.business._id,
  date: new Date("2099-01-05T00:00:00.000Z"),
  startTime: "09:00",
  endTime: "10:00",
  status: "pending",
});

const server = app.listen(0);
const { port } = server.address();
const baseUrl = `http://localhost:${port}/api`;

test("6.2.6-A Appointment ID no concede payment authority aun con ENABLE_PAYMENTS=true", async () => {
  const response = await fetch(`${baseUrl}/payments/initiate?businessId=${seed.business._id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      appointmentId: appointment._id.toString(),
      paymentType: "deposit",
    }),
  });

  assert.strictEqual(response.status, 403);
  const data = await response.json();
  assert.strictEqual(data.code, "FORBIDDEN_ERROR");
  assert.strictEqual(await Payment.countDocuments({}), 0);

  const stored = await Appointment.findById(appointment._id);
  assert.strictEqual(stored.status, "pending");
  assert.strictEqual(stored.paymentStatus, "unpaid");
});

test.after(async () => {
  await teardown(server, sessionStore);
});
