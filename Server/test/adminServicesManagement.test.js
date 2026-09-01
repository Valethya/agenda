import "./setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import app, { sessionStore } from "../src/app.js";
import { connectDB } from "../src/db/db.js";
import { cleanTestData, seedTestData, teardown } from "./fixtures.js";
import Appointment from "../src/db/models/appointment.model.js";
import Membership from "../src/db/models/membership.model.js";
import Service from "../src/db/models/service.model.js";
import User from "../src/db/models/user.model.js";
import { createHash } from "../src/utils/password.js";
import * as serviceService from "../src/services/service.service.js";

await connectDB();
await cleanTestData();
const seed = await seedTestData();
const server = app.listen(0);
const baseUrl = `http://localhost:${server.address().port}/api`;

const request = (path, { method = "GET", cookie, body } = {}) => fetch(`${baseUrl}${path}`, {
  method,
  headers: {
    ...(cookie ? { Cookie: cookie } : {}),
    ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
  },
  ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
});

const login = async (email, password) => {
  const response = await request("/login", { method: "POST", body: { email, password } });
  assert.ok([200, 201].includes(response.status), `${email}: ${response.status}`);
  return response.headers.get("set-cookie");
};

const adminCookie = await login("test-admin@example.com", "passwordAdmin");
const workerCookie = await login("test-worker@example.com", "passwordWorker");
const businessBAdminCookie = await login("user-b@example.com", "passwordUserB");

const noMembershipUser = await User.create({
  firstName: "Sin",
  lastName: "Membership",
  email: ["service-no-membership-e@example.com"],
  phone: ["+56981110001"],
  password: await createHash("serviceNoMembershipE"),
  role: "worker",
  isActive: true,
});

const uniqueName = (suffix) => `Servicio E ${suffix} ${Date.now()} ${Math.random().toString(16).slice(2)}`;
const validBody = (overrides = {}) => ({
  name: uniqueName("valid"),
  description: "Servicio administrado por E",
  duration: 45,
  price: 15000,
  depositAmount: 5000,
  workers: [seed.worker._id.toString()],
  ...overrides,
});

const workerMembershipFilter = { user: seed.worker._id, business: seed.business._id };
const adminMembershipFilter = { user: seed.admin._id, business: seed.business._id };

const resetParticipantState = async () => {
  await User.updateOne({ _id: seed.worker._id }, { $set: { isActive: true } });
  await Membership.updateOne(workerMembershipFilter, {
    $set: { role: "worker", isActive: true, isBookable: true },
  });
  await Membership.updateOne(adminMembershipFilter, {
    $set: { role: "admin", isActive: true, isBookable: false },
  });
};

