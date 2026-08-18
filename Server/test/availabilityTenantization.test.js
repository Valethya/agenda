import "./setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import app, { sessionStore } from "../src/app.js";
import { connectDB } from "../src/db/db.js";
import { seedTestData, cleanTestData, teardown } from "./fixtures.js";
import Membership from "../src/db/models/membership.model.js";
import Service from "../src/db/models/service.model.js";
import Shift from "../src/db/models/shift.model.js";
import Block from "../src/db/models/block.model.js";
import Appointment from "../src/db/models/appointment.model.js";
import * as shiftRepository from "../src/repositories/shift.repository.js";
import * as blockRepository from "../src/repositories/block.repository.js";
import * as appointmentRepository from "../src/repositories/appointment.repository.js";

await connectDB();
await cleanTestData();
const seed = await seedTestData();
const server = app.listen(0);
const { port } = server.address();
const baseUrl = `http://localhost:${port}/api`;
const date = "2099-04-06"; // lunes
const targetDate = new Date(`${date}T00:00:00.000Z`);

const request = async (path, { method = "GET", cookie, body } = {}) => fetch(`${baseUrl}${path}`, {
  method,
  headers: {
    ...(cookie ? { Cookie: cookie } : {}),
    ...(body ? { "Content-Type": "application/json" } : {}),
  },
  ...(body ? { body: JSON.stringify(body) } : {}),
});

const login = async (email, password) => {
  const response = await request("/login", { method: "POST", body: { email, password } });
  return {
    response,
    payload: await response.json(),
    cookie: response.headers.get("set-cookie"),
  };
};

const slotsFor = async ({ workerId, serviceId, slug }) => {
  const response = await request(
    `/availability/slots?workerId=${workerId}&serviceId=${serviceId}&date=${date}&slug=${slug}`,
  );
  assert.equal(response.status, 200);
  return (await response.json()).payload;
};

const slotAt = (slots, startTime) => slots.find((slot) => slot.startTime === startTime);

const membershipA = await Membership.findOne({
  user: seed.worker._id,
  business: seed.business._id,
  role: "worker",
  isActive: true,
});
const membershipB = await Membership.create({
  user: seed.worker._id,
  business: seed.businessB._id,
  role: "worker",
  isActive: true,
});

const serviceB = await Service.create({
  name: "Servicio B del mismo worker global",
  description: "Prueba 6.2.3",
  duration: 60,
  price: 18000,
  depositAmount: 0,
  business: seed.businessB._id,
  workers: [seed.worker._id],
  isActive: true,
});

await shiftRepository.upsertByBusinessWorkerAndDay(
  seed.business._id,
  seed.worker._id,
  1,
  { isOpen: true, startTime: "09:00", endTime: "18:00", breaks: [] },
);
const shiftB = await Shift.create({
  business: seed.businessB._id,
  worker: seed.worker._id,
  dayOfWeek: 1,
  isOpen: true,
  startTime: "14:00",
  endTime: "20:00",
  breaks: [],
});

const adminA = await login("test-admin@example.com", "passwordAdmin");
const adminB = await login("user-b@example.com", "passwordUserB");
assert.ok(adminA.response.status === 200 || adminA.response.status === 201);
assert.ok(adminB.response.status === 200 || adminB.response.status === 201);

