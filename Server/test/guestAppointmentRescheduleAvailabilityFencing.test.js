import "./setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import app, { sessionStore } from "../src/app.js";
import { connectDB } from "../src/db/db.js";
import { cleanTestData, seedTestData, teardown } from "./fixtures.js";
import Appointment from "../src/db/models/appointment.model.js";
import AuditLog from "../src/db/models/auditLog.model.js";
import BusinessConfig from "../src/db/models/businessConfig.model.js";
import GuestAppointmentCapability from "../src/db/models/guestAppointmentCapability.model.js";
import Service from "../src/db/models/service.model.js";
import * as appointmentRepository from "../src/repositories/appointment.repository.js";
import * as blockRepository from "../src/repositories/block.repository.js";
import * as holidayRepository from "../src/repositories/holiday.repository.js";
import * as serviceRepository from "../src/repositories/service.repository.js";
import * as availabilityService from "../src/services/availability.service.js";
import * as businessConfigService from "../src/services/businessConfig.service.js";
import {
  consumeGuestAppointmentRescheduleCapability,
  exchangeGuestAppointmentRescheduleChallenge,
  requestGuestAppointmentRescheduleChallenge,
} from "../src/services/guestAppointmentCapability.service.js";
import { processNextGuestAppointmentVerificationJob } from "../src/services/guestAppointmentVerification.worker.js";
import { setAfterEligibilityReadTestHookForTests } from "../src/services/professionalEligibility.service.js";

await connectDB();
await cleanTestData();
const seed = await seedTestData();
const origin = "https://guest-reschedule-availability-fence.example.test";
await BusinessConfig.create({
  business: seed.business._id,
  businessName: seed.business.name,
  appointmentSettings: { slotDuration: 30 },
  publicWeb: {
    websiteUrl: origin,
    bookingUrl: `${origin}/reservar`,
    verificationStatus: "verified",
    verifiedOrigin: origin,
    verifiedAt: new Date("2026-01-01T00:00:00.000Z"),
    verificationValidUntil: new Date("2200-01-01T00:00:00.000Z"),
    trustGeneration: 1,
    verificationAttemptGeneration: 1,
  },
});
await Service.updateOne({ _id: seed.service._id }, { $set: { duration: 60 } });

const server = app.listen(0);
const { port } = server.address();
const baseUrl = `http://localhost:${port}/api`;
let cursor = new Date("2102-01-01T00:00:00.000Z");
let sequence = 0;

const nextDate = () => {
  const date = cursor.toISOString().slice(0, 10);
  cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  return date;
};

const standardShift = Object.freeze({
  isOpen: true,
  startTime: "09:00",
  endTime: "18:00",
  breaks: [],
});

const setShift = async (date, patch = {}) => availabilityService.saveWorkerShift({
  businessId: seed.business._id,
  workerId: seed.worker._id.toString(),
  dayOfWeek: new Date(`${date}T00:00:00.000Z`).getUTCDay(),
  patch: { ...standardShift, ...patch },
});

const makeAppointment = async (date) => {
  sequence += 1;
  return Appointment.create({
    client: seed.client._id,
    worker: seed.worker._id,
    service: seed.service._id,
    business: seed.business._id,
    date: new Date(`${date}T00:00:00.000Z`),
    startTime: "10:00",
    endTime: "11:00",
    status: "confirmed",
    paymentStatus: "unpaid",
    guestContact: {
      channel: "email",
      destination: `h3-availability-${sequence}@example.com`,
      provenance: "guest-booking-input-v1",
      capturedAt: new Date(),
    },
  });
};

const mintReschedule = async (appointment) => {
  assert.deepEqual(await requestGuestAppointmentRescheduleChallenge({
    businessId: appointment.business,
    appointmentId: appointment._id,
  }), { accepted: true });

  let accessUrl;
  const processed = await processNextGuestAppointmentVerificationJob({
    workerId: `h3-availability-${crypto.randomBytes(8).toString("hex")}`,
    deliverVerification: async (payload) => {
      accessUrl = payload.accessUrl;
      return true;
    },
  });
  assert.equal(processed?.status, "delivered");
  const fragment = new URLSearchParams(new URL(accessUrl).hash.slice(1));
  return exchangeGuestAppointmentRescheduleChallenge({
    businessId: appointment.business,
    appointmentId: appointment._id,
    verificationId: fragment.get("verificationId"),
    challengeSecret: fragment.get("challenge"),
  });
};

