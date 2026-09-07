import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { readFile } from "node:fs/promises";
import GuestAppointmentCapability, { GUEST_APPOINTMENT_CAPABILITY_STATUSES } from "../../src/db/models/guestAppointmentCapability.model.js";
import {
  GUEST_APPOINTMENT_ACTIONS,
  GUEST_APPOINTMENT_IMPLEMENTED_ACTIONS,
  GUEST_APPOINTMENT_IMPLEMENTED_PURPOSE_TO_ACTION,
} from "../../src/security/guestAppointmentCapability.constants.js";
import {
  guestAppointmentCancelChallengeSchema,
  guestAppointmentCancelConsumeSchema,
  guestAppointmentReadChallengeSchema,
  guestAppointmentRescheduleChallengeSchema,
  guestAppointmentRescheduleConsumeSchema,
  guestAppointmentRescheduleExchangeSchema,
} from "../../src/validations/guestAppointmentCapability.validation.js";
import { emitAvailabilityChange, registerAvailabilityChangeEmitter } from "../../src/config/availabilityEvents.js";

const envelope = (body) => ({ body, query: {}, params: {} });

test("6.2.5-C2/H3 capability contract", async (t) => {
  await t.test("READ, CANCEL and RESCHEDULE are explicit independent authorities", () => {
    assert.deepEqual(GUEST_APPOINTMENT_ACTIONS, ["read", "cancel", "reschedule"]);
    assert.deepEqual(GUEST_APPOINTMENT_IMPLEMENTED_ACTIONS, ["read", "cancel", "reschedule"]);
    assert.deepEqual(GUEST_APPOINTMENT_IMPLEMENTED_PURPOSE_TO_ACTION, {
      "appointment-read-bootstrap": "read",
      "appointment-cancel-bootstrap": "cancel",
      "appointment-reschedule-bootstrap": "reschedule",
    });
  });

  await t.test("capability storage remains hashed and has no User/Membership authority", () => {
    assert.deepEqual(GUEST_APPOINTMENT_CAPABILITY_STATUSES, ["active", "consumed", "revoked"]);
    assert.equal(GuestAppointmentCapability.schema.path("business").options.required, true);
    assert.equal(GuestAppointmentCapability.schema.path("appointment").options.required, true);
    assert.equal(GuestAppointmentCapability.schema.path("action").options.required, true);
    assert.equal(GuestAppointmentCapability.schema.path("secretHash").options.select, false);
    assert.equal(GuestAppointmentCapability.schema.path("user"), undefined);
    assert.equal(GuestAppointmentCapability.schema.path("membership"), undefined);
    assert.equal(GuestAppointmentCapability.schema.path("secret"), undefined);
  });

  await t.test("RESCHEDULE HTTP schema accepts only date/startTime mutation input", () => {
    const businessId = new mongoose.Types.ObjectId().toString();
    const appointmentId = new mongoose.Types.ObjectId().toString();
    const verificationId = new mongoose.Types.ObjectId().toString();
    const bearer = "b".repeat(43);
    const challengeSecret = "a".repeat(43);

    assert.equal(guestAppointmentReadChallengeSchema.safeParse(envelope({ businessId, appointmentId })).success, true);
    assert.equal(guestAppointmentCancelChallengeSchema.safeParse(envelope({ businessId, appointmentId })).success, true);
    assert.equal(guestAppointmentRescheduleChallengeSchema.safeParse(envelope({ businessId, appointmentId })).success, true);
    assert.equal(guestAppointmentRescheduleExchangeSchema.safeParse(envelope({ businessId, appointmentId, verificationId, challengeSecret })).success, true);
    assert.equal(guestAppointmentRescheduleConsumeSchema.safeParse(envelope({ businessId, appointmentId, bearer, date: "2099-09-14", startTime: "11:00" })).success, true);

    for (const injected of [
      { worker: new mongoose.Types.ObjectId().toString() },
      { service: new mongoose.Types.ObjectId().toString() },
      { endTime: "12:00" },
      { status: "confirmed" },
      { paymentStatus: "fully_paid" },
      { clientInfo: { email: "attacker@example.com" } },
      { duration: 5 },
    ]) {
      assert.equal(guestAppointmentRescheduleConsumeSchema.safeParse(envelope({
        businessId, appointmentId, bearer, date: "2099-09-14", startTime: "11:00", ...injected,
      })).success, false);
    }
    assert.equal(guestAppointmentCancelConsumeSchema.safeParse(envelope({ businessId, appointmentId, bearer, date: "2099-09-14" })).success, false);
  });

  await t.test("availability bridge remains lifecycle-neutral and guest domain never imports socket.js", async () => {
    let observed = null;
    const unregister = registerAvailabilityChangeEmitter((workerId, dateStr, businessId) => { observed = { workerId, dateStr, businessId }; });
    emitAvailabilityChange("worker", "2099-01-02", "business");
    assert.deepEqual(observed, { workerId: "worker", dateStr: "2099-01-02", businessId: "business" });
    unregister();

    const serviceSource = await readFile(new URL("../../src/services/guestAppointmentCapability.service.js", import.meta.url), "utf8");
    const rescheduleRepo = await readFile(new URL("../../src/repositories/guestAppointmentReschedule.repository.js", import.meta.url), "utf8");
    assert.match(serviceSource, /from "\.\.\/config\/availabilityEvents\.js"/u);
    assert.doesNotMatch(serviceSource, /from "\.\.\/config\/socket\.js"/u);
    assert.doesNotMatch(rescheduleRepo, /socket\.js/u);
  });

  await t.test("shared G2/H3 lock primitive deduplicates and globally sorts interval + canonical availability keys", async () => {
    const source = await readFile(new URL("../../src/repositories/appointment.repository.js", import.meta.url), "utf8");
    assert.match(source, /new Set\(scopes\.map/u);
    assert.match(source, /new Set\(scopes\.flatMap\(\(scope\) => canonicalAvailabilityFenceIds\(scope\)\)\)/u);
    assert.match(source, /new Set\(\[\.\.\.bookingLockIds, \.\.\.availabilityLockIds\]\)\]\.sort\(\)/u);
    assert.match(source, /for \(const lockId of lockIds\)/u);
    assert.match(source, /excludeAppointmentId/u);
  });
});
