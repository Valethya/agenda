import "./setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import app, { sessionStore } from "../src/app.js";
import { connectDB } from "../src/db/db.js";
import { seedTestData, cleanTestData, teardown } from "./fixtures.js";
import User from "../src/db/models/user.model.js";
import Membership from "../src/db/models/membership.model.js";
import Service from "../src/db/models/service.model.js";
import Shift from "../src/db/models/shift.model.js";
import Appointment from "../src/db/models/appointment.model.js";
import AuditLog from "../src/db/models/auditLog.model.js";
import { createHash } from "../src/utils/password.js";

await connectDB();
await cleanTestData();
const seed = await seedTestData();
const server = app.listen(0);
const baseUrl = `http://localhost:${server.address().port}/api`;

const request = (path, { method = "GET", cookie, body, headers = {} } = {}) => fetch(`${baseUrl}${path}`, {
  method,
  headers: {
    ...(cookie ? { Cookie: cookie } : {}),
    ...(body ? { "Content-Type": "application/json" } : {}),
    ...headers,
  },
  ...(body ? { body: JSON.stringify(body) } : {}),
});
const login = async (email, password) => {
  const response = await request("/login", { method: "POST", body: { email, password } });
  assert.ok([200, 201].includes(response.status), `${email}: ${response.status}`);
  return response.headers.get("set-cookie");
};
const makeAppointment = (overrides = {}) => Appointment.create({
  client: seed.client._id,
  worker: seed.worker._id,
  service: seed.service._id,
  business: seed.business._id,
  date: new Date("2099-09-01T00:00:00.000Z"),
  startTime: "10:00",
  endTime: "11:00",
  status: "pending",
  ...overrides,
});
const adminCookie = await login("test-admin@example.com", "passwordAdmin");
const workerCookie = await login("test-worker@example.com", "passwordWorker");

