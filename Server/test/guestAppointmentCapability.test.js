import "./setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { connectDB } from "../src/db/db.js";
import Business from "../src/db/models/business.model.js";
import User from "../src/db/models/user.model.js";
import Service from "../src/db/models/service.model.js";
import Appointment from "../src/db/models/appointment.model.js";
import ClientContactVerification from "../src/db/models/clientContactVerification.model.js";
import GuestAppointmentVerificationDelivery from "../src/db/models/guestAppointmentVerificationDelivery.model.js";
import GuestAppointmentVerificationJob from "../src/db/models/guestAppointmentVerificationJob.model.js";
import GuestAppointmentIntakeBucket from "../src/db/models/guestAppointmentIntakeBucket.model.js";
import GuestAppointmentCapability from "../src/db/models/guestAppointmentCapability.model.js";
import * as deliveryRepository from "../src/repositories/guestAppointmentVerificationDelivery.repository.js";
import * as capabilityRepository from "../src/repositories/guestAppointmentCapability.repository.js";
import * as jobRepository from "../src/repositories/guestAppointmentVerificationJob.repository.js";
import {
  consumeGuestAppointmentReadCapability,
  exchangeGuestAppointmentReadChallenge,
  requestGuestAppointmentReadChallenge,
} from "../src/services/guestAppointmentCapability.service.js";
import { processNextGuestAppointmentVerificationJob } from "../src/services/guestAppointmentVerification.worker.js";
import { issueVerificationForBusiness } from "../src/services/clientContactVerification.service.js";

process.env.GUEST_APPOINTMENT_ACCESS_ORIGIN = "https://guest-access.example.test";
await connectDB();

const suffix = `${Date.now()}-${process.pid}`;
const businessA = await Business.create({ name: `C2 A ${suffix}`, slug: `c2-a-${suffix}` });
const businessB = await Business.create({ name: `C2 B ${suffix}`, slug: `c2-b-${suffix}` });
const clientA = await User.create({
  firstName: "Guest",
  lastName: "A",
  email: [`guest-a-${suffix}@example.com`],
  phone: [],
  password: "unused-c2-test",
});
const clientB = await User.create({
  firstName: "Guest",
  lastName: "B",
  email: [`guest-b-${suffix}@example.com`],
  phone: [],
  password: "unused-c2-test",
});
const workerA = await User.create({
  firstName: "Worker",
  lastName: "A",
  email: [`worker-a-${suffix}@example.com`],
  phone: [],
  password: "unused-c2-test",
  role: "worker",
});
const workerB = await User.create({
  firstName: "Worker",
  lastName: "B",
  email: [`worker-b-${suffix}@example.com`],
  phone: [],
  password: "unused-c2-test",
  role: "worker",
});
const serviceA = await Service.create({
  name: "Servicio A",
  duration: 60,
  price: 10000,
  business: businessA._id,
  workers: [workerA._id],
});
const serviceB = await Service.create({
  name: "Servicio B",
  duration: 30,
  price: 8000,
  business: businessB._id,
  workers: [workerB._id],
});

let appointmentSequence = 0;
const nextAppointment = async ({
  business = businessA,
  client = clientA,
  worker = workerA,
  service = serviceA,
  destination = clientA.email[0],
  withGuestContact = true,
} = {}) => {
  appointmentSequence += 1;
  const date = new Date(Date.UTC(2032, 0, appointmentSequence + 1));
  const data = {
    client: client._id,
    worker: worker._id,
    service: service._id,
    date,
    startTime: "10:00",
    endTime: service.duration === 30 ? "10:30" : "11:00",
    business: business._id,
    notes: "never expose this note",
  };
  if (withGuestContact) {
    data.guestContact = {
      channel: "email",
      destination,
      provenance: "guest-booking-input-v1",
      capturedAt: new Date(),
    };
  }
  return Appointment.create(data);
};

const expectInvalid = async (promise) => {
  await assert.rejects(
    promise,
    (error) => error.code === "GUEST_APPOINTMENT_CAPABILITY_INVALID_PROOF",
  );
};

const parseAccessUrl = (accessUrl) => {
  const url = new URL(accessUrl);
  return {
    url,
    fragment: new URLSearchParams(url.hash.slice(1)),
  };
};

