import './setup.js';
import test from "node:test";
import assert from "node:assert/strict";
import app, { sessionStore } from "../src/app.js";
import { connectDB } from "../src/db/db.js";
import { seedTestData, cleanTestData, teardown } from "./fixtures.js";
import Appointment from "../src/db/models/appointment.model.js";

await connectDB();
await cleanTestData();
const seed = await seedTestData();
const server = app.listen(0);
const { port } = server.address();
const baseUrl = `http://localhost:${port}/api`;

const bookingBody = (overrides = {}) => ({
  worker: seed.worker._id.toString(),
  service: seed.service._id.toString(),
  date: "2099-01-05",
  startTime: "09:00",
  clientInfo: {
    firstName: "Guest",
    lastName: "Boundary",
    email: "guest-boundary@example.com",
    phone: "+56970000201",
  },
  ...overrides,
});

const postPublic = (body) => fetch(`${baseUrl}/appointments?businessId=${seed.business._id}`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const assertValidationError = async (response) => {
  assert.equal(response.status, 400);
  const data = await response.json();
  assert.equal(data.code, "VALIDATION_ERROR");
  return data;
};

test("6.2.6-A public booking input allowlist", async (t) => {
  await t.test("isSuggestion público falla antes de crear y no permite salir de disponibilidad", async () => {
    const before = await Appointment.countDocuments({});
    const response = await postPublic(bookingBody({
      startTime: "08:00",
      isSuggestion: true,
    }));
    await assertValidationError(response);
    assert.equal(await Appointment.countDocuments({}), before);
  });

  await t.test("isSuggestion público no permite solapar una Appointment activa", async () => {
    const first = await postPublic(bookingBody({ startTime: "09:00" }));
    assert.equal(first.status, 201);

    const before = await Appointment.countDocuments({});
    const second = await postPublic(bookingBody({
      startTime: "09:00",
      clientInfo: {
        firstName: "Second",
        lastName: "Guest",
        email: "second@example.com",
        phone: "+56970000202",
      },
      isSuggestion: true,
    }));
    await assertValidationError(second);
    assert.equal(await Appointment.countDocuments({}), before);
  });

  await t.test("paymentOption público no puede alterar estado ni auto-confirmación", async () => {
    const before = await Appointment.countDocuments({ startTime: "10:00" });
    const forbidden = await postPublic(bookingBody({
      startTime: "10:00",
      paymentOption: "local",
      clientInfo: {
        firstName: "Payment",
        lastName: "Control",
        email: "payment-control@example.com",
        phone: "+56970000203",
      },
    }));
    await assertValidationError(forbidden);
    assert.equal(await Appointment.countDocuments({ startTime: "10:00" }), before);

    const normal = await postPublic(bookingBody({
      startTime: "10:00",
      clientInfo: {
        firstName: "Payment",
        lastName: "Normal",
        email: "payment-normal@EXAMPLE.COM",
        phone: "+56970000204",
      },
    }));
    assert.equal(normal.status, 201);
    const data = await normal.json();
    assert.equal(data.payload.status, "pending");

    const stored = await Appointment.findById(data.payload.appointmentId).select("+guestContact");
    assert.equal(stored.guestContact.destination, "payment-normal@example.com");
  });

  await t.test("campo de control desconocido falla con error contractual estable", async () => {
    const response = await postPublic(bookingBody({
      startTime: "11:00",
      adminOverride: true,
    }));
    await assertValidationError(response);
    assert.equal(await Appointment.countDocuments({ startTime: "11:00" }), 0);
  });

  await t.test("guest contact se trimea y rechaza whitespace, longitud y phone inválido antes de Mongoose", async () => {
    const whitespace = await postPublic(bookingBody({
      startTime: "12:00",
      clientInfo: {
        firstName: "   ",
        lastName: "Guest",
        email: "whitespace@example.com",
        phone: "+56970000205",
      },
    }));
    await assertValidationError(whitespace);

    const longName = await postPublic(bookingBody({
      startTime: "12:00",
      clientInfo: {
        firstName: "A".repeat(121),
        lastName: "Guest",
        email: "long@example.com",
        phone: "+56970000205",
      },
    }));
    await assertValidationError(longName);

    const badPhone = await postPublic(bookingBody({
      startTime: "12:00",
      clientInfo: {
        firstName: "Phone",
        lastName: "Invalid",
        email: "phone@example.com",
        phone: "  +56 9 7000 0205  ",
      },
    }));
    await assertValidationError(badPhone);

    assert.equal(await Appointment.countDocuments({ startTime: "12:00" }), 0);
  });

  await t.test("booking normal conserva trim y normalización contractual del contacto", async () => {
    const response = await postPublic(bookingBody({
      startTime: "12:00",
      clientInfo: {
        firstName: "  Trimmed  ",
        lastName: "  Guest  ",
        email: "LocalPart@EXAMPLE.COM",
        phone: "  +56970000206  ",
      },
    }));
    assert.equal(response.status, 201);
    const data = await response.json();
    const stored = await Appointment.findById(data.payload.appointmentId).select("+guestContact");
    assert.equal(stored.guestContact.firstName, "Trimmed");
    assert.equal(stored.guestContact.lastName, "Guest");
    assert.equal(stored.guestContact.destination, "LocalPart@example.com");
    assert.equal(stored.guestContact.phone, "+56970000206");
  });
});

test.after(async () => {
  await teardown(server, sessionStore);
});
