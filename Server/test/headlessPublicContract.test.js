import './setup.js';
import test from "node:test";
import assert from "node:assert";
import app, { sessionStore } from "../src/app.js";
import { connectDB } from "../src/db/db.js";
import { seedTestData, cleanTestData, teardown } from "./fixtures.js";
import Service from "../src/db/models/service.model.js";
import Appointment from "../src/db/models/appointment.model.js";

await connectDB();
await cleanTestData();
const seed = await seedTestData();

const serviceB = await Service.create({
  name: "Servicio B Headless",
  description: "Contrato B",
  duration: 30,
  price: 18000,
  depositAmount: 0,
  business: seed.businessB._id,
  workers: [seed.workerB._id],
  isActive: true,
});

const server = app.listen(0);
const { port } = server.address();
const baseUrl = `http://localhost:${port}/api`;

const PUBLIC_SERVICE_KEYS = ["business", "depositAmount", "description", "duration", "id", "name", "price"];
const PUBLIC_PROFESSIONAL_KEYS = ["firstName", "id", "lastName"];
const PUBLIC_APPOINTMENT_KEYS = ["appointmentId", "businessId", "date", "endTime", "serviceId", "startTime", "status", "workerId"];

const sortedKeys = (value) => Object.keys(value).sort();

test("6.2.6-A headless public booking contract", async (t) => {
  await t.test("dos Businesses consumen la misma proyección pública de servicios", async () => {
    for (const business of [seed.business, seed.businessB]) {
      const response = await fetch(`${baseUrl}/services?businessId=${business._id}`);
      assert.strictEqual(response.status, 200);
      const data = await response.json();
      assert.ok(data.payload.length > 0);
      for (const service of data.payload) {
        assert.deepStrictEqual(sortedKeys(service), PUBLIC_SERVICE_KEYS);
        assert.strictEqual(service.business, business._id.toString());
        assert.ok(!("workers" in service));
        assert.ok(!("isActive" in service));
        assert.ok(!("createdAt" in service));
        assert.ok(!("updatedAt" in service));
      }
    }
  });

  await t.test("tenant ausente no selecciona otro Business", async () => {
    const response = await fetch(`${baseUrl}/services`);
    assert.strictEqual(response.status, 400);
    const data = await response.json();
    assert.strictEqual(data.code, "VALIDATION_ERROR");
  });

  await t.test("identificadores tenant contradictorios fallan", async () => {
    const response = await fetch(
      `${baseUrl}/services?businessId=${seed.business._id}&slug=${seed.businessB.slug}`,
    );
    assert.strictEqual(response.status, 400);
    const data = await response.json();
    assert.strictEqual(data.code, "VALIDATION_ERROR");
  });

  await t.test("profesionales públicos requieren Service y exponen sólo proyección mínima", async () => {
    const missingService = await fetch(`${baseUrl}/users/workers?businessId=${seed.business._id}`);
    assert.strictEqual(missingService.status, 400);

    const response = await fetch(
      `${baseUrl}/users/workers?businessId=${seed.business._id}&serviceId=${seed.service._id}`,
    );
    assert.strictEqual(response.status, 200);
    const data = await response.json();
    assert.deepStrictEqual(data.payload.map((worker) => worker.id), [seed.worker._id.toString()]);
    assert.deepStrictEqual(sortedKeys(data.payload[0]), PUBLIC_PROFESSIONAL_KEYS);
    for (const forbidden of ["email", "phone", "role", "business", "isActive", "createdAt", "updatedAt"]) {
      assert.ok(!(forbidden in data.payload[0]));
    }
  });

  await t.test("Service de B no puede enumerar profesionales dentro de A", async () => {
    const response = await fetch(
      `${baseUrl}/users/workers?businessId=${seed.business._id}&serviceId=${serviceB._id}`,
    );
    assert.strictEqual(response.status, 404);
  });

  await t.test("worker de B y disponibilidad de B no pueden utilizarse dentro de A", async () => {
    const response = await fetch(
      `${baseUrl}/availability/slots?businessId=${seed.business._id}&workerId=${seed.workerB._id}&serviceId=${seed.service._id}&date=2099-01-05`,
    );
    assert.strictEqual(response.status, 404);
  });

  await t.test("booking A no puede crear Appointment con Service de B", async () => {
    const before = await Appointment.countDocuments({});
    const response = await fetch(`${baseUrl}/appointments?businessId=${seed.business._id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        worker: seed.workerB._id.toString(),
        service: serviceB._id.toString(),
        date: "2099-01-05",
        startTime: "09:00",
        clientInfo: {
          firstName: "Guest",
          lastName: "CrossTenant",
          email: "headless-cross-tenant@example.com",
          phone: "+56970000001",
        },
      }),
    });
    assert.strictEqual(response.status, 404);
    assert.strictEqual(await Appointment.countDocuments({}), before);
  });

  await t.test("booking guest no requiere login, oculta authority interna y retry no duplica cita activa", async () => {
    const bookingBody = {
      worker: seed.worker._id.toString(),
      service: seed.service._id.toString(),
      date: "2099-01-05",
      startTime: "09:00",
      clientInfo: {
        firstName: "Guest",
        lastName: "Headless",
        email: "headless-guest@example.com",
        phone: "+56970000002",
      },
    };

    const response = await fetch(`${baseUrl}/appointments?businessId=${seed.business._id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bookingBody),
    });

    assert.strictEqual(response.status, 201);
    const data = await response.json();
    assert.deepStrictEqual(sortedKeys(data.payload), PUBLIC_APPOINTMENT_KEYS);
    assert.strictEqual(data.payload.businessId, seed.business._id.toString());
    assert.strictEqual(data.payload.serviceId, seed.service._id.toString());
    assert.strictEqual(data.payload.workerId, seed.worker._id.toString());
    for (const forbidden of ["client", "guestContact", "notes", "paymentStatus", "createdAt", "updatedAt"]) {
      assert.ok(!(forbidden in data.payload));
    }

    const stored = await Appointment.findById(data.payload.appointmentId).select("+guestContact");
    assert.ok(stored);
    assert.strictEqual(stored.business.toString(), seed.business._id.toString());
    assert.strictEqual(stored.guestContact?.destination, "headless-guest@example.com");
    assert.strictEqual(stored.guestContact?.provenance, "guest-booking-input-v1");

    const retry = await fetch(`${baseUrl}/appointments?businessId=${seed.business._id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bookingBody),
    });
    assert.strictEqual(retry.status, 409);
    assert.strictEqual(
      await Appointment.countDocuments({
        business: seed.business._id,
        worker: seed.worker._id,
        date: new Date("2099-01-05T00:00:00.000Z"),
        startTime: "09:00",
        status: { $in: ["pending_payment", "pending", "confirmed", "completed"] },
      }),
      1,
    );
  });

  await t.test("Appointment ID por sí solo no concede detalle ni acciones", async () => {
    const appointment = await Appointment.findOne({ business: seed.business._id });
    assert.ok(appointment);
    const detail = await fetch(`${baseUrl}/appointments/${appointment._id}?businessId=${seed.business._id}`);
    assert.strictEqual(detail.status, 401);
    const cancel = await fetch(`${baseUrl}/appointments/${appointment._id}/cancel?businessId=${seed.business._id}`, {
      method: "PATCH",
    });
    assert.strictEqual(cancel.status, 401);
  });
});

test.after(async () => {
  await teardown(server, sessionStore);
});
