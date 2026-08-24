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
import {
  validateBookingTenantScope,
  bookAppointment,
  confirmAppointment,
  getAppointmentDetails,
} from "../src/services/appointment.service.js";
import { getPublicProfessionalsForService } from "../src/services/publicBookingContract.service.js";
import { getAvailableSlots } from "../src/services/availability.service.js";

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

const loginCookie = async () => {
  const response = await request("/login", {
    method: "POST",
    body: { email: "test-admin@example.com", password: "passwordAdmin" },
  });
  assert.ok(response.status === 200 || response.status === 201);
  return response.headers.get("set-cookie");
};

const workerMembership = () => Membership.findOne({
  user: seed.worker._id,
  business: seed.business._id,
});

const restoreCanonicalWorker = async () => {
  await User.updateOne({ _id: seed.worker._id }, { $set: { isActive: true } });
  await Business.updateOne({ _id: seed.business._id }, { $set: { isActive: true } });
  await Membership.updateOne(
    { user: seed.worker._id, business: seed.business._id },
    { $set: { isActive: true, isBookable: true } },
  );
  await Service.updateOne(
    { _id: seed.service._id },
    { $set: { isActive: true, workers: [seed.worker._id] } },
  );
};

test("admin+bookable puede descubrirse y worker+non-bookable no", async () => {
  const adminMembership = await Membership.findOne({ user: seed.admin._id, business: seed.business._id });
  adminMembership.isBookable = true;
  await adminMembership.save();
  await Service.updateOne({ _id: seed.service._id }, { $addToSet: { workers: seed.admin._id } });

  let professionals = await getPublicProfessionalsForService({
    businessId: seed.business._id,
    serviceId: seed.service._id,
  });
  assert.ok(professionals.some((professional) => professional.id === seed.admin._id.toString()));
  assert.ok(professionals.some((professional) => professional.id === seed.worker._id.toString()));

  await Membership.updateOne(
    { user: seed.worker._id, business: seed.business._id },
    { $set: { isBookable: false } },
  );
  professionals = await getPublicProfessionalsForService({
    businessId: seed.business._id,
    serviceId: seed.service._id,
  });
  assert.equal(professionals.some((professional) => professional.id === seed.worker._id.toString()), false);

  adminMembership.isBookable = false;
  await adminMembership.save();
  await Service.updateOne({ _id: seed.service._id }, { $pull: { workers: seed.admin._id } });
  await restoreCanonicalWorker();
});

test("Service.workers y Shift stale no vencen isBookable=false", async () => {
  await Membership.updateOne(
    { user: seed.worker._id, business: seed.business._id },
    { $set: { isBookable: false } },
  );
  assert.ok(await Shift.findOne({ worker: seed.worker._id, business: seed.business._id }));
  const service = await Service.findById(seed.service._id);
  assert.ok(service.workers.some((worker) => worker.equals(seed.worker._id)));

  await assert.rejects(
    getAvailableSlots(seed.worker._id, "2099-04-20", seed.service._id, seed.business._id),
    /profesional especificado no está disponible/u,
  );
  await restoreCanonicalWorker();
});

test("slot/scope previo no concede Appointment si bookability se revoca antes de crear", async () => {
  const tenantScope = await validateBookingTenantScope({
    worker: seed.worker._id,
    service: seed.service._id,
    businessId: seed.business._id,
  });
  await Membership.updateOne(
    { user: seed.worker._id, business: seed.business._id },
    { $set: { isBookable: false } },
  );
  const before = await Appointment.countDocuments({ business: seed.business._id });

  await assert.rejects(
    bookAppointment({
      client: seed.client._id,
      worker: seed.worker._id,
      service: seed.service._id,
      businessId: seed.business._id,
      tenantScope,
      date: "2099-04-21",
      startTime: "10:00",
      isSuggestion: true,
      paymentOption: "local",
    }),
    /profesional especificado no está disponible/u,
  );
  assert.equal(await Appointment.countDocuments({ business: seed.business._id }), before);
  await restoreCanonicalWorker();
});

test("Appointment existente no exige isBookable ni presencia actual en Service.workers", async () => {
  const appointment = await Appointment.create({
    client: seed.client._id,
    worker: seed.worker._id,
    service: seed.service._id,
    business: seed.business._id,
    date: new Date("2099-04-22T00:00:00.000Z"),
    startTime: "10:00",
    endTime: "11:00",
    status: "pending",
  });

  await Membership.updateOne(
    { user: seed.worker._id, business: seed.business._id },
    { $set: { isBookable: false } },
  );
  await Service.updateOne({ _id: seed.service._id }, { $pull: { workers: seed.worker._id } });

  const updated = await confirmAppointment(
    appointment._id,
    seed.worker._id,
    null,
    seed.business._id,
  );
  assert.equal(updated.status, "confirmed");
  const persisted = await Appointment.findById(appointment._id);
  assert.ok(persisted.worker.equals(seed.worker._id));

  await Membership.updateOne(
    { user: seed.worker._id, business: seed.business._id },
    { $set: { isActive: false } },
  );
  await assert.rejects(
    getAppointmentDetails(appointment._id, seed.worker._id, null, seed.business._id),
    /cita especificada no existe/u,
  );
  await restoreCanonicalWorker();
});

test("POST workers legacy es estable y no crea User/Membership/Shift", async () => {
  const cookie = await loginCookie();
  const before = {
    users: await User.countDocuments(),
    memberships: await Membership.countDocuments(),
    shifts: await Shift.countDocuments(),
  };

  const missingEmail = await request("/users/workers", {
    method: "POST",
    cookie,
    body: {
      firstName: "Legacy",
      lastName: "Missing",
      email: "new-legacy@example.com",
      password: "never-materialized",
    },
  });
  const existingEmail = await request("/users/workers", {
    method: "POST",
    cookie,
    body: {
      firstName: "Legacy",
      lastName: "Existing",
      email: "test-worker@example.com",
      password: "never-materialized",
    },
  });
  assert.equal(missingEmail.status, existingEmail.status);
  assert.deepEqual(await missingEmail.json(), await existingEmail.json());
  assert.deepEqual({
    users: await User.countDocuments(),
    memberships: await Membership.countDocuments(),
    shifts: await Shift.countDocuments(),
  }, before);
});

test("DELETE workers legacy ignora hard=true y no borra Membership físicamente", async () => {
  const cookie = await loginCookie();
  const membership = await workerMembership();
  const response = await request(`/users/workers/${seed.worker._id}?hard=true`, {
    method: "DELETE",
    cookie,
  });
  assert.equal(response.status, 409);
  assert.ok(await Membership.findById(membership._id));
  assert.ok(await User.findById(seed.worker._id));
});

test("GET interno workers no filtra PII ni cross-tenant y conserva campos operacionales", async () => {
  const cookie = await loginCookie();
  const response = await request("/internal/users/workers", { cookie });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(Array.isArray(body.payload));
  assert.ok(body.payload.some((entry) => entry._id === seed.worker._id.toString()));
  assert.equal(body.payload.some((entry) => entry._id === seed.workerB._id.toString()), false);
  for (const entry of body.payload) {
    assert.ok(entry._id);
    assert.equal(typeof entry.firstName, "string");
    assert.equal(typeof entry.lastName, "string");
    for (const forbidden of ["email", "phone", "role", "business", "isBookable", "memberships", "password"]) {
      assert.equal(Object.hasOwn(entry, forbidden), false, forbidden);
    }
  }
});

test.after(async () => {
  await teardown(server, sessionStore);
});
