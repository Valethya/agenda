import './setup.js';
import test from "node:test";
import assert from "node:assert";
import app, { sessionStore } from "../src/app.js";
import { connectDB } from "../src/db/db.js";
import { cleanTestData, teardown } from "./fixtures.js";
import Business from "../src/db/models/business.model.js";
import User from "../src/db/models/user.model.js";
import Membership from "../src/db/models/membership.model.js";
import Service from "../src/db/models/service.model.js";
import Shift from "../src/db/models/shift.model.js";
import Appointment from "../src/db/models/appointment.model.js";
import { createHash } from "../src/utils/password.js";

await connectDB();
await cleanTestData();

const password = await createHash("discoveryPassword");
const businessA = await Business.create({ name: "Discovery A", slug: "discovery-a", isActive: true });
const businessB = await Business.create({ name: "Discovery B", slug: "discovery-b", isActive: true });

let sequence = 0;
const createParticipant = async ({
  business = businessA,
  userRole = "worker",
  membershipRole = userRole,
  isBookable = true,
  membershipActive = true,
  userActive = true,
  label,
}) => {
  sequence += 1;
  const user = await User.create({
    firstName: label,
    lastName: "Discovery",
    email: [`g1-${sequence}@example.com`],
    phone: [`+5698${String(sequence).padStart(7, "0")}`],
    password,
    role: userRole,
    business: business._id,
    isActive: userActive,
  });
  const membership = await Membership.create({
    user: user._id,
    business: business._id,
    role: membershipRole,
    isBookable,
    isActive: membershipActive,
  });
  return { user, membership };
};

const adminBookable = await createParticipant({ userRole: "admin", isBookable: true, label: "AdminBookable" });
const workerBookable = await createParticipant({ userRole: "worker", isBookable: true, label: "WorkerBookable" });
const workerNonBookable = await createParticipant({ userRole: "worker", isBookable: false, label: "WorkerNonBookable" });
const adminNonBookable = await createParticipant({ userRole: "admin", isBookable: false, label: "AdminNonBookable" });
const unassignedBookable = await createParticipant({ userRole: "worker", isBookable: true, label: "UnassignedBookable" });
const inactiveMembership = await createParticipant({
  userRole: "worker",
  isBookable: true,
  membershipActive: false,
  label: "InactiveMembership",
});
const inactiveUser = await createParticipant({
  userRole: "worker",
  isBookable: true,
  userActive: false,
  label: "InactiveUser",
});
const foreignWorker = await createParticipant({
  business: businessB,
  userRole: "worker",
  isBookable: true,
  label: "ForeignWorker",
});

const serviceA = await Service.create({
  name: "Servicio público A",
  description: "Servicio visible en A",
  duration: 45,
  price: 20000,
  depositAmount: 5000,
  business: businessA._id,
  workers: [
    adminBookable.user._id,
    workerBookable.user._id,
    workerNonBookable.user._id,
    adminNonBookable.user._id,
    inactiveMembership.user._id,
    inactiveUser.user._id,
    foreignWorker.user._id,
  ],
  isActive: true,
});

const inactiveServiceA = await Service.create({
  name: "Servicio inactivo A",
  description: "No visible",
  duration: 30,
  price: 10000,
  depositAmount: 0,
  business: businessA._id,
  workers: [workerBookable.user._id],
  isActive: false,
});

const serviceB = await Service.create({
  name: "Servicio público B",
  description: "Servicio visible sólo en B",
  duration: 30,
  price: 12000,
  depositAmount: 0,
  business: businessB._id,
  workers: [foreignWorker.user._id],
  isActive: true,
});

// Shift existe sólo para un profesional non-bookable. Los profesionales válidos
// quedan intencionalmente sin Shift para demostrar que G1 no hace disponibilidad.
await Shift.create({
  business: businessA._id,
  worker: workerNonBookable.user._id,
  dayOfWeek: 1,
  isOpen: true,
  startTime: "09:00",
  endTime: "18:00",
  breaks: [],
});

const server = app.listen(0);
const { port } = server.address();
const baseUrl = `http://localhost:${port}/api`;

const servicesUrl = (businessId = businessA._id) => `${baseUrl}/services?businessId=${businessId}`;
const serviceUrl = (serviceId, businessId = businessA._id) =>
  `${baseUrl}/services/${serviceId}?businessId=${businessId}`;
