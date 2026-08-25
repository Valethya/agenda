import "./setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import app, { sessionStore } from "../src/app.js";
import { connectDB } from "../src/db/db.js";
import { seedTestData, cleanTestData, teardown } from "./fixtures.js";
import Membership from "../src/db/models/membership.model.js";
import User from "../src/db/models/user.model.js";
import Business from "../src/db/models/business.model.js";
import Service from "../src/db/models/service.model.js";
import Shift from "../src/db/models/shift.model.js";
import Appointment from "../src/db/models/appointment.model.js";
import { createHash } from "../src/utils/password.js";
import { getPublicProfessionalsForService } from "../src/services/publicBookingContract.service.js";

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
    ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
  },
  ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
});

const login = async (email, password) => {
  const response = await request("/login", { method: "POST", body: { email, password } });
  assert.ok(response.status === 200 || response.status === 201, `login ${email}: ${response.status}`);
  return response.headers.get("set-cookie");
};

const adminCookie = await login("test-admin@example.com", "passwordAdmin");
const workerCookie = await login("test-worker@example.com", "passwordWorker");
const adminMembership = await Membership.findOne({ user: seed.admin._id, business: seed.business._id });
const workerMembership = await Membership.findOne({ user: seed.worker._id, business: seed.business._id });
const foreignMembership = await Membership.findOne({ user: seed.workerB._id, business: seed.businessB._id });

const secondAdmin = await User.create({
  firstName: "Segundo",
  lastName: "Admin",
  email: ["second-admin@example.com"],
  password: await createHash("passwordSecondAdmin"),
  role: "user",
  business: seed.business._id,
  isActive: true,
});
const secondAdminMembership = await Membership.create({
  user: secondAdmin._id,
  business: seed.business._id,
  role: "admin",
  isBookable: true,
  isActive: true,
});
const secondAdminCookie = await login("second-admin@example.com", "passwordSecondAdmin");

test("GET Team exige Membership admin activa, minimiza datos y queda tenant-scoped", async () => {
  const response = await request("/team", { cookie: adminCookie });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, "success");
  assert.ok(Array.isArray(body.payload.team));
  assert.equal(body.payload.team.some((entry) => entry.userId === seed.workerB._id.toString()), false);

  for (const entry of body.payload.team) {
    assert.deepEqual(
      Object.keys(entry).sort(),
      ["isActive", "isBookable", "isOwner", "membershipId", "name", "role", "userId"].sort(),
    );
    assert.equal(Object.hasOwn(entry, "email"), false);
    assert.equal(Object.hasOwn(entry, "password"), false);
    assert.equal(Object.hasOwn(entry, "resetPasswordToken"), false);
  }

  const deniedWorker = await request("/team", { cookie: workerCookie });
  assert.equal(deniedWorker.status, 403);

  await User.updateOne({ _id: seed.worker._id }, { $set: { role: "admin" } });
  const deniedGlobalAdmin = await request("/team", { cookie: workerCookie });
  assert.equal(deniedGlobalAdmin.status, 403);

  await User.updateOne({ _id: seed.worker._id }, { $set: { role: "superadmin" } });
  const deniedSuperadmin = await request("/team", { cookie: workerCookie });
  assert.equal(deniedSuperadmin.status, 403);
  await User.updateOne({ _id: seed.worker._id }, { $set: { role: "worker" } });
});

