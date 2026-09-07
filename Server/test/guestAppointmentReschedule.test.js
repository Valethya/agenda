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
import Membership from "../src/db/models/membership.model.js";
import {
  consumeGuestAppointmentCancelCapability,
  consumeGuestAppointmentReadCapability,
  consumeGuestAppointmentRescheduleCapability,
  exchangeGuestAppointmentCancelChallenge,
  exchangeGuestAppointmentReadChallenge,
  exchangeGuestAppointmentRescheduleChallenge,
  requestGuestAppointmentCancelChallenge,
  requestGuestAppointmentReadChallenge,
  requestGuestAppointmentRescheduleChallenge,
} from "../src/services/guestAppointmentCapability.service.js";
import { processNextGuestAppointmentVerificationJob } from "../src/services/guestAppointmentVerification.worker.js";

await connectDB();
await cleanTestData();
const seed = await seedTestData();
const origin = "https://guest-reschedule.example.test";
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
let openDates = null;

const expectInvalid = (promise) => assert.rejects(promise, (error) => error?.code === "GUEST_APPOINTMENT_CAPABILITY_INVALID_PROOF");
const expectStateConflict = (promise) => assert.rejects(promise, (error) => error?.code === "GUEST_APPOINTMENT_RESCHEDULE_STATE_CONFLICT");
const expectSlotConflict = (promise) => assert.rejects(promise, (error) => error?.code === "GUEST_APPOINTMENT_RESCHEDULE_SLOT_CONFLICT");

const slots = async (date) => {
  const response = await fetch(`${baseUrl}/availability/slots?businessId=${seed.business._id}&workerId=${seed.worker._id}&serviceId=${seed.service._id}&date=${date}`);
  assert.equal(response.status, 200);
  return (await response.json()).payload;
};
const available = (values, startTime) => values.some((value) => value.startTime === startTime && value.available !== false);

