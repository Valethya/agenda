import "./setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

process.env.FRONTEND_URL = "http://panel.example";
process.env.CORS_ORIGINS = "http://panel.example";

const [
  { default: app, sessionStore },
  { connectDB },
  fixtures,
  { default: BusinessConfig },
  { default: Appointment },
  { default: ClientContactVerification },
  { default: GuestAppointmentVerificationDelivery },
  { default: GuestAppointmentVerificationJob },
  { default: GuestAppointmentIntakeBucket },
  { default: GuestAppointmentCapability },
  publicWeb,
  guestCapability,
  worker,
] = await Promise.all([
  import("../src/app.js"),
  import("../src/db/db.js"),
  import("./fixtures.js"),
  import("../src/db/models/businessConfig.model.js"),
  import("../src/db/models/appointment.model.js"),
  import("../src/db/models/clientContactVerification.model.js"),
  import("../src/db/models/guestAppointmentVerificationDelivery.model.js"),
  import("../src/db/models/guestAppointmentVerificationJob.model.js"),
  import("../src/db/models/guestAppointmentIntakeBucket.model.js"),
  import("../src/db/models/guestAppointmentCapability.model.js"),
  import("../src/services/publicWeb.service.js"),
  import("../src/services/guestAppointmentCapability.service.js"),
  import("../src/services/guestAppointmentVerification.worker.js"),
]);

const { seedTestData, cleanTestData, teardown } = fixtures;
const { configurePublicWeb, deletePublicWeb, reverifyPublicWeb, verifyPublicWeb } = publicWeb;
const { requestGuestAppointmentReadChallenge } = guestCapability;
const { processNextGuestAppointmentVerificationJob } = worker;

await connectDB();
await cleanTestData();
const seed = await seedTestData();

const server = app.listen(0);
const { port } = server.address();
const baseUrl = `http://127.0.0.1:${port}/api`;
const panelOrigin = "http://panel.example";
const publicOrigin = "https://capability-source.example.test";
const arbitraryOrigin = "https://arbitrary-reader.example.test";
let appointmentSequence = 0;

const rawChallenge = (state) => state.dnsVerification.recordValue.slice("agenda-verification=".length);

const resetC2Artifacts = async () => {
  await Promise.all([
    GuestAppointmentCapability.deleteMany({ business: seed.business._id }),
    GuestAppointmentVerificationDelivery.deleteMany({ business: seed.business._id }),
    ClientContactVerification.deleteMany({ business: seed.business._id }),
    GuestAppointmentVerificationJob.deleteMany({ business: seed.business._id }),
    GuestAppointmentIntakeBucket.deleteMany({ _id: /^guest-appointment-read:/u }),
  ]);
};

const ensureNoTrust = async () => {
  const config = await BusinessConfig.findOne({ business: seed.business._id });
  if (config?.publicWeb?.websiteUrl) await deletePublicWeb({ businessId: seed.business._id });
};

const freshTrust = async () => {
  await ensureNoTrust();
  const pending = await configurePublicWeb({
    businessId: seed.business._id,
    websiteUrl: publicOrigin,
    bookingUrl: `${publicOrigin}/reservar`,
  });
  const challenge = rawChallenge(pending);
  return verifyPublicWeb({
    businessId: seed.business._id,
    resolveTxt: async () => [["agenda-verification=", challenge]],
  });
};

const createGuestAppointment = async () => {
  appointmentSequence += 1;
  return Appointment.create({
    client: seed.client._id,
    worker: seed.worker._id,
    service: seed.service._id,
    date: new Date(Date.UTC(2091, 0, appointmentSequence + 1)),
    startTime: "10:00",
    endTime: "11:00",
    business: seed.business._id,
    guestContact: {
      channel: "email",
      destination: `capability-http-${appointmentSequence}@example.test`,
      provenance: "guest-booking-input-v1",
      capturedAt: new Date(),
    },
  });
};

const deliverProof = async () => {
  const target = await createGuestAppointment();
  await requestGuestAppointmentReadChallenge({
    businessId: seed.business._id,
    appointmentId: target._id,
  });

  let accessUrl = null;
  const result = await processNextGuestAppointmentVerificationJob({
    workerId: `http-capability-${Date.now()}-${Math.random()}`,
    deliverVerification: async (payload) => {
      accessUrl = payload.accessUrl;
      return true;
    },
  });
  assert.equal(result?.status, "delivered");
  assert.ok(accessUrl);
  const fragment = new URLSearchParams(new URL(accessUrl).hash.slice(1));
  return { target, fragment };
};

const exchangeHttp = async ({ target, fragment }, { origin = publicOrigin } = {}) => {
  const response = await fetch(`${baseUrl}/guest-appointments/read/verify`, {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      businessId: seed.business._id.toString(),
      appointmentId: target._id.toString(),
      verificationId: fragment.get("verificationId"),
      challengeSecret: fragment.get("challenge"),
    }),
  });
  const body = await response.json();
  return { response, body };
};

const consumeHttp = async ({ target, bearer, origin = arbitraryOrigin, cookie = null }) => {
  const response = await fetch(`${baseUrl}/guest-appointments/read`, {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify({
      businessId: seed.business._id.toString(),
      appointmentId: target._id.toString(),
      bearer,
    }),
  });
  const body = await response.json();
  return { response, body };
};

