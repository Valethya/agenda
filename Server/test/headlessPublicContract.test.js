import './setup.js';
import test from "node:test";
import assert from "node:assert";
import app, { sessionStore } from "../src/app.js";
import { connectDB } from "../src/db/db.js";
import { seedTestData, cleanTestData, teardown } from "./fixtures.js";
import Service from "../src/db/models/service.model.js";
import Appointment from "../src/db/models/appointment.model.js";
import User from "../src/db/models/user.model.js";
import Shift from "../src/db/models/shift.model.js";
import Holiday from "../src/db/models/holiday.model.js";

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

for (let day = 1; day <= 5; day += 1) {
  await Shift.create({
    business: seed.businessB._id,
    worker: seed.workerB._id,
    dayOfWeek: day,
    isOpen: true,
    startTime: "09:00",
    endTime: "18:00",
    breaks: [],
  });
}

const server = app.listen(0);
const { port } = server.address();
const baseUrl = `http://localhost:${port}/api`;

const loginA = await fetch(`${baseUrl}/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: "test-admin@example.com", password: "passwordAdmin" }),
});
assert.strictEqual(loginA.status, 201);
const adminCookieA = loginA.headers.get("set-cookie");

const PUBLIC_SERVICE_KEYS = ["business", "depositAmount", "description", "duration", "id", "name", "price"];
const PUBLIC_PROFESSIONAL_KEYS = ["firstName", "id", "lastName"];
const PUBLIC_APPOINTMENT_KEYS = ["appointmentId", "businessId", "date", "endTime", "serviceId", "startTime", "status", "workerId"];

const sortedKeys = (value) => Object.keys(value).sort();

const postGuestBooking = async ({
  businessId = seed.business._id,
  worker = seed.worker._id,
  service = seed.service._id,
  date = "2099-01-05",
  startTime,
  email,
  phone,
  cookie = null,
}) => fetch(`${baseUrl}/appointments?businessId=${businessId}`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    ...(cookie ? { Cookie: cookie } : {}),
  },
  body: JSON.stringify({
    worker: worker.toString(),
    service: service.toString(),
    date,
    startTime,
    clientInfo: {
      firstName: "Guest",
      lastName: "Headless",
      email,
      phone,
    },
  }),
});

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

  await t.test("cookie de A no altera el contrato headless explícito de B", async () => {
    const servicesRes = await fetch(`${baseUrl}/services?businessId=${seed.businessB._id}`, {
      headers: { Cookie: adminCookieA },
    });
    assert.strictEqual(servicesRes.status, 200);
    const servicesData = await servicesRes.json();
    assert.ok(servicesData.payload.some((service) => service.id === serviceB._id.toString()));
    assert.ok(servicesData.payload.every((service) => service.business === seed.businessB._id.toString()));
    assert.deepStrictEqual(sortedKeys(servicesData.payload[0]), PUBLIC_SERVICE_KEYS);

    const workersRes = await fetch(
      `${baseUrl}/users/workers?businessId=${seed.businessB._id}&serviceId=${serviceB._id}`,
      { headers: { Cookie: adminCookieA } },
    );
    assert.strictEqual(workersRes.status, 200);
    const workersData = await workersRes.json();
    assert.deepStrictEqual(workersData.payload.map((worker) => worker.id), [seed.workerB._id.toString()]);
    assert.deepStrictEqual(sortedKeys(workersData.payload[0]), PUBLIC_PROFESSIONAL_KEYS);
    for (const forbidden of ["email", "phone", "role", "business"]) {
      assert.ok(!(forbidden in workersData.payload[0]));
    }

    const slotsRes = await fetch(
      `${baseUrl}/availability/slots?businessId=${seed.businessB._id}&workerId=${seed.workerB._id}&serviceId=${serviceB._id}&date=2099-01-07`,
      { headers: { Cookie: adminCookieA } },
    );
    assert.strictEqual(slotsRes.status, 200);

    const bookingRes = await postGuestBooking({
      businessId: seed.businessB._id,
      worker: seed.workerB._id,
      service: serviceB._id,
      date: "2099-01-07",
      startTime: "09:00",
      email: "cookie-a-booking-b@example.com",
      phone: "+56970000009",
      cookie: adminCookieA,
    });
    assert.strictEqual(bookingRes.status, 201);
    const bookingData = await bookingRes.json();
    assert.deepStrictEqual(sortedKeys(bookingData.payload), PUBLIC_APPOINTMENT_KEYS);
    assert.strictEqual(bookingData.payload.businessId, seed.businessB._id.toString());
    const stored = await Appointment.findById(bookingData.payload.appointmentId).select("+guestContact");
    assert.strictEqual(stored.business.toString(), seed.businessB._id.toString());
    assert.strictEqual(stored.client, null);
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

  await t.test("Shift raw requiere autenticación pero slots continúa público", async () => {
    const shifts = await fetch(
      `${baseUrl}/availability/shifts/${seed.workerB._id}?businessId=${seed.businessB._id}`,
    );
    assert.strictEqual(shifts.status, 401);

    const slots = await fetch(
      `${baseUrl}/availability/slots?businessId=${seed.businessB._id}&workerId=${seed.workerB._id}&serviceId=${serviceB._id}&date=2099-01-08`,
    );
    assert.strictEqual(slots.status, 200);
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
    assert.strictEqual(await User.findOne({ email: "headless-cross-tenant@example.com" }), null);
  });

  await t.test("booking guest no requiere login, no crea User y retry no duplica cita activa", async () => {
    const response = await postGuestBooking({
      startTime: "09:00",
      email: "headless-guest@example.com",
      phone: "+56970000002",
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
    assert.strictEqual(stored.client, null);
    assert.strictEqual(stored.guestContact?.destination, "headless-guest@example.com");
    assert.strictEqual(stored.guestContact?.provenance, "guest-booking-input-v1");
    assert.strictEqual(await User.findOne({ email: "headless-guest@example.com" }), null);

    const retry = await postGuestBooking({
      startTime: "09:00",
      email: "headless-guest@example.com",
      phone: "+56970000002",
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

  await t.test("teléfono conocido de una víctima no permite inyectar email en su User", async () => {
    const victimBefore = await User.findById(seed.client._id).lean();
    const response = await postGuestBooking({
      startTime: "10:00",
      email: "attacker-controlled@example.com",
      phone: "+56911112222",
    });
    assert.strictEqual(response.status, 201);

    const victimAfter = await User.findById(seed.client._id).lean();
    assert.deepStrictEqual(victimAfter.email, victimBefore.email);
    assert.deepStrictEqual(victimAfter.phone, victimBefore.phone);
    assert.strictEqual(await User.findOne({ email: "attacker-controlled@example.com" }), null);

    const data = await response.json();
    const stored = await Appointment.findById(data.payload.appointmentId).select("+guestContact");
    assert.strictEqual(stored.client, null);
    assert.strictEqual(stored.guestContact.destination, "attacker-controlled@example.com");
  });

  await t.test("booking rechazado por slot ocupado no deja mutaciones de identidad global", async () => {
    const first = await postGuestBooking({
      startTime: "11:00",
      email: "slot-owner@example.com",
      phone: "+56970000003",
    });
    assert.strictEqual(first.status, 201);

    const victimBefore = await User.findById(seed.client._id).lean();
    const userCountBefore = await User.countDocuments({});
    const rejected = await postGuestBooking({
      startTime: "11:00",
      email: "occupied-attacker@example.com",
      phone: "+56911112222",
    });
    assert.strictEqual(rejected.status, 409);

    const victimAfter = await User.findById(seed.client._id).lean();
    assert.deepStrictEqual(victimAfter.email, victimBefore.email);
    assert.deepStrictEqual(victimAfter.phone, victimBefore.phone);
    assert.strictEqual(await User.countDocuments({}), userCountBefore);
    assert.strictEqual(await User.findOne({ email: "occupied-attacker@example.com" }), null);
  });

  await t.test("guest nuevo no provoca creación de password o User autenticable", async () => {
    const before = await User.countDocuments({});
    const response = await postGuestBooking({
      startTime: "15:00",
      email: "brand-new-guest@example.com",
      phone: "+56970000004",
    });
    assert.strictEqual(response.status, 201);
    assert.strictEqual(await User.countDocuments({}), before);
    assert.strictEqual(await User.findOne({ email: "brand-new-guest@example.com" }).select("+password"), null);
  });

  await t.test("fechas imposibles Gregorianas fallan antes de consultar o reservar", async () => {
    const slots = await fetch(
      `${baseUrl}/availability/slots?businessId=${seed.business._id}&workerId=${seed.worker._id}&serviceId=${seed.service._id}&date=2026-02-31`,
    );
    assert.strictEqual(slots.status, 400);

    const before = await Appointment.countDocuments({});
    const booking = await postGuestBooking({
      date: "2026-02-31",
      startTime: "09:00",
      email: "invalid-date@example.com",
      phone: "+56970000005",
    });
    assert.strictEqual(booking.status, 400);
    assert.strictEqual(await Appointment.countDocuments({}), before);
  });

  await t.test("Holiday es deliberadamente global y afecta por igual a A y B", async () => {
    await Holiday.create({
      date: new Date("2099-01-06T00:00:00.000Z"),
      name: "Feriado global de contrato",
      isHalfDay: false,
    });

    const a = await fetch(
      `${baseUrl}/availability/slots?businessId=${seed.business._id}&workerId=${seed.worker._id}&serviceId=${seed.service._id}&date=2099-01-06`,
    );
    const b = await fetch(
      `${baseUrl}/availability/slots?businessId=${seed.businessB._id}&workerId=${seed.workerB._id}&serviceId=${serviceB._id}&date=2099-01-06`,
    );
    assert.strictEqual(a.status, 200);
    assert.strictEqual(b.status, 200);
    const aData = await a.json();
    const bData = await b.json();
    assert.ok(aData.payload.length > 0 && aData.payload.every((slot) => slot.available === false));
    assert.ok(bData.payload.length > 0 && bData.payload.every((slot) => slot.available === false));
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
