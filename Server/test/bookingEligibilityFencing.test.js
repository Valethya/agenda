import './setup.js';
import test from "node:test";
import assert from "node:assert/strict";
import app, { sessionStore } from "../src/app.js";
import { connectDB } from "../src/db/db.js";
import { seedTestData, cleanTestData, teardown } from "./fixtures.js";
import Appointment from "../src/db/models/appointment.model.js";
import Business from "../src/db/models/business.model.js";
import Membership from "../src/db/models/membership.model.js";
import Service from "../src/db/models/service.model.js";
import User from "../src/db/models/user.model.js";
import { setAfterEligibilityReadTestHookForTests } from "../src/services/professionalEligibility.service.js";

await connectDB();
await cleanTestData();
const seed = await seedTestData();

const service = await Service.create({
  name: "Servicio fencing G2",
  description: "Pruebas adversariales de elegibilidad",
  duration: 60,
  price: 10000,
  depositAmount: 0,
  business: seed.business._id,
  workers: [seed.worker._id],
  isActive: true,
});

const server = app.listen(0);
const { port } = server.address();
const baseUrl = `http://localhost:${port}/api`;

const guest = (suffix) => ({
  firstName: "Fence",
  lastName: `Guest ${suffix}`,
  email: `fence-${suffix}@example.com`,
  phone: `+56973${String(suffix).padStart(6, "0")}`,
});

const publicBook = ({ date, suffix }) => fetch(
  `${baseUrl}/appointments?businessId=${seed.business._id}`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      worker: seed.worker._id.toString(),
      service: service._id.toString(),
      date,
      startTime: "09:00",
      clientInfo: guest(suffix),
    }),
  },
);

const activeForDate = async (date) => Appointment.find({
  business: seed.business._id,
  worker: seed.worker._id,
  date: {
    $gte: new Date(`${date}T00:00:00.000Z`),
    $lte: new Date(`${date}T23:59:59.999Z`),
  },
  status: { $in: ["pending_payment", "pending", "confirmed", "completed"] },
});

const installEligibilityReadBarrier = () => {
  let firstArrival = true;
  let resolveArrived;
  let release;
  const arrived = new Promise((resolve) => { resolveArrived = resolve; });
  const released = new Promise((resolve) => { release = resolve; });

  setAfterEligibilityReadTestHookForTests(async (context) => {
    if (!firstArrival) return;
    firstArrival = false;
    resolveArrived(context);
    await released;
  });

  return {
    arrived,
    release,
    clear: () => setAfterEligibilityReadTestHookForTests(null),
  };
};

const runRevocationWinsRace = async ({ date, suffix, mutate, restore }) => {
  const barrier = installEligibilityReadBarrier();
  try {
    const pending = publicBook({ date, suffix });
    await barrier.arrived;
    await mutate();
    barrier.release();
    const response = await pending;
    assert.equal(response.status, 404);
    assert.equal((await activeForDate(date)).length, 0);
  } finally {
    barrier.release();
    barrier.clear();
    await restore();
  }
};

test("G2 eligibility write fencing", async (t) => {
  await t.test("Membership.isBookable true -> false committed después del read impide Appointment stale", async () => {
    await runRevocationWinsRace({
      date: "2099-09-21",
      suffix: 201,
      mutate: () => Membership.updateOne(
        { user: seed.worker._id, business: seed.business._id },
        { $set: { isBookable: false } },
      ),
      restore: () => Membership.updateOne(
        { user: seed.worker._id, business: seed.business._id },
        { $set: { isBookable: true } },
      ),
    });
  });

  await t.test("Membership.isActive true -> false committed después del read impide Appointment stale", async () => {
    await runRevocationWinsRace({
      date: "2099-09-28",
      suffix: 202,
      mutate: () => Membership.updateOne(
        { user: seed.worker._id, business: seed.business._id },
        { $set: { isActive: false } },
      ),
      restore: () => Membership.updateOne(
        { user: seed.worker._id, business: seed.business._id },
        { $set: { isActive: true } },
      ),
    });
  });

  await t.test("Service.isActive true -> false committed después del read impide Appointment stale", async () => {
    await runRevocationWinsRace({
      date: "2099-10-05",
      suffix: 203,
      mutate: () => Service.updateOne({ _id: service._id }, { $set: { isActive: false } }),
      restore: () => Service.updateOne({ _id: service._id }, { $set: { isActive: true } }),
    });
  });

  await t.test("eliminar worker de Service después del read impide Appointment stale", async () => {
    await runRevocationWinsRace({
      date: "2099-10-12",
      suffix: 204,
      mutate: () => Service.updateOne({ _id: service._id }, { $set: { workers: [] } }),
      restore: () => Service.updateOne({ _id: service._id }, { $set: { workers: [seed.worker._id] } }),
    });
  });

  await t.test("User.isActive true -> false committed después del read impide Appointment stale", async () => {
    await runRevocationWinsRace({
      date: "2099-10-19",
      suffix: 205,
      mutate: () => User.updateOne({ _id: seed.worker._id }, { $set: { isActive: false } }),
      restore: () => User.updateOne({ _id: seed.worker._id }, { $set: { isActive: true } }),
    });
  });

  await t.test("Business.isActive true -> false committed después del read impide Appointment stale", async () => {
    await runRevocationWinsRace({
      date: "2099-10-26",
      suffix: 206,
      mutate: () => Business.updateOne({ _id: seed.business._id }, { $set: { isActive: false } }),
      restore: () => Business.updateOne({ _id: seed.business._id }, { $set: { isActive: true } }),
    });
  });

  await t.test("cambio concurrente de Service.duration se reintenta y persiste una duración serializable", async () => {
    const date = "2099-11-02";
    const barrier = installEligibilityReadBarrier();
    try {
      const pending = publicBook({ date, suffix: 207 });
      await barrier.arrived;
      await Service.updateOne({ _id: service._id }, { $set: { duration: 90 } });
      barrier.release();

      const response = await pending;
      assert.equal(response.status, 201);
      const appointments = await activeForDate(date);
      assert.equal(appointments.length, 1);
      assert.equal(appointments[0].startTime, "09:00");
      assert.equal(appointments[0].endTime, "10:30");
      assert.equal(appointments[0].service.toString(), service._id.toString());
    } finally {
      barrier.release();
      barrier.clear();
      await Service.updateOne({ _id: service._id }, { $set: { duration: 60 } });
    }
  });
});

test.after(async () => {
  setAfterEligibilityReadTestHookForTests(null);
  await teardown(server, sessionStore);
});