const professionalsUrl = (serviceId, businessId = businessA._id) =>
  `${baseUrl}/users/workers?businessId=${businessId}&serviceId=${serviceId}`;

const ids = (payload) => payload.map((value) => value.id).sort();
const expectedVisibleProfessionals = [
  adminBookable.user._id.toString(),
  workerBookable.user._id.toString(),
].sort();

test("G1 public booking discovery", async (t) => {
  await t.test("Business A obtiene sólo sus Services activos", async () => {
    const response = await fetch(servicesUrl());
    assert.strictEqual(response.status, 200);
    const data = await response.json();
    assert.deepStrictEqual(ids(data.payload), [serviceA._id.toString()]);
  });

  await t.test("businessId=A + slug=B falla cerrado en las tres superficies G1", async () => {
    const conflictingTenant = `businessId=${businessA._id}&slug=${businessB.slug}`;
    const responses = await Promise.all([
      fetch(`${baseUrl}/services?${conflictingTenant}`),
      fetch(`${baseUrl}/services/${serviceA._id}?${conflictingTenant}`),
      fetch(`${baseUrl}/users/workers?${conflictingTenant}&serviceId=${serviceA._id}`),
    ]);

    for (const response of responses) {
      assert.strictEqual(response.status, 400);
      const data = await response.json();
      assert.strictEqual(data.code, "VALIDATION_ERROR");
    }
  });

  await t.test("businessId=A + slug=A conserva compatibilidad en las tres superficies G1", async () => {
    const coherentTenant = `businessId=${businessA._id}&slug=${businessA.slug}`;

    const services = await fetch(`${baseUrl}/services?${coherentTenant}`);
    assert.strictEqual(services.status, 200);
    const servicesData = await services.json();
    assert.deepStrictEqual(ids(servicesData.payload), [serviceA._id.toString()]);

    const service = await fetch(`${baseUrl}/services/${serviceA._id}?${coherentTenant}`);
    assert.strictEqual(service.status, 200);
    const serviceData = await service.json();
    assert.strictEqual(serviceData.payload.id, serviceA._id.toString());

    const professionals = await fetch(
      `${baseUrl}/users/workers?${coherentTenant}&serviceId=${serviceA._id}`,
    );
    assert.strictEqual(professionals.status, 200);
    const professionalsData = await professionals.json();
    assert.deepStrictEqual(ids(professionalsData.payload), expectedVisibleProfessionals);
  });

  await t.test("Service de Business B no aparece y Service inactivo no aparece", async () => {
    const response = await fetch(servicesUrl());
    const data = await response.json();
    assert.ok(!ids(data.payload).includes(serviceB._id.toString()));
    assert.ok(!ids(data.payload).includes(inactiveServiceA._id.toString()));
  });

  await t.test("lookup de Service extranjero e inactivo falla cerrado", async () => {
    const foreign = await fetch(serviceUrl(serviceB._id));
    const inactive = await fetch(serviceUrl(inactiveServiceA._id));
    assert.strictEqual(foreign.status, 404);
    assert.strictEqual(inactive.status, 404);
  });

  await t.test("admin y worker bookable asignados son visibles sin inferencia por role", async () => {
    const response = await fetch(professionalsUrl(serviceA._id));
    assert.strictEqual(response.status, 200);
    const data = await response.json();
    assert.deepStrictEqual(ids(data.payload), expectedVisibleProfessionals);
  });

  await t.test("worker/admin non-bookable asignados permanecen invisibles", async () => {
    const response = await fetch(professionalsUrl(serviceA._id));
    const data = await response.json();
    const visible = ids(data.payload);
    assert.ok(!visible.includes(workerNonBookable.user._id.toString()));
    assert.ok(!visible.includes(adminNonBookable.user._id.toString()));
  });

  await t.test("bookable no asignado al Service permanece invisible", async () => {
    const response = await fetch(professionalsUrl(serviceA._id));
    const data = await response.json();
    assert.ok(!ids(data.payload).includes(unassignedBookable.user._id.toString()));
  });

  await t.test("Membership inactiva, User inactivo y profesional extranjero permanecen invisibles", async () => {
    const response = await fetch(professionalsUrl(serviceA._id));
    const data = await response.json();
    const visible = ids(data.payload);
    assert.ok(!visible.includes(inactiveMembership.user._id.toString()));
    assert.ok(!visible.includes(inactiveUser.user._id.toString()));
    assert.ok(!visible.includes(foreignWorker.user._id.toString()));
  });

  await t.test("Business inactivo falla cerrado", async () => {
    businessA.isActive = false;
    await businessA.save();
    try {
      const services = await fetch(servicesUrl());
      const professionals = await fetch(professionalsUrl(serviceA._id));
      assert.strictEqual(services.status, 404);
      assert.strictEqual(professionals.status, 404);
    } finally {
      businessA.isActive = true;
      await businessA.save();
    }
  });

  await t.test("Shift no es requisito y tampoco concede bookability", async () => {
    assert.strictEqual(await Shift.countDocuments({ worker: adminBookable.user._id }), 0);
    assert.strictEqual(await Shift.countDocuments({ worker: workerBookable.user._id }), 0);
    assert.strictEqual(await Shift.countDocuments({ worker: workerNonBookable.user._id }), 1);

    const response = await fetch(professionalsUrl(serviceA._id));
    const data = await response.json();
    const visible = ids(data.payload);
    assert.ok(visible.includes(adminBookable.user._id.toString()));
    assert.ok(visible.includes(workerBookable.user._id.toString()));
    assert.ok(!visible.includes(workerNonBookable.user._id.toString()));
  });

  await t.test("proyección pública de profesional no expone autoridad ni contacto", async () => {
    const response = await fetch(professionalsUrl(serviceA._id));
    const data = await response.json();
    for (const professional of data.payload) {
      for (const forbidden of [
        "email",
        "phone",
        "membershipId",
        "membership",
        "role",
        "isOwner",
        "tenantAuthority",
        "business",
        "isActive",
        "createdAt",
        "updatedAt",
      ]) {
        assert.ok(!(forbidden in professional), `professional expone ${forbidden}`);
      }
      assert.deepStrictEqual(Object.keys(professional).sort(), ["firstName", "id", "lastName"]);
    }
  });

  await t.test("proyección pública de Service no expone workers ni metadata administrativa", async () => {
    const response = await fetch(serviceUrl(serviceA._id));
    assert.strictEqual(response.status, 200);
    const { payload } = await response.json();
    for (const forbidden of ["workers", "isActive", "createdAt", "updatedAt", "__v"] ) {
      assert.ok(!(forbidden in payload), `service expone ${forbidden}`);
    }
    assert.deepStrictEqual(
      Object.keys(payload).sort(),
      ["business", "depositAmount", "description", "duration", "id", "name", "price"],
    );
  });

  await t.test("ObjectId inválido y query inesperada se rechazan con 400", async () => {
    const invalidService = await fetch(`${baseUrl}/services/no-es-objectid?businessId=${businessA._id}`);
    const invalidProfessional = await fetch(
      `${baseUrl}/users/workers?businessId=${businessA._id}&serviceId=no-es-objectid`,
    );
    const unexpected = await fetch(`${servicesUrl()}&$where=1`);
    assert.strictEqual(invalidService.status, 400);
    assert.strictEqual(invalidProfessional.status, 400);
    assert.strictEqual(unexpected.status, 400);
  });

  await t.test("discovery es estrictamente read-only", async () => {
    const snapshot = async () => ({
      businesses: await Business.countDocuments({}),
      users: await User.countDocuments({}),
      memberships: await Membership.countDocuments({}),
      services: await Service.countDocuments({}),
      shifts: await Shift.countDocuments({}),
      appointments: await Appointment.countDocuments({}),
      serviceUpdatedAt: (await Service.findById(serviceA._id).lean()).updatedAt,
      workerUpdatedAt: (await User.findById(workerBookable.user._id).lean()).updatedAt,
      membershipUpdatedAt: (await Membership.findById(workerBookable.membership._id).lean()).updatedAt,
    });

    const before = await snapshot();
    assert.strictEqual((await fetch(servicesUrl())).status, 200);
    assert.strictEqual((await fetch(serviceUrl(serviceA._id))).status, 200);
    assert.strictEqual((await fetch(professionalsUrl(serviceA._id))).status, 200);
    const after = await snapshot();
    assert.deepStrictEqual(after, before);
  });
});

test.after(async () => {
  await teardown(server, sessionStore);
});