const reschedule = (appointment, capability, date, startTime = "10:00") =>
  consumeGuestAppointmentRescheduleCapability({
    businessId: appointment.business,
    appointmentId: appointment._id,
    bearer: capability.bearer,
    date,
    startTime,
  });

const expectSlotConflict = (promise) => assert.rejects(
  promise,
  (error) => error?.code === "GUEST_APPOINTMENT_RESCHEDULE_SLOT_CONFLICT",
);

const assertAbortInvariant = async ({ appointment, capability, oldDate }) => {
  const stored = await Appointment.findById(appointment._id);
  assert.equal(stored.date.toISOString().slice(0, 10), oldDate);
  assert.equal(stored.startTime, "10:00");
  assert.equal(stored.endTime, "11:00");
  assert.equal((await GuestAppointmentCapability.findById(capability.capabilityId)).status, "active");
  assert.equal(await AuditLog.exists({ appointmentId: appointment._id, event: "APPOINTMENT_RESCHEDULED" }), null);
};

const runCalendarMutationWins = async ({ startTime = "10:00", prepare = null, mutate, restore }) => {
  const oldDate = nextDate();
  const newDate = nextDate();
  await setShift(newDate);
  if (prepare) await prepare(newDate);
  const appointment = await makeAppointment(oldDate);
  const capability = await mintReschedule(appointment);
  let invoked = false;
  appointmentRepository.setBeforeCanonicalAvailabilityFenceTestHookForTests(async () => {
    if (invoked) return;
    invoked = true;
    await mutate(newDate);
  });
  try {
    await expectSlotConflict(reschedule(appointment, capability, newDate, startTime));
    await assertAbortInvariant({ appointment, capability, oldDate });
  } finally {
    appointmentRepository.setBeforeCanonicalAvailabilityFenceTestHookForTests(null);
    if (restore) await restore(newDate);
  }
};

const installAfterFenceBarrier = () => {
  let first = true;
  let resolveArrived;
  let release;
  const arrived = new Promise((resolve) => { resolveArrived = resolve; });
  const released = new Promise((resolve) => { release = resolve; });
  appointmentRepository.setAfterCanonicalAvailabilityFenceTestHookForTests(async () => {
    if (!first) return;
    first = false;
    resolveArrived();
    await released;
  });
  return {
    arrived,
    release,
    clear: () => appointmentRepository.setAfterCanonicalAvailabilityFenceTestHookForTests(null),
  };
};