test("E admin Services management", async (t) => {
  t.beforeEach(async () => {
    await resetParticipantState();
  });

  await t.test("admin lista Services tenant-scoped e incluye inactivos", async () => {
    const inactive = await Service.create({
      ...validBody({ name: uniqueName("inactive"), workers: [] }),
      business: seed.business._id,
      isActive: false,
    });
    await Service.create({
      ...validBody({ name: uniqueName("business-b"), workers: [seed.workerB._id] }),
      business: seed.businessB._id,
      isActive: true,
    });

    const response = await request("/internal/services", { cookie: adminCookie });
    assert.equal(response.status, 200);
    const data = await response.json();
    const ids = data.payload.map((service) => service._id.toString());
    assert.ok(ids.includes(seed.service._id.toString()));
    assert.ok(ids.includes(inactive._id.toString()));
    assert.ok(data.payload.every((service) => service.business.toString() === seed.business._id.toString()));
  });

  await t.test("otro Business no puede leer ni modificar Service ajeno", async () => {
    const read = await request(`/internal/services/${seed.service._id}`, { cookie: businessBAdminCookie });
    assert.equal(read.status, 404);

    const update = await request(`/services/${seed.service._id}`, {
      method: "PUT",
      cookie: businessBAdminCookie,
      body: { name: uniqueName("foreign-update") },
    });
    assert.equal(update.status, 404);

    const deactivate = await request(`/services/${seed.service._id}`, {
      method: "DELETE",
      cookie: businessBAdminCookie,
    });
    assert.equal(deactivate.status, 404);
  });

  await t.test("worker/no-admin no puede crear, editar ni desactivar Services", async () => {
    const create = await request("/services", {
      method: "POST",
      cookie: workerCookie,
      body: validBody({ name: uniqueName("worker-create") }),
    });
    assert.equal(create.status, 403);

    const update = await request(`/services/${seed.service._id}`, {
      method: "PUT",
      cookie: workerCookie,
      body: { name: uniqueName("worker-update") },
    });
    assert.equal(update.status, 403);

    const deactivate = await request(`/services/${seed.service._id}`, {
      method: "DELETE",
      cookie: workerCookie,
    });
    assert.equal(deactivate.status, 403);
    assert.equal((await Service.findById(seed.service._id)).isActive, true);
  });

  await t.test("creación deriva Business, fuerza activo y aplica defaults server-side", async () => {
    const body = validBody({ name: uniqueName("server-authority") });
    delete body.depositAmount;
    const response = await request("/services", { method: "POST", cookie: adminCookie, body });
    assert.equal(response.status, 201);
    const data = await response.json();
    const persisted = await Service.findById(data.payload._id);
    assert.equal(persisted.business.toString(), seed.business._id.toString());
    assert.equal(persisted.isActive, true);
    assert.equal(persisted.depositAmount, 0);
  });

  await t.test("creación rechaza business, isActive, campos extra y operadores Mongo", async () => {
    const forbiddenCases = [
      { business: seed.businessB._id.toString() },
      { isActive: false },
      { createdAt: new Date().toISOString() },
      { unknownField: "nope" },
      { $set: { business: seed.businessB._id.toString() } },
    ];

    for (const extra of forbiddenCases) {
      const name = uniqueName("forbidden");
      const response = await request("/services", {
        method: "POST",
        cookie: adminCookie,
        body: validBody({ name, ...extra }),
      });
      assert.equal(response.status, 400, JSON.stringify(extra));
      assert.equal(await Service.exists({ name }), null);
    }
  });

  await t.test("service layer también rechaza autoridad inyectada sin depender de Zod", async () => {
    await assert.rejects(
      serviceService.createService(
        validBody({ name: uniqueName("direct"), business: seed.businessB._id }),
        seed.business._id,
      ),
      /campos no permitidos/u,
    );
  });

  await t.test("workers rechaza duplicados, tenant ajeno, Membership ausente/inactiva, User inactivo y non-bookable", async () => {
    const duplicate = await request("/services", {
      method: "POST",
      cookie: adminCookie,
      body: validBody({
        name: uniqueName("duplicate"),
        workers: [seed.worker._id.toString(), seed.worker._id.toString()],
      }),
    });
    assert.equal(duplicate.status, 400);

    const foreign = await request("/services", {
      method: "POST",
      cookie: adminCookie,
      body: validBody({ name: uniqueName("foreign-worker"), workers: [seed.workerB._id.toString()] }),
    });
    assert.equal(foreign.status, 404);

    const noMembership = await request("/services", {
      method: "POST",
      cookie: adminCookie,
      body: validBody({ name: uniqueName("no-membership"), workers: [noMembershipUser._id.toString()] }),
    });
    assert.equal(noMembership.status, 404);

    await Membership.updateOne(workerMembershipFilter, { $set: { isActive: false, isBookable: true } });
    const inactiveMembership = await request("/services", {
      method: "POST",
      cookie: adminCookie,
      body: validBody({ name: uniqueName("inactive-membership") }),
    });
    assert.equal(inactiveMembership.status, 404);

    await resetParticipantState();
    await User.updateOne({ _id: seed.worker._id }, { $set: { isActive: false } });
    const inactiveUser = await request("/services", {
      method: "POST",
      cookie: adminCookie,
      body: validBody({ name: uniqueName("inactive-user") }),
    });
    assert.equal(inactiveUser.status, 404);

    await resetParticipantState();
    await Membership.updateOne(workerMembershipFilter, { $set: { isBookable: false } });
    const nonBookable = await request("/services", {
      method: "POST",
      cookie: adminCookie,
      body: validBody({ name: uniqueName("non-bookable") }),
    });
    assert.equal(nonBookable.status, 404);
  });

  await t.test("admin+bookable y worker+bookable son allowlist válidos sin inferencia por role", async () => {
    await Membership.updateOne(adminMembershipFilter, { $set: { isBookable: true } });
    const response = await request("/services", {
      method: "POST",
      cookie: adminCookie,
      body: validBody({
        name: uniqueName("admin-worker-bookable"),
        workers: [seed.admin._id.toString(), seed.worker._id.toString()],
      }),
    });
    assert.equal(response.status, 201);
    const data = await response.json();
    assert.deepEqual(data.payload.workers.map(String).sort(), [seed.admin._id.toString(), seed.worker._id.toString()].sort());
  });

  await t.test("editar workers no modifica Membership", async () => {
    const before = await Membership.findOne(workerMembershipFilter).lean();
    const response = await request(`/services/${seed.service._id}`, {
      method: "PUT",
      cookie: adminCookie,
      body: { workers: [] },
    });
    assert.equal(response.status, 200);
    const after = await Membership.findOne(workerMembershipFilter).lean();
    assert.equal(after.role, before.role);
    assert.equal(after.isBookable, before.isBookable);
    assert.equal(after.isActive, before.isActive);
  });

  await t.test("depositAmount nunca puede superar price, incluso al bajar price", async () => {
    const invalidCreate = await request("/services", {
      method: "POST",
      cookie: adminCookie,
      body: validBody({ name: uniqueName("bad-deposit"), price: 10000, depositAmount: 15000 }),
    });
    assert.equal(invalidCreate.status, 400);

    const invalidPriceOnly = await request(`/services/${seed.service._id}`, {
      method: "PUT",
      cookie: adminCookie,
      body: { price: 3000 },
    });
    assert.equal(invalidPriceOnly.status, 400);
    let persisted = await Service.findById(seed.service._id);
    assert.equal(persisted.price, 25000);
    assert.equal(persisted.depositAmount, 5000);

    const validFinalState = await request(`/services/${seed.service._id}`, {
      method: "PUT",
      cookie: adminCookie,
      body: { price: 3000, depositAmount: 2000 },
    });
    assert.equal(validFinalState.status, 200);
    persisted = await Service.findById(seed.service._id);
    assert.equal(persisted.price, 3000);
    assert.equal(persisted.depositAmount, 2000);
  });

  await t.test("DELETE y ?hard=true son exclusivamente soft-delete y preservan Appointment histórico", async () => {
    const historicalService = await Service.create({
      ...validBody({ name: uniqueName("historical"), workers: [seed.worker._id] }),
      business: seed.business._id,
      isActive: true,
    });
    const appointment = await Appointment.create({
      client: seed.client._id,
      worker: seed.worker._id,
      service: historicalService._id,
      business: seed.business._id,
      date: new Date("2099-04-05T00:00:00.000Z"),
      startTime: "10:00",
      endTime: "10:45",
      status: "confirmed",
      paymentStatus: "unpaid",
    });
    const appointmentBefore = await Appointment.findById(appointment._id).lean();

    const response = await request(`/services/${historicalService._id}?hard=true`, {
      method: "DELETE",
      cookie: adminCookie,
    });
    assert.equal(response.status, 200);

    const persistedService = await Service.findById(historicalService._id);
    assert.ok(persistedService, "Service debe seguir existiendo físicamente");
    assert.equal(persistedService.isActive, false);

    const appointmentAfter = await Appointment.findById(appointment._id).lean();
    assert.equal(appointmentAfter.service.toString(), historicalService._id.toString());
    assert.equal(appointmentAfter.worker.toString(), appointmentBefore.worker.toString());
    assert.equal(appointmentAfter.status, appointmentBefore.status);
    assert.equal(appointmentAfter.startTime, appointmentBefore.startTime);
    assert.equal(appointmentAfter.endTime, appointmentBefore.endTime);

    const publicRead = await request(`/services?businessId=${seed.business._id}`);
    assert.equal(publicRead.status, 200);
    const publicData = await publicRead.json();
    assert.equal(publicData.payload.some((item) => item.id === historicalService._id.toString()), false);

    const adminRead = await request("/internal/services", { cookie: adminCookie });
    assert.equal(adminRead.status, 200);
    const adminData = await adminRead.json();
    assert.equal(adminData.payload.some((item) => item._id === historicalService._id.toString() && item.isActive === false), true);
  });

  await t.test("no queda primitive de hard-delete en repository/controller/service administrativos", () => {
    const repositorySource = readFileSync(new URL("../src/repositories/service.repository.js", import.meta.url), "utf8");
    const serviceSource = readFileSync(new URL("../src/services/service.service.js", import.meta.url), "utf8");
    const controllerSource = readFileSync(new URL("../src/controllers/service.controller.js", import.meta.url), "utf8");

    assert.doesNotMatch(repositorySource, /findOneAndDelete|findByIdAndDelete|deleteOne|deleteMany/u);
    assert.doesNotMatch(serviceSource, /hardDelete|deleteByIdAndBusiness/u);
    assert.doesNotMatch(controllerSource, /req\.query\.hard|hardDelete/u);
  });
});

test.after(async () => teardown(server, sessionStore));
