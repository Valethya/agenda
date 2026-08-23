import "./setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { connectDB } from "../src/db/db.js";
import BusinessConfig from "../src/db/models/businessConfig.model.js";
import Appointment from "../src/db/models/appointment.model.js";
import ClientContactVerification from "../src/db/models/clientContactVerification.model.js";
import GuestAppointmentVerificationDelivery from "../src/db/models/guestAppointmentVerificationDelivery.model.js";
import GuestAppointmentVerificationJob from "../src/db/models/guestAppointmentVerificationJob.model.js";
import GuestAppointmentCapability from "../src/db/models/guestAppointmentCapability.model.js";
import {
  consumeGuestAppointmentReadCapability,
  exchangeGuestAppointmentReadChallenge,
  requestGuestAppointmentReadChallenge,
} from "../src/services/guestAppointmentCapability.service.js";
import { processNextGuestAppointmentVerificationJob } from "../src/services/guestAppointmentVerification.worker.js";
import {
  configurePublicWeb,
  deletePublicWeb,
  reverifyPublicWeb,
  verifyPublicWeb,
} from "../src/services/publicWeb.service.js";
import * as fixtures from "./fixtures.js";

const { seedTestData, cleanTestData } = fixtures;
await connectDB();
await cleanTestData();
const seed = await seedTestData();

const origin = "https://c2-public.example.test";
let sequence = 0;

const raw = (state) => state.dnsVerification.recordValue.slice("agenda-verification=".length);

const ensureNoTrust = async () => {
  const config = await BusinessConfig.findOne({ business: seed.business._id });
  if (config?.publicWeb?.websiteUrl) await deletePublicWeb({ businessId: seed.business._id });
};

const freshTrust = async (nextOrigin = origin) => {
  await ensureNoTrust();
  const pending = await configurePublicWeb({
    businessId: seed.business._id,
    websiteUrl: nextOrigin,
    bookingUrl: `${nextOrigin}/reservar`,
  });
  const challenge = raw(pending);
  return verifyPublicWeb({
    businessId: seed.business._id,
    resolveTxt: async () => [["agenda-verification=", challenge]],
  });
};

const appointment = async () => {
  sequence += 1;
  return Appointment.create({
    client: seed.client._id,
    worker: seed.worker._id,
    service: seed.service._id,
    date: new Date(Date.UTC(2090, 0, sequence + 1)),
    startTime: "10:00",
    endTime: "11:00",
    business: seed.business._id,
    guestContact: {
      channel: "email",
      destination: `c2-public-${sequence}@example.test`,
      provenance: "guest-booking-input-v1",
      capturedAt: new Date(),
    },
  });
};

const fragmentFromUrl = (url) => new URLSearchParams(new URL(url).hash.slice(1));

const deliverProof = async ({ app = null, workerId = `public-web-${Date.now()}-${Math.random()}` } = {}) => {
  const target = app ?? await appointment();
  await requestGuestAppointmentReadChallenge({
    businessId: seed.business._id,
    appointmentId: target._id,
  });
  let sent = 0;
  let accessUrl = null;
  const result = await processNextGuestAppointmentVerificationJob({
    workerId,
    deliverVerification: async (payload) => {
      sent += 1;
      accessUrl = payload.accessUrl;
      return true;
    },
  });
  assert.equal(result?.status, "delivered");
  assert.equal(sent, 1);
  assert.ok(accessUrl);
  return { appointment: target, fragment: fragmentFromUrl(accessUrl), accessUrl };
};

const exchange = ({ appointment: target, fragment }) => exchangeGuestAppointmentReadChallenge({
  businessId: seed.business._id,
  appointmentId: target._id,
  verificationId: fragment.get("verificationId"),
  challengeSecret: fragment.get("challenge"),
});

const invalidProof = async (promise) => assert.rejects(
  promise,
  (error) => error?.code === "GUEST_APPOINTMENT_CAPABILITY_INVALID_PROOF",
);

const assertExchangeInvalidAfter = async (mutateTrust) => {
  await freshTrust();
  const proof = await deliverProof();
  await mutateTrust(proof);
  await invalidProof(exchange(proof));
};

