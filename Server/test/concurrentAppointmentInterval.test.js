import './setup.js';
import test from "node:test";
import assert from "node:assert/strict";
import app, { sessionStore } from "../src/app.js";
import { connectDB } from "../src/db/db.js";
import { seedTestData, cleanTestData, teardown } from "./fixtures.js";
import Appointment from "../src/db/models/appointment.model.js";
import AppointmentBookingMutex from "../src/db/models/appointmentBookingMutex.model.js";
import Business from "../src/db/models/business.model.js";
import Service from "../src/db/models/service.model.js";
import Shift from "../src/db/models/shift.model.js";
import User from "../src/db/models/user.model.js";
import Membership from "../src/db/models/membership.model.js";
import { createHash } from "../src/utils/password.js";
import { getAvailableSlots } from "../src/services/availability.service.js";
import { setBeforeBookingCommitTestHookForTests } from "../src/services/appointment.service.js";

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
    status: { $in: ["pending_payment", "pending", "confirmed", "completed"] },
  }).sort({ startTime: 1 });
};

const installCommitBarrier = ({ date, participants }) => {
  let arrived = 0;
  let resolveAllArrived;
  let release;
  const allArrived = new Promise((resolve) => { resolveAllArrived = resolve; });
  const released = new Promise((resolve) => { release = resolve; });

  setBeforeBookingCommitTestHookForTests(async (context) => {
    if (context.date !== date) return;
    arrived += 1;
    if (arrived === participants) resolveAllArrived();
    await released;
  });

  return {
    allArrived,
    release,
    clear: () => setBeforeBookingCommitTestHookForTests(null),
  };
};