test("6.2.4-B Appointment ownership enforcement", async (t) => {
  t.beforeEach(async () => {
    await Appointment.deleteMany({});
    await AuditLog.deleteMany({});
    await Service.findByIdAndUpdate(seed.service._id, { workers: [seed.worker._id], isActive: true });
    await Membership.updateOne(
      { user: seed.worker._id, business: seed.business._id },
      { $set: { isActive: true, role: "worker", isBookable: true } },
    );
    await Membership.updateOne(
      { user: seed.admin._id, business: seed.business._id },
      { $set: { isActive: true, role: "admin", isBookable: false } },
    );
  });

  await t.test("APT-CLIENT-01: igualdad User._id/client no concede read/cancel/list/timeline", async () => {
    const user = await User.create({
      firstName: "Client", lastName: "Unverified", email: ["client-no-grant@example.com"],
      phone: ["+56981110001"], password: await createHash("clientNoGrant"), role: "user", isActive: true,
    });
    const membership = await Membership.create({
      user: user._id, business: seed.business._id, role: "worker", isActive: true,
    });
    const cookie = await login("client-no-grant@example.com", "clientNoGrant");
    const appointment = await makeAppointment({ client: user._id });
    membership.isActive = false;
    await membership.save();

    assert.equal((await request(`/appointments/${appointment._id}`, { cookie })).status, 403);
    assert.equal((await request(`/appointments/${appointment._id}/cancel`, { method: "PATCH", cookie })).status, 403);
    assert.equal((await request(`/appointments/${appointment._id}/timeline`, { cookie })).status, 403);
    assert.equal((await request("/appointments/my", { cookie })).status, 403);
    assert.equal((await Appointment.findById(appointment._id)).status, "pending");
  });

  await t.test("profesional de Appointment existente requiere Membership activa + assignment, no allowlist/bookability actuales", async () => {
    const appointment = await makeAppointment();
    assert.equal((await request(`/appointments/${appointment._id}`, { cookie: workerCookie })).status, 200);

    await Service.findByIdAndUpdate(seed.service._id, { workers: [] });
    await Membership.updateOne(
      { user: seed.worker._id, business: seed.business._id },
      { $set: { isBookable: false } },
    );
    assert.equal((await request(`/appointments/${appointment._id}`, { cookie: workerCookie })).status, 200);

    const other = await User.create({
      firstName: "Other", lastName: "Professional", email: ["other-prof@example.com"],
      phone: ["+56981110002"], password: await createHash("otherProfessional"), role: "worker", isActive: true,
    });
    await Membership.create({
      user: other._id,
      business: seed.business._id,
      role: "worker",
      isActive: true,
      isBookable: true,
    });
    await Service.findByIdAndUpdate(seed.service._id, { workers: [other._id] });
    const otherCookie = await login("other-prof@example.com", "otherProfessional");
    assert.equal((await request(`/appointments/${appointment._id}`, { cookie: otherCookie })).status, 404);

    const membership = await Membership.findOne({ user: seed.worker._id, business: seed.business._id });
    membership.isActive = false;
    await membership.save();
    assert.equal((await request(`/appointments/${appointment._id}`, { cookie: workerCookie })).status, 403);
    const persisted = await Appointment.findById(appointment._id);
    assert.equal(persisted.worker.toString(), seed.worker._id.toString());
    assert.equal(persisted.status, "pending");
  });

  await t.test("admin puede ser profesional con su única Membership cuando isBookable=true", async () => {
    await Membership.updateOne(
      { user: seed.admin._id, business: seed.business._id },
      { $set: { isBookable: true } },
    );
    const day = new Date("2099-09-01T00:00:00.000Z").getUTCDay();
    await Shift.findOneAndUpdate(
      { business: seed.business._id, worker: seed.admin._id, dayOfWeek: day },
      { business: seed.business._id, worker: seed.admin._id, dayOfWeek: day, isOpen: true, startTime: "09:00", endTime: "12:00", breaks: [] },
      { upsert: true },
    );
    const created = await request("/services", {
      method: "POST", cookie: adminCookie,
      body: { name: "Admin Professional 624B", duration: 30, price: 10000, workers: [seed.admin._id.toString()] },
    });
    assert.equal(created.status, 201);
    const service = (await created.json()).payload;
    assert.equal(await Membership.countDocuments({ user: seed.admin._id, business: seed.business._id }), 1);
    const adminMembership = await Membership.findOne({ user: seed.admin._id, business: seed.business._id });
    assert.equal(adminMembership.role, "admin");
    assert.equal(adminMembership.isBookable, true);

    const slots = await request(`/availability/slots?workerId=${seed.admin._id}&serviceId=${service._id}&date=2099-09-01&slug=${seed.business.slug}`);
    assert.equal(slots.status, 200);
    const booking = await request("/internal/appointments", {
      method: "POST", cookie: adminCookie,
      headers: { "x-business-slug": seed.business.slug },
      body: {
        worker: seed.admin._id.toString(), service: service._id, date: "2099-09-01", startTime: "09:00", isSuggestion: true,
        clientInfo: { firstName: "Guest", lastName: "Admin Pro", email: "admin-pro-guest@example.com", phone: "+56981110003" },
      },
    });
    assert.equal(booking.status, 201);
  });

  await t.test("Service.workers valida bookable tenant participants, duplicados, [] e inactive Service", async () => {
    const invalidReference = await request("/services", {
      method: "POST", cookie: adminCookie,
      body: { name: "Invalid Worker Id 624B", duration: 30, price: 1, workers: ["not-an-object-id"] },
    });
    assert.equal(invalidReference.status, 400);

    const duplicate = await request("/services", {
      method: "POST", cookie: adminCookie,
      body: { name: "Duplicate Workers 624B", duration: 30, price: 1, workers: [seed.worker._id.toString(), seed.worker._id.toString()] },
    });
    assert.equal(duplicate.status, 400);

    const noMembership = await User.create({
      firstName: "No", lastName: "Membership", email: ["no-membership-624b@example.com"],
      phone: ["+56981110004"], password: await createHash("noMembership"), role: "user", isActive: true,
    });
    const denied = await request("/services", {
      method: "POST", cookie: adminCookie,
      body: { name: "Denied Worker 624B", duration: 30, price: 1, workers: [noMembership._id.toString()] },
    });
    assert.equal(denied.status, 404);

    const inactive = await User.create({
      firstName: "Inactive", lastName: "Professional", email: ["inactive-624b@example.com"],
      phone: ["+56981110005"], password: await createHash("inactive624b"), role: "worker", isActive: false,
    });
    await Membership.create({
      user: inactive._id,
      business: seed.business._id,
      role: "worker",
      isActive: true,
      isBookable: true,
    });
    assert.equal((await request("/services", {
      method: "POST", cookie: adminCookie,
      body: { name: "Inactive Worker 624B", duration: 30, price: 1, workers: [inactive._id.toString()] },
    })).status, 404);

    assert.equal((await request("/services", {
      method: "POST", cookie: adminCookie,
      body: { name: "Other Tenant Worker 624B", duration: 30, price: 1, workers: [seed.workerB._id.toString()] },
    })).status, 404);

    assert.equal((await request("/services", {
      method: "POST", cookie: workerCookie,
      body: { name: "Worker Cannot Grant Admin 624B", duration: 30, price: 1, workers: [seed.worker._id.toString()] },
    })).status, 403);

    const editable = await request("/services", {
      method: "POST", cookie: adminCookie,
      body: { name: "Editable Workers 624B", duration: 30, price: 1, workers: [seed.worker._id.toString()] },
    });
    const editableService = (await editable.json()).payload;
    await Membership.updateOne(
      { user: seed.admin._id, business: seed.business._id },
      { $set: { isBookable: true } },
    );
    assert.equal((await request(`/services/${editableService._id}`, {
      method: "PUT", cookie: adminCookie, body: { workers: [seed.admin._id.toString()] },
    })).status, 200);
    const invalidUpdate = await request(`/services/${editableService._id}`, {
      method: "PUT", cookie: adminCookie, body: { workers: [noMembership._id.toString()] },
    });
    assert.equal(invalidUpdate.status, 404);
    const persistedEditable = await Service.findById(editableService._id);
    assert.deepEqual(persistedEditable.workers.map(String), [seed.admin._id.toString()]);

    const empty = await request("/services", {
      method: "POST", cookie: adminCookie,
      body: { name: "Empty Workers 624B", duration: 30, price: 1, workers: [] },
    });
    assert.equal(empty.status, 201);
    const emptyService = (await empty.json()).payload;
    assert.equal((await request(`/availability/slots?workerId=${seed.worker._id}&serviceId=${emptyService._id}&date=2099-09-01&slug=${seed.business.slug}`)).status, 404);

    const active = await request("/services", {
      method: "POST", cookie: adminCookie,
      body: { name: "Inactive Service 624B", duration: 30, price: 1, workers: [seed.worker._id.toString()] },
    });
    const activeService = (await active.json()).payload;
    const historical = await makeAppointment({ service: activeService._id, startTime: "14:00", endTime: "14:30" });
    assert.equal((await request(`/services/${activeService._id}`, { method: "PUT", cookie: adminCookie, body: { isActive: false } })).status, 200);
    assert.ok(await Appointment.findById(historical._id));
    assert.equal((await request(`/availability/slots?workerId=${seed.worker._id}&serviceId=${activeService._id}&date=2099-09-01&slug=${seed.business.slug}`)).status, 404);
    assert.equal((await request("/internal/appointments", {
      method: "POST", cookie: adminCookie,
      headers: { "x-business-slug": seed.business.slug },
      body: {
        worker: seed.worker._id.toString(), service: activeService._id, date: "2099-09-01", startTime: "11:00", isSuggestion: true,
        clientInfo: { firstName: "Guest", lastName: "Inactive", email: "inactive-booking-624b@example.com", phone: "+56981110006" },
      },
    })).status, 404);
  });

  await t.test("state commands usan CAS/409 y timeline expone allowlist segura", async () => {
    const appointment = await makeAppointment({ startTime: "15:00", endTime: "16:00" });
    const [a, b] = await Promise.all([
      request(`/appointments/${appointment._id}/confirm`, { method: "PATCH", cookie: adminCookie }),
      request(`/appointments/${appointment._id}/confirm`, { method: "PATCH", cookie: adminCookie }),
    ]);
    assert.deepEqual([a.status, b.status].sort((x, y) => x - y), [200, 409]);
    assert.equal((await request(`/appointments/${appointment._id}/complete`, { method: "PATCH", cookie: adminCookie })).status, 200);
    assert.equal((await request(`/appointments/${appointment._id}/complete`, { method: "PATCH", cookie: adminCookie })).status, 409);
    assert.equal((await request(`/appointments/${appointment._id}/cancel`, { method: "PATCH", cookie: adminCookie })).status, 409);

    await AuditLog.deleteMany({ appointmentId: appointment._id });
    await AuditLog.create({
      appointmentId: appointment._id, userId: seed.admin._id, event: "SAFE_TIMELINE_624B", level: "ERROR",
      message: "visible", technicalMessage: "secret stack token_ws=x", metadata: { token_ws: "x", capability: "secret", raw: { provider: true } },
    });
    const timeline = await request(`/appointments/${appointment._id}/timeline`, { cookie: adminCookie });
    assert.equal(timeline.status, 200);
    const entry = (await timeline.json()).payload[0];
    assert.deepEqual(Object.keys(entry).sort(), ["createdAt", "event", "level", "message"].sort());
  });

  await t.test("cross-tenant/resource patch falla cerrado y Payment está disabled por defecto", async () => {
    const appointment = await makeAppointment({ startTime: "17:00", endTime: "18:00" });
    assert.equal((await request(`/appointments/${appointment._id}`, {
      method: "PATCH", cookie: adminCookie,
      body: { business: seed.businessB._id, client: seed.admin._id, worker: seed.workerB._id, status: "completed" },
    })).status, 404);
    assert.equal((await request("/payments/initiate", { method: "POST", body: { appointmentId: appointment._id, paymentType: "deposit" } })).status, 404);
    assert.equal((await request("/payments/webpay-return?token_ws=not-routed")).status, 404);
    const persisted = await Appointment.findById(appointment._id);
    assert.equal(persisted.business.toString(), seed.business._id.toString());
    assert.equal(persisted.status, "pending");
  });
});

test.after(async () => teardown(server, sessionStore));