const mintCapability = async () => {
  await resetC2Artifacts();
  await freshTrust();
  const proof = await deliverProof();
  const exchanged = await exchangeHttp(proof);
  assert.equal(exchanged.response.status, 200);
  assert.equal(exchanged.body.capability.action, "read");
  assert.equal(exchanged.response.headers.get("access-control-allow-credentials"), null);
  return { ...proof, capability: exchanged.body.capability };
};

const adminLogin = await fetch(`${baseUrl}/login`, {
  method: "POST",
  headers: { Origin: panelOrigin, "Content-Type": "application/json" },
  body: JSON.stringify({ email: "test-admin@example.com", password: "passwordAdmin" }),
});
assert.ok([200, 201].includes(adminLogin.status));
const adminCookie = adminLogin.headers.get("set-cookie");

test("6.2.6-B capability-authenticated READ browser surface", async (t) => {
  await t.test("delete after valid exchange does not shorten the already-issued READ capability", async () => {
    const issued = await mintCapability();
    await deletePublicWeb({ businessId: seed.business._id });

    const consumed = await consumeHttp({ target: issued.target, bearer: issued.capability.bearer });
    assert.equal(consumed.response.status, 200);
    assert.equal(consumed.body.appointment.appointmentId, issued.target._id.toString());
    assert.equal(consumed.response.headers.get("access-control-allow-origin"), arbitraryOrigin);
    assert.equal(consumed.response.headers.get("access-control-allow-credentials"), null);
  });

  await t.test("trust expiry after valid exchange does not shorten the already-issued READ capability", async () => {
    const issued = await mintCapability();
    await BusinessConfig.updateOne(
      { business: seed.business._id },
      { $set: { "publicWeb.verificationValidUntil": new Date() } },
    );

    const consumed = await consumeHttp({ target: issued.target, bearer: issued.capability.bearer });
    assert.equal(consumed.response.status, 200);
    assert.equal(consumed.body.appointment.appointmentId, issued.target._id.toString());
    assert.equal(consumed.response.headers.get("access-control-allow-credentials"), null);
  });

  await t.test("reverify after valid exchange preserves READ and even panel Origin stays credentialless on /read", async () => {
    const issued = await mintCapability();
    const pending = await reverifyPublicWeb({ businessId: seed.business._id });
    assert.equal(pending.verificationStatus, "pending");

    const consumed = await consumeHttp({
      target: issued.target,
      bearer: issued.capability.bearer,
      origin: panelOrigin,
      cookie: adminCookie,
    });
    assert.equal(consumed.response.status, 200);
    assert.equal(consumed.response.headers.get("access-control-allow-origin"), panelOrigin);
    assert.equal(consumed.response.headers.get("access-control-allow-credentials"), null);
  });

  await t.test("arbitrary Origin receives only credentialless CORS and invalid bearer remains INVALID_PROOF despite admin cookie", async () => {
    await resetC2Artifacts();
    const target = await createGuestAppointment();
    const invalid = await consumeHttp({
      target,
      bearer: "A".repeat(43),
      origin: arbitraryOrigin,
      cookie: adminCookie,
    });
    assert.equal(invalid.response.status, 403);
    assert.equal(invalid.body.code, "GUEST_APPOINTMENT_CAPABILITY_INVALID_PROOF");
    assert.equal(invalid.response.headers.get("access-control-allow-origin"), arbitraryOrigin);
    assert.equal(invalid.response.headers.get("access-control-allow-credentials"), null);

    const missing = await fetch(`${baseUrl}/guest-appointments/read`, {
      method: "POST",
      headers: { Origin: arbitraryOrigin, "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({
        businessId: seed.business._id.toString(),
        appointmentId: target._id.toString(),
      }),
    });
    assert.equal(missing.status, 400);
    assert.equal(missing.headers.get("access-control-allow-origin"), arbitraryOrigin);
    assert.equal(missing.headers.get("access-control-allow-credentials"), null);
  });

  await t.test("bearer /read preflight never needs current publicWeb trust and is never credentialed", async () => {
    await ensureNoTrust();
    const response = await fetch(`${baseUrl}/guest-appointments/read`, {
      method: "OPTIONS",
      headers: {
        Origin: arbitraryOrigin,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
      },
    });
    assert.ok([200, 204].includes(response.status));
    assert.equal(response.headers.get("access-control-allow-origin"), arbitraryOrigin);
    assert.equal(response.headers.get("access-control-allow-credentials"), null);
  });

  await t.test("old Delivery cannot be exchanged after revocation while /read/verify keeps INVALID_PROOF headless", async () => {
    await resetC2Artifacts();
    await freshTrust();
    const proof = await deliverProof();
    await deletePublicWeb({ businessId: seed.business._id });

    const response = await fetch(`${baseUrl}/guest-appointments/read/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        businessId: seed.business._id.toString(),
        appointmentId: proof.target._id.toString(),
        verificationId: proof.fragment.get("verificationId"),
        challengeSecret: proof.fragment.get("challenge"),
      }),
    });
    const body = await response.json();
    assert.equal(response.status, 403);
    assert.equal(body.code, "GUEST_APPOINTMENT_CAPABILITY_INVALID_PROOF");
  });
});

test.after(async () => {
  await resetC2Artifacts();
  await Appointment.deleteMany({ business: seed.business._id });
  await teardown(server, sessionStore);
});