const requestAndProcess = async ({
  appointment,
  business = businessA,
  accepted = true,
  workerId = `worker-${Date.now()}-${Math.random()}`,
} = {}) => {
  let transportCalls = 0;
  let transportPayload = null;

  const acceptedResponse = await requestGuestAppointmentReadChallenge({
    businessId: business._id,
    appointmentId: appointment._id,
  });
  assert.deepEqual(acceptedResponse, { accepted: true });

  const durableJob = await GuestAppointmentVerificationJob.findOne({
    business: business._id,
    appointment: appointment._id,
    purpose: "appointment-read-bootstrap",
    action: "read",
  }).lean();
  assert.ok(durableJob);
  assert.equal(durableJob.status, "queued");
  assert.equal(durableJob.purgeAfter, null);

  const result = await processNextGuestAppointmentVerificationJob({
    workerId,
    deliverVerification: async (payload) => {
      transportCalls += 1;
      transportPayload = payload;
      return accepted;
    },
  });

  return {
    acceptedResponse,
    durableJob,
    result,
    transportCalls,
    transportPayload,
  };
};

const deliveredProof = async (appointment, business = businessA) => {
  const processed = await requestAndProcess({ appointment, business, accepted: true });
  assert.equal(processed.result?.status, "delivered");
  assert.equal(processed.transportCalls, 1);
  assert.ok(processed.transportPayload?.accessUrl);
  const { url, fragment } = parseAccessUrl(processed.transportPayload.accessUrl);
  return { ...processed, url, fragment };
};

const exchangeProof = async ({ appointment, business = businessA, fragment }) => (
  exchangeGuestAppointmentReadChallenge({
    businessId: business._id,
    appointmentId: appointment._id,
    verificationId: fragment.get("verificationId"),
    challengeSecret: fragment.get("challenge"),
  })
);