test("PATCH mantiene role e isBookable independientes y no toca recursos relacionados", async () => {
  const beforeShifts = await Shift.countDocuments({ business: seed.business._id });
  const beforeServices = await Service.countDocuments({ business: seed.business._id });
  const beforeService = await Service.findById(seed.service._id).lean();
  const appointment = await Appointment.create({
    client: seed.client._id,
    worker: seed.worker._id,
    service: seed.service._id,
    business: seed.business._id,
    date: new Date("2099-06-01T00:00:00.000Z"),
    startTime: "10:00",
    endTime: "11:00",
    status: "pending",
  });

  let response = await request(`/team/memberships/${workerMembership._id}`, {
    method: "PATCH",
    cookie: adminCookie,
    body: { role: "admin" },
  });
  assert.equal(response.status, 200);
  let persisted = await Membership.findById(workerMembership._id);
  assert.equal(persisted.role, "admin");
  assert.equal(persisted.isBookable, true);

  response = await request(`/team/memberships/${workerMembership._id}`, {
    method: "PATCH",
    cookie: adminCookie,
    body: { role: "worker", isBookable: false },
  });
  assert.equal(response.status, 200);
  persisted = await Membership.findById(workerMembership._id);
  assert.equal(persisted.role, "worker");
  assert.equal(persisted.isBookable, false);

  response = await request(`/team/memberships/${workerMembership._id}`, {
    method: "PATCH",
    cookie: adminCookie,
    body: { isBookable: true },
  });
  assert.equal(response.status, 200);
  persisted = await Membership.findById(workerMembership._id);
  assert.equal(persisted.role, "worker");
  assert.equal(persisted.isBookable, true);

  assert.equal(await Shift.countDocuments({ business: seed.business._id }), beforeShifts);
  assert.equal(await Service.countDocuments({ business: seed.business._id }), beforeServices);
  const afterService = await Service.findById(seed.service._id).lean();
  assert.deepEqual(afterService.workers.map(String), beforeService.workers.map(String));
  const afterAppointment = await Appointment.findById(appointment._id);
  assert.equal(afterAppointment.worker.toString(), seed.worker._id.toString());
  assert.equal(afterAppointment.status, "pending");
});

test("PATCH es allowlist estricta, no permite mover user/business y no existe hard delete", async () => {
  for (const body of [
    { role: "worker", unexpected: true },
    { user: seed.admin._id.toString() },
    { business: seed.businessB._id.toString() },
    { _id: adminMembership._id.toString() },
    { isBookable: null },
    { role: { value: "admin" } },
    {},
  ]) {
    const response = await request(`/team/memberships/${workerMembership._id}`, {
      method: "PATCH",
      cookie: adminCookie,
      body,
    });
    assert.equal(response.status, 400, JSON.stringify(body));
  }

  const deleteResponse = await request(`/team/memberships/${workerMembership._id}`, {
    method: "DELETE",
    cookie: adminCookie,
  });
  assert.equal(deleteResponse.status, 404);
  assert.ok(await Membership.findById(workerMembership._id));
});

test("tenant isolation devuelve 404 para Membership ajena y no produce mutación lateral", async () => {
  const before = await Membership.findById(foreignMembership._id).lean();
  const response = await request(`/team/memberships/${foreignMembership._id}`, {
    method: "PATCH",
    cookie: adminCookie,
    body: { isBookable: false, role: "admin" },
  });
  assert.equal(response.status, 404);
  const after = await Membership.findById(foreignMembership._id).lean();
  assert.equal(after.role, before.role);
  assert.equal(after.isBookable, before.isBookable);
  assert.equal(after.isActive, before.isActive);
});

test("desactivar Membership revoca acceso y discovery sin borrar User ni historial", async () => {
  await Membership.updateOne(
    { _id: workerMembership._id },
    { $set: { role: "worker", isBookable: true, isActive: true } },
  );

  let professionals = await getPublicProfessionalsForService({
    businessId: seed.business._id,
    serviceId: seed.service._id,
  });
  assert.ok(professionals.some((entry) => entry.id === seed.worker._id.toString()));

  const response = await request(`/team/memberships/${workerMembership._id}`, {
    method: "PATCH",
    cookie: adminCookie,
    body: { isActive: false },
  });
  assert.equal(response.status, 200);

  const denied = await request("/team", { cookie: workerCookie });
  assert.equal(denied.status, 403);
  professionals = await getPublicProfessionalsForService({
    businessId: seed.business._id,
    serviceId: seed.service._id,
  });
  assert.equal(professionals.some((entry) => entry.id === seed.worker._id.toString()), false);
  assert.ok(await User.findById(seed.worker._id));
  assert.ok(await Membership.findById(workerMembership._id));

  const reactivation = await request(`/team/memberships/${workerMembership._id}`, {
    method: "PATCH",
    cookie: adminCookie,
    body: { isActive: true },
  });
  assert.equal(reactivation.status, 409);

  await Membership.updateOne(
    { _id: workerMembership._id },
    { $set: { role: "worker", isBookable: true, isActive: true } },
  );
});

test("owner guard impide degradar o desactivar la Membership propietaria", async () => {
  await Business.updateOne({ _id: seed.business._id }, { $set: { owner: seed.admin._id } });

  for (const body of [{ role: "worker" }, { isActive: false }, { role: "worker", isActive: false }]) {
    const response = await request(`/team/memberships/${adminMembership._id}`, {
      method: "PATCH",
      cookie: adminCookie,
      body,
    });
    assert.equal(response.status, 409);
  }

  const ownerMembership = await Membership.findById(adminMembership._id);
  assert.equal(ownerMembership.role, "admin");
  assert.equal(ownerMembership.isActive, true);
  await Business.updateOne({ _id: seed.business._id }, { $unset: { owner: 1 } });
});

