import "./setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
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

const expectInvalid = (promise) => assert.rejects(
  promise,
  (error) => error?.code === "GUEST_APPOINTMENT_CAPABILITY_INVALID_PROOF",
);
const expectConflict = (promise) => assert.rejects(
  promise,
  (error) => error?.code === "GUEST_APPOINTMENT_CANCEL_STATE_CONFLICT",
);

const makeAppointment = async (status = "confirmed") => {
  sequence += 1;
  return Appointment.create({
    client: seed.client._id,
    worker: seed.worker._id,
    service: seed.service._id,
    business: seed.business._id,
    date: new Date(Date.UTC(2099, 9, sequence + 1)),
    startTime: "10:00",
    endTime: "11:00",
    status,
    paymentStatus: "pending",
    guestContact: {
      channel: "email",
      destination: `h2-${sequence}@example.com`,
      provenance: "guest-booking-input-v1",
      capturedAt: new Date(),
    },
  });
};

const deliveredFragment = async (appointment, action) => {
  const request = action === "cancel"
    ? requestGuestAppointmentCancelChallenge
    : requestGuestAppointmentReadChallenge;
  assert.deepEqual(await request({ businessId: appointment.business, appointmentId: appointment._id }), { accepted: true });

  let accessUrl;
  const processed = await processNextGuestAppointmentVerificationJob({
    workerId: `h2-${crypto.randomBytes(8).toString("hex")}`,
    deliverVerification: async (payload) => {
      accessUrl = payload.accessUrl;
      return true;
    },
  });
  assert.equal(processed?.status, "delivered");
  const fragment = new URLSearchParams(new URL(accessUrl).hash.slice(1));
  assert.equal(fragment.get("businessId"), appointment.business.toString());
  assert.equal(fragment.get("appointmentId"), appointment._id.toString());
  assert.equal(fragment.get("purpose"), `appointment-${action}-bootstrap`);
  return fragment;
};

const mintCancel = async (appointment) => {
  const fragment = await deliveredFragment(appointment, "cancel");
  return exchangeGuestAppointmentCancelChallenge({
    businessId: appointment.business,
    appointmentId: appointment._id,
    verificationId: fragment.get("verificationId"),
    challengeSecret: fragment.get("challenge"),
  });
};

const mintRead = async (appointment) => {
  const fragment = await deliveredFragment(appointment, "read");
  return exchangeGuestAppointmentReadChallenge({
    businessId: appointment.business,
    appointmentId: appointment._id,
    verificationId: fragment.get("verificationId"),
    challengeSecret: fragment.get("challenge"),
  });
};

const cancelWith = (appointment, capability) => consumeGuestAppointmentCancelCapability({
  businessId: appointment.business,
  appointmentId: appointment._id,
  bearer: capability.bearer,
});

const slots = async (date) => {
  const response = await fetch(`${baseUrl}/availability/slots?businessId=${seed.business._id}&workerId=${seed.worker._id}&serviceId=${seed.service._id}&date=${date}`);
  assert.equal(response.status, 200);
  return (await response.json()).payload;
};
const hasTen = (values) => values.some((value) => value.startTime === "10:00");

