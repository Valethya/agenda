import "./setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import app, { sessionStore } from "../src/app.js";
import { connectDB } from "../src/db/db.js";
import { cleanTestData, seedTestData, teardown } from "./fixtures.js";
import Appointment from "../src/db/models/appointment.model.js";
import BusinessConfig from "../src/db/models/businessConfig.model.js";
import GuestAppointmentCapability from "../src/db/models/guestAppointmentCapability.model.js";
import Membership from "../src/db/models/membership.model.js";
import Service from "../src/db/models/service.model.js";
import * as serviceRepository from "../src/repositories/service.repository.js";
import * as userRepository from "../src/repositories/user.repository.js";
import { toggleBusinessStatus } from "../src/services/superadmin.service.js";
import { completeAppointment } from "../src/services/appointment.service.js";
import {
  consumeGuestAppointmentCancelCapability,
  consumeGuestAppointmentRescheduleCapability,
  exchangeGuestAppointmentCancelChallenge,
  exchangeGuestAppointmentRescheduleChallenge,
  requestGuestAppointmentCancelChallenge,
  requestGuestAppointmentRescheduleChallenge,
} from "../src/services/guestAppointmentCapability.service.js";
import { processNextGuestAppointmentVerificationJob } from "../src/services/guestAppointmentVerification.worker.js";
import {
  setAfterEligibilityFenceTestHookForTests,
  setAfterEligibilityReadTestHookForTests,
} from "../src/services/professionalEligibility.service.js";

