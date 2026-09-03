import './setup.js';
import test from "node:test";
import assert from "node:assert/strict";
import app, { sessionStore } from "../src/app.js";
import { connectDB } from "../src/db/db.js";
import { seedTestData, cleanTestData, teardown } from "./fixtures.js";
import Appointment from "../src/db/models/appointment.model.js";
import Membership from "../src/db/models/membership.model.js";
import Service from "../src/db/models/service.model.js";
import * as serviceRepository from "../src/repositories/service.repository.js";
import * as userRepository from "../src/repositories/user.repository.js";
import { toggleBusinessStatus } from "../src/services/superadmin.service.js";
import {
  setAfterEligibilityFenceTestHookForTests,
  setAfterEligibilityReadTestHookForTests,
} from "../src/services/professionalEligibility.service.js";

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

const installBarrier = (setter) => {
  let firstArrival = true;
  let resolveArrived;
  let release;
  const arrived = new Promise((resolve) => { resolveArrived = resolve; });
  const released = new Promise((resolve) => { release = resolve; });

  setter(async (context) => {
    if (!firstArrival) return;
    firstArrival = false;
    resolveArrived(context);
    await released;
  });

  return {
    arrived,
    release,
    clear: () => setter(null),
  };
};

const installEligibilityReadBarrier = () => installBarrier(setAfterEligibilityReadTestHookForTests);
const installEligibilityFenceBarrier = () => installBarrier(setAfterEligibilityFenceTestHookForTests);

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

const runBookingWinsRace = async ({
  date,
  suffix,
  mutate,
  assertMutationStillInvisible,
  assertFinalMutationState,
  restore,
}) => {
  const barrier = installEligibilityFenceBarrier();
  let mutationCompleted = false;
  let resolveMutationStarted;
  const mutationStarted = new Promise((resolve) => { resolveMutationStarted = resolve; });

  try {
    const pendingBooking = publicBook({ date, suffix });
    await barrier.arrived;

    const pendingMutation = (async () => {
      resolveMutationStarted();
      const result = await mutate();
      mutationCompleted = true;
      return result;
    })();

    await mutationStarted;

    // El booking sigue detenido después de haber escrito el fence. Esta lectura
    // externa fuerza un round-trip real a Mongo y debe seguir viendo el estado
    // administrativo previo: la mutación concurrente no puede committear por
    // delante del write ya abierto sobre Membership.bookingEligibilityRevision.
    await assertMutationStillInvisible();
    assert.equal(mutationCompleted, false);

    barrier.release();

    const bookingResponse = await pendingBooking;
    assert.equal(bookingResponse.status, 201);
    const appointments = await activeForDate(date);
    assert.equal(appointments.length, 1);
    assert.equal(appointments[0].startTime, "09:00");
    assert.equal(appointments[0].endTime, "10:00");

    await pendingMutation;
    assert.equal(mutationCompleted, true);
    await assertFinalMutationState();
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
      // Team muta físicamente esta misma Membership; no necesita un fence
      // auxiliar porque el booking también escribe este documento.
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

  await t.test("Service.isActive true -> false usa el fence per-worker y evita Appointment stale", async () => {
    await runRevocationWinsRace({
      date: "2099-10-05",
      suffix: 203,
      mutate: () => serviceRepository.updateMutableByIdAndBusiness(
        service._id,
        seed.business._id,
        { isActive: false },
      ),
      restore: () => serviceRepository.updateMutableByIdAndBusiness(
        service._id,
        seed.business._id,
        { isActive: true },
      ),
    });
  });

  await t.test("eliminar worker de Service después del read participa en el mismo fence", async () => {
    await runRevocationWinsRace({
      date: "2099-10-12",
      suffix: 204,
      mutate: () => serviceRepository.updateMutableByIdAndBusiness(
        service._id,
        seed.business._id,
        { workers: [] },
      ),
      restore: () => serviceRepository.updateMutableByIdAndBusiness(
        service._id,
        seed.business._id,
        { workers: [seed.worker._id] },
      ),
    });
  });

  await t.test("User.isActive true -> false usa sus Memberships como fences", async () => {
    await runRevocationWinsRace({
      date: "2099-10-19",
      suffix: 205,
      mutate: () => userRepository.updateUser(seed.worker._id, { isActive: false }),
      restore: () => userRepository.updateUser(seed.worker._id, { isActive: true }),
    });
  });

  await t.test("Business.isActive true -> false fencerea Memberships sin lock global de booking", async () => {
    await runRevocationWinsRace({
      date: "2099-10-26",
      suffix: 206,
      mutate: () => toggleBusinessStatus(seed.business._id),
      restore: () => toggleBusinessStatus(seed.business._id),
    });
  });

  await t.test("cambio concurrente de Service.duration reintenta y persiste duración serializable", async () => {
    const date = "2099-11-02";
    const barrier = installEligibilityReadBarrier();
    try {
      const pending = publicBook({ date, suffix: 207 });
      await barrier.arrived;
      await serviceRepository.updateMutableByIdAndBusiness(
        service._id,
        seed.business._id,
        { duration: 90 },
      );
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
      await serviceRepository.updateMutableByIdAndBusiness(
        service._id,
        seed.business._id,
        { duration: 60 },
      );
    }
  });

  await t.test("booking gana fence antes de Membership.isBookable=false y la revocación queda después", async () => {
    await runBookingWinsRace({
      date: "2099-11-09",
      suffix: 208,
      mutate: () => Membership.updateOne(
        { user: seed.worker._id, business: seed.business._id },
        { $set: { isBookable: false } },
      ),
      assertMutationStillInvisible: async () => {
        const membership = await Membership.findOne({
          user: seed.worker._id,
          business: seed.business._id,
        });
        assert.equal(membership.isBookable, true);
      },
      assertFinalMutationState: async () => {
        const membership = await Membership.findOne({
          user: seed.worker._id,
          business: seed.business._id,
        });
        assert.equal(membership.isBookable, false);
      },
      restore: () => Membership.updateOne(
        { user: seed.worker._id, business: seed.business._id },
        { $set: { isBookable: true } },
      ),
    });
  });

  await t.test("booking gana fence antes de Service.isActive=false y Service queda ordenado después", async () => {
    await runBookingWinsRace({
      date: "2099-11-16",
      suffix: 209,
      mutate: () => serviceRepository.updateMutableByIdAndBusiness(
        service._id,
        seed.business._id,
        { isActive: false },
      ),
      assertMutationStillInvisible: async () => {
        const currentService = await Service.findById(service._id);
        assert.equal(currentService.isActive, true);
      },
      assertFinalMutationState: async () => {
        const currentService = await Service.findById(service._id);
        assert.equal(currentService.isActive, false);
      },
      restore: () => serviceRepository.updateMutableByIdAndBusiness(
        service._id,
        seed.business._id,
        { isActive: true },
      ),
    });
  });
});

test.after(async () => {
  setAfterEligibilityReadTestHookForTests(null);
  setAfterEligibilityFenceTestHookForTests(null);
  await teardown(server, sessionStore);
});