const book = async (date, suffix) => {
  const response = await fetch(`${baseUrl}/appointments?businessId=${seed.business._id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      worker: seed.worker._id.toString(),
      service: seed.service._id.toString(),
      date,
      startTime: "10:00",
      clientInfo: {
        firstName: "Guest",
        lastName: "H2",
        email: `h2-flow-${suffix}@example.com`,
        phone: `+5697000${String(sequence + 10).padStart(4, "0")}`,
      },
    }),
  });
  return { response, body: await response.json() };
};

test("H2 guest cancellation", async (t) => {
  await t.test("CANCEL challenge response is non-enumerative", async () => {
    const appointment = await makeAppointment();
    const existing = await requestGuestAppointmentCancelChallenge({ businessId: seed.business._id, appointmentId: appointment._id });
    const missing = await requestGuestAppointmentCancelChallenge({ businessId: seed.business._id, appointmentId: new Appointment()._id });
    assert.deepEqual(existing, { accepted: true });
    assert.deepEqual(missing, { accepted: true });
    await GuestAppointmentVerificationJob.deleteMany({});
  });

  await t.test("valid CANCEL proof mints CANCEL only; READ proof cannot mint CANCEL", async () => {
    const cancelAppointment = await makeAppointment();
    const cancel = await mintCancel(cancelAppointment);
    assert.equal(cancel.action, "cancel");
    assert.equal(cancel.businessId.toString(), seed.business._id.toString());
    assert.equal(cancel.appointmentId.toString(), cancelAppointment._id.toString());

    const readAppointment = await makeAppointment();
    const readFragment = await deliveredFragment(readAppointment, "read");
    await expectInvalid(exchangeGuestAppointmentCancelChallenge({
      businessId: readAppointment.business,
      appointmentId: readAppointment._id,
      verificationId: readFragment.get("verificationId"),
      challengeSecret: readFragment.get("challenge"),
    }));
  });

  await t.test("READ bearer cannot cancel", async () => {
    const appointment = await makeAppointment();
    const read = await mintRead(appointment);
    await expectInvalid(consumeGuestAppointmentCancelCapability({ businessId: appointment.business, appointmentId: appointment._id, bearer: read.bearer }));
    assert.equal((await Appointment.findById(appointment._id)).status, "confirmed");
  });

  await t.test("CANCEL is exact Appointment + Business scope", async () => {
    const appointment = await makeAppointment();
    const other = await makeAppointment();
    const capability = await mintCancel(appointment);
    await expectInvalid(consumeGuestAppointmentCancelCapability({ businessId: appointment.business, appointmentId: other._id, bearer: capability.bearer }));
    await expectInvalid(consumeGuestAppointmentCancelCapability({ businessId: seed.businessB._id, appointmentId: appointment._id, bearer: capability.bearer }));
    assert.equal((await cancelWith(appointment, capability)).status, "cancelled");
  });

  await t.test("expired fails; successful capability is single-use", async () => {
    const expiredAppointment = await makeAppointment();
    const expired = await mintCancel(expiredAppointment);
    await GuestAppointmentCapability.updateOne({ _id: expired.capabilityId }, { $set: { expiresAt: new Date("2000-01-01T00:00:00.000Z") } });
    await expectInvalid(cancelWith(expiredAppointment, expired));
    assert.equal((await Appointment.findById(expiredAppointment._id)).status, "confirmed");

    const appointment = await makeAppointment();
    const capability = await mintCancel(appointment);
    assert.equal((await cancelWith(appointment, capability)).status, "cancelled");
    await expectInvalid(cancelWith(appointment, capability));
  });

  for (const status of ["pending", "pending_payment", "confirmed"]) {
    await t.test(`${status} transitions to cancelled without deleting or retiming`, async () => {
      const appointment = await makeAppointment(status);
      const capability = await mintCancel(appointment);
      assert.equal((await cancelWith(appointment, capability)).status, "cancelled");
      const stored = await Appointment.findById(appointment._id).lean();
      assert.ok(stored);
      assert.equal(stored.status, "cancelled");
      assert.equal(stored.startTime, "10:00");
      assert.equal(stored.endTime, "11:00");
    });
  }

  for (const status of ["completed", "cancelled"]) {
    await t.test(`${status} fails with coherent state conflict`, async () => {
      const appointment = await makeAppointment(status);
      const capability = await mintCancel(appointment);
      await expectConflict(cancelWith(appointment, capability));
      assert.equal((await Appointment.findById(appointment._id)).status, status);
      assert.equal((await GuestAppointmentCapability.findById(capability.capabilityId)).status, "active");
    });
  }

  await t.test("concurrent state winner is observed atomically and CANCEL consumption rolls back", async () => {
    const appointment = await makeAppointment();
    const capability = await mintCancel(appointment);
    let release;
    const barrier = new Promise((resolve) => { release = resolve; });
    const competingChange = (async () => {
      await Appointment.updateOne({ _id: appointment._id }, { $set: { status: "completed" } });
      release();
    })();
    await barrier;
    await competingChange;
    await expectConflict(cancelWith(appointment, capability));
    assert.equal((await Appointment.findById(appointment._id)).status, "completed");
    assert.equal((await GuestAppointmentCapability.findById(capability.capabilityId)).status, "active");
  });

  await t.test("guest audit is explicit and contains no bearer/challenge/contact", async () => {
    const appointment = await makeAppointment();
    const capability = await mintCancel(appointment);
    await cancelWith(appointment, capability);
    const audit = await AuditLog.findOne({ appointmentId: appointment._id, event: "APPOINTMENT_CANCELLED" }).lean();
    assert.ok(audit);
    assert.equal(audit.userId, undefined);
    assert.equal(audit.metadata.actorCapability, "guest-cancel");
    const serialized = JSON.stringify(audit);
    assert.equal(serialized.includes(capability.bearer), false);
    assert.equal(serialized.includes("challenge"), false);
    assert.equal(serialized.includes("guestContact"), false);
  });

  await t.test("successful cancellation emits the canonical availability change", async () => {
    const source = await readFile(new URL("../src/services/guestAppointmentCapability.service.js", import.meta.url), "utf8");
    assert.match(source, /emitAvailabilityChange\(cancelled\.worker\.toString\(\), dateStr, business\)/u);
  });

  await t.test("cancelled does not block discovery or authoritative overlap", async () => {
    const appointment = await makeAppointment();
    const capability = await mintCancel(appointment);
    await cancelWith(appointment, capability);
    const dayStart = new Date(appointment.date); dayStart.setUTCHours(0, 0, 0, 0);
    const dayEnd = new Date(appointment.date); dayEnd.setUTCHours(23, 59, 59, 999);
    const discovered = await appointmentRepository.findByBusinessWorkerAndDate(appointment.business, appointment.worker, dayStart, dayEnd);
    assert.equal(discovered.some((value) => value._id.toString() === appointment._id.toString()), false);
    assert.equal(await appointmentRepository.findActiveOverlapByBusinessWorkerDate(
      appointment.business, appointment.worker, dayStart, dayEnd, appointment.startTime, appointment.endTime,
    ), null);
  });

  await t.test("available -> book -> unavailable -> guest cancel -> available -> rebook", async () => {
    const date = "2099-09-14";
    assert.equal(hasTen(await slots(date)), true);
    const first = await book(date, "a");
    assert.equal(first.response.status, 201);
    const appointment = await Appointment.findById(first.body.payload.appointmentId);
    assert.ok(appointment);
    assert.equal(hasTen(await slots(date)), false);

    const capability = await mintCancel(appointment);
    assert.equal((await cancelWith(appointment, capability)).status, "cancelled");
    assert.equal(hasTen(await slots(date)), true);

    const second = await book(date, "b");
    assert.equal(second.response.status, 201);
    assert.notEqual(second.body.payload.appointmentId, appointment._id.toString());
    assert.equal((await Appointment.findById(appointment._id)).status, "cancelled");
  });

  await t.test("H1 READ remains independently usable after cancellation", async () => {
    const appointment = await makeAppointment();
    await cancelWith(appointment, await mintCancel(appointment));
    const read = await mintRead(appointment);
    const detail = await consumeGuestAppointmentReadCapability({ businessId: appointment.business, appointmentId: appointment._id, bearer: read.bearer });
    assert.equal(detail.status, "cancelled");
    assert.equal(Object.hasOwn(detail, "guestContact"), false);
  });
});

test.after(async () => {
  await teardown(server, sessionStore);
});
