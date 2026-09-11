import "./setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import mongoose from "mongoose";
import { connectDB } from "../src/db/db.js";
import { cleanTestData, seedTestData, teardown } from "./fixtures.js";
import BusinessConfig from "../src/db/models/businessConfig.model.js";
import GuestAppointmentCapability from "../src/db/models/guestAppointmentCapability.model.js";
import GuestAppointmentCommunicationJob from "../src/db/models/guestAppointmentCommunicationJob.model.js";
import { bookAppointment, buildGuestBookingContactSnapshot } from "../src/services/appointment.service.js";
import {
  consumeGuestAppointmentCancelCapability,
  consumeGuestAppointmentRescheduleCapability,
} from "../src/services/guestAppointmentCapability.service.js";
import { processNextGuestAppointmentCommunicationJob } from "../src/services/guestAppointmentCommunication.worker.js";

await connectDB();
await cleanTestData();
const seed = await seedTestData();
const origin = "https://guest-communication-snapshot.example.test";
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

const capabilityHash = ({ businessId, appointmentId, action, secret }) => crypto
  .createHash("sha256")
  .update(businessId.toString(), "utf8").update("\0", "utf8")
  .update(appointmentId.toString(), "utf8").update("\0", "utf8")
  .update(action, "utf8").update("\0", "utf8")
  .update(secret, "utf8").digest("hex");

const createCapability = async ({ appointment, action }) => {
  const secret = crypto.randomBytes(32).toString("base64url");
  await GuestAppointmentCapability.create({
    business: appointment.business,
    appointment: appointment._id,
    verification: new mongoose.Types.ObjectId(),
    action,
    secretHash: capabilityHash({
      businessId: appointment.business,
      appointmentId: appointment._id,
      action,
      secret,
    }),
    status: "active",
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  });
  return secret;
};

const createBooking = ({ date, email }) => bookAppointment({
  client: null,
  worker: seed.worker._id,
  service: seed.service._id,
  businessId: seed.business._id,
  date,
  startTime: "10:00",
  paymentOption: "local",
  guestContact: buildGuestBookingContactSnapshot({ email }),
});

const deliverAll = async () => {
  const deliveries = [];
  for (let index = 0; index < 8; index += 1) {
    const result = await processNextGuestAppointmentCommunicationJob({
      workerId: `snapshot-worker-${index}`,
      deliver: async (payload) => {
        deliveries.push(structuredClone(payload));
        return { accepted: true, providerMessageId: `provider-${index}` };
      },
    });
    if (!result) break;
  }
  return deliveries;
};

const subject = (delivery) => delivery.deliveryPayload.subject;
const html = (delivery) => delivery.deliveryPayload.html;
const findBySubject = (deliveries, prefix) => deliveries.find((delivery) => subject(delivery).startsWith(prefix));

const assertOriginalBookingWindow = (delivery) => {
  assert.match(html(delivery), />10:00</);
  assert.match(html(delivery), />11:00</);
};

