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
import GuestAppointmentVerificationJob from "../src/db/models/guestAppointmentVerificationJob.model.js";
import * as appointmentRepository from "../src/repositories/appointment.repository.js";
import {
  consumeGuestAppointmentCancelCapability,
  consumeGuestAppointmentReadCapability,
  exchangeGuestAppointmentCancelChallenge,
  exchangeGuestAppointmentReadChallenge,
  requestGuestAppointmentCancelChallenge,
  requestGuestAppointmentReadChallenge,
} from "../src/services/guestAppointmentCapability.service.js";
import { processNextGuestAppointmentVerificationJob } from "../src/services/guestAppointmentVerification.worker.js";

await connectDB();
await cleanTestData();
const seed = await seedTestData();
const origin = "https://guest-cancel.example.test";
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
let sequence = 0;

const invalidProof = (promise) => assert.rejects(
  promise,
  (error) => error?.code === "GUEST_APPOINTMENT_CAPABILITY_INVALID_PROOF",
);
const stateConflict = (promise) => assert.rejects(
  promise,
  (error) => error?.code === "GUEST_APPOINTMENT_CANCEL_STATE_CONFLICT",
);

const createAppointment = async ({ status = "confirmed", business = seed.business, worker = seed.worker, service = seed.service } = {}) => {
  sequence += 1;
  return Appointment.create({
    client: seed.client._id,
    worker: worker._id,
    service: service._id,
    business: business._id,
    date: new Date(Date.UTC(2099, 8, 14 + sequence)),
    startTime: "10:00",
    endTime: "11:00",
    status,
    paymentStatus: "pending",
    guestContact: {
      channel: "email",
      destination: `guest-cancel-${sequence}@example.com`,
      provenance: "guest-booking-input-v1",
      capturedAt: new Date(),
    },
  });
};

const processProof = async ({ appointment, action }) => {
  const request = action === "cancel"
    ? requestGuestAppointmentCancelChallenge
    : requestGuestAppointmentReadChallenge;
  const response = await request({ businessId: appointment.business, appointmentId: appointment._id });
  assert.deepEqual(response, { accepted: true });

  let accessUrl = null;
  const result = await processNextGuestAppointmentVerificationJob({
    workerId: `h2-${action}-${crypto.randomBytes(8).toString("hex")}`,
    deliverVerification: async (payload) => {
      accessUrl = payload.accessUrl;
      return true;
    },
  });
  assert.equal(result?.status, "delivered");
  assert.ok(accessUrl);
  const fragment = new URLSearchParams(new URL(accessUrl).hash.slice(1));
  assert.equal(fragment.get("appointmentId"), appointment._id.toString());
  assert.equal(fragment.get("businessId"), appointment.business.toString());
  assert.equal(fragment.get("purpose"), `appointment-${action}-bootstrap`);
  return fragment;
};

const cancelCapability = async (appointment) => {
  const fragment = await processProof({ appointment, action: "cancel" });
  return exchangeGuestAppointmentCancelChallenge({
    businessId: appointment.business,
    appointmentId: appointment._id,
    verificationId: fragment.get("verificationId"),
    challengeSecret: fragment.get("challenge"),
  });
};

const readCapability = async (appointment) => {
  const fragment = await processProof({ appointment, action: "read" });
  return exchangeGuestAppointmentReadChallenge({
    businessId: appointment.business,
    appointmentId: appointment._id,
    verificationId: fragment.get("verificationId"),
    challengeSecret: fragment.get("challenge"),
  });
};

