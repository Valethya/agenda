import "./setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import mongoose from "mongoose";
import { connectDB } from "../src/db/db.js";
import { cleanTestData, seedTestData, teardown } from "./fixtures.js";
import Appointment from "../src/db/models/appointment.model.js";
import BusinessConfig from "../src/db/models/businessConfig.model.js";
import GuestAppointmentCapability from "../src/db/models/guestAppointmentCapability.model.js";
import GuestAppointmentCommunicationJob from "../src/db/models/guestAppointmentCommunicationJob.model.js";
import * as communicationRepository from "../src/repositories/guestAppointmentCommunicationJob.repository.js";
import { bookAppointment, buildGuestBookingContactSnapshot } from "../src/services/appointment.service.js";
import {
  consumeGuestAppointmentCancelCapability,
  consumeGuestAppointmentRescheduleCapability,
} from "../src/services/guestAppointmentCapability.service.js";
import { processNextGuestAppointmentCommunicationJob } from "../src/services/guestAppointmentCommunication.worker.js";

await connectDB();
await cleanTestData();
const seed = await seedTestData();
const origin = "https://guest-communications.example.test";
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

let sequence = 0;
const scopedCapabilityHash = ({ businessId, appointmentId, action, secret }) => crypto
  .createHash("sha256")
  .update(businessId.toString(), "utf8").update("\0", "utf8")
  .update(appointmentId.toString(), "utf8").update("\0", "utf8")
  .update(action, "utf8").update("\0", "utf8")
  .update(secret, "utf8").digest("hex");

const guestContact = (email) => ({
  channel: "email",
  destination: email,
  provenance: "guest-booking-input-v1",
  capturedAt: new Date(),
});

const directGuestAppointment = async ({ date, startTime = "10:00", endTime = "11:00", status = "confirmed", email }) => {
  sequence += 1;
  return Appointment.create({
    client: null,
    worker: seed.worker._id,
    service: seed.service._id,
    business: seed.business._id,
    date: new Date(`${date}T00:00:00.000Z`),
    startTime,
    endTime,
    status,
    paymentStatus: "unpaid",
    guestContact: guestContact(email || `phase-i-${sequence}@example.com`),
  });
};

const createCapability = async ({ appointment, action, secret }) => GuestAppointmentCapability.create({
  business: appointment.business,
  appointment: appointment._id,
  verification: new mongoose.Types.ObjectId(),
  action,
  secretHash: scopedCapabilityHash({
    businessId: appointment.business,
    appointmentId: appointment._id,
    action,
    secret,
  }),
  status: "active",
  expiresAt: new Date(Date.now() + 10 * 60 * 1000),
});

const deliverOne = async (workerId, deliveries, result = { accepted: true, providerMessageId: "provider-1" }, now = new Date()) => (
  processNextGuestAppointmentCommunicationJob({
    workerId,
    now,
    deliver: async (payload) => {
      deliveries.push(structuredClone(payload));
      return result;
    },
  })
);

const assertNoAuthorityMaterial = (delivery) => {
  const serialized = JSON.stringify(delivery);
  assert.doesNotMatch(serialized, /challenge/i);
  assert.doesNotMatch(serialized, /bearer/i);
  assert.doesNotMatch(serialized, /secretHash/i);
  assert.doesNotMatch(serialized, /verificationId/i);
  const href = delivery.deliveryPayload.html.match(/href="([^"]+)"/)?.[1];
  assert.ok(href);
  const url = new URL(href.replaceAll("&amp;", "&"));
  assert.equal(url.origin, origin);
  assert.equal(url.pathname, "/appointment-access");
  assert.equal(url.searchParams.get("businessId"), seed.business._id.toString());
  assert.ok(url.searchParams.get("appointmentId"));
  assert.equal(url.hash, "");
  assert.equal(url.searchParams.has("challenge"), false);
  assert.equal(url.searchParams.has("verificationId"), false);
};

