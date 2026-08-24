import './setup.js';
import test from "node:test";
import assert from "node:assert/strict";
import app, { sessionStore } from "../src/app.js";
import { connectDB } from "../src/db/db.js";
import { seedTestData, cleanTestData, teardown } from "./fixtures.js";
import Appointment from "../src/db/models/appointment.model.js";
import Service from "../src/db/models/service.model.js";
import Shift from "../src/db/models/shift.model.js";
import User from "../src/db/models/user.model.js";
import Membership from "../src/db/models/membership.model.js";
import { createHash } from "../src/utils/password.js";

await connectDB();
await cleanTestData();
const seed = await seedTestData();

const service120 = await Service.create({
  name: "Servicio concurrencia 120",
  description: "Intervalo de dos horas",
  duration: 120,
  price: 20000,
  depositAmount: 0,
  business: seed.business._id,
  workers: [seed.worker._id],
  isActive: true,
});

const service60 = await Service.create({
  name: "Servicio concurrencia 60",
  description: "Intervalo de una hora",
  duration: 60,
  price: 10000,
  depositAmount: 0,
  business: seed.business._id,
  workers: [seed.worker._id],
  isActive: true,
});

const serviceB = await Service.create({
  name: "Servicio concurrencia B",
  description: "Aislamiento por Business",
  duration: 60,
  price: 10000,
  depositAmount: 0,
  business: seed.businessB._id,
  workers: [seed.workerB._id],
  isActive: true,
});

await Shift.create({
  business: seed.businessB._id,
  worker: seed.workerB._id,
  dayOfWeek: 1,
  isOpen: true,
  startTime: "09:00",
  endTime: "18:00",
  breaks: [],
});

const workerA2 = await User.create({
  firstName: "Worker",
  lastName: "Concurrente A2",
  email: ["worker-concurrent-a2@example.com"],
  phone: ["+56971112223"],
  password: await createHash("workerConcurrentA2"),
  role: "worker",
  business: seed.business._id,
  isActive: true,
});
await Membership.create({
  user: workerA2._id,
  business: seed.business._id,
  role: "worker",
  isActive: true,
  isBookable: true,
});
await Shift.create({
  business: seed.business._id,
  worker: workerA2._id,
  dayOfWeek: 1,
  isOpen: true,
  startTime: "09:00",
  endTime: "18:00",
  breaks: [],
});
const multiWorkerService = await Service.create({
  name: "Servicio multi-worker concurrencia",
  description: "Aislamiento por worker",
  duration: 60,
  price: 10000,
  depositAmount: 0,
  business: seed.business._id,
  workers: [seed.worker._id, workerA2._id],
  isActive: true,
});

const server = app.listen(0);
const { port } = server.address();
const baseUrl = `http://localhost:${port}/api`;

const guest = (suffix) => ({
  firstName: "Guest",
  lastName: `Concurrente ${suffix}`,
  email: `guest-concurrent-${suffix}@example.com`,
  phone: `+56972${String(suffix).padStart(6, "0")}`,
});

const publicBook = ({ businessId, workerId, serviceId, date, startTime, suffix }) => fetch(
  `${baseUrl}/appointments?businessId=${businessId}`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      worker: workerId.toString(),
      service: serviceId.toString(),
      date,
      startTime,
      clientInfo: guest(suffix),
    }),
  },
);

const activeFor = ({ businessId, workerId, date }) => {
  const start = new Date(`${date}T00:00:00.000Z`);
  const end = new Date(`${date}T23:59:59.999Z`);
  return Appointment.find({
    business: businessId,
    worker: workerId,
    date: { $gte: start, $lte: end },
    status: { $ne: "cancelled" },
  }).sort({ startTime: 1 });
};

