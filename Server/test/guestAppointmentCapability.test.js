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
import GuestAppointmentCapability from "../src/db/models/guestAppointmentCapability.model.js";
import * as deliveryRepository from "../src/repositories/guestAppointmentVerificationDelivery.repository.js";
import {
  consumeGuestAppointmentReadCapability,
  exchangeGuestAppointmentReadChallenge,
  requestGuestAppointmentReadChallenge,
} from "../src/services/guestAppointmentCapability.service.js";
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
const ambiguousClient = await User.create({
  firstName: "Guest",
  lastName: "Ambiguous",
  email: [`guest-c1-${suffix}@example.com`, `guest-c2-${suffix}@example.com`],
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
const date = new Date("2032-05-20T00:00:00.000Z");
const appointmentA = await Appointment.create({
  client: clientA._id,
  worker: workerA._id,
  service: serviceA._id,
  date,
  startTime: "10:00",
  endTime: "11:00",
  business: businessA._id,
  notes: "never expose this note",
});
const appointmentA2 = await Appointment.create({
  client: clientA._id,
  worker: workerA._id,
  service: serviceA._id,
  date,
  startTime: "11:00",
  endTime: "12:00",
  business: businessA._id,
});
const ambiguousAppointment = await Appointment.create({
  client: ambiguousClient._id,
  worker: workerA._id,
  service: serviceA._id,
  date,
  startTime: "12:00",
  endTime: "13:00",
  business: businessA._id,
});
const appointmentB = await Appointment.create({
  client: clientB._id,
  worker: workerB._id,
  service: serviceB._id,
  date,
  startTime: "10:00",
  endTime: "10:30",
  business: businessB._id,
});

const expectInvalid = async (promise) => {
  await assert.rejects(promise, (error) => error.code === "GUEST_APPOINTMENT_CAPABILITY_INVALID_PROOF");
};

const deliveredFromRequest = async (appointmentId = appointmentA._id) => {
  let deliveryPayload;
  const result = await requestGuestAppointmentReadChallenge({
    businessId: businessA._id,
    appointmentId,
    deliverVerification: async (payload) => {
      deliveryPayload = payload;
      return true;
    },
  });
  assert.deepEqual(result, { accepted: true });
  assert.ok(deliveryPayload);
  const url = new URL(deliveryPayload.accessUrl);
  const fragment = new URLSearchParams(url.hash.slice(1));
  return { deliveryPayload, fragment };
};

test("6.2.5-C2 verified guest Appointment READ capability", async (t) => {
  await t.test("trusted delivery uses persisted destination and issue response exposes no bearer", async () => {
    const { deliveryPayload, fragment } = await deliveredFromRequest();
    assert.equal(deliveryPayload.destination, clientA.email[0]);
    assert.equal(new URL(deliveryPayload.accessUrl).origin, process.env.GUEST_APPOINTMENT_ACCESS_ORIGIN);
    assert.equal(new URL(deliveryPayload.accessUrl).search, "");
    assert.equal(fragment.get("businessId"), businessA._id.toString());
    assert.equal(fragment.get("appointmentId"), appointmentA._id.toString());
    assert.equal(fragment.get("purpose"), "appointment-read-bootstrap");

    const verificationId = fragment.get("verificationId");
    const challenge = fragment.get("challenge");
    const persisted = await ClientContactVerification.findById(verificationId).select("+secretHash").lean();
    const delivery = await GuestAppointmentVerificationDelivery.findOne({ verification: verificationId }).lean();
    assert.equal(persisted.destination, clientA.email[0]);
    assert.equal(persisted.secret, undefined);
    assert.notEqual(persisted.secretHash, challenge);
    assert.equal(delivery.status, "delivered");
    assert.equal(delivery.appointment.toString(), appointmentA._id.toString());
    assert.equal(JSON.stringify(persisted).includes(challenge), false);
  });

  await t.test("direct C1 issue without trusted delivery cannot mint C2 capability", async () => {
    const issued = await issueVerificationForBusiness({
      businessId: businessA._id,
      destination: clientA.email[0],
      purpose: "appointment-read-bootstrap",
    });
    await expectInvalid(exchangeGuestAppointmentReadChallenge({
      businessId: businessA._id,
      appointmentId: appointmentA._id,
      verificationId: issued.verificationId,
      challengeSecret: issued.secret,
    }));
  });

  await t.test("purpose/action combinations fail closed outside implemented READ mapping", async () => {
    const issued = await issueVerificationForBusiness({
      businessId: businessA._id,
      destination: clientA.email[0],
      purpose: "appointment-read-bootstrap",
    });
    await assert.rejects(
      deliveryRepository.createPending({
        verificationId: issued.verificationId,
        businessId: businessA._id,
        appointmentId: appointmentA._id,
        purpose: "appointment-read-bootstrap",
        action: "cancel",
      }),
      /purpose\/action no implementado/u,
    );
  });

  await t.test("cross-tenant and cross-Appointment attempts fail before valid exchange", async () => {
    const { fragment } = await deliveredFromRequest();
    const verificationId = fragment.get("verificationId");
    const challengeSecret = fragment.get("challenge");

    await expectInvalid(exchangeGuestAppointmentReadChallenge({
      businessId: businessB._id,
      appointmentId: appointmentB._id,
      verificationId,
      challengeSecret,
    }));
    await expectInvalid(exchangeGuestAppointmentReadChallenge({
      businessId: businessA._id,
      appointmentId: appointmentA2._id,
      verificationId,
      challengeSecret,
    }));

    const capability = await exchangeGuestAppointmentReadChallenge({
      businessId: businessA._id,
      appointmentId: appointmentA._id,
      verificationId,
      challengeSecret,
    });
    assert.equal(capability.action, "read");

    const stored = await GuestAppointmentCapability.findById(capability.capabilityId).select("+secretHash").lean();
    assert.equal(stored.business.toString(), businessA._id.toString());
    assert.equal(stored.appointment.toString(), appointmentA._id.toString());
    assert.equal(stored.action, "read");
    assert.equal(stored.status, "active");
    assert.notEqual(stored.secretHash, capability.bearer);
    assert.equal(JSON.stringify(stored).includes(capability.bearer), false);

    await expectInvalid(consumeGuestAppointmentReadCapability({
      businessId: businessA._id,
      appointmentId: appointmentA2._id,
      bearer: capability.bearer,
    }));
    await expectInvalid(consumeGuestAppointmentReadCapability({
      businessId: businessB._id,
      appointmentId: appointmentB._id,
      bearer: capability.bearer,
    }));

    const detail = await consumeGuestAppointmentReadCapability({
      businessId: businessA._id,
      appointmentId: appointmentA._id,
      bearer: capability.bearer,
    });
    assert.equal(detail.appointmentId.toString(), appointmentA._id.toString());
    assert.equal(detail.business.id.toString(), businessA._id.toString());
    assert.equal(detail.service.name, serviceA.name);
    assert.equal(detail.client, undefined);
    assert.equal(detail.notes, undefined);

    await expectInvalid(consumeGuestAppointmentReadCapability({
      businessId: businessA._id,
      appointmentId: appointmentA._id,
      bearer: capability.bearer,
    }));
    const consumed = await GuestAppointmentCapability.findById(capability.capabilityId).lean();
    assert.equal(consumed.status, "consumed");
    assert.ok(consumed.consumedAt);
  });

  await t.test("ambiguous legacy User email set is not used for authority delivery", async () => {
    let calls = 0;
    const before = await GuestAppointmentVerificationDelivery.countDocuments({ appointment: ambiguousAppointment._id });
    const result = await requestGuestAppointmentReadChallenge({
      businessId: businessA._id,
      appointmentId: ambiguousAppointment._id,
      deliverVerification: async () => {
        calls += 1;
        return true;
      },
    });
    assert.deepEqual(result, { accepted: true });
    assert.equal(calls, 0);
    assert.equal(await GuestAppointmentVerificationDelivery.countDocuments({ appointment: ambiguousAppointment._id }), before);
  });
});

test.after(async () => {
  await GuestAppointmentCapability.deleteMany({ business: { $in: [businessA._id, businessB._id] } });
  await GuestAppointmentVerificationDelivery.deleteMany({ business: { $in: [businessA._id, businessB._id] } });
  await ClientContactVerification.deleteMany({ business: { $in: [businessA._id, businessB._id] } });
  await Appointment.deleteMany({ business: { $in: [businessA._id, businessB._id] } });
  await Service.deleteMany({ business: { $in: [businessA._id, businessB._id] } });
  await User.deleteMany({ _id: { $in: [clientA._id, clientB._id, ambiguousClient._id, workerA._id, workerB._id] } });
  await Business.deleteMany({ _id: { $in: [businessA._id, businessB._id] } });
  await mongoose.disconnect();
});
