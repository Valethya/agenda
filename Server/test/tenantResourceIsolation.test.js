import "./setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import app, { sessionStore } from "../src/app.js";
import { connectDB } from "../src/db/db.js";
import { seedTestData, cleanTestData, teardown } from "./fixtures.js";
import User from "../src/db/models/user.model.js";
import Membership from "../src/db/models/membership.model.js";
import Service from "../src/db/models/service.model.js";
import Appointment from "../src/db/models/appointment.model.js";
import Block from "../src/db/models/block.model.js";
import { createHash } from "../src/utils/password.js";

await connectDB();
await cleanTestData();
const seed = await seedTestData();
const server = app.listen(0);
const { port } = server.address();
const baseUrl = `http://localhost:${port}/api`;

const request = async (path, { method = "GET", cookie, body } = {}) => fetch(`${baseUrl}${path}`, {
  method,
  headers: {
    ...(cookie ? { Cookie: cookie } : {}),
    ...(body ? { "Content-Type": "application/json" } : {}),
  },
  ...(body ? { body: JSON.stringify(body) } : {}),
});

const loginCookie = async (email, password) => {
  const response = await request("/login", { method: "POST", body: { email, password } });
  assert.ok(response.status === 200 || response.status === 201);
  return response.headers.get("set-cookie");
};

const shiftBody = (workerId, dayOfWeek = 6) => ({
  workerId: workerId.toString(),
  dayOfWeek,
  isOpen: true,
  startTime: "10:00",
  endTime: "17:00",
  breaks: [],
});

const blockBody = (workerId, date = "2099-04-10") => ({
  workerId: workerId.toString(),
  date,
  startTime: "12:00",
  endTime: "13:00",
  reason: "Prueba de aislamiento tenant",
});

const createAppointment = async ({ business, worker, service, startTime }) => Appointment.create({
  client: seed.client._id,
  worker,
  service,
  business,
  date: new Date("2099-04-20T00:00:00.000Z"),
  startTime,
  endTime: `${String(Number(startTime.slice(0, 2)) + 1).padStart(2, "0")}:00`,
  status: "pending",
});

const adminCookie = await loginCookie("test-admin@example.com", "passwordAdmin");
const workerCookie = await loginCookie("test-worker@example.com", "passwordWorker");

const workerA2 = await User.create({
  firstName: "Worker",
  lastName: "A2",
  email: ["worker-a2@example.com"],
  phone: ["+56977770001"],
  password: await createHash("passwordWorkerA2"),
  role: "worker",
  business: seed.business._id,
  isActive: true,
});
await Membership.create({
  user: workerA2._id,
  business: seed.business._id,
  role: "worker",
  isActive: true,
});

const serviceB = await Service.create({
  name: "Servicio exclusivo B",
  description: "Servicio del tenant B",
  duration: 60,
  price: 18000,
  depositAmount: 0,
  business: seed.businessB._id,
  workers: [seed.workerB._id],
  isActive: true,
});

const serviceAForSoftDelete = await Service.create({
  name: "Servicio A soft delete",
  description: "Servicio del tenant A",
  duration: 30,
  price: 12000,
  depositAmount: 0,
  business: seed.business._id,
  workers: [seed.worker._id],
  isActive: true,
});

const serviceAForHardDelete = await Service.create({
  name: "Servicio A hard delete",
  description: "Servicio del tenant A",
  duration: 30,
  price: 14000,
  depositAmount: 0,
  business: seed.business._id,
  workers: [seed.worker._id],
  isActive: true,
});

const appointmentB = await createAppointment({
  business: seed.businessB._id,
  worker: seed.workerB._id,
  service: serviceB._id,
  startTime: "09:00",
});
const appointmentAConfirm = await createAppointment({
  business: seed.business._id,
  worker: seed.worker._id,
  service: seed.service._id,
  startTime: "10:00",
});
const appointmentAComplete = await createAppointment({
  business: seed.business._id,
  worker: seed.worker._id,
  service: seed.service._id,
  startTime: "11:00",
});
const appointmentACancel = await createAppointment({
  business: seed.business._id,
  worker: seed.worker._id,
  service: seed.service._id,
  startTime: "12:00",
});