test("I guest communications", async (t) => {
  t.after(async () => teardown(null, null));

  await t.test("booking commit creates one logical outbox event; failed booking creates none", async () => {
    await GuestAppointmentCommunicationJob.deleteMany({});
    const date = "2099-10-05";
    const email = "booking-i@example.com";
    const appointment = await bookAppointment({
      client: null,
      worker: seed.worker._id,
      service: seed.service._id,
      businessId: seed.business._id,
      date,
      startTime: "10:00",
      paymentOption: "local",
      guestContact: buildGuestBookingContactSnapshot({ email }),
    });
    const jobs = await GuestAppointmentCommunicationJob.find({ appointment: appointment._id });
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].event, "booking");
    assert.equal(jobs[0].business.toString(), seed.business._id.toString());

    await assert.rejects(bookAppointment({
      client: null,
      worker: seed.worker._id,
      service: seed.service._id,
      businessId: seed.business._id,
      date,
      startTime: "10:00",
      paymentOption: "local",
      guestContact: buildGuestBookingContactSnapshot({ email: "booking-conflict-i@example.com" }),
    }));
    assert.equal(await GuestAppointmentCommunicationJob.countDocuments({ event: "booking" }), 1);

    const deliveries = [];
    assert.equal((await deliverOne("phase-i-booking-worker", deliveries))?.status, "delivered");
    assert.equal(deliveries.length, 1);
    assert.equal(deliveries[0].deliveryPayload.destination, email);
    assert.match(deliveries[0].deliveryPayload.html, new RegExp(seed.business.name));
    assert.match(deliveries[0].deliveryPayload.html, new RegExp(seed.service.name));
    assert.match(deliveries[0].deliveryPayload.html, /Trabajador Prueba/);
    assert.match(deliveries[0].deliveryPayload.html, /10:00/);
    assert.match(deliveries[0].deliveryPayload.html, /11:00/);
    assertNoAuthorityMaterial(deliveries[0]);
    assert.equal(await processNextGuestAppointmentCommunicationJob({ workerId: "phase-i-booking-worker-2", deliver: async () => assert.fail("duplicate send") }), null);
  });

  await t.test("guest cancel commits before communication and delivery failure never reverts cancellation", async () => {
    await GuestAppointmentCommunicationJob.deleteMany({});
    const appointment = await directGuestAppointment({ date: "2099-10-06", email: "cancel-i@example.com" });
    const secret = crypto.randomBytes(32).toString("base64url");
    await createCapability({ appointment, action: "cancel", secret });

    const cancelled = await consumeGuestAppointmentCancelCapability({
      businessId: appointment.business,
      appointmentId: appointment._id,
      bearer: secret,
    });
    assert.equal(cancelled.status, "cancelled");
    const job = await GuestAppointmentCommunicationJob.findOne({ appointment: appointment._id, event: "cancel" });
    assert.ok(job);

    const deliveries = [];
    const failed = await deliverOne("phase-i-cancel-worker", deliveries, {
      accepted: false,
      retryable: true,
      ambiguous: true,
      code: "PROVIDER_OUTCOME_AMBIGUOUS",
    });
    assert.equal(failed.status, "retry");
    assert.equal((await Appointment.findById(appointment._id)).status, "cancelled");
    assert.match(deliveries[0].deliveryPayload.html, /Cancelada/);

    const retryAt = new Date(Date.now() + 2 * 60 * 1000);
    const retried = await deliverOne("phase-i-cancel-retry", deliveries, { accepted: true, providerMessageId: "provider-cancel" }, retryAt);
    assert.equal(retried.status, "delivered");
    assert.equal(deliveries.length, 2);
    assert.deepEqual(deliveries[1], deliveries[0], "retry must reuse exact provider payload and idempotency key");
    assert.equal((await Appointment.findById(appointment._id)).status, "cancelled");
  });

  await t.test("guest reschedule communicates only the committed new window; stale reuse emits no new success job", async () => {
    await GuestAppointmentCommunicationJob.deleteMany({});
    const appointment = await directGuestAppointment({ date: "2099-10-07", email: "reschedule-i@example.com" });
    const secret = crypto.randomBytes(32).toString("base64url");
    await createCapability({ appointment, action: "reschedule", secret });

    const moved = await consumeGuestAppointmentRescheduleCapability({
      businessId: appointment.business,
      appointmentId: appointment._id,
      bearer: secret,
      date: "2099-10-07",
      startTime: "11:00",
    });
    assert.equal(moved.startTime, "11:00");
    assert.equal(moved.endTime, "12:00");
    assert.equal(await GuestAppointmentCommunicationJob.countDocuments({ appointment: appointment._id, event: "reschedule" }), 1);

    await assert.rejects(consumeGuestAppointmentRescheduleCapability({
      businessId: appointment.business,
      appointmentId: appointment._id,
      bearer: secret,
      date: "2099-10-07",
      startTime: "12:00",
    }));
    assert.equal(await GuestAppointmentCommunicationJob.countDocuments({ appointment: appointment._id, event: "reschedule" }), 1);

    const deliveries = [];
    assert.equal((await deliverOne("phase-i-reschedule-worker", deliveries))?.status, "delivered");
    assert.match(deliveries[0].deliveryPayload.html, /11:00/);
    assert.match(deliveries[0].deliveryPayload.html, /12:00/);
    assert.doesNotMatch(deliveries[0].deliveryPayload.html, />10:00</);
    assertNoAuthorityMaterial(deliveries[0]);
  });

  await t.test("cross-tenant job fails closed before delivery", async () => {
    await GuestAppointmentCommunicationJob.deleteMany({});
    const appointment = await directGuestAppointment({ date: "2099-10-08", email: "tenant-a-i@example.com" });
    const maliciousJobId = `guest-lifecycle:cancel:${appointment._id}:${new mongoose.Types.ObjectId()}`;
    await GuestAppointmentCommunicationJob.create({
      _id: maliciousJobId,
      business: seed.businessB._id,
      appointment: appointment._id,
      event: "cancel",
      status: "queued",
      attempts: 0,
      nextAttemptAt: new Date(),
    });
    let called = false;
    const result = await processNextGuestAppointmentCommunicationJob({
      workerId: "phase-i-cross-tenant",
      deliver: async () => { called = true; return { accepted: true }; },
    });
    assert.equal(result.status, "failed");
    assert.equal(called, false);
    const stored = await GuestAppointmentCommunicationJob.findById(maliciousJobId);
    assert.equal(stored.status, "failed");
  });

  await t.test("duplicate logical enqueue and concurrent claims remain single-delivery", async () => {
    await GuestAppointmentCommunicationJob.deleteMany({});
    const appointment = await directGuestAppointment({ date: "2099-10-09", email: "dedupe-i@example.com" });
    const operationId = new mongoose.Types.ObjectId();
    const jobId = communicationRepository.buildCommunicationJobId({ event: "cancel", appointmentId: appointment._id, operationId });
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await communicationRepository.enqueueInSession({
          jobId,
          businessId: appointment.business,
          appointmentId: appointment._id,
          event: "cancel",
          session,
        });
        await communicationRepository.enqueueInSession({
          jobId,
          businessId: appointment.business,
          appointmentId: appointment._id,
          event: "cancel",
          session,
        });
      });
    } finally {
      await session.endSession();
    }
    assert.equal(await GuestAppointmentCommunicationJob.countDocuments({ _id: jobId }), 1);

    const deliveries = [];
    const [left, right] = await Promise.all([
      deliverOne("phase-i-race-left", deliveries),
      deliverOne("phase-i-race-right", deliveries),
    ]);
    assert.equal(deliveries.length, 1);
    assert.equal([left?.status, right?.status].filter((value) => value === "delivered").length, 1);
  });
});