await connectDB();
await cleanTestData();
const seed = await seedTestData();
const origin = "https://guest-reschedule-race.example.test";
await BusinessConfig.create({
  business: seed.business._id,
  businessName: seed.business.name,
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

const server = app.listen(0);
const { port } = server.address();
const baseUrl = `http://localhost:${port}/api`;
let cursor = new Date("2101-01-01T00:00:00.000Z");
let sequence = 0;

const slots = async (date) => {
  const response = await fetch(`${baseUrl}/availability/slots?businessId=${seed.business._id}&workerId=${seed.worker._id}&serviceId=${seed.service._id}&date=${date}`);
  assert.equal(response.status, 200);
  return (await response.json()).payload;
};
const isOpen = (values, startTime) => values.some((slot) => slot.startTime === startTime && slot.available !== false);
const nextOpenDate = async () => {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const date = cursor.toISOString().slice(0, 10);
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
    const values = await slots(date);
    if (isOpen(values, "10:00") && isOpen(values, "11:00")) return date;
  }
  throw new Error("No se encontró fecha abierta para concurrencia H3");
};
const nextDates = async (count) => {
  const values = [];
  for (let index = 0; index < count; index += 1) values.push(await nextOpenDate());
  return values;
};
const makeAppointment = async (date, startTime = "10:00") => {
  sequence += 1;
  const endTime = startTime === "10:00" ? "11:00" : "12:00";
  return Appointment.create({
    client: seed.client._id,
    worker: seed.worker._id,
    service: seed.service._id,
    business: seed.business._id,
    date: new Date(`${date}T00:00:00.000Z`),
    startTime,
    endTime,
    status: "confirmed",
    paymentStatus: "unpaid",
    guestContact: {
      channel: "email",
      destination: `h3-race-${sequence}@example.com`,
      provenance: "guest-booking-input-v1",
      capturedAt: new Date(),
    },
  });
};

const deliveredFragment = async (appointment, action) => {
  const request = action === "cancel" ? requestGuestAppointmentCancelChallenge : requestGuestAppointmentRescheduleChallenge;
  await request({ businessId: appointment.business, appointmentId: appointment._id });
  let accessUrl;
  const processed = await processNextGuestAppointmentVerificationJob({
    workerId: `h3-race-${crypto.randomBytes(8).toString("hex")}`,
    deliverVerification: async (payload) => { accessUrl = payload.accessUrl; return true; },
  });
  assert.equal(processed?.status, "delivered");
  return new URLSearchParams(new URL(accessUrl).hash.slice(1));
};
const mint = async (appointment, action) => {
  const proof = await deliveredFragment(appointment, action);
  const exchange = action === "cancel" ? exchangeGuestAppointmentCancelChallenge : exchangeGuestAppointmentRescheduleChallenge;
  return exchange({
    businessId: appointment.business,
    appointmentId: appointment._id,
    verificationId: proof.get("verificationId"),
    challengeSecret: proof.get("challenge"),
  });
};
const reschedule = (appointment, capability, date, startTime = "10:00") => consumeGuestAppointmentRescheduleCapability({
  businessId: appointment.business,
  appointmentId: appointment._id,
  bearer: capability.bearer,
  date,
  startTime,
});
const expectStateConflict = (promise) => assert.rejects(promise, (error) => error?.code === "GUEST_APPOINTMENT_RESCHEDULE_STATE_CONFLICT");

const installBarrier = (setter) => {
  let first = true;
  let resolveArrived;
  let release;
  const arrived = new Promise((resolve) => { resolveArrived = resolve; });
  const released = new Promise((resolve) => { release = resolve; });
  setter(async (context) => {
    if (!first) return;
    first = false;
    resolveArrived(context);
    await released;
  });
  return { arrived, release, clear: () => setter(null) };
};
const readBarrier = () => installBarrier(setAfterEligibilityReadTestHookForTests);
const fenceBarrier = () => installBarrier(setAfterEligibilityFenceTestHookForTests);

const runRevocationWins = async ({ mutate, restore }) => {
  const [dateA, dateB] = await nextDates(2);
  const appointment = await makeAppointment(dateA);
  const capability = await mint(appointment, "reschedule");
  const barrier = readBarrier();
  try {
    const pending = reschedule(appointment, capability, dateB, "11:00");
    await barrier.arrived;
    await mutate();
    barrier.release();
    await expectStateConflict(pending);
    const stored = await Appointment.findById(appointment._id);
    assert.equal(stored.date.toISOString().slice(0, 10), dateA);
    assert.equal(stored.startTime, "10:00");
    assert.equal((await GuestAppointmentCapability.findById(capability.capabilityId)).status, "active");
  } finally {
    barrier.release();
    barrier.clear();
    await restore();
  }
};

test("H3 adversarial reschedule concurrency", async (t) => {
  await t.test("swap A↔B does not deadlock or partially move either Appointment", async () => {
    const [dateA, dateB] = await nextDates(2);
    const x = await makeAppointment(dateA, "10:00");
    const y = await makeAppointment(dateB, "10:00");
    const [capX, capY] = await Promise.all([mint(x, "reschedule"), mint(y, "reschedule")]);
    const result = await Promise.allSettled([
      reschedule(x, capX, dateB, "10:00"),
      reschedule(y, capY, dateA, "10:00"),
    ]);
    assert.equal(result.filter((entry) => entry.status === "fulfilled").length, 0);
    const [storedX, storedY] = await Promise.all([Appointment.findById(x._id), Appointment.findById(y._id)]);
    assert.equal(storedX.date.toISOString().slice(0, 10), dateA);
    assert.equal(storedY.date.toISOString().slice(0, 10), dateB);
    assert.equal(storedX.startTime, "10:00");
    assert.equal(storedY.startTime, "10:00");
  });

  await t.test("guest CANCEL winning after H3 transactional read makes reschedule retry and fail coherently", async () => {
    const [dateA, dateB] = await nextDates(2);
    const appointment = await makeAppointment(dateA);
    const rescheduleCapability = await mint(appointment, "reschedule");
    const cancelCapability = await mint(appointment, "cancel");
    const barrier = readBarrier();
    try {
      const pending = reschedule(appointment, rescheduleCapability, dateB, "11:00");
      await barrier.arrived;
      const cancelled = await consumeGuestAppointmentCancelCapability({
        businessId: appointment.business,
        appointmentId: appointment._id,
        bearer: cancelCapability.bearer,
      });
      assert.equal(cancelled.status, "cancelled");
      barrier.release();
      await expectStateConflict(pending);
      const stored = await Appointment.findById(appointment._id);
      assert.equal(stored.status, "cancelled");
      assert.equal(stored.date.toISOString().slice(0, 10), dateA);
      assert.equal((await GuestAppointmentCapability.findById(rescheduleCapability.capabilityId)).status, "active");
    } finally {
      barrier.release();
      barrier.clear();
    }
  });

  await t.test("COMPLETE winning after H3 transactional read prevents stale move to B", async () => {
    const [dateA, dateB] = await nextDates(2);
    const appointment = await makeAppointment(dateA);
    const capability = await mint(appointment, "reschedule");
    const barrier = readBarrier();
    try {
      const pending = reschedule(appointment, capability, dateB, "11:00");
      await barrier.arrived;
      const completed = await completeAppointment(appointment._id, seed.worker._id, null, seed.business._id);
      assert.equal(completed.status, "completed");
      barrier.release();
      await expectStateConflict(pending);
      const stored = await Appointment.findById(appointment._id);
      assert.equal(stored.status, "completed");
      assert.equal(stored.date.toISOString().slice(0, 10), dateA);
      assert.equal((await GuestAppointmentCapability.findById(capability.capabilityId)).status, "active");
    } finally {
      barrier.release();
      barrier.clear();
    }
  });

  await t.test("Membership.isBookable revocation winning the G2 read fence prevents reschedule", async () => {
    await runRevocationWins({
      mutate: () => Membership.updateOne({ user: seed.worker._id, business: seed.business._id }, { $set: { isBookable: false } }),
      restore: () => Membership.updateOne({ user: seed.worker._id, business: seed.business._id }, { $set: { isBookable: true } }),
    });
  });

  await t.test("Membership.isActive revocation winning the G2 read fence prevents reschedule", async () => {
    await runRevocationWins({
      mutate: () => Membership.updateOne({ user: seed.worker._id, business: seed.business._id }, { $set: { isActive: false } }),
      restore: () => Membership.updateOne({ user: seed.worker._id, business: seed.business._id }, { $set: { isActive: true } }),
    });
  });

  await t.test("Service revocation winning the G2 read fence prevents reschedule", async () => {
    await runRevocationWins({
      mutate: () => serviceRepository.updateMutableByIdAndBusiness(seed.service._id, seed.business._id, { isActive: false }),
      restore: () => serviceRepository.updateMutableByIdAndBusiness(seed.service._id, seed.business._id, { isActive: true }),
    });
  });

  await t.test("User revocation winning the G2 read fence prevents reschedule", async () => {
    await runRevocationWins({
      mutate: () => userRepository.updateUser(seed.worker._id, { isActive: false }),
      restore: () => userRepository.updateUser(seed.worker._id, { isActive: true }),
    });
  });

  await t.test("Business revocation winning the G2 read fence prevents reschedule", async () => {
    await runRevocationWins({
      mutate: () => toggleBusinessStatus(seed.business._id),
      restore: () => toggleBusinessStatus(seed.business._id),
    });
  });

  await t.test("reschedule winning the G2 write fence commits before later bookability revocation", async () => {
    const [dateA, dateB] = await nextDates(2);
    const appointment = await makeAppointment(dateA);
    const capability = await mint(appointment, "reschedule");
    const barrier = fenceBarrier();
    let mutationCompleted = false;
    try {
      const pendingReschedule = reschedule(appointment, capability, dateB, "11:00");
      await barrier.arrived;
      const pendingRevocation = Membership.updateOne(
        { user: seed.worker._id, business: seed.business._id },
        { $set: { isBookable: false } },
      ).then((value) => { mutationCompleted = true; return value; });

      const current = await Membership.findOne({ user: seed.worker._id, business: seed.business._id });
      assert.equal(current.isBookable, true);
      assert.equal(mutationCompleted, false);
      barrier.release();

      const moved = await pendingReschedule;
      assert.equal(new Date(moved.date).toISOString().slice(0, 10), dateB);
      await pendingRevocation;
      assert.equal(mutationCompleted, true);
      assert.equal((await Membership.findOne({ user: seed.worker._id, business: seed.business._id })).isBookable, false);
      assert.equal((await Appointment.findById(appointment._id)).date.toISOString().slice(0, 10), dateB);
    } finally {
      barrier.release();
      barrier.clear();
      await Membership.updateOne({ user: seed.worker._id, business: seed.business._id }, { $set: { isBookable: true } });
    }
  });

  await t.test("Service.duration revocation race is revalidated and backend-derived endTime wins", async () => {
    const [dateA, dateB] = await nextDates(2);
    const appointment = await makeAppointment(dateA);
    const capability = await mint(appointment, "reschedule");
    const barrier = readBarrier();
    try {
      const pending = reschedule(appointment, capability, dateB, "10:00");
      await barrier.arrived;
      await serviceRepository.updateMutableByIdAndBusiness(seed.service._id, seed.business._id, { duration: 90 });
      barrier.release();
      const moved = await pending;
      assert.equal(moved.startTime, "10:00");
      assert.equal(moved.endTime, "11:30");
      const stored = await Appointment.findById(appointment._id);
      assert.equal(stored.endTime, "11:30");
    } finally {
      barrier.release();
      barrier.clear();
      const service = await Service.findById(seed.service._id);
      if (service?.duration !== 60) await serviceRepository.updateMutableByIdAndBusiness(seed.service._id, seed.business._id, { duration: 60 });
    }
  });
});

test.after(async () => {
  setAfterEligibilityReadTestHookForTests(null);
  setAfterEligibilityFenceTestHookForTests(null);
  await teardown(server, sessionStore);
});