test("6.2.5-C2 verified guest Appointment READ capability uses durable delivery", async (t) => {
  await t.test("public request only persists durable intent and exposes no bearer or transport call", async () => {
    const appointment = await nextAppointment();
    let calls = 0;
    const response = await requestGuestAppointmentReadChallenge({
      businessId: businessA._id,
      appointmentId: appointment._id,
      deliverVerification: async () => { calls += 1; },
    });

    assert.deepEqual(response, { accepted: true });
    assert.equal(calls, 0);
    assert.equal(Object.hasOwn(response, "bearer"), false);
    assert.equal(Object.hasOwn(response, "challenge"), false);
    const job = await GuestAppointmentVerificationJob.findOne({ appointment: appointment._id }).lean();
    assert.ok(job);
    assert.equal(job.status, "queued");
    await GuestAppointmentVerificationJob.deleteOne({ _id: job._id });
  });

  await t.test("same scope stays deduplicated during cooldown", async () => {
    const appointment = await nextAppointment();
    const first = await requestGuestAppointmentReadChallenge({
      businessId: businessA._id,
      appointmentId: appointment._id,
    });
    const second = await requestGuestAppointmentReadChallenge({
      businessId: businessA._id,
      appointmentId: appointment._id,
    });
    assert.deepEqual(first, { accepted: true });
    assert.deepEqual(second, { accepted: true });
    assert.equal(
      await GuestAppointmentVerificationJob.countDocuments({
        business: businessA._id,
        appointment: appointment._id,
        purpose: "appointment-read-bootstrap",
        action: "read",
      }),
      1,
    );
    await GuestAppointmentVerificationJob.deleteOne({ appointment: appointment._id });
  });

  await t.test("worker delivers only to Appointment.guestContact and later User.email mutation is irrelevant", async () => {
    const snapshotDestination = `snapshot-${suffix}@example.com`;
    const appointment = await nextAppointment({ destination: snapshotDestination });
    clientA.email = [`mutated-${suffix}@example.com`];
    await clientA.save();

    const { transportPayload, fragment, url } = await deliveredProof(appointment);
    assert.equal(transportPayload.destination, snapshotDestination);
    assert.equal(url.origin, process.env.GUEST_APPOINTMENT_ACCESS_ORIGIN);
    assert.equal(url.search, "");
    assert.equal(fragment.get("businessId"), businessA._id.toString());
    assert.equal(fragment.get("appointmentId"), appointment._id.toString());
    assert.equal(fragment.get("purpose"), "appointment-read-bootstrap");

    const verificationId = fragment.get("verificationId");
    const challenge = fragment.get("challenge");
    const persisted = await ClientContactVerification.findById(verificationId).select("+secretHash").lean();
    const delivery = await GuestAppointmentVerificationDelivery.findOne({ verification: verificationId }).lean();
    const job = await GuestAppointmentVerificationJob.findOne({ appointment: appointment._id }).lean();

    assert.equal(persisted.destination, snapshotDestination);
    assert.equal(persisted.secret, undefined);
    assert.notEqual(persisted.secretHash, challenge);
    assert.equal(delivery.status, "delivered");
    assert.equal(delivery.jobGeneration, job.generation);
    assert.equal(job.status, "delivered");
    assert.ok(job.purgeAfter instanceof Date);
    assert.ok(job.purgeAfter.getTime() >= job.nextEligibleAt.getTime());
  });

  await t.test("legacy Appointment without guestContact fails closed and Appointment.client is never fallback provenance", async () => {
    const legacy = await nextAppointment({ withGuestContact: false });
    let calls = 0;
    const response = await requestGuestAppointmentReadChallenge({
      businessId: businessA._id,
      appointmentId: legacy._id,
    });
    assert.deepEqual(response, { accepted: true });

    const result = await processNextGuestAppointmentVerificationJob({
      workerId: `legacy-worker-${suffix}`,
      deliverVerification: async () => { calls += 1; return true; },
    });
    assert.equal(result?.status, "failed");
    assert.equal(calls, 0);
    assert.equal(await ClientContactVerification.countDocuments({ business: businessA._id, destination: clientA.email[0] }), 0);
    const job = await GuestAppointmentVerificationJob.findOne({ appointment: legacy._id }).lean();
    assert.equal(job.status, "failed");
    assert.ok(job.purgeAfter instanceof Date);
  });

  await t.test("rejected transport leaves delivery/job failed and cannot enable exchange", async () => {
    const appointment = await nextAppointment();
    const processed = await requestAndProcess({ appointment, accepted: false });
    assert.equal(processed.result?.status, "failed");
    assert.equal(processed.transportCalls, 1);
    const { fragment } = parseAccessUrl(processed.transportPayload.accessUrl);
    const verificationId = fragment.get("verificationId");
    const delivery = await GuestAppointmentVerificationDelivery.findOne({ verification: verificationId }).lean();
    const verification = await ClientContactVerification.findById(verificationId).lean();
    assert.equal(delivery.status, "failed");
    assert.equal(verification.status, "revoked");
    await expectInvalid(exchangeProof({ appointment, fragment }));
  });

  await t.test("direct C1 issue without delivered C2 job cannot mint capability", async () => {
    const appointment = await nextAppointment();
    const issued = await issueVerificationForBusiness({
      businessId: businessA._id,
      destination: `direct-${suffix}@example.com`,
      purpose: "appointment-read-bootstrap",
    });
    await expectInvalid(exchangeGuestAppointmentReadChallenge({
      businessId: businessA._id,
      appointmentId: appointment._id,
      verificationId: issued.verificationId,
      challengeSecret: issued.secret,
    }));
  });

  await t.test("purpose/action confusion fails closed", async () => {
    const appointment = await nextAppointment();
    const issued = await issueVerificationForBusiness({
      businessId: businessA._id,
      destination: `purpose-${suffix}@example.com`,
      purpose: "appointment-read-bootstrap",
    });
    await assert.rejects(
      deliveryRepository.createPending({
        verificationId: issued.verificationId,
        jobId: new mongoose.Types.ObjectId(),
        jobGeneration: 1,
        businessId: businessA._id,
        appointmentId: appointment._id,
        purpose: "appointment-read-bootstrap",
        action: "cancel",
      }),
      /purpose\/action no implementado/u,
    );
  });

  await t.test("cross-Business and cross-Appointment attempts fail without destroying the correct proof", async () => {
    const appointment = await nextAppointment();
    const otherA = await nextAppointment();
    const appointmentB = await nextAppointment({
      business: businessB,
      client: clientB,
      worker: workerB,
      service: serviceB,
      destination: clientB.email[0],
    });
    const { fragment } = await deliveredProof(appointment);

    await expectInvalid(exchangeGuestAppointmentReadChallenge({
      businessId: businessB._id,
      appointmentId: appointmentB._id,
      verificationId: fragment.get("verificationId"),
      challengeSecret: fragment.get("challenge"),
    }));
    await expectInvalid(exchangeGuestAppointmentReadChallenge({
      businessId: businessA._id,
      appointmentId: otherA._id,
      verificationId: fragment.get("verificationId"),
      challengeSecret: fragment.get("challenge"),
    }));

    const capability = await exchangeProof({ appointment, fragment });
    assert.equal(capability.action, "read");
  });

  await t.test("capability raw bearer is not persisted; READ projection is minimal and single-use", async () => {
    const appointment = await nextAppointment();
    const { fragment } = await deliveredProof(appointment);
    const capability = await exchangeProof({ appointment, fragment });
    const stored = await GuestAppointmentCapability.findById(capability.capabilityId).select("+secretHash").lean();

    assert.equal(stored.business.toString(), businessA._id.toString());
    assert.equal(stored.appointment.toString(), appointment._id.toString());
    assert.equal(stored.action, "read");
    assert.notEqual(stored.secretHash, capability.bearer);
    assert.equal(JSON.stringify(stored).includes(capability.bearer), false);

    const detail = await consumeGuestAppointmentReadCapability({
      businessId: businessA._id,
      appointmentId: appointment._id,
      bearer: capability.bearer,
    });
    assert.equal(detail.appointmentId.toString(), appointment._id.toString());
    assert.equal(detail.business.id.toString(), businessA._id.toString());
    assert.equal(detail.service.name, serviceA.name);
    assert.equal(detail.client, undefined);
    assert.equal(detail.guestContact, undefined);
    assert.equal(detail.notes, undefined);
    assert.equal(detail.history, undefined);
    assert.equal(detail.timeline, undefined);

    await expectInvalid(consumeGuestAppointmentReadCapability({
      businessId: businessA._id,
      appointmentId: appointment._id,
      bearer: capability.bearer,
    }));
  });

  await t.test("exact expiry and revoke are terminal for READ capability", async () => {
    const expiryAppointment = await nextAppointment();
    const expiryDelivered = await deliveredProof(expiryAppointment);
    const expiring = await exchangeProof({ appointment: expiryAppointment, fragment: expiryDelivered.fragment });
    const exactExpiry = new Date();
    await GuestAppointmentCapability.updateOne({ _id: expiring.capabilityId }, { $set: { expiresAt: exactExpiry } });
    await expectInvalid(consumeGuestAppointmentReadCapability({
      businessId: businessA._id,
      appointmentId: expiryAppointment._id,
      bearer: expiring.bearer,
    }));
    assert.equal((await GuestAppointmentCapability.findById(expiring.capabilityId)).status, "active");

    const revokedAppointment = await nextAppointment();
    const revokedDelivered = await deliveredProof(revokedAppointment);
    const revocable = await exchangeProof({ appointment: revokedAppointment, fragment: revokedDelivered.fragment });
    const revoked = await capabilityRepository.revokeForScope({
      capabilityId: revocable.capabilityId,
      businessId: businessA._id,
      appointmentId: revokedAppointment._id,
      action: "read",
      now: new Date(),
    });
    assert.equal(revoked.status, "revoked");
    await expectInvalid(consumeGuestAppointmentReadCapability({
      businessId: businessA._id,
      appointmentId: revokedAppointment._id,
      bearer: revocable.bearer,
    }));
  });

  await t.test("resource/service incoherence after proof fails closed after consuming the one-shot capability", async () => {
    const appointment = await nextAppointment();
    const { fragment } = await deliveredProof(appointment);
    const capability = await exchangeProof({ appointment, fragment });
    await Appointment.updateOne({ _id: appointment._id }, { $set: { service: serviceB._id } });

    await expectInvalid(consumeGuestAppointmentReadCapability({
      businessId: businessA._id,
      appointmentId: appointment._id,
      bearer: capability.bearer,
    }));
    const stored = await GuestAppointmentCapability.findById(capability.capabilityId).lean();
    assert.equal(stored.status, "consumed");
  });

  await t.test("two workers cannot send twice for the same queued job", async () => {
    const appointment = await nextAppointment();
    await requestGuestAppointmentReadChallenge({ businessId: businessA._id, appointmentId: appointment._id });
    let calls = 0;
    const transport = async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return true;
    };
    const results = await Promise.all([
      processNextGuestAppointmentVerificationJob({ workerId: `concurrent-a-${suffix}`, deliverVerification: transport }),
      processNextGuestAppointmentVerificationJob({ workerId: `concurrent-b-${suffix}`, deliverVerification: transport }),
    ]);
    assert.equal(calls, 1);
    assert.equal(results.filter((result) => result?.status === "delivered").length, 1);
  });

  await t.test("stale processing is reclaimable, but stale delivering is failed/revoked without resend", async () => {
    const processingAppointment = await nextAppointment();
    const base = new Date("2031-01-01T00:00:00.000Z");
    await jobRepository.enqueueForScope({
      businessId: businessA._id,
      appointmentId: processingAppointment._id,
      purpose: "appointment-read-bootstrap",
      action: "read",
      now: base,
    });
    const firstClaim = await jobRepository.claimNext({ workerId: `stale-one-${suffix}`, now: base, leaseMs: 1000 });
    const secondClaim = await jobRepository.claimNext({ workerId: `stale-two-${suffix}`, now: new Date(base.getTime() + 1001), leaseMs: 1000 });
    assert.equal(firstClaim._id.toString(), secondClaim._id.toString());
    assert.equal(secondClaim.attempts, firstClaim.attempts + 1);
    await jobRepository.markFailed({
      jobId: secondClaim._id,
      generation: secondClaim.generation,
      workerId: `stale-two-${suffix}`,
      now: new Date(base.getTime() + 1100),
    });

    const deliveringAppointment = await nextAppointment();
    const start = new Date();
    await jobRepository.enqueueForScope({
      businessId: businessA._id,
      appointmentId: deliveringAppointment._id,
      purpose: "appointment-read-bootstrap",
      action: "read",
      now: start,
    });
    const job = await jobRepository.claimNext({ workerId: `deliver-owner-${suffix}`, now: start, leaseMs: 1000 });
    const issued = await issueVerificationForBusiness({
      businessId: businessA._id,
      destination: `stale-delivery-${suffix}@example.com`,
      purpose: "appointment-read-bootstrap",
    });
    await jobRepository.attachVerification({
      jobId: job._id,
      generation: job.generation,
      workerId: `deliver-owner-${suffix}`,
      verificationId: issued.verificationId,
    });
    const delivery = await deliveryRepository.createPending({
      verificationId: issued.verificationId,
      jobId: job._id,
      jobGeneration: job.generation,
      businessId: businessA._id,
      appointmentId: deliveringAppointment._id,
      purpose: "appointment-read-bootstrap",
      action: "read",
    });
    await jobRepository.attachDelivery({
      jobId: job._id,
      generation: job.generation,
      workerId: `deliver-owner-${suffix}`,
      verificationId: issued.verificationId,
      deliveryId: delivery._id,
    });
    await jobRepository.beginDelivery({
      jobId: job._id,
      generation: job.generation,
      workerId: `deliver-owner-${suffix}`,
      verificationId: issued.verificationId,
      deliveryId: delivery._id,
      now: start,
      leaseMs: 1000,
    });

    const wrongOwner = await jobRepository.markDelivered({
      jobId: job._id,
      generation: job.generation,
      workerId: `wrong-owner-${suffix}`,
      verificationId: issued.verificationId,
      deliveryId: delivery._id,
      now: new Date(start.getTime() + 500),
    });
    assert.equal(wrongOwner, null);

    let resendCalls = 0;
    const reconciled = await processNextGuestAppointmentVerificationJob({
      workerId: `reconcile-${suffix}`,
      now: new Date(start.getTime() + 1001),
      deliverVerification: async () => { resendCalls += 1; return true; },
    });
    assert.equal(resendCalls, 0);
    assert.equal(reconciled, null);
    assert.equal((await GuestAppointmentVerificationJob.findById(job._id)).status, "failed");
    assert.equal((await GuestAppointmentVerificationDelivery.findById(delivery._id)).status, "failed");
    assert.equal((await ClientContactVerification.findById(issued.verificationId)).status, "revoked");
  });

  await t.test("an older generation or worker cannot complete a reset scope", async () => {
    const appointment = await nextAppointment();
    const firstNow = new Date("2033-01-01T00:00:00.000Z");
    await jobRepository.enqueueForScope({
      businessId: businessA._id,
      appointmentId: appointment._id,
      purpose: "appointment-read-bootstrap",
      action: "read",
      now: firstNow,
      cooldownMs: 1000,
    });
    const old = await jobRepository.claimNext({ workerId: `old-generation-${suffix}`, now: firstNow });
    await jobRepository.markFailed({
      jobId: old._id,
      generation: old.generation,
      workerId: `old-generation-${suffix}`,
      now: firstNow,
      cooldownMs: 1000,
      retentionMs: 2000,
    });
    const reset = await jobRepository.enqueueForScope({
      businessId: businessA._id,
      appointmentId: appointment._id,
      purpose: "appointment-read-bootstrap",
      action: "read",
      now: new Date(firstNow.getTime() + 1001),
      cooldownMs: 1000,
    });
    assert.equal(reset.job.generation, old.generation + 1);
    assert.equal(reset.job.purgeAfter, null);

    const oldFailure = await jobRepository.markFailed({
      jobId: old._id,
      generation: old.generation,
      workerId: `old-generation-${suffix}`,
      now: new Date(firstNow.getTime() + 1100),
    });
    assert.equal(oldFailure, null);
    await GuestAppointmentVerificationJob.deleteOne({ _id: old._id });
  });

  await t.test("persistent intake backpressure bounds random scopes and terminal retention is purgeable", async () => {
    const bucketNow = new Date("2040-01-01T00:00:00.000Z");
    const randomAppointments = Array.from({ length: 20 }, () => new mongoose.Types.ObjectId());
    const outcomes = [];
    for (const appointmentId of randomAppointments) {
      outcomes.push(await jobRepository.enqueueForScope({
        businessId: businessA._id,
        appointmentId,
        purpose: "appointment-read-bootstrap",
        action: "read",
        now: bucketNow,
        intakeWindowMs: 60_000,
        intakeMaxPerWindow: 3,
        intakeBucketRetentionMs: 120_000,
      }));
    }

    assert.equal(outcomes.filter((outcome) => outcome.enqueued).length, 3);
    assert.equal(outcomes.filter((outcome) => outcome.backpressured).length, 17);
    const createdIds = randomAppointments.slice(0, 3);
    assert.equal(
      await GuestAppointmentVerificationJob.countDocuments({ appointment: { $in: randomAppointments } }),
      3,
    );

    const publicResponse = await requestGuestAppointmentReadChallenge({
      businessId: businessA._id,
      appointmentId: new mongoose.Types.ObjectId(),
    });
    assert.deepEqual(publicResponse, { accepted: true });

    for (let index = 0; index < 3; index += 1) {
      const result = await processNextGuestAppointmentVerificationJob({
        workerId: `amplification-${index}-${suffix}`,
        deliverVerification: async () => {
          throw new Error("transport must not be called for invalid resource");
        },
      });
      assert.equal(result?.status, "failed");
    }

    const terminals = await GuestAppointmentVerificationJob.find({ appointment: { $in: createdIds } }).lean();
    assert.equal(terminals.length, 3);
    for (const job of terminals) {
      assert.equal(job.status, "failed");
      assert.ok(job.purgeAfter instanceof Date);
      assert.ok(job.purgeAfter.getTime() >= job.nextEligibleAt.getTime());
    }

    const active = await GuestAppointmentVerificationJob.create({
      business: businessA._id,
      appointment: new mongoose.Types.ObjectId(),
      purpose: "appointment-read-bootstrap",
      action: "read",
      status: "queued",
      generation: 1,
      nextEligibleAt: new Date(Date.now() + 60_000),
      purgeAfter: null,
    });
    assert.equal(active.purgeAfter, null);

    const afterRetention = new Date(Math.max(...terminals.map((job) => job.purgeAfter.getTime())) + 1);
    await GuestAppointmentVerificationJob.deleteMany({
      status: { $in: ["delivered", "failed"] },
      purgeAfter: { $lte: afterRetention },
    });
    assert.equal(
      await GuestAppointmentVerificationJob.countDocuments({ appointment: { $in: createdIds } }),
      0,
    );
    assert.ok(await GuestAppointmentVerificationJob.exists({ _id: active._id }));
  });
});

test.after(async () => {
  await GuestAppointmentCapability.deleteMany({ business: { $in: [businessA._id, businessB._id] } });
  await GuestAppointmentVerificationDelivery.deleteMany({ business: { $in: [businessA._id, businessB._id] } });
  await ClientContactVerification.deleteMany({ business: { $in: [businessA._id, businessB._id] } });
  await GuestAppointmentVerificationJob.deleteMany({ business: { $in: [businessA._id, businessB._id] } });
  await GuestAppointmentIntakeBucket.deleteMany({ _id: /^guest-appointment-read:/u });
  await Appointment.deleteMany({ business: { $in: [businessA._id, businessB._id] } });
  await Service.deleteMany({ business: { $in: [businessA._id, businessB._id] } });
  await User.deleteMany({ _id: { $in: [clientA._id, clientB._id, workerA._id, workerB._id] } });
  await Business.deleteMany({ _id: { $in: [businessA._id, businessB._id] } });
  await mongoose.disconnect();
});