test("último admin no puede degradarse ni desactivarse", async () => {
  await Membership.updateOne(
    { _id: secondAdminMembership._id },
    { $set: { role: "worker", isActive: true } },
  );
  await Membership.updateOne(
    { _id: workerMembership._id },
    { $set: { role: "worker", isActive: true } },
  );
  await Membership.updateOne(
    { _id: adminMembership._id },
    { $set: { role: "admin", isActive: true } },
  );

  let response = await request(`/team/memberships/${adminMembership._id}`, {
    method: "PATCH",
    cookie: adminCookie,
    body: { role: "worker" },
  });
  assert.equal(response.status, 409);

  response = await request(`/team/memberships/${adminMembership._id}`, {
    method: "PATCH",
    cookie: adminCookie,
    body: { isActive: false },
  });
  assert.equal(response.status, 409);

  await Membership.updateOne(
    { _id: secondAdminMembership._id },
    { $set: { role: "admin", isActive: true } },
  );
});

test("dos degradaciones concurrentes se serializan y nunca dejan cero admins", async () => {
  await Membership.updateOne(
    { _id: adminMembership._id },
    { $set: { role: "admin", isActive: true } },
  );
  await Membership.updateOne(
    { _id: secondAdminMembership._id },
    { $set: { role: "admin", isActive: true } },
  );
  await Membership.updateOne(
    { _id: workerMembership._id },
    { $set: { role: "worker", isActive: true } },
  );

  const [first, second] = await Promise.all([
    request(`/team/memberships/${adminMembership._id}`, {
      method: "PATCH",
      cookie: adminCookie,
      body: { role: "worker" },
    }),
    request(`/team/memberships/${secondAdminMembership._id}`, {
      method: "PATCH",
      cookie: secondAdminCookie,
      body: { role: "worker" },
    }),
  ]);

  const statuses = [first.status, second.status];
  assert.equal(statuses.filter((status) => status === 200).length, 1, statuses.join(","));
  assert.equal(await Membership.countDocuments({
    business: seed.business._id,
    role: "admin",
    isActive: true,
  }), 1);

  await Membership.updateOne(
    { _id: adminMembership._id },
    { $set: { role: "admin", isActive: true } },
  );
  await Membership.updateOne(
    { _id: secondAdminMembership._id },
    { $set: { role: "admin", isActive: true } },
  );
});

test("concurrencia cross-tenant no modifica el Business ajeno", async () => {
  const beforeForeign = await Membership.findById(foreignMembership._id).lean();
  const [local, foreign] = await Promise.all([
    request(`/team/memberships/${workerMembership._id}`, {
      method: "PATCH",
      cookie: adminCookie,
      body: { isBookable: false },
    }),
    request(`/team/memberships/${foreignMembership._id}`, {
      method: "PATCH",
      cookie: secondAdminCookie,
      body: { role: "admin", isBookable: false },
    }),
  ]);
  assert.equal(local.status, 200);
  assert.equal(foreign.status, 404);
  const afterForeign = await Membership.findById(foreignMembership._id).lean();
  assert.equal(afterForeign.role, beforeForeign.role);
  assert.equal(afterForeign.isBookable, beforeForeign.isBookable);
});

test("legacy POST/DELETE workers permanecen cerrados y no mutantes", async () => {
  const before = {
    users: await User.countDocuments(),
    memberships: await Membership.countDocuments(),
  };
  const post = await request("/users/workers", {
    method: "POST",
    cookie: adminCookie,
    body: {
      firstName: "No",
      lastName: "Crear",
      email: "must-not-create@example.com",
      password: "never-used",
    },
  });
  assert.notEqual(post.status, 200);
  assert.notEqual(post.status, 201);

  const del = await request(`/users/workers/${seed.worker._id}`, {
    method: "DELETE",
    cookie: adminCookie,
  });
  assert.equal(del.status, 409);
  assert.deepEqual({
    users: await User.countDocuments(),
    memberships: await Membership.countDocuments(),
  }, before);
});

test.after(async () => {
  await teardown(server, sessionStore);
});