const loginAdmin = async () => {
  const response = await fetch(`${baseUrl}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "test-admin@example.com", password: "passwordAdmin" }),
  });
  assert.ok(response.status === 200 || response.status === 201);
  return response.headers.get("set-cookie");
};

test("6.2.6-A interval booking concurrency invariant", async (t) => {
  await t.test("09:00-11:00 vs 10:00-12:00 lanzadas en paralelo dejan exactamente un ganador", async () => {
    const date = "2099-06-01";
    const before = await Appointment.countDocuments({});

    const [first, second] = await Promise.all([
      publicBook({
        businessId: seed.business._id,
        workerId: seed.worker._id,
        serviceId: service120._id,
        date,
        startTime: "09:00",
        suffix: 101,
      }),
      publicBook({
        businessId: seed.business._id,
        workerId: seed.worker._id,
        serviceId: service120._id,
        date,
        startTime: "10:00",
        suffix: 102,
      }),
    ]);

    assert.deepEqual([first.status, second.status].sort((a, b) => a - b), [201, 409]);
    const loser = first.status === 409 ? first : second;
    const loserBody = await loser.json();
    assert.equal(loserBody.code, "CONFLICT_ERROR");
    assert.equal(loserBody.message, "El horario seleccionado ya no se encuentra disponible");

    assert.equal(await Appointment.countDocuments({}), before + 1);
    const persisted = await activeFor({ businessId: seed.business._id, workerId: seed.worker._id, date });
    assert.equal(persisted.length, 1);
    assert.ok([
      "09:00-11:00",
      "10:00-12:00",
    ].includes(`${persisted[0].startTime}-${persisted[0].endTime}`));
  });

  await t.test("duraciones 120 vs 60 en overlap real concurrente dejan exactamente un ganador", async () => {
    const date = "2099-06-03";
    const before = await Appointment.countDocuments({});

    const [longBooking, shortBooking] = await Promise.all([
      publicBook({
        businessId: seed.business._id,
        workerId: seed.worker._id,
        serviceId: service120._id,
        date,
        startTime: "09:00",
        suffix: 151,
      }),
      publicBook({
        businessId: seed.business._id,
        workerId: seed.worker._id,
        serviceId: service60._id,
        date,
        startTime: "10:00",
        suffix: 152,
      }),
    ]);

    assert.deepEqual([longBooking.status, shortBooking.status].sort((a, b) => a - b), [201, 409]);
    const loser = longBooking.status === 409 ? longBooking : shortBooking;
    const loserBody = await loser.json();
    assert.equal(loserBody.code, "CONFLICT_ERROR");
    assert.equal(loserBody.message, "El horario seleccionado ya no se encuentra disponible");

    assert.equal(await Appointment.countDocuments({}), before + 1);
    const persisted = await activeFor({ businessId: seed.business._id, workerId: seed.worker._id, date });
    assert.equal(persisted.length, 1);
    assert.ok([
      "09:00-11:00",
      "10:00-11:00",
    ].includes(`${persisted[0].startTime}-${persisted[0].endTime}`));
  });

  await t.test("intervalos adyacentes 09:00-10:00 y 10:00-11:00 pueden coexistir", async () => {
    const date = "2099-06-02";
    const [first, second] = await Promise.all([
      publicBook({
        businessId: seed.business._id,
        workerId: seed.worker._id,
        serviceId: service60._id,
        date,
        startTime: "09:00",
        suffix: 201,
      }),
      publicBook({
        businessId: seed.business._id,
        workerId: seed.worker._id,
        serviceId: service60._id,
        date,
        startTime: "10:00",
        suffix: 202,
      }),
    ]);

    assert.deepEqual([first.status, second.status].sort((a, b) => a - b), [201, 201]);
    const persisted = await activeFor({ businessId: seed.business._id, workerId: seed.worker._id, date });
    assert.deepEqual(persisted.map((item) => `${item.startTime}-${item.endTime}`), [
      "09:00-10:00",
      "10:00-11:00",
    ]);
  });

  await t.test("Business A y B a la misma hora no comparten exclusión", async () => {
    const date = "2099-06-08";
    const [a, b] = await Promise.all([
      publicBook({
        businessId: seed.business._id,
        workerId: seed.worker._id,
        serviceId: service60._id,
        date,
        startTime: "09:00",
        suffix: 301,
      }),
      publicBook({
        businessId: seed.businessB._id,
        workerId: seed.workerB._id,
        serviceId: serviceB._id,
        date,
        startTime: "09:00",
        suffix: 302,
      }),
    ]);

    assert.equal(a.status, 201);
    assert.equal(b.status, 201);
    assert.equal((await activeFor({ businessId: seed.business._id, workerId: seed.worker._id, date })).length, 1);
    assert.equal((await activeFor({ businessId: seed.businessB._id, workerId: seed.workerB._id, date })).length, 1);
  });

  await t.test("dos workers del mismo Business a la misma hora no comparten exclusión", async () => {
    const date = "2099-06-15";
    const [a, b] = await Promise.all([
      publicBook({
        businessId: seed.business._id,
        workerId: seed.worker._id,
        serviceId: multiWorkerService._id,
        date,
        startTime: "09:00",
        suffix: 401,
      }),
      publicBook({
        businessId: seed.business._id,
        workerId: workerA2._id,
        serviceId: multiWorkerService._id,
        date,
        startTime: "09:00",
        suffix: 402,
      }),
    ]);

    assert.equal(a.status, 201);
    assert.equal(b.status, 201);
    assert.equal((await activeFor({ businessId: seed.business._id, workerId: seed.worker._id, date })).length, 1);
    assert.equal((await activeFor({ businessId: seed.business._id, workerId: workerA2._id, date })).length, 1);
  });

  await t.test("cancelación libera el intervalo para una reserva posterior solapada", async () => {
    const date = "2099-06-22";
    const created = await publicBook({
      businessId: seed.business._id,
      workerId: seed.worker._id,
      serviceId: service120._id,
      date,
      startTime: "09:00",
      suffix: 501,
    });
    assert.equal(created.status, 201);
    const createdBody = await created.json();

    const adminCookie = await loginAdmin();
    const cancelled = await fetch(`${baseUrl}/appointments/${createdBody.payload.appointmentId}/cancel`, {
      method: "PATCH",
      headers: { Cookie: adminCookie },
    });
    assert.equal(cancelled.status, 200);

    const replacement = await publicBook({
      businessId: seed.business._id,
      workerId: seed.worker._id,
      serviceId: service120._id,
      date,
      startTime: "10:00",
      suffix: 502,
    });
    assert.equal(replacement.status, 201);

    const active = await activeFor({ businessId: seed.business._id, workerId: seed.worker._id, date });
    assert.equal(active.length, 1);
    assert.equal(active[0].startTime, "10:00");
    assert.equal(active[0].endTime, "12:00");
  });
});

test.after(async () => {
  await teardown(server, sessionStore);
});
