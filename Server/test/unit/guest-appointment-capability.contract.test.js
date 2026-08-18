import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import ClientContactVerification from "../../src/db/models/clientContactVerification.model.js";
import GuestAppointmentCapability, { GUEST_APPOINTMENT_CAPABILITY_STATUSES } from "../../src/db/models/guestAppointmentCapability.model.js";
import GuestAppointmentVerificationDelivery from "../../src/db/models/guestAppointmentVerificationDelivery.model.js";
import GuestAppointmentVerificationJob from "../../src/db/models/guestAppointmentVerificationJob.model.js";
import GuestAppointmentIntakeBucket from "../../src/db/models/guestAppointmentIntakeBucket.model.js";
import {
  GUEST_APPOINTMENT_ACTIONS,
  GUEST_APPOINTMENT_IMPLEMENTED_ACTIONS,
  GUEST_APPOINTMENT_IMPLEMENTED_PURPOSE_TO_ACTION,
} from "../../src/security/guestAppointmentCapability.constants.js";
import {
  buildGuestAppointmentVerificationUrl,
  getTrustedGuestAppointmentOrigin,
} from "../../src/security/guestAppointmentAccessUrl.js";
import {
  guestAppointmentReadChallengeSchema,
  guestAppointmentReadExchangeSchema,
} from "../../src/validations/guestAppointmentCapability.validation.js";

const originalOrigin = process.env.GUEST_APPOINTMENT_ACCESS_ORIGIN;

test("6.2.5-C2 capability contract", async (t) => {
  await t.test("READ is the only implemented action and purpose mapping is closed", () => {
    assert.deepEqual(GUEST_APPOINTMENT_ACTIONS, ["read", "cancel", "reschedule"]);
    assert.deepEqual(GUEST_APPOINTMENT_IMPLEMENTED_ACTIONS, ["read"]);
    assert.deepEqual(GUEST_APPOINTMENT_IMPLEMENTED_PURPOSE_TO_ACTION, {
      "appointment-read-bootstrap": "read",
    });
    assert.equal(GUEST_APPOINTMENT_IMPLEMENTED_PURPOSE_TO_ACTION["appointment-cancel-bootstrap"], undefined);
    assert.equal(GUEST_APPOINTMENT_IMPLEMENTED_PURPOSE_TO_ACTION["appointment-reschedule-bootstrap"], undefined);
  });

  await t.test("capability persists only derived secret and resource scope", () => {
    assert.deepEqual(GUEST_APPOINTMENT_CAPABILITY_STATUSES, ["active", "consumed", "revoked"]);
    assert.equal(GuestAppointmentCapability.schema.path("business").options.required, true);
    assert.equal(GuestAppointmentCapability.schema.path("appointment").options.required, true);
    assert.equal(GuestAppointmentCapability.schema.path("action").options.required, true);
    assert.equal(GuestAppointmentCapability.schema.path("secretHash").options.select, false);
    assert.equal(GuestAppointmentCapability.schema.path("user"), undefined);
    assert.equal(GuestAppointmentCapability.schema.path("membership"), undefined);
    assert.equal(GuestAppointmentCapability.schema.path("customerProfile"), undefined);
    assert.equal(GuestAppointmentCapability.schema.path("secret"), undefined);
    assert.equal(GuestAppointmentVerificationDelivery.schema.path("destination"), undefined);
    assert.equal(ClientContactVerification.schema.path("appointment"), undefined);
  });

  await t.test("durable jobs only expose terminal purge timestamps and intake guard stores no resource identifiers", () => {
    assert.ok(GuestAppointmentVerificationJob.schema.path("purgeAfter"));
    assert.equal(GuestAppointmentVerificationJob.schema.path("bearer"), undefined);
    assert.equal(GuestAppointmentVerificationJob.schema.path("destination"), undefined);
    assert.equal(GuestAppointmentIntakeBucket.schema.path("business"), undefined);
    assert.equal(GuestAppointmentIntakeBucket.schema.path("appointment"), undefined);
    assert.equal(GuestAppointmentIntakeBucket.schema.path("destination"), undefined);

    const jobTtl = GuestAppointmentVerificationJob.schema.indexes().find(([, options]) => (
      options.name === "guest_appointment_job_terminal_ttl"
    ));
    const bucketTtl = GuestAppointmentIntakeBucket.schema.indexes().find(([, options]) => (
      options.name === "guest_appointment_intake_bucket_ttl"
    ));
    assert.ok(jobTtl);
    assert.deepEqual(jobTtl[0], { purgeAfter: 1 });
    assert.equal(jobTtl[1].expireAfterSeconds, 0);
    assert.ok(bucketTtl);
    assert.deepEqual(bucketTtl[0], { expiresAt: 1 });
    assert.equal(bucketTtl[1].expireAfterSeconds, 0);
  });

  await t.test("sensitive URL origin must be explicit HTTPS without credentials/path/query/hash", () => {
    for (const value of [
      undefined,
      "http://guest.example.test",
      "https://user:pass@guest.example.test",
      "https://guest.example.test/path",
      "https://guest.example.test?x=1",
      "https://guest.example.test/#x",
      " https://guest.example.test",
    ]) {
      if (value === undefined) delete process.env.GUEST_APPOINTMENT_ACCESS_ORIGIN;
      else process.env.GUEST_APPOINTMENT_ACCESS_ORIGIN = value;
      assert.throws(() => getTrustedGuestAppointmentOrigin(), /Configuración de acceso guest no válida/u);
    }

    process.env.GUEST_APPOINTMENT_ACCESS_ORIGIN = "https://guest.example.test";
    assert.equal(getTrustedGuestAppointmentOrigin(), "https://guest.example.test");

    const url = buildGuestAppointmentVerificationUrl({
      businessId: new mongoose.Types.ObjectId(),
      appointmentId: new mongoose.Types.ObjectId(),
      verificationId: new mongoose.Types.ObjectId(),
      purpose: "appointment-read-bootstrap",
      challengeSecret: "a".repeat(43),
    });
    const parsed = new URL(url);
    assert.equal(parsed.origin, "https://guest.example.test");
    assert.equal(parsed.search, "");
    assert.ok(parsed.hash.includes("challenge="));
  });

  await t.test("HTTP schemas require explicit businessId and reject authority/destination injection", () => {
    const businessId = new mongoose.Types.ObjectId().toString();
    const appointmentId = new mongoose.Types.ObjectId().toString();
    const verificationId = new mongoose.Types.ObjectId().toString();

    assert.equal(guestAppointmentReadChallengeSchema.safeParse({
      body: { businessId, appointmentId }, query: {}, params: {},
    }).success, true);
    assert.equal(guestAppointmentReadChallengeSchema.safeParse({
      body: { businessId, appointmentId, email: "attacker@example.com" }, query: {}, params: {},
    }).success, false);
    assert.equal(guestAppointmentReadExchangeSchema.safeParse({
      body: {
        businessId,
        appointmentId,
        verificationId,
        challengeSecret: "a".repeat(43),
        action: "cancel",
      },
      query: {},
      params: {},
    }).success, false);
  });
});

test.after(() => {
  if (originalOrigin === undefined) delete process.env.GUEST_APPOINTMENT_ACCESS_ORIGIN;
  else process.env.GUEST_APPOINTMENT_ACCESS_ORIGIN = originalOrigin;
});
