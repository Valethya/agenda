import "./setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import app, { sessionStore } from "../src/app.js";
import { connectDB } from "../src/db/db.js";
import { cleanTestData, seedTestData, teardown } from "./fixtures.js";
import Appointment from "../src/db/models/appointment.model.js";
import BusinessConfig from "../src/db/models/businessConfig.model.js";
import GuestAppointmentVerificationJob from "../src/db/models/guestAppointmentVerificationJob.model.js";
import { processNextGuestAppointmentVerificationJob } from "../src/services/guestAppointmentVerification.worker.js";

await connectDB();
await cleanTestData();
const seed = await seedTestData();
const origin = "https://h4-mvp-integration.example.test";
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
const publicHeaders = { "x-business-slug": seed.business.slug };
let cursor = new Date("2102-01-01T00:00:00.000Z");

const json = async (response) => ({ response, body: await response.json() });
const publicGet = (path) => fetch(`${baseUrl}${path}`, { headers: publicHeaders });
const slots = async (date) => {
  const { response, body } = await json(await publicGet(`/availability/slots?workerId=${seed.worker._id}&serviceId=${seed.service._id}&date=${date}`));
  assert.equal(response.status, 200);
  assert.ok(Array.isArray(body.payload));
  return body.payload;
};
const isOpen = (values, startTime) => values.some((slot) => slot.startTime === startTime && slot.available !== false);
const nextOpenDate = async () => {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const date = cursor.toISOString().slice(0, 10);
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
    const values = await slots(date);
    if (isOpen(values, "10:00")) return date;
  }
  throw new Error("No se encontró una fecha canónica abierta para H4");
};

const loginAdmin = async () => {
  const response = await fetch(`${baseUrl}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "test-admin@example.com", password: "passwordAdmin" }),
  });
  assert.equal(response.status, 201);
  return response.headers.get("set-cookie");
};
const adminGet = async (appointmentId, cookie) => {
  const { response, body } = await json(await fetch(`${baseUrl}/appointments/${appointmentId}`, { headers: { Cookie: cookie } }));
  assert.equal(response.status, 200);
  return body.payload;
};

const requestChallenge = async (appointmentId, action) => {
  await GuestAppointmentVerificationJob.updateMany(
    {
      business: seed.business._id,
      appointment: appointmentId,
      action,
      status: { $in: ["delivered", "failed"] },
    },
    { $set: { nextEligibleAt: new Date(0) } },
  );

  const { response, body } = await json(await fetch(`${baseUrl}/guest-appointments/${action}/challenge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ businessId: seed.business._id.toString(), appointmentId: appointmentId.toString() }),
  }));
  assert.equal(response.status, 202);
  assert.equal(body.status, "accepted");

  const expectedPurpose = `appointment-${action}-bootstrap`;
  for (let attempt = 0; attempt < 16; attempt += 1) {
    let accessUrl;
    const processed = await processNextGuestAppointmentVerificationJob({
      workerId: `h4-${crypto.randomBytes(8).toString("hex")}`,
      deliverVerification: async (payload) => { accessUrl = payload.accessUrl; return true; },
    });
    assert.ok(processed, "El worker H4 debe encontrar el challenge solicitado");
    if (processed.status !== "delivered" || !accessUrl) continue;
    const fragment = new URLSearchParams(new URL(accessUrl).hash.slice(1));
    if (fragment.get("appointmentId") === appointmentId.toString() && fragment.get("purpose") === expectedPurpose) return fragment;
  }
  assert.fail(`No se entregó el challenge ${action} exacto`);
};