const discoverOpenDates = async () => {
  if (openDates) return openDates;
  const result = [];
  for (let month = 9; month <= 11 && result.length < 30; month += 1) {
    for (let day = 1; day <= 28 && result.length < 30; day += 1) {
      const date = `2099-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const values = await slots(date);
      if (available(values, "10:00") && available(values, "11:00")) result.push(date);
    }
  }
  assert.ok(result.length >= 20, "fixture debe ofrecer suficientes fechas canónicas");
  openDates = result;
  return result;
};
const nextDates = async (count) => {
  const dates = await discoverOpenDates();
  const start = sequence;
  sequence += count;
  return dates.slice(start, start + count);
};

const book = async (date, startTime = "10:00", suffix = "x") => {
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
        lastName: "H3",
        email: `h3-${suffix}-${crypto.randomBytes(4).toString("hex")}@example.com`,
        phone: `+5698${crypto.randomInt(1000000, 9999999)}`,
      },
    }),
  });
  const body = await response.json();
  return { response, body, appointment: response.status === 201 ? await Appointment.findById(body.payload.appointmentId) : null };
};

const deliveredFragment = async (appointment, action) => {
  const requests = {
    read: requestGuestAppointmentReadChallenge,
    cancel: requestGuestAppointmentCancelChallenge,
    reschedule: requestGuestAppointmentRescheduleChallenge,
  };
  assert.deepEqual(await requests[action]({ businessId: appointment.business, appointmentId: appointment._id }), { accepted: true });
  let accessUrl;
  const processed = await processNextGuestAppointmentVerificationJob({
    workerId: `h3-${crypto.randomBytes(8).toString("hex")}`,
    deliverVerification: async (payload) => { accessUrl = payload.accessUrl; return true; },
  });
  assert.equal(processed?.status, "delivered");
  const fragment = new URLSearchParams(new URL(accessUrl).hash.slice(1));
  assert.equal(fragment.get("purpose"), `appointment-${action}-bootstrap`);
  return fragment;
};
const mint = async (appointment, action) => {
  const fragment = await deliveredFragment(appointment, action);
  const exchanges = {
    read: exchangeGuestAppointmentReadChallenge,
    cancel: exchangeGuestAppointmentCancelChallenge,
    reschedule: exchangeGuestAppointmentRescheduleChallenge,
  };
  return exchanges[action]({
    businessId: appointment.business,
    appointmentId: appointment._id,
    verificationId: fragment.get("verificationId"),
    challengeSecret: fragment.get("challenge"),
  });
};
const rescheduleWith = (appointment, capability, date, startTime) => consumeGuestAppointmentRescheduleCapability({
  businessId: appointment.business,
  appointmentId: appointment._id,
  bearer: capability.bearer,
  date,
  startTime,
});

const setStatus = async (appointment, status) => Appointment.updateOne({ _id: appointment._id }, { $set: { status } });

test("H3 guest reschedule", async (t) => {
  await t.test("RESCHEDULE challenge remains non-enumerative and proof mints RESCHEDULE only", async () => {
    const [date] = await nextDates(1);
    const { appointment } = await book(date, "10:00", "challenge");
    const existing = await requestGuestAppointmentRescheduleChallenge({ businessId: seed.business._id, appointmentId: appointment._id });
    const missing = await requestGuestAppointmentRescheduleChallenge({ businessId: seed.business._id, appointmentId: new Appointment()._id });
    assert.deepEqual(existing, { accepted: true });
    assert.deepEqual(missing, { accepted: true });
    const capability = await mint(appointment, "reschedule");
    assert.equal(capability.action, "reschedule");
    assert.equal(capability.businessId.toString(), seed.business._id.toString());
    assert.equal(capability.appointmentId.toString(), appointment._id.toString());
  });

  await t.test("READ and CANCEL bearers cannot reschedule; RESCHEDULE cannot cancel or read", async () => {
    const [dateA, dateB, dateC] = await nextDates(3);
    const a = (await book(dateA, "10:00", "authority-a")).appointment;
    const read = await mint(a, "read");
    await expectInvalid(rescheduleWith(a, read, dateB, "10:00"));

    const b = (await book(dateB, "10:00", "authority-b")).appointment;
    const cancel = await mint(b, "cancel");
    await expectInvalid(rescheduleWith(b, cancel, dateC, "10:00"));

    const c = (await book(dateC, "10:00", "authority-c")).appointment;
    const reschedule = await mint(c, "reschedule");
    await expectInvalid(consumeGuestAppointmentCancelCapability({ businessId: c.business, appointmentId: c._id, bearer: reschedule.bearer }));
    await expectInvalid(consumeGuestAppointmentReadCapability({ businessId: c.business, appointmentId: c._id, bearer: reschedule.bearer }));
  });

  await t.test("RESCHEDULE is exact Business + Appointment scope; expired and reused fail", async () => {
    const [dateA, dateB, dateC] = await nextDates(3);
    const a = (await book(dateA, "10:00", "scope-a")).appointment;
    const other = (await book(dateB, "10:00", "scope-b")).appointment;
    const scoped = await mint(a, "reschedule");
    await expectInvalid(consumeGuestAppointmentRescheduleCapability({ businessId: a.business, appointmentId: other._id, bearer: scoped.bearer, date: dateC, startTime: "10:00" }));
    await expectInvalid(consumeGuestAppointmentRescheduleCapability({ businessId: seed.businessB._id, appointmentId: a._id, bearer: scoped.bearer, date: dateC, startTime: "10:00" }));

    const expired = await mint(a, "reschedule");
    await GuestAppointmentCapability.updateOne({ _id: expired.capabilityId }, { $set: { expiresAt: new Date("2000-01-01T00:00:00.000Z") } });
    await expectInvalid(rescheduleWith(a, expired, dateC, "10:00"));

    const result = await rescheduleWith(a, scoped, dateC, "10:00");
    assert.equal(result.appointmentId.toString(), a._id.toString());
    await expectInvalid(rescheduleWith(a, scoped, dateA, "10:00"));
  });

  for (const status of ["pending", "pending_payment", "confirmed"]) {
    await t.test(`${status} reschedules same Appointment and preserves business/service/worker/payment`, async () => {
      const [dateA, dateB] = await nextDates(2);
      const appointment = (await book(dateA, "10:00", `state-${status}`)).appointment;
      await setStatus(appointment, status);
      const before = await Appointment.findById(appointment._id).lean();
      const capability = await mint(await Appointment.findById(appointment._id), "reschedule");
      const result = await rescheduleWith(appointment, capability, dateB, "11:00");
      const after = await Appointment.findById(appointment._id).lean();
      assert.equal(result.appointmentId.toString(), appointment._id.toString());
      assert.equal(after._id.toString(), before._id.toString());
      assert.equal(after.business.toString(), before.business.toString());
      assert.equal(after.service.toString(), before.service.toString());
      assert.equal(after.worker.toString(), before.worker.toString());
      assert.equal(after.paymentStatus, before.paymentStatus);
      assert.equal(after.status, status);
      assert.equal(after.startTime, "11:00");
      assert.equal(after.endTime, result.endTime);
      assert.notEqual(after.date.getTime(), before.date.getTime());
    });
  }

  for (const status of ["cancelled", "completed"]) {
    await t.test(`${status} cannot reschedule and capability stays active`, async () => {
      const [dateA, dateB] = await nextDates(2);
      const appointment = (await book(dateA, "10:00", `closed-${status}`)).appointment;
      await setStatus(appointment, status);
      const current = await Appointment.findById(appointment._id);
      const capability = await mint(current, "reschedule");
      await expectStateConflict(rescheduleWith(current, capability, dateB, "10:00"));
      assert.equal((await GuestAppointmentCapability.findById(capability.capabilityId)).status, "active");
      assert.equal((await Appointment.findById(appointment._id)).status, status);
    });
  }

  await t.test("canonical A→B sequence releases A, blocks B, preserves [start,end) and own-id exclusion", async () => {
    const [dateA, dateB] = await nextDates(2);
    assert.equal(available(await slots(dateA), "10:00"), true);
    assert.equal(available(await slots(dateB), "10:00"), true);
    const first = await book(dateA, "10:00", "sequence");
    assert.equal(first.response.status, 201);
    assert.equal(available(await slots(dateA), "10:00"), false);
    const capability = await mint(first.appointment, "reschedule");
    await rescheduleWith(first.appointment, capability, dateB, "10:00");
    assert.equal(available(await slots(dateA), "10:00"), true);
    assert.equal(available(await slots(dateB), "10:00"), false);
    assert.equal((await Appointment.findById(first.appointment._id))._id.toString(), first.appointment._id.toString());
  });

  await t.test("same-date reschedule excludes only X and another Appointment still blocks overlap", async () => {
    const [date] = await nextDates(1);
    const x = (await book(date, "10:00", "same-x")).appointment;
    const capability = await mint(x, "reschedule");
    const moved = await rescheduleWith(x, capability, date, "11:00");
    assert.equal(moved.startTime, "11:00");
    const y = await book(date, "10:00", "same-y");
    assert.equal(y.response.status, 201, "old X interval must be released");
    const retry = await mint(await Appointment.findById(x._id), "reschedule");
    await expectSlotConflict(rescheduleWith(x, retry, date, "10:00"));
    assert.equal((await Appointment.findById(x._id)).startTime, "11:00");
  });

  await t.test("slot conflict aborts move, capability consumption and success audit together", async () => {
    const [dateA, dateB] = await nextDates(2);
    const x = (await book(dateA, "10:00", "abort-x")).appointment;
    await book(dateB, "10:00", "abort-blocker");
    const capability = await mint(x, "reschedule");
    await expectSlotConflict(rescheduleWith(x, capability, dateB, "10:00"));
    const stored = await Appointment.findById(x._id);
    assert.equal(stored.date.toISOString().slice(0, 10), dateA);
    assert.equal(stored.startTime, "10:00");
    assert.equal((await GuestAppointmentCapability.findById(capability.capabilityId)).status, "active");
    assert.equal(await AuditLog.exists({ appointmentId: x._id, event: "APPOINTMENT_RESCHEDULED" }), null);
  });

  await t.test("reschedule vs public booking for B has one winner", async () => {
    const [dateA, dateB] = await nextDates(2);
    const x = (await book(dateA, "10:00", "race-book-x")).appointment;
    const capability = await mint(x, "reschedule");
    const [move, competing] = await Promise.allSettled([
      rescheduleWith(x, capability, dateB, "10:00"),
      book(dateB, "10:00", "race-book-y"),
    ]);
    const moved = move.status === "fulfilled";
    const booked = competing.status === "fulfilled" && competing.value.response.status === 201;
    assert.notEqual(moved, booked, "exactly one operation must acquire B");
    const blockers = await Appointment.find({ business: seed.business._id, worker: seed.worker._id, date: new Date(`${dateB}T00:00:00.000Z`), startTime: "10:00", status: { $ne: "cancelled" } });
    assert.equal(blockers.length, 1);
  });

  await t.test("reschedule X→B vs reschedule Y→B has one winner and loser keeps origin", async () => {
    const [dateA, dateC, dateB] = await nextDates(3);
    const x = (await book(dateA, "10:00", "race-r-x")).appointment;
    const y = (await book(dateC, "10:00", "race-r-y")).appointment;
    const capX = await mint(x, "reschedule");
    const capY = await mint(y, "reschedule");
    const results = await Promise.allSettled([
      rescheduleWith(x, capX, dateB, "10:00"),
      rescheduleWith(y, capY, dateB, "10:00"),
    ]);
    assert.equal(results.filter((value) => value.status === "fulfilled").length, 1);
    const storedX = await Appointment.findById(x._id);
    const storedY = await Appointment.findById(y._id);
    const atB = [storedX, storedY].filter((value) => value.date.toISOString().slice(0, 10) === dateB);
    assert.equal(atB.length, 1);
    const loser = atB[0]._id.toString() === x._id.toString() ? storedY : storedX;
    assert.ok([dateA, dateC].includes(loser.date.toISOString().slice(0, 10)));
  });

  await t.test("eligibility loss fails closed without moving or consuming capability", async () => {
    const [dateA, dateB] = await nextDates(2);
    const x = (await book(dateA, "10:00", "eligibility")).appointment;
    const capability = await mint(x, "reschedule");
    await Membership.updateOne({ user: seed.worker._id, business: seed.business._id }, { $set: { isBookable: false } });
    await expectStateConflict(rescheduleWith(x, capability, dateB, "10:00"));
    assert.equal((await Appointment.findById(x._id)).date.toISOString().slice(0, 10), dateA);
    assert.equal((await GuestAppointmentCapability.findById(capability.capabilityId)).status, "active");
    await Membership.updateOne({ user: seed.worker._id, business: seed.business._id }, { $set: { isBookable: true } });
  });

  await t.test("guest reschedule audit contains old/new window and no secret material", async () => {
    const [dateA, dateB] = await nextDates(2);
    const x = (await book(dateA, "10:00", "audit")).appointment;
    const capability = await mint(x, "reschedule");
    await rescheduleWith(x, capability, dateB, "11:00");
    const audit = await AuditLog.findOne({ appointmentId: x._id, event: "APPOINTMENT_RESCHEDULED" }).lean();
    assert.ok(audit);
    assert.equal(audit.userId, undefined);
    assert.equal(audit.metadata.actorCapability, "guest-reschedule");
    assert.equal(audit.metadata.oldStartTime, "10:00");
    assert.equal(audit.metadata.newStartTime, "11:00");
    const serialized = JSON.stringify(audit);
    assert.equal(serialized.includes(capability.bearer), false);
    assert.equal(serialized.includes("challenge"), false);
    assert.equal(serialized.includes("secretHash"), false);
  });

  await t.test("H1 READ and H2 CANCEL remain usable after a reschedule", async () => {
    const [dateA, dateB] = await nextDates(2);
    const x = (await book(dateA, "10:00", "regression")).appointment;
    await rescheduleWith(x, await mint(x, "reschedule"), dateB, "11:00");
    const current = await Appointment.findById(x._id);
    const read = await mint(current, "read");
    const detail = await consumeGuestAppointmentReadCapability({ businessId: current.business, appointmentId: current._id, bearer: read.bearer });
    assert.equal(detail.startTime, "11:00");
    const cancel = await mint(current, "cancel");
    const cancelled = await consumeGuestAppointmentCancelCapability({ businessId: current.business, appointmentId: current._id, bearer: cancel.bearer });
    assert.equal(cancelled.status, "cancelled");
    assert.equal(available(await slots(dateB), "11:00"), true);
  });

  await t.test("events use lifecycle-neutral bridge and different dates notify both domains", async () => {
    const source = await readFile(new URL("../src/services/guestAppointmentCapability.service.js", import.meta.url), "utf8");
    assert.match(source, /emitAvailabilityChange\(worker\.toString\(\), oldDateStr, business\)/u);
    assert.match(source, /newDateStr !== oldDateStr/u);
    assert.doesNotMatch(source, /config\/socket\.js/u);
  });
});

test.after(async () => {
  await teardown(server, sessionStore);
});