const runConcurrentAtBarrier = async ({ date, requests }) => {
  const barrier = installCommitBarrier({ date, participants: requests.length });
  try {
    const pending = requests.map((request) => publicBook({ ...request, date }));
    await barrier.allArrived;
    barrier.release();
    return await Promise.all(pending);
  } finally {
    barrier.clear();
  }
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

test("G2 booking commit concurrency invariant", async (t) => {
  await t.test("mismo startTime concurrente deja exactamente un ganador y 409 para el perdedor", async () => {
    const date = "2099-06-29";
    const before = await Appointment.countDocuments({});
    const [first, second] = await runConcurrentAtBarrier({
      date,
      requests: [
        { businessId: seed.business._id, workerId: seed.worker._id, serviceId: service60._id, startTime: "09:00", suffix: 1 },
        { businessId: seed.business._id, workerId: seed.worker._id, serviceId: service60._id, startTime: "09:00", suffix: 2 },
      ],
    });

    assert.deepEqual([first.status, second.status].sort((a, b) => a - b), [201, 409]);
    const loserBody = await (first.status === 409 ? first : second).json();
    assert.equal(loserBody.code, "CONFLICT_ERROR");
    assert.equal(loserBody.message, "El horario seleccionado ya no se encuentra disponible");
    assert.equal(await Appointment.countDocuments({}), before + 1);

    const persisted = await activeFor({ businessId: seed.business._id, workerId: seed.worker._id, date });
    assert.equal(persisted.length, 1);
    assert.equal(persisted[0].business.toString(), seed.business._id.toString());
    assert.equal(persisted[0].worker.toString(), seed.worker._id.toString());
    assert.equal(persisted[0].service.toString(), service60._id.toString());
    assert.equal(persisted[0].endTime, "10:00");
  });

  await t.test("startTime distinto con overlap real concurrente deja exactamente un ganador", async () => {
    const date = "2099-07-06";
    const [longBooking, shortBooking] = await runConcurrentAtBarrier({
      date,
      requests: [
        { businessId: seed.business._id, workerId: seed.worker._id, serviceId: service120._id, startTime: "09:00", suffix: 11 },
        { businessId: seed.business._id, workerId: seed.worker._id, serviceId: service60._id, startTime: "10:00", suffix: 12 },
      ],
    });

    assert.deepEqual([longBooking.status, shortBooking.status].sort((a, b) => a - b), [201, 409]);
    assert.equal((await activeFor({ businessId: seed.business._id, workerId: seed.worker._id, date })).length, 1);
  });

  await t.test("intervalos adyacentes [09:00,10:00) y [10:00,11:00) pueden coexistir", async () => {
    const date = "2099-07-13";
    const [first, second] = await runConcurrentAtBarrier({
      date,
      requests: [
        { businessId: seed.business._id, workerId: seed.worker._id, serviceId: service60._id, startTime: "09:00", suffix: 21 },
        { businessId: seed.business._id, workerId: seed.worker._id, serviceId: service60._id, startTime: "10:00", suffix: 22 },
      ],
    });
    assert.deepEqual([first.status, second.status].sort((a, b) => a - b), [201, 201]);
  });

  await t.test("dos workers del mismo Business a la misma hora no comparten exclusión", async () => {
    const date = "2099-07-20";
    const [a, b] = await runConcurrentAtBarrier({
      date,
      requests: [
        { businessId: seed.business._id, workerId: seed.worker._id, serviceId: multiWorkerService._id, startTime: "09:00", suffix: 31 },
        { businessId: seed.business._id, workerId: workerA2._id, serviceId: multiWorkerService._id, startTime: "09:00", suffix: 32 },
      ],
    });
    assert.equal(a.status, 201);
    assert.equal(b.status, 201);
  });

  await t.test("Business distintos a la misma hora no comparten exclusión", async () => {
    const date = "2099-07-27";
    const [a, b] = await runConcurrentAtBarrier({
      date,
      requests: [
        { businessId: seed.business._id, workerId: seed.worker._id, serviceId: service60._id, startTime: "09:00", suffix: 41 },
        { businessId: seed.businessB._id, workerId: seed.workerB._id, serviceId: serviceB._id, startTime: "09:00", suffix: 42 },
      ],
    });
    assert.equal(a.status, 201);
    assert.equal(b.status, 201);
  });

  await t.test("cancelled libera el intervalo y no deja un lock histórico bloqueante", async () => {
    const date = "2099-08-03";
    const created = await publicBook({ businessId: seed.business._id, workerId: seed.worker._id, serviceId: service120._id, date, startTime: "09:00", suffix: 51 });
    assert.equal(created.status, 201);
    const createdBody = await created.json();

    const adminCookie = await loginAdmin();
    const cancelled = await fetch(`${baseUrl}/appointments/${createdBody.payload.appointmentId}/cancel`, {
      method: "PATCH",
      headers: { Cookie: adminCookie },
    });
    assert.equal(cancelled.status, 200);

    const replacement = await publicBook({ businessId: seed.business._id, workerId: seed.worker._id, serviceId: service120._id, date, startTime: "10:00", suffix: 52 });
    assert.equal(replacement.status, 201);
    assert.equal((await activeFor({ businessId: seed.business._id, workerId: seed.worker._id, date })).length, 1);

    const lockId = `${seed.business._id}:${seed.worker._id}:${date}`;
    assert.equal(await AppointmentBookingMutex.countDocuments({ _id: lockId }), 1);
  });

  await t.test("retry secuencial del mismo slot devuelve 409", async () => {
    const date = "2099-08-10";
    const first = await publicBook({ businessId: seed.business._id, workerId: seed.worker._id, serviceId: service60._id, date, startTime: "09:00", suffix: 61 });
    assert.equal(first.status, 201);
    const second = await publicBook({ businessId: seed.business._id, workerId: seed.worker._id, serviceId: service60._id, date, startTime: "09:00", suffix: 62 });
    assert.equal(second.status, 409);
  });

  await t.test("getAvailableSlots conserva el intervalo persistido como ocupado", async () => {
    const date = "2099-08-17";
    const created = await publicBook({ businessId: seed.business._id, workerId: seed.worker._id, serviceId: service60._id, date, startTime: "09:00", suffix: 71 });
    assert.equal(created.status, 201);
    const slots = await getAvailableSlots(seed.worker._id, date, service60._id, seed.business._id);
    assert.equal(slots.find((slot) => slot.startTime === "09:00")?.available, false);
    assert.equal(slots.find((slot) => slot.startTime === "10:00")?.available, true);
  });

  await t.test("si Membership deja de ser bookable después del precheck, el commit falla cerrado", async () => {
    const date = "2099-08-24";
    const barrier = installCommitBarrier({ date, participants: 1 });
    try {
      const pending = publicBook({ businessId: seed.business._id, workerId: seed.worker._id, serviceId: service60._id, date, startTime: "09:00", suffix: 81 });
      await barrier.allArrived;
      await Membership.updateOne(
        { user: seed.worker._id, business: seed.business._id },
        { $set: { isBookable: false } },
      );
      barrier.release();
      const response = await pending;
      assert.equal(response.status, 404);
      assert.equal((await activeFor({ businessId: seed.business._id, workerId: seed.worker._id, date })).length, 0);
    } finally {
      barrier.clear();
      await Membership.updateOne(
        { user: seed.worker._id, business: seed.business._id },
        { $set: { isBookable: true } },
      );
    }
  });

  await t.test("si Service se desactiva después del precheck, el commit falla cerrado", async () => {
    const date = "2099-08-31";
    const barrier = installCommitBarrier({ date, participants: 1 });
    try {
      const pending = publicBook({ businessId: seed.business._id, workerId: seed.worker._id, serviceId: service60._id, date, startTime: "09:00", suffix: 91 });
      await barrier.allArrived;
      await Service.updateOne({ _id: service60._id }, { $set: { isActive: false } });
      barrier.release();
      const response = await pending;
      assert.equal(response.status, 404);
      assert.equal((await activeFor({ businessId: seed.business._id, workerId: seed.worker._id, date })).length, 0);
    } finally {
      barrier.clear();
      await Service.updateOne({ _id: service60._id }, { $set: { isActive: true } });
    }
  });

  await t.test("si Service elimina al worker después del precheck, el commit falla cerrado", async () => {
    const date = "2099-09-07";
    const barrier = installCommitBarrier({ date, participants: 1 });
    try {
      const pending = publicBook({ businessId: seed.business._id, workerId: seed.worker._id, serviceId: service60._id, date, startTime: "09:00", suffix: 101 });
      await barrier.allArrived;
      await Service.updateOne({ _id: service60._id }, { $set: { workers: [] } });
      barrier.release();
      const response = await pending;
      assert.equal(response.status, 404);
      assert.equal((await activeFor({ businessId: seed.business._id, workerId: seed.worker._id, date })).length, 0);
    } finally {
      barrier.clear();
      await Service.updateOne({ _id: service60._id }, { $set: { workers: [seed.worker._id] } });
    }
  });

  await t.test("si Business queda inactivo después del precheck, el commit falla cerrado", async () => {
    const date = "2099-09-14";
    const barrier = installCommitBarrier({ date, participants: 1 });
    try {
      const pending = publicBook({ businessId: seed.business._id, workerId: seed.worker._id, serviceId: service60._id, date, startTime: "09:00", suffix: 111 });
      await barrier.allArrived;
      await Business.updateOne({ _id: seed.business._id }, { $set: { isActive: false } });
      barrier.release();
      const response = await pending;
      assert.equal(response.status, 404);
      assert.equal((await activeFor({ businessId: seed.business._id, workerId: seed.worker._id, date })).length, 0);
    } finally {
      barrier.clear();
      await Business.updateOne({ _id: seed.business._id }, { $set: { isActive: true } });
    }
  });
});

test.after(async () => {
  setBeforeBookingCommitTestHookForTests(null);
  await teardown(server, sessionStore);
});