const blockB = await Block.create({
  business: seed.businessB._id,
  worker: seed.workerB._id,
  date: new Date("2099-04-11T00:00:00.000Z"),
  startTime: "14:00",
  endTime: "15:00",
  reason: "Bloqueo tenant B",
});

test("6.2.2-D adversarial tenant resource isolation", async (t) => {
  await t.test("Admin A no puede operar Appointment B por ID global", async () => {
    const attempts = [
      ["PATCH", `/appointments/${appointmentB._id}/confirm`],
      ["PATCH", `/appointments/${appointmentB._id}/complete`],
      ["PATCH", `/appointments/${appointmentB._id}/cancel`],
      ["GET", `/appointments/${appointmentB._id}`],
      ["GET", `/appointments/${appointmentB._id}/timeline`],
    ];

    for (const [method, path] of attempts) {
      const response = await request(path, { method, cookie: adminCookie });
      assert.equal(response.status, 404, `${method} ${path} debe fallar cerrado`);
    }

    const untouched = await Appointment.findById(appointmentB._id);
    assert.equal(untouched.status, "pending");
  });

  await t.test("Admin A conserva operaciones válidas sobre Appointment A y listado tenant-scoped", async () => {
    const confirm = await request(`/appointments/${appointmentAConfirm._id}/confirm`, {
      method: "PATCH",
      cookie: adminCookie,
    });
    assert.equal(confirm.status, 200);

    const complete = await request(`/appointments/${appointmentAComplete._id}/complete`, {
      method: "PATCH",
      cookie: adminCookie,
    });
    assert.equal(complete.status, 200);

    const cancel = await request(`/appointments/${appointmentACancel._id}/cancel`, {
      method: "PATCH",
      cookie: adminCookie,
    });
    assert.equal(cancel.status, 200);

    const detail = await request(`/appointments/${appointmentAConfirm._id}`, { cookie: adminCookie });
    assert.equal(detail.status, 200);

    const timeline = await request(`/appointments/${appointmentAConfirm._id}/timeline`, { cookie: adminCookie });
    assert.equal(timeline.status, 200);

    const mine = await request("/appointments/my", { cookie: adminCookie });
    assert.equal(mine.status, 200);
    const minePayload = await mine.json();
    assert.ok(minePayload.payload.length >= 3);
    assert.ok(minePayload.payload.every((appointment) => appointment.business._id === seed.business._id.toString()));
  });

  await t.test("Service B no puede leerse ni mutarse desde contexto o autoridad de A", async () => {
    const publicRead = await request(`/services/${serviceB._id}?slug=${seed.business.slug}`);
    assert.equal(publicRead.status, 404);

    const adminRead = await request(`/internal/services/${serviceB._id}`, { cookie: adminCookie });
    assert.equal(adminRead.status, 404);

    const update = await request(`/services/${serviceB._id}`, {
      method: "PUT",
      cookie: adminCookie,
      body: { name: "Intento cross tenant" },
    });
    assert.equal(update.status, 404);

    const softDelete = await request(`/services/${serviceB._id}`, {
      method: "DELETE",
      cookie: adminCookie,
    });
    assert.equal(softDelete.status, 404);

    const hardDelete = await request(`/services/${serviceB._id}?hard=true`, {
      method: "DELETE",
      cookie: adminCookie,
    });
    assert.equal(hardDelete.status, 404);

    const untouched = await Service.findById(serviceB._id);
    assert.ok(untouched);
    assert.equal(untouched.isActive, true);
    assert.equal(untouched.name, "Servicio exclusivo B");
  });

  await t.test("Service A conserva lectura, update, soft delete y hard delete dentro de A", async () => {
    const read = await request(`/internal/services/${serviceAForSoftDelete._id}`, { cookie: adminCookie });
    assert.equal(read.status, 200);

    const update = await request(`/services/${serviceAForSoftDelete._id}`, {
      method: "PUT",
      cookie: adminCookie,
      body: { name: "Servicio A actualizado" },
    });
    assert.equal(update.status, 200);

    const softDelete = await request(`/services/${serviceAForSoftDelete._id}`, {
      method: "DELETE",
      cookie: adminCookie,
    });
    assert.equal(softDelete.status, 200);
    assert.equal((await Service.findById(serviceAForSoftDelete._id)).isActive, false);

    const hiddenPublicly = await request(`/services/${serviceAForSoftDelete._id}?slug=${seed.business.slug}`);
    assert.equal(hiddenPublicly.status, 404);

    const hardDelete = await request(`/services/${serviceAForHardDelete._id}?hard=true`, {
      method: "DELETE",
      cookie: adminCookie,
    });
    assert.equal(hardDelete.status, 200);
    assert.equal(await Service.findById(serviceAForHardDelete._id), null);
  });

  await t.test("Turnos de workers de B no se leen ni modifican desde contexto A", async () => {
    const readCrossTenant = await request(`/availability/shifts/${seed.workerB._id}`, {
      cookie: adminCookie,
    });
    assert.equal(readCrossTenant.status, 404);

    const readSameTenant = await request(`/availability/shifts/${seed.worker._id}`, {
      cookie: adminCookie,
    });
    assert.equal(readSameTenant.status, 200);

    const crossTenant = await request("/availability/shifts", {
      method: "POST",
      cookie: adminCookie,
      body: shiftBody(seed.workerB._id),
    });
    assert.equal(crossTenant.status, 404);

    const sameTenant = await request("/availability/shifts", {
      method: "POST",
      cookie: adminCookie,
      body: shiftBody(seed.worker._id),
    });
    assert.equal(sameTenant.status, 200);
    const sameTenantBody = await sameTenant.json();
    assert.equal(sameTenantBody.payload.business, seed.business._id.toString());
  });

  await t.test("Admin A no puede crear ni eliminar bloques funcionalmente pertenecientes a B", async () => {
    const createCrossTenant = await request("/availability/blocks", {
      method: "POST",
      cookie: adminCookie,
      body: blockBody(seed.workerB._id),
    });
    assert.equal(createCrossTenant.status, 404);

    const deleteCrossTenant = await request(`/availability/blocks/${blockB._id}`, {
      method: "DELETE",
      cookie: adminCookie,
    });
    assert.equal(deleteCrossTenant.status, 404);
    assert.ok(await Block.findById(blockB._id));

    const createSameTenant = await request("/availability/blocks", {
      method: "POST",
      cookie: adminCookie,
      body: blockBody(seed.worker._id, "2099-04-12"),
    });
    assert.equal(createSameTenant.status, 201);
    const created = await createSameTenant.json();
    assert.equal(created.payload.business, seed.business._id.toString());

    const deleteSameTenant = await request(`/availability/blocks/${created.payload._id}`, {
      method: "DELETE",
      cookie: adminCookie,
    });
    assert.equal(deleteSameTenant.status, 200);
  });

  await t.test("Worker A sólo puede modificar su propio turno dentro de A", async () => {
    const own = await request("/availability/shifts", {
      method: "POST",
      cookie: workerCookie,
      body: shiftBody(seed.worker._id, 0),
    });
    assert.equal(own.status, 200);

    const otherSameTenant = await request("/availability/shifts", {
      method: "POST",
      cookie: workerCookie,
      body: shiftBody(workerA2._id, 0),
    });
    assert.equal(otherSameTenant.status, 403);

    const otherTenant = await request("/availability/shifts", {
      method: "POST",
      cookie: workerCookie,
      body: shiftBody(seed.workerB._id, 0),
    });
    assert.equal(otherTenant.status, 404);
  });
});

test.after(async () => {
  await teardown(server, sessionStore);
});