const verifyCapability = async (appointmentId, action) => {
  const fragment = await requestChallenge(appointmentId, action);
  const { response, body } = await json(await fetch(`${baseUrl}/guest-appointments/${action}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      businessId: seed.business._id.toString(),
      appointmentId: appointmentId.toString(),
      verificationId: fragment.get("verificationId"),
      challengeSecret: fragment.get("challenge"),
    }),
  }));
  assert.equal(response.status, 200);
  assert.equal(body.status, "success");
  assert.equal(body.capability.action, action);
  assert.equal(body.capability.businessId, seed.business._id.toString());
  assert.equal(body.capability.appointmentId, appointmentId.toString());
  assert.equal(typeof body.capability.bearer, "string");
  assert.ok(body.capability.bearer.length > 20);
  return body;
};

const consume = async (appointmentId, action, capability, extra = {}) => json(await fetch(`${baseUrl}/guest-appointments/${action}`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    businessId: seed.business._id.toString(),
    appointmentId: appointmentId.toString(),
    bearer: capability.bearer,
    ...extra,
  }),
}));

const readGuest = async (appointmentId) => {
  const verified = await verifyCapability(appointmentId, "read");
  const { response, body } = await consume(appointmentId, "read", verified.capability);
  assert.equal(response.status, 200);
  assert.equal(body.status, "success");
  assert.equal(body.appointment.appointmentId, appointmentId.toString());
  assert.equal(body.appointment.business.id, seed.business._id.toString());
  return body.appointment;
};

test("H4 integrated MVP booking journey", async (t) => {
  const adminCookie = await loginAdmin();
  const dateA = await nextOpenDate();
  const dateB = await nextOpenDate();
  let appointmentId;

  await t.test("public discovery is tenant-scoped and canonical slots start open", async () => {
    const services = await json(await publicGet("/services"));
    assert.equal(services.response.status, 200);
    assert.equal(services.body.payload.some((service) => service.id === seed.service._id.toString()), true);

    const professionals = await json(await publicGet(`/users/workers?serviceId=${seed.service._id}`));
    assert.equal(professionals.response.status, 200);
    assert.equal(professionals.body.payload.some((professional) => professional.id === seed.worker._id.toString()), true);

    assert.equal(isOpen(await slots(dateA), "10:00"), true);
    assert.equal(isOpen(await slots(dateB), "10:00"), true);

    const crossTenant = await json(await fetch(`${baseUrl}/appointments`, {
      method: "POST",
      headers: { ...publicHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        worker: seed.workerB._id.toString(),
        service: seed.service._id.toString(),
        date: dateA,
        startTime: "10:00",
        clientInfo: { firstName: "Cross", lastName: "Tenant", email: "cross@example.com", phone: "+56970000001" },
      }),
    }));
    assert.notEqual(crossTenant.response.status, 201);
    assert.equal(await Appointment.exists({ business: seed.business._id, worker: seed.workerB._id }), null);
  });

  await t.test("public booking commits once, occupies A, and admin observes the same Appointment", async () => {
    const payload = {
      worker: seed.worker._id.toString(),
      service: seed.service._id.toString(),
      date: dateA,
      startTime: "10:00",
      notes: "H4 integrated journey",
      clientInfo: { firstName: "Guest", lastName: "H4", email: "h4-flow@example.com", phone: "+56970000002" },
    };
    const bookingRequest = () => fetch(`${baseUrl}/appointments`, {
      method: "POST",
      headers: { ...publicHeaders, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then(json);
    const [first, second] = await Promise.all([bookingRequest(), bookingRequest()]);
    const winners = [first, second].filter(({ response }) => response.status === 201);
    assert.equal(winners.length, 1);
    appointmentId = winners[0].body.payload.appointmentId;
    assert.ok(appointmentId);
    assert.equal(isOpen(await slots(dateA), "10:00"), false);
    assert.equal(await Appointment.countDocuments({ business: seed.business._id, worker: seed.worker._id, date: new Date(`${dateA}T00:00:00.000Z`), startTime: "10:00", status: { $in: ["pending", "pending_payment", "confirmed"] } }), 1);

    const admin = await adminGet(appointmentId, adminCookie);
    assert.equal(admin._id, appointmentId);
    assert.equal(admin.business?._id, seed.business._id.toString());
    assert.equal(admin.startTime, "10:00");
  });

  await t.test("READ authority cannot mutate and reveals the committed booking only", async () => {
    const readVerified = await verifyCapability(appointmentId, "read");
    const wrongAction = await consume(appointmentId, "cancel", readVerified.capability);
    assert.equal(wrongAction.response.status, 403);
    assert.equal(JSON.stringify(wrongAction.body).includes(readVerified.capability.bearer), false);

    const readResult = await consume(appointmentId, "read", readVerified.capability);
    assert.equal(readResult.response.status, 200);
    assert.equal(readResult.body.appointment.appointmentId, appointmentId);
    assert.equal(readResult.body.appointment.startTime, "10:00");
    assert.notEqual(readResult.body.appointment.status, "cancelled");
  });

  await t.test("RESCHEDULE preserves identity, atomically releases A/acquires B, and admin + READ converge", async () => {
    const verified = await verifyCapability(appointmentId, "reschedule");
    assert.equal(verified.rescheduleContext.appointmentId, appointmentId);
    assert.equal(verified.rescheduleContext.service.id, seed.service._id.toString());
    assert.equal(verified.rescheduleContext.professional.id, seed.worker._id.toString());

    const wrongAction = await consume(appointmentId, "cancel", verified.capability);
    assert.equal(wrongAction.response.status, 403);

    const moved = await consume(appointmentId, "reschedule", verified.capability, { date: dateB, startTime: "10:00" });
    assert.equal(moved.response.status, 200);
    assert.equal(moved.body.appointment.appointmentId, appointmentId);
    assert.equal(moved.body.appointment.businessId, seed.business._id.toString());
    assert.equal(moved.body.appointment.serviceId, seed.service._id.toString());
    assert.equal(moved.body.appointment.workerId, seed.worker._id.toString());
    assert.equal(new Date(moved.body.appointment.date).toISOString().slice(0, 10), dateB);
    assert.equal(moved.body.appointment.startTime, "10:00");
    assert.equal(moved.body.appointment.endTime, "11:00");

    assert.equal(isOpen(await slots(dateA), "10:00"), true);
    assert.equal(isOpen(await slots(dateB), "10:00"), false);

    const admin = await adminGet(appointmentId, adminCookie);
    assert.equal(admin._id, appointmentId);
    assert.equal(new Date(admin.date).toISOString().slice(0, 10), dateB);
    assert.equal(admin.startTime, "10:00");

    const guest = await readGuest(appointmentId);
    assert.equal(new Date(guest.date).toISOString().slice(0, 10), dateB);
    assert.equal(guest.startTime, "10:00");
  });

  await t.test("CANCEL remains separate, releases B after commit, and admin + READ converge on cancelled", async () => {
    const verified = await verifyCapability(appointmentId, "cancel");
    const wrongAction = await consume(appointmentId, "reschedule", verified.capability, { date: dateA, startTime: "10:00" });
    assert.equal(wrongAction.response.status, 403);

    const cancelled = await consume(appointmentId, "cancel", verified.capability);
    assert.equal(cancelled.response.status, 200);
    assert.equal(cancelled.body.appointment.appointmentId, appointmentId);
    assert.equal(cancelled.body.appointment.status, "cancelled");
    assert.equal(isOpen(await slots(dateB), "10:00"), true);

    const admin = await adminGet(appointmentId, adminCookie);
    assert.equal(admin._id, appointmentId);
    assert.equal(admin.status, "cancelled");

    const guest = await readGuest(appointmentId);
    assert.equal(guest.appointmentId, appointmentId);
    assert.equal(guest.status, "cancelled");
  });
});

test.after(async () => {
  await teardown(server, sessionStore);
});