test("6.2.6-B C2 publicWeb revocation and send fence", async (t) => {
  await t.test("Business without fresh verified trust fails before C1 and transport", async () => {
    await ensureNoTrust();
    const target = await appointment();
    await requestGuestAppointmentReadChallenge({ businessId: seed.business._id, appointmentId: target._id });
    const beforeC1 = await ClientContactVerification.countDocuments({ business: seed.business._id });
    let sends = 0;
    const result = await processNextGuestAppointmentVerificationJob({
      workerId: `no-trust-${Date.now()}`,
      deliverVerification: async () => { sends += 1; return true; },
    });
    assert.equal(result?.status, "failed");
    assert.equal(sends, 0);
    assert.equal(await ClientContactVerification.countDocuments({ business: seed.business._id }), beforeC1);
  });

  await t.test("revocation confirmed before send fence prevents outbound delivery", async () => {
    await freshTrust();
    const target = await appointment();
    await requestGuestAppointmentReadChallenge({ businessId: seed.business._id, appointmentId: target._id });
    let sends = 0;
    let revokedGeneration = null;
    const result = await processNextGuestAppointmentVerificationJob({
      workerId: `revoke-before-fence-${Date.now()}`,
      beforeSendAuthorization: async () => {
        const removed = await deletePublicWeb({ businessId: seed.business._id });
        revokedGeneration = removed.trustGeneration;
      },
      deliverVerification: async () => { sends += 1; return true; },
    });
    assert.ok(revokedGeneration >= 2);
    assert.equal(result?.status, "failed");
    assert.equal(sends, 0);
    const job = await GuestAppointmentVerificationJob.findOne({ appointment: target._id }).lean();
    assert.equal(job.status, "failed");
  });

  await t.test("worker that waits past its authority fence revalidates and does not send", async () => {
    await freshTrust();
    const target = await appointment();
    await requestGuestAppointmentReadChallenge({ businessId: seed.business._id, appointmentId: target._id });
    let sends = 0;
    const result = await processNextGuestAppointmentVerificationJob({
      workerId: `lost-fence-${Date.now()}`,
      beforeExternalSend: async ({ fence }) => {
        await BusinessConfig.updateOne(
          { business: seed.business._id, "publicWeb.authorityFence.token": fence.token },
          { $set: { "publicWeb.authorityFence.expiresAt": new Date(Date.now() - 1) } },
        );
        const pending = await reverifyPublicWeb({ businessId: seed.business._id });
        assert.equal(pending.verificationStatus, "pending");
      },
      deliverVerification: async () => { sends += 1; return true; },
    });
    assert.equal(result?.status, "failed");
    assert.equal(sends, 0);
  });

  await t.test("delivered generation becomes invalid after delete", async () => {
    await assertExchangeInvalidAfter(async () => {
      await deletePublicWeb({ businessId: seed.business._id });
    });
  });

  await t.test("delivered generation becomes invalid after origin change", async () => {
    await assertExchangeInvalidAfter(async () => {
      await configurePublicWeb({
        businessId: seed.business._id,
        websiteUrl: "https://c2-changed.example.test",
        bookingUrl: "https://c2-changed.example.test/reservar",
      });
    });
  });

  await t.test("delivered generation becomes invalid after trust expiry", async () => {
    await assertExchangeInvalidAfter(async () => {
      await BusinessConfig.updateOne(
        { business: seed.business._id },
        { $set: { "publicWeb.verificationValidUntil": new Date() } },
      );
    });
  });

  await t.test("delivered generation becomes invalid after explicit reverify", async () => {
    await assertExchangeInvalidAfter(async () => {
      const pending = await reverifyPublicWeb({ businessId: seed.business._id });
      assert.equal(pending.verificationStatus, "pending");
    });
  });

  await t.test("delete/recreate same exact origin never resurrects an old Delivery", async () => {
    const initial = await freshTrust();
    const proof = await deliverProof();
    const oldGeneration = initial.trustGeneration;

    const removed = await deletePublicWeb({ businessId: seed.business._id });
    assert.ok(removed.trustGeneration > oldGeneration);
    const pending = await configurePublicWeb({
      businessId: seed.business._id,
      websiteUrl: origin,
      bookingUrl: `${origin}/reservar`,
    });
    assert.ok(pending.trustGeneration > removed.trustGeneration);
    const challenge = raw(pending);
    const renewed = await verifyPublicWeb({
      businessId: seed.business._id,
      resolveTxt: async () => [[`agenda-verification=${challenge}`]],
    });
    assert.notEqual(renewed.trustGeneration, oldGeneration);

    await invalidProof(exchange(proof));
  });

  await t.test("capability exchanged before later trust revocation keeps the existing C2 lifetime", async () => {
    await freshTrust();
    const proof = await deliverProof();
    const capability = await exchange(proof);
    await deletePublicWeb({ businessId: seed.business._id });

    const detail = await consumeGuestAppointmentReadCapability({
      businessId: seed.business._id,
      appointmentId: proof.appointment._id,
      bearer: capability.bearer,
    });
    assert.equal(detail.appointmentId.toString(), proof.appointment._id.toString());
  });
});

test.after(async () => {
  await GuestAppointmentCapability.deleteMany({ business: seed.business._id });
  await GuestAppointmentVerificationDelivery.deleteMany({ business: seed.business._id });
  await ClientContactVerification.deleteMany({ business: seed.business._id });
  await GuestAppointmentVerificationJob.deleteMany({ business: seed.business._id });
  await BusinessConfig.deleteMany({ business: { $in: [seed.business._id, seed.businessB._id] } });
  await Appointment.deleteMany({ business: { $in: [seed.business._id, seed.businessB._id] } });
  await cleanTestData();
  await mongoose.disconnect();
});