test("I lifecycle communication snapshots", async (t) => {
  t.after(async () => teardown(null, null));

  await t.test("booking snapshot survives a reschedule before booking delivery", async () => {
    await GuestAppointmentCommunicationJob.deleteMany({});
    const appointment = await createBooking({ date: "2099-11-05", email: "snapshot-booking-reschedule@example.com" });
    const rescheduleSecret = await createCapability({ appointment, action: "reschedule" });

    await consumeGuestAppointmentRescheduleCapability({
      businessId: appointment.business,
      appointmentId: appointment._id,
      bearer: rescheduleSecret,
      date: "2099-11-05",
      startTime: "12:00",
    });

    const deliveries = await deliverAll();
    assert.equal(deliveries.length, 2);
    const bookingDelivery = findBySubject(deliveries, "Reserva recibida");
    const rescheduleDelivery = findBySubject(deliveries, "Reserva reagendada");
    assert.ok(bookingDelivery);
    assert.ok(rescheduleDelivery);
    assertOriginalBookingWindow(bookingDelivery);
    assert.doesNotMatch(html(bookingDelivery), />12:00</);
    assert.doesNotMatch(html(bookingDelivery), />13:00</);
    assert.match(html(rescheduleDelivery), />12:00</);
    assert.match(html(rescheduleDelivery), />13:00</);
  });

  await t.test("booking snapshot survives cancellation and cancel keeps its own state", async () => {
    await GuestAppointmentCommunicationJob.deleteMany({});
    const appointment = await createBooking({ date: "2099-11-06", email: "snapshot-booking-cancel@example.com" });
    const cancelSecret = await createCapability({ appointment, action: "cancel" });

    await consumeGuestAppointmentCancelCapability({
      businessId: appointment.business,
      appointmentId: appointment._id,
      bearer: cancelSecret,
    });

    const deliveries = await deliverAll();
    assert.equal(deliveries.length, 2);
    const bookingDelivery = findBySubject(deliveries, "Reserva recibida");
    const cancelDelivery = findBySubject(deliveries, "Reserva cancelada");
    assert.ok(bookingDelivery);
    assert.ok(cancelDelivery);
    assertOriginalBookingWindow(bookingDelivery);
    assert.doesNotMatch(html(bookingDelivery), />Cancelada</);
    assert.match(html(cancelDelivery), />Cancelada</);
  });

  await t.test("successive reschedules retain distinct committed windows", async () => {
    await GuestAppointmentCommunicationJob.deleteMany({});
    const appointment = await createBooking({ date: "2099-11-09", email: "snapshot-two-reschedules@example.com" });

    const firstSecret = await createCapability({ appointment, action: "reschedule" });
    await consumeGuestAppointmentRescheduleCapability({
      businessId: appointment.business,
      appointmentId: appointment._id,
      bearer: firstSecret,
      date: "2099-11-09",
      startTime: "11:00",
    });

    const secondSecret = await createCapability({ appointment, action: "reschedule" });
    await consumeGuestAppointmentRescheduleCapability({
      businessId: appointment.business,
      appointmentId: appointment._id,
      bearer: secondSecret,
      date: "2099-11-09",
      startTime: "13:00",
    });

    const deliveries = await deliverAll();
    assert.equal(deliveries.length, 3);
    const reschedules = deliveries.filter((delivery) => subject(delivery).startsWith("Reserva reagendada"));
    assert.equal(reschedules.length, 2);
    assert.match(html(reschedules[0]), />11:00</);
    assert.match(html(reschedules[0]), />12:00</);
    assert.doesNotMatch(html(reschedules[0]), />13:00</);
    assert.match(html(reschedules[1]), />13:00</);
    assert.match(html(reschedules[1]), />14:00</);
  });

  await t.test("prepared delivery retry remains identical", async () => {
    await GuestAppointmentCommunicationJob.deleteMany({});
    await createBooking({ date: "2099-11-10", email: "snapshot-retry@example.com" });
    const attempts = [];
    const first = await processNextGuestAppointmentCommunicationJob({
      workerId: "snapshot-retry-first",
      deliver: async (payload) => {
        attempts.push(structuredClone(payload));
        return { accepted: false, retryable: true, ambiguous: true, code: "PROVIDER_OUTCOME_AMBIGUOUS" };
      },
    });
    assert.equal(first.status, "retry");

    const retryAt = new Date(Date.now() + 2 * 60 * 1000);
    const second = await processNextGuestAppointmentCommunicationJob({
      workerId: "snapshot-retry-second",
      now: retryAt,
      deliver: async (payload) => {
        attempts.push(structuredClone(payload));
        return { accepted: true, providerMessageId: "provider-retry" };
      },
    });
    assert.equal(second.status, "delivered");
    assert.equal(attempts.length, 2);
    assert.deepEqual(attempts[1], attempts[0]);
  });
});