test("H3 canonical availability commit fencing", async (t) => {
  await t.test("SHIFT close committed after discovery makes reschedule fail closed", async () => {
    await runCalendarMutationWins({
      mutate: (date) => setShift(date, { isOpen: false }),
      restore: (date) => setShift(date),
    });
  });

  await t.test("SHIFT window change committed after discovery invalidates B", async () => {
    await runCalendarMutationWins({
      mutate: (date) => setShift(date, { endTime: "10:30" }),
      restore: (date) => setShift(date),
    });
  });

  await t.test("BREAK change committed after discovery invalidates B", async () => {
    await runCalendarMutationWins({
      mutate: (date) => setShift(date, { breaks: [{ startTime: "10:30", endTime: "11:30" }] }),
      restore: (date) => setShift(date),
    });
  });

  await t.test("BLOCK create committed after discovery invalidates B", async () => {
    let block = null;
    await runCalendarMutationWins({
      mutate: async (date) => {
        block = await blockRepository.createForBusinessWorker(seed.business._id, seed.worker._id, {
          date: new Date(`${date}T00:00:00.000Z`),
          startTime: "10:00",
          endTime: "11:00",
          reason: "H3 race",
        });
      },
      restore: async () => {
        if (block) await blockRepository.deleteByIdBusinessAndWorker(block._id, seed.business._id, seed.worker._id);
      },
    });
  });

  await t.test("BLOCK create then remove before canonical commit lets the final serialized state win", async () => {
    const oldDate = nextDate();
    const newDate = nextDate();
    await setShift(newDate);
    const appointment = await makeAppointment(oldDate);
    const capability = await mintReschedule(appointment);
    let invoked = false;
    appointmentRepository.setBeforeCanonicalAvailabilityFenceTestHookForTests(async () => {
      if (invoked) return;
      invoked = true;
      const block = await blockRepository.createForBusinessWorker(seed.business._id, seed.worker._id, {
        date: new Date(`${newDate}T00:00:00.000Z`),
        startTime: "10:00",
        endTime: "11:00",
        reason: "temporary H3 race",
      });
      await blockRepository.deleteByIdBusinessAndWorker(block._id, seed.business._id, seed.worker._id);
    });
    try {
      const moved = await reschedule(appointment, capability, newDate);
      assert.equal(new Date(moved.date).toISOString().slice(0, 10), newDate);
      assert.equal(moved.startTime, "10:00");
      assert.equal((await GuestAppointmentCapability.findById(capability.capabilityId)).status, "consumed");
    } finally {
      appointmentRepository.setBeforeCanonicalAvailabilityFenceTestHookForTests(null);
    }
  });

  await t.test("HOLIDAY committed after discovery invalidates B", async () => {
    let holiday = null;
    await runCalendarMutationWins({
      mutate: async (date) => {
        holiday = await holidayRepository.create({
          date: new Date(`${date}T00:00:00.000Z`),
          name: "H3 race holiday",
          isHalfDay: false,
        });
      },
      restore: async () => {
        if (holiday) await holidayRepository.deleteById(holiday._id);
      },
    });
  });

  await t.test("Service.duration expanding into a break is rejected by the canonical commit window", async () => {
    const oldDate = nextDate();
    const newDate = nextDate();
    await setShift(newDate, { breaks: [{ startTime: "11:00", endTime: "12:00" }] });
    const appointment = await makeAppointment(oldDate);
    const capability = await mintReschedule(appointment);
    let invoked = false;
    setAfterEligibilityReadTestHookForTests(async () => {
      if (invoked) return;
      invoked = true;
      await serviceRepository.updateMutableByIdAndBusiness(
        seed.service._id,
        seed.business._id,
        { duration: 90 },
      );
    });
    try {
      await expectSlotConflict(reschedule(appointment, capability, newDate, "10:00"));
      await assertAbortInvariant({ appointment, capability, oldDate });
    } finally {
      setAfterEligibilityReadTestHookForTests(null);
      await serviceRepository.updateMutableByIdAndBusiness(seed.service._id, seed.business._id, { duration: 60 });
      await setShift(newDate);
    }
  });

  await t.test("Service.duration expanding past Shift end is rejected", async () => {
    const oldDate = nextDate();
    const newDate = nextDate();
    await setShift(newDate);
    const appointment = await makeAppointment(oldDate);
    const capability = await mintReschedule(appointment);
    let invoked = false;
    setAfterEligibilityReadTestHookForTests(async () => {
      if (invoked) return;
      invoked = true;
      await serviceRepository.updateMutableByIdAndBusiness(
        seed.service._id,
        seed.business._id,
        { duration: 90 },
      );
    });
    try {
      await expectSlotConflict(reschedule(appointment, capability, newDate, "17:00"));
      await assertAbortInvariant({ appointment, capability, oldDate });
    } finally {
      setAfterEligibilityReadTestHookForTests(null);
      await serviceRepository.updateMutableByIdAndBusiness(seed.service._id, seed.business._id, { duration: 60 });
    }
  });

  await t.test("slotDuration grid change committed after discovery invalidates startTime", async () => {
    await businessConfigService.updateConfig(seed.business._id, { appointmentSettings: { slotDuration: 30 } });
    await runCalendarMutationWins({
      mutate: () => businessConfigService.updateConfig(seed.business._id, { appointmentSettings: { slotDuration: 45 } }),
      restore: () => businessConfigService.updateConfig(seed.business._id, { appointmentSettings: { slotDuration: 30 } }),
    });
  });

  const commitWinsCases = [
    {
      name: "SHIFT",
      mutate: (date) => setShift(date, { isOpen: false }),
      restore: (date) => setShift(date),
    },
    {
      name: "BLOCK",
      mutate: (date) => blockRepository.createForBusinessWorker(seed.business._id, seed.worker._id, {
        date: new Date(`${date}T00:00:00.000Z`),
        startTime: "10:00",
        endTime: "11:00",
        reason: "post-commit H3 block",
      }),
      restore: async (_date, value) => {
        if (value?._id) await blockRepository.deleteByIdBusinessAndWorker(value._id, seed.business._id, seed.worker._id);
      },
    },
    {
      name: "HOLIDAY",
      mutate: (date) => holidayRepository.create({
        date: new Date(`${date}T00:00:00.000Z`),
        name: "post-commit H3 holiday",
        isHalfDay: false,
      }),
      restore: async (_date, value) => {
        if (value?._id) await holidayRepository.deleteById(value._id);
      },
    },
    {
      name: "CONFIG",
      prepare: () => businessConfigService.updateConfig(seed.business._id, { appointmentSettings: { slotDuration: 30 } }),
      mutate: () => businessConfigService.updateConfig(seed.business._id, { appointmentSettings: { slotDuration: 45 } }),
      restore: () => businessConfigService.updateConfig(seed.business._id, { appointmentSettings: { slotDuration: 30 } }),
    },
  ];

  for (const scenario of commitWinsCases) {
    await t.test(`${scenario.name} mutation waits when H3 acquired the canonical fence first`, async () => {
      const oldDate = nextDate();
      const newDate = nextDate();
      await setShift(newDate);
      if (scenario.prepare) await scenario.prepare(newDate);
      const appointment = await makeAppointment(oldDate);
      const capability = await mintReschedule(appointment);
      const barrier = installAfterFenceBarrier();
      let mutationCompleted = false;
      let mutationValue = null;
      let resolveStarted;
      const started = new Promise((resolve) => { resolveStarted = resolve; });
      try {
        const pendingReschedule = reschedule(appointment, capability, newDate, "10:00");
        await barrier.arrived;
        const pendingMutation = (async () => {
          resolveStarted();
          mutationValue = await scenario.mutate(newDate);
          mutationCompleted = true;
          return mutationValue;
        })();
        await started;
        await Appointment.findById(appointment._id);
        assert.equal(mutationCompleted, false);

        barrier.release();
        const moved = await pendingReschedule;
        assert.equal(new Date(moved.date).toISOString().slice(0, 10), newDate);
        await pendingMutation;
        assert.equal(mutationCompleted, true);
        assert.equal((await Appointment.findById(appointment._id)).date.toISOString().slice(0, 10), newDate);
      } finally {
        barrier.release();
        barrier.clear();
        if (scenario.restore) await scenario.restore(newDate, mutationValue);
      }
    });
  }

  await t.test("public booking shares the same canonical commit fence", async () => {
    const date = nextDate();
    await setShift(date);
    let invoked = false;
    appointmentRepository.setBeforeCanonicalAvailabilityFenceTestHookForTests(async () => {
      if (invoked) return;
      invoked = true;
      await setShift(date, { isOpen: false });
    });
    try {
      const response = await fetch(`${baseUrl}/appointments?businessId=${seed.business._id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          worker: seed.worker._id.toString(),
          service: seed.service._id.toString(),
          date,
          startTime: "10:00",
          clientInfo: {
            firstName: "Canonical",
            lastName: "Fence",
            email: `canonical-${crypto.randomBytes(4).toString("hex")}@example.com`,
            phone: "+56981112222",
          },
        }),
      });
      assert.equal(response.status, 409);
      assert.equal(await Appointment.exists({
        business: seed.business._id,
        worker: seed.worker._id,
        date: new Date(`${date}T00:00:00.000Z`),
        startTime: "10:00",
      }), null);
    } finally {
      appointmentRepository.setBeforeCanonicalAvailabilityFenceTestHookForTests(null);
      await setShift(date);
    }
  });
});

test.after(async () => {
  appointmentRepository.setBeforeCanonicalAvailabilityFenceTestHookForTests(null);
  appointmentRepository.setAfterCanonicalAvailabilityFenceTestHookForTests(null);
  setAfterEligibilityReadTestHookForTests(null);
  await serviceRepository.updateMutableByIdAndBusiness(seed.service._id, seed.business._id, { duration: 60 });
  await businessConfigService.updateConfig(seed.business._id, { appointmentSettings: { slotDuration: 30 } });
  await teardown(server, sessionStore);
});