test("6.2.3 tenantización física de disponibilidad", async (t) => {
  await t.test("mismo worker puede tener el mismo día con turnos independientes por negocio", async () => {
    const shiftsA = await shiftRepository.findByBusinessAndWorker(seed.business._id, seed.worker._id);
    const shiftsB = await shiftRepository.findByBusinessAndWorker(seed.businessB._id, seed.worker._id);
    const mondayA = shiftsA.find((shift) => shift.dayOfWeek === 1);
    const mondayB = shiftsB.find((shift) => shift.dayOfWeek === 1);

    assert.ok(mondayA);
    assert.ok(mondayB);
    assert.equal(mondayA.business.toString(), seed.business._id.toString());
    assert.equal(mondayA.startTime, "09:00");
    assert.equal(mondayA.endTime, "18:00");
    assert.equal(mondayB.business.toString(), seed.businessB._id.toString());
    assert.equal(mondayB.startTime, "14:00");
    assert.equal(mondayB.endTime, "20:00");

    const dayA = await shiftRepository.findByBusinessWorkerAndDay(seed.business._id, seed.worker._id, 1);
    const dayB = await shiftRepository.findByBusinessWorkerAndDay(seed.businessB._id, seed.worker._id, 1);
    assert.equal(dayA._id.toString(), mondayA._id.toString());
    assert.equal(dayB._id.toString(), shiftB._id.toString());
  });

  await t.test("GET shifts limita físicamente el resultado al tenant autenticado", async () => {
    const responseA = await request(`/availability/shifts/${seed.worker._id}`, { cookie: adminA.cookie });
    const responseB = await request(`/availability/shifts/${seed.worker._id}`, { cookie: adminB.cookie });
    assert.equal(responseA.status, 200);
    assert.equal(responseB.status, 200);

    const payloadA = (await responseA.json()).payload;
    const payloadB = (await responseB.json()).payload;
    assert.ok(payloadA.length > 0);
    assert.ok(payloadB.length > 0);
    assert.ok(payloadA.every((shift) => shift.business === seed.business._id.toString()));
    assert.ok(payloadB.every((shift) => shift.business === seed.businessB._id.toString()));
    assert.equal(payloadB.length, 1);
  });

  let blockA;
  let blockB;

  await t.test("Block A afecta A pero no B; Block B afecta B pero no A", async () => {
    const createA = await request("/availability/blocks", {
      method: "POST",
      cookie: adminA.cookie,
      body: {
        workerId: seed.worker._id.toString(),
        date,
        startTime: "15:00",
        endTime: "16:00",
        reason: "Block A",
      },
    });
    assert.equal(createA.status, 201);
    blockA = (await createA.json()).payload;
    assert.equal(blockA.business, seed.business._id.toString());

    let slotsA = await slotsFor({
      workerId: seed.worker._id,
      serviceId: seed.service._id,
      slug: seed.business.slug,
    });
    let slotsB = await slotsFor({
      workerId: seed.worker._id,
      serviceId: serviceB._id,
      slug: seed.businessB.slug,
    });
    assert.equal(slotAt(slotsA, "15:00")?.available, false);
    assert.equal(slotAt(slotsB, "15:00")?.available, true);

    const createB = await request("/availability/blocks", {
      method: "POST",
      cookie: adminB.cookie,
      body: {
        workerId: seed.worker._id.toString(),
        date,
        startTime: "16:00",
        endTime: "17:00",
        reason: "Block B",
      },
    });
    assert.equal(createB.status, 201);
    blockB = (await createB.json()).payload;
    assert.equal(blockB.business, seed.businessB._id.toString());

    slotsA = await slotsFor({
      workerId: seed.worker._id,
      serviceId: seed.service._id,
      slug: seed.business.slug,
    });
    slotsB = await slotsFor({
      workerId: seed.worker._id,
      serviceId: serviceB._id,
      slug: seed.businessB.slug,
    });
    assert.equal(slotAt(slotsA, "16:00")?.available, true);
    assert.equal(slotAt(slotsB, "16:00")?.available, false);

    const repoA = await blockRepository.findByBusinessWorkerAndDateRange(
      seed.business._id,
      seed.worker._id,
      targetDate,
      targetDate,
    );
    const repoB = await blockRepository.findByBusinessWorkerAndDateRange(
      seed.businessB._id,
      seed.worker._id,
      targetDate,
      targetDate,
    );
    assert.ok(repoA.every((block) => block.business.toString() === seed.business._id.toString()));
    assert.ok(repoB.every((block) => block.business.toString() === seed.businessB._id.toString()));
    assert.ok(repoA.some((block) => block._id.toString() === blockA._id));
    assert.ok(repoB.some((block) => block._id.toString() === blockB._id));
  });

  await t.test("admins y worker no pueden eliminar Blocks del otro tenant", async () => {
    const adminADeleteB = await request(`/availability/blocks/${blockB._id}`, {
      method: "DELETE",
      cookie: adminA.cookie,
    });
    const adminBDeleteA = await request(`/availability/blocks/${blockA._id}`, {
      method: "DELETE",
      cookie: adminB.cookie,
    });
    assert.equal(adminADeleteB.status, 404);
    assert.equal(adminBDeleteA.status, 404);

    const workerLogin = await login("test-worker@example.com", "passwordWorker");
    assert.equal(workerLogin.response.status, 200);
    assert.equal(workerLogin.payload.status, "needs_selection");

    const selectA = await request("/select-membership", {
      method: "POST",
      cookie: workerLogin.cookie,
      body: { membershipId: membershipA._id.toString() },
    });
    assert.equal(selectA.status, 200);

    const ownBlock = await request("/availability/blocks", {
      method: "POST",
      cookie: workerLogin.cookie,
      body: {
        workerId: seed.worker._id.toString(),
        date,
        startTime: "17:00",
        endTime: "17:30",
        reason: "Worker A",
      },
    });
    assert.equal(ownBlock.status, 201);
    assert.equal((await ownBlock.json()).payload.business, seed.business._id.toString());

    const workerDeleteB = await request(`/availability/blocks/${blockB._id}`, {
      method: "DELETE",
      cookie: workerLogin.cookie,
    });
    assert.equal(workerDeleteB.status, 404);
  });

  await t.test("Appointment A no ocupa B y el mismo horario puede coexistir en dos negocios", async () => {
    const common = {
      client: seed.client._id,
      worker: seed.worker._id,
      date: targetDate,
      startTime: "14:00",
      endTime: "15:00",
      status: "pending",
    };

    const appointmentA = await Appointment.create({
      ...common,
      service: seed.service._id,
      business: seed.business._id,
    });

    let slotsB = await slotsFor({
      workerId: seed.worker._id,
      serviceId: serviceB._id,
      slug: seed.businessB.slug,
    });
    assert.equal(slotAt(slotsB, "14:00")?.available, true);

    const appointmentB = await Appointment.create({
      ...common,
      service: serviceB._id,
      business: seed.businessB._id,
    });
    assert.ok(appointmentA._id);
    assert.ok(appointmentB._id);

    const repoA = await appointmentRepository.findByBusinessWorkerAndDate(
      seed.business._id,
      seed.worker._id,
      targetDate,
    );
    const repoB = await appointmentRepository.findByBusinessWorkerAndDate(
      seed.businessB._id,
      seed.worker._id,
      targetDate,
    );
    assert.ok(repoA.some((appointment) => appointment._id.toString() === appointmentA._id.toString()));
    assert.ok(repoB.some((appointment) => appointment._id.toString() === appointmentB._id.toString()));
    assert.ok(repoA.every((appointment) => appointment.business.toString() === seed.business._id.toString()));
    assert.ok(repoB.every((appointment) => appointment.business.toString() === seed.businessB._id.toString()));

    const slotsA = await slotsFor({
      workerId: seed.worker._id,
      serviceId: seed.service._id,
      slug: seed.business.slug,
    });
    slotsB = await slotsFor({
      workerId: seed.worker._id,
      serviceId: serviceB._id,
      slug: seed.businessB.slug,
    });
    assert.equal(slotAt(slotsA, "14:00")?.available, false);
    assert.equal(slotAt(slotsB, "14:00")?.available, false);

    await assert.rejects(
      Appointment.create({
        ...common,
        client: seed.client._id,
        service: seed.service._id,
        business: seed.business._id,
      }),
      (error) => error?.code === 11000,
    );
  });

  await t.test("índices físicos frescos no conservan unicidad global por worker", async () => {
    await Promise.all([Shift.init(), Block.init(), Appointment.init()]);
    const [shiftIndexes, blockIndexes, appointmentIndexes] = await Promise.all([
      Shift.collection.indexes(),
      Block.collection.indexes(),
      Appointment.collection.indexes(),
    ]);

    const keyEquals = (index, expected) => JSON.stringify(index.key) === JSON.stringify(expected);

    const shiftTenant = shiftIndexes.find((index) => keyEquals(index, { business: 1, worker: 1, dayOfWeek: 1 }));
    assert.equal(shiftTenant?.unique, true);
    assert.equal(
      shiftIndexes.some((index) => keyEquals(index, { worker: 1, dayOfWeek: 1 }) && index.unique === true),
      false,
    );

    assert.ok(blockIndexes.some((index) => keyEquals(index, { business: 1, worker: 1, date: 1 })));

    const appointmentTenant = appointmentIndexes.find((index) =>
      keyEquals(index, { business: 1, worker: 1, date: 1, startTime: 1 })
    );
    assert.equal(appointmentTenant?.unique, true);
    assert.deepEqual(
      appointmentTenant?.partialFilterExpression,
      { status: { $in: ["pending_payment", "pending", "confirmed", "completed"] } },
    );
    assert.equal(
      appointmentIndexes.some((index) =>
        keyEquals(index, { worker: 1, date: 1, startTime: 1 }) && index.unique === true
      ),
      false,
    );
  });
});

test.after(async () => {
  await Membership.findByIdAndDelete(membershipB._id).catch(() => {});
  await teardown(server, sessionStore);
});
