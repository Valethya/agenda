import "./setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import app, { sessionStore } from "../src/app.js";
import { connectDB } from "../src/db/db.js";
import { cleanTestData, seedTestData, teardown } from "./fixtures.js";
import BusinessConfig from "../src/db/models/businessConfig.model.js";
import GuestAppointmentVerificationJob from "../src/db/models/guestAppointmentVerificationJob.model.js";
import GuestAppointmentCommunicationJob from "../src/db/models/guestAppointmentCommunicationJob.model.js";
import { processNextGuestAppointmentVerificationJob } from "../src/services/guestAppointmentVerification.worker.js";
import { processNextGuestAppointmentCommunicationJob } from "../src/services/guestAppointmentCommunication.worker.js";

await connectDB();
await cleanTestData();
const seed = await seedTestData();
const origin = "https://j-smoke.example.test";
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
const rootUrl = `http://127.0.0.1:${port}`;
const apiUrl = `${rootUrl}/api`;
const publicHeaders = { Origin: origin, "x-business-slug": seed.business.slug };

const json = async (response) => ({ response, body: await response.json() });
const slots = async (date) => {
  const result = await json(await fetch(`${apiUrl}/availability/slots?workerId=${seed.worker._id}&serviceId=${seed.service._id}&date=${date}`, {
    headers: publicHeaders,
  }));
  assert.equal(result.response.status, 200);
  return result.body.payload;
};

let cursor = new Date("2106-01-01T00:00:00.000Z");
const nextOpenDate = async () => {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const date = cursor.toISOString().slice(0, 10);
    cursor = new Date(cursor.getTime() + 86_400_000);
    const values = await slots(date);
    if (values.some((slot) => slot.startTime === "10:00" && slot.available !== false)) return date;
  }
  throw new Error("J_SMOKE_NO_OPEN_SLOT");
};

const requestCapability = async (appointmentId, action) => {
  await GuestAppointmentVerificationJob.updateMany(
    { business: seed.business._id, appointment: appointmentId, action, status: { $in: ["delivered", "failed"] } },
    { $set: { nextEligibleAt: new Date(0) } },
  );

  const requested = await json(await fetch(`${apiUrl}/guest-appointments/${action}/challenge`, {
    method: "POST",
    headers: { ...publicHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ businessId: seed.business._id.toString(), appointmentId }),
  }));
  assert.equal(requested.response.status, 202);

  let fragment;
  for (let attempt = 0; attempt < 16 && !fragment; attempt += 1) {
    let accessUrl;
    const processed = await processNextGuestAppointmentVerificationJob({
      workerId: `j-smoke-${crypto.randomBytes(6).toString("hex")}`,
      deliverVerification: async (payload) => { accessUrl = payload.accessUrl; return true; },
    });
    assert.ok(processed);
    if (processed.status === "delivered" && accessUrl) {
      const params = new URLSearchParams(new URL(accessUrl).hash.slice(1));
      if (params.get("appointmentId") === appointmentId) fragment = params;
    }
  }
  assert.ok(fragment, "J smoke verification challenge must be delivered");

  const verified = await json(await fetch(`${apiUrl}/guest-appointments/${action}/verify`, {
    method: "POST",
    headers: { ...publicHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({
      businessId: seed.business._id.toString(),
      appointmentId,
      verificationId: fragment.get("verificationId"),
      challengeSecret: fragment.get("challenge"),
    }),
  }));
  assert.equal(verified.response.status, 200);
  assert.equal(verified.body.capability.action, action);
  return verified.body.capability;
};

test("J controlled non-production MVP smoke contract", async (t) => {
  t.after(async () => teardown(server, sessionStore));

  await t.test("liveness and readiness expose only coarse state", async () => {
    const live = await json(await fetch(`${rootUrl}/health/live`));
    assert.equal(live.response.status, 200);
    assert.deepEqual(live.body, { status: "ok" });

    const ready = await json(await fetch(`${rootUrl}/health/ready`));
    assert.equal(ready.response.status, 200);
    assert.deepEqual(ready.body, { status: "ready" });
  });

  const date = await nextOpenDate();
  let appointmentId;

  await t.test("public discovery and booking use the trusted production-style origin", async () => {
    const services = await json(await fetch(`${apiUrl}/services`, { headers: publicHeaders }));
    assert.equal(services.response.status, 200);
    assert.equal(services.response.headers.get("access-control-allow-origin"), origin);
    assert.equal(services.body.payload.some((service) => service.id === seed.service._id.toString()), true);

    const professionals = await json(await fetch(`${apiUrl}/users/workers?serviceId=${seed.service._id}`, { headers: publicHeaders }));
    assert.equal(professionals.response.status, 200);
    assert.equal(professionals.body.payload.some((worker) => worker.id === seed.worker._id.toString()), true);

    const booked = await json(await fetch(`${apiUrl}/appointments`, {
      method: "POST",
      headers: { ...publicHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        worker: seed.worker._id.toString(),
        service: seed.service._id.toString(),
        date,
        startTime: "10:00",
        clientInfo: {
          firstName: "Production",
          lastName: "Smoke",
          email: "j-smoke@example.com",
          phone: "+56970000123",
        },
      }),
    }));
    assert.equal(booked.response.status, 201);
    appointmentId = booked.body.payload.appointmentId;
    assert.ok(appointmentId);
  });

  await t.test("transactional outbox path is created and delivers a non-authorizing manage URL", async () => {
    const job = await GuestAppointmentCommunicationJob.findOne({ appointment: appointmentId, event: "booking" });
    assert.ok(job);

    const deliveries = [];
    const delivered = await processNextGuestAppointmentCommunicationJob({
      workerId: "j-smoke-communication",
      deliver: async (payload) => {
        deliveries.push(structuredClone(payload));
        return { accepted: true, providerMessageId: "j-smoke-provider" };
      },
    });
    assert.equal(delivered.status, "delivered");
    assert.equal(deliveries.length, 1);
    const serialized = JSON.stringify(deliveries[0]);
    assert.doesNotMatch(serialized, /challengeSecret|secretHash|bearer/iu);
    const href = deliveries[0].deliveryPayload.html.match(/href="([^"]+)"/)?.[1];
    assert.ok(href);
    assert.equal(new URL(href.replaceAll("&amp;", "&")).origin, origin);
  });

  await t.test("guest CANCEL challenge/verify/consume works from the trusted origin", async () => {
    const capability = await requestCapability(appointmentId, "cancel");
    const cancelled = await json(await fetch(`${apiUrl}/guest-appointments/cancel`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({
        businessId: seed.business._id.toString(),
        appointmentId,
        bearer: capability.bearer,
      }),
    }));
    assert.equal(cancelled.response.status, 200);
    assert.equal(cancelled.response.headers.get("access-control-allow-origin"), origin);
    assert.equal(cancelled.body.appointment.status, "cancelled");
  });
});