const publicBook = async ({ date, startTime = "10:00", suffix = "flow" }) => {
  const response = await fetch(`${baseUrl}/appointments?businessId=${seed.business._id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      worker: seed.worker._id.toString(),
      service: seed.service._id.toString(),
      date,
      startTime,
      clientInfo: {
        firstName: "Guest",
        lastName: "Cancellation",
        email: `h2-${suffix}@example.com`,
        phone: `+5697${String(sequence + 1000).padStart(7, "0")}`,
      },
    }),
  });
  const body = await response.json();
  return { response, body };
};

const availableSlots = async (date) => {
  const response = await fetch(
    `${baseUrl}/availability/slots?businessId=${seed.business._id}&workerId=${seed.worker._id}&serviceId=${seed.service._id}&date=${date}`,
  );
  assert.equal(response.status, 200);
  return (await response.json()).payload;
};

const slotExists = (slots, startTime) => slots.some((slot) => slot.startTime === startTime);

test("H2 guest cancellation capability boundary", async (t) => {
  await t.test("CANCEL challenge remains non-enumerative", async () => {
    const appointment = await createAppointment();
    const real = await requestGuestAppointmentCancelChallenge({
      businessId: seed.business._id,
      appointmentId: appointment._id,
    });
    const missing = await requestGuestAppointmentCancelChallenge({
      businessId: seed.business._id,
      appointmentId: new Appointment()._id,
    });
    assert.deepEqual(real, { accepted: true });
    assert.deepEqual(missing, { accepted: true });
    await GuestAppointmentVerificationJob.deleteMany({ appointment: { $in: [appointment._id] } });
  });

  await t.test("valid CANCEL proof mints only exact CANCEL; READ proof cannot mint CANCEL", async () => {
    const appointment = await createAppointment();
    const cancelFragment = await processProof({ appointment, action: "cancel" });
    const capability = await exchangeGuestAppointmentCancelChallenge({
      businessId: appointment.business,
      appointmentId: appointment._id,
      verificationId: cancelFragment.get("verificationId"),
      challengeSecret: cancelFragment.get("challenge"),
    });
    assert.equal(capability.action, "cancel");
    assert.equal(capability.businessId.toString(), appointment.business.toString());
    assert.equal(capability.appointmentId.toString(), appointment._id.toString());

    const other = await createAppointment();
    const readFragment = await processProof({ appointment: other, action: "read" });
    await invalidProof(exchangeGuestAppointmentCancelChallenge({
      businessId: other.business,
      appointmentId: other._id,
      verificationId: readFragment.get("verificationId"),
      challengeSecret: readFragment.get("challenge"),
    }));
  });

  await t.test("READ capability cannot cancel", async () => {
    const appointment = await createAppointment();
    const read = await readCapability(appointment);
    await invalidProof(consumeGuestAppointmentCancelCapability({
      businessId: appointment.business,
      appointmentId: appointment._id,
      bearer: read.bearer,
    }));
    assert.equal((await Appointment.findById(appointment._id)).status, "confirmed");
  });

  await t.test("CANCEL is exact Appointment + Business scope and wrong attempts do not consume the valid bearer", async () => {
    const appointment = await createAppointment();
    const other = await createAppointment();
    const capability = await cancelCapability(appointment);

    await invalidProof(consumeGuestAppointmentCancelCapability({
      businessId: appointment.business,
      appointmentId: other._id,
      bearer: capability.bearer,
    }));
    await invalidProof(consumeGuestAppointmentCancelCapability({
      businessId: seed.businessB._id,
      appointmentId: appointment._id,
      bearer: capability.bearer,
    }));

    const result = await consumeGuestAppointmentCancelCapability({
      businessId: appointment.business,
      appointmentId: appointment._id,
      bearer: capability.bearer,
    });
    assert.equal(result.status, "cancelled");
  });

  await t.test("expired CANCEL fails closed and successful CANCEL is single-use", async () => {
    const expiredAppointment = await createAppointment();
    const expired = await cancelCapability(expiredAppointment);
    await GuestAppointmentCapability.updateOne(
      { _id: expired.capabilityId },
      { $set: { expiresAt: new Date("2000-01-01T00:00:00.000Z") } },
    );
    await invalidProof(consumeGuestAppointmentCancelCapability({
      businessId: expiredAppointment.business,
      appointmentId: expiredAppointment._id,
      bearer: expired.bearer,
    }));
    assert.equal((await Appointment.findById(expiredAppointment._id)).status, "confirmed");

    const appointment = await createAppointment();
    const capability = await cancelCapability(appointment);
    await consumeGuestAppointmentCancelCapability({
      businessId: appointment.business,
      appointmentId: appointment._id,
      bearer: capability.bearer,
    });
    await invalidProof(consumeGuestAppointmentCancelCapability({
      businessId: appointment.business,
      appointmentId: appointment._id,
      bearer: capability.bearer,
    }));
  });

  for (const status of ["pending", "pending_payment", "confirmed"]) {
    await t.test(`${status} -> cancelled preserves Appointment history`, async () => {
      const appointment = await createAppointment({ status });
      const capability = await cancelCapability(appointment);
      const result = await consumeGuestAppointmentCancelCapability({
        businessId: appointment.business,
        appointmentId: appointment._id,
        bearer: capability.bearer,
      });
      assert.equal(result.status, "cancelled");
      const stored = await Appointment.findById(appointment._id).lean();
      assert.ok(stored);
      assert.equal(stored.status, "cancelled");
      assert.equal(stored.startTime, "10:00");
      assert.equal(stored.endTime, "11:00");
    });
  }

  for (const status of ["completed", "cancelled"]) {
    await t.test(`${status} cannot be guest-cancelled`, async () => {
      const appointment = await createAppointment({ status });
      const capability = await cancelCapability(appointment);
      await stateConflict(consumeGuestAppointmentCancelCapability({
        businessId: appointment.business,
        appointmentId: appointment._id,
        bearer: capability.bearer,
      }));
      assert.equal((await Appointment.findById(appointment._id)).status, status);
      const storedCapability = await GuestAppointmentCapability.findById(capability.capabilityId).lean();
      assert.equal(storedCapability.status, "active", "state conflict must rollback capability consumption");
    });
  }

  await t.test("concurrent status change wins -> cancellation conflicts and transaction rolls capability back", async () => {
    const appointment = await createAppointment();
    const capability = await cancelCapability(appointment);
    const barrier = {};
    barrier.beforeCancel = new Promise((resolve) => { barrier.release = resolve; });

    await Appointment.updateOne({ _id: appointment._id }, { $set: { status: "completed" } });
    barrier.release();
    await barrier.beforeCancel;

    await stateConflict(consumeGuestAppointmentCancelCapability({
      businessId: appointment.business,
      appointmentId: appointment._id,
      bearer: capability.bearer,
    }));
    assert.equal((await Appointment.findById(appointment._id)).status, "completed");
    assert.equal((await GuestAppointmentCapability.findById(capability.capabilityId)).status, "active");
  });

  await t.test("successful guest cancellation writes guest audit without userId, bearer, challenge or guestContact", async () => {
    const appointment = await createAppointment();
    const capability = await cancelCapability(appointment);
    const bearerValue = capability.bearer;
    await consumeGuestAppointmentCancelCapability({
      businessId: appointment.business,
      appointmentId: appointment._id,
      bearer: bearerValue,
    });
    const audit = await AuditLog.findOne({ appointmentId: appointment._id, event: "APPOINTMENT_CANCELLED" }).lean();
    assert.ok(audit);
    assert.equal(audit.userId, undefined);
    assert.equal(audit.metadata.actorCapability, "guest-cancel");
    const serialized = JSON.stringify(audit);
    assert.equal(serialized.includes(bearerValue), false);
    assert.equal(serialized.includes("challenge"), false);
    assert.equal(serialized.includes("guestContact"), false);
  });

  await t.test("cancelled is excluded from discovery and authoritative booking overlap", async () => {
    const appointment = await createAppointment();
    const capability = await cancelCapability(appointment);
    await consumeGuestAppointmentCancelCapability({
      businessId: appointment.business,
      appointmentId: appointment._id,
      bearer: capability.bearer,
    });

    const dayStart = new Date(appointment.date);
    dayStart.setUTCHours(0, 0, 0, 0);
    const dayEnd = new Date(appointment.date);
    dayEnd.setUTCHours(23, 59, 59, 999);
    const discovery = await appointmentRepository.findByBusinessWorkerAndDate(
      appointment.business,
      appointment.worker,
      dayStart,
      dayEnd,
    );
    assert.equal(discovery.some((value) => value._id.toString() === appointment._id.toString()), false);

    const overlap = await appointmentRepository.findActiveOverlapByBusinessWorkerDate(
      appointment.business,
      appointment.worker,
      dayStart,
      dayEnd,
      appointment.startTime,
      appointment.endTime,
    );
    assert.equal(overlap, null);
  });

  await t.test("full canonical flow: available -> book -> unavailable -> guest cancel -> available -> rebook", async () => {
    const date = "2099-09-14"; // Monday, within seeded shift.
    const before = await availableSlots(date);
    assert.equal(slotExists(before, "10:00"), true);

    const booked = await publicBook({ date, suffix: "flow-a" });
    assert.equal(booked.response.status, 201);
    const appointmentId = booked.body.payload.appointmentId;
    const appointment = await Appointment.findById(appointmentId);
    assert.ok(appointment);
    assert.equal(appointment.status, "pending");

    const blocked = await availableSlots(date);
    assert.equal(slotExists(blocked, "10:00"), false);

    const capability = await cancelCapability(appointment);
    const cancelled = await consumeGuestAppointmentCancelCapability({
      businessId: seed.business._id,
      appointmentId: appointment._id,
      bearer: capability.bearer,
    });
    assert.equal(cancelled.status, "cancelled");

    const released = await availableSlots(date);
    assert.equal(slotExists(released, "10:00"), true);

    const rebooked = await publicBook({ date, suffix: "flow-b" });
    assert.equal(rebooked.response.status, 201);
    const replacement = await Appointment.findById(rebooked.body.payload.appointmentId);
    assert.ok(replacement);
    assert.notEqual(replacement._id.toString(), appointment._id.toString());
    assert.equal((await Appointment.findById(appointment._id)).status, "cancelled");
  });

  await t.test("H1 READ still reads a cancelled Appointment", async () => {
    const appointment = await createAppointment();
    const cancel = await cancelCapability(appointment);
    await consumeGuestAppointmentCancelCapability({
      businessId: appointment.business,
      appointmentId: appointment._id,
      bearer: cancel.bearer,
    });
    const read = await readCapability(appointment);
    const detail = await consumeGuestAppointmentReadCapability({
      businessId: appointment.business,
      appointmentId: appointment._id,
      bearer: read.bearer,
    });
    assert.equal(detail.appointmentId.toString(), appointment._id.toString());
    assert.equal(detail.status, "cancelled");
    assert.equal(Object.hasOwn(detail, "guestContact"), false);
  });
});

test.after(async () => {
  await teardown(server, sessionStore);
});
