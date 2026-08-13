import "./setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import app, { sessionStore } from "../src/app.js";
import { connectDB } from "../src/db/db.js";
import { seedTestData, cleanTestData, teardown } from "./fixtures.js";
import Service from "../src/db/models/service.model.js";
import Appointment from "../src/db/models/appointment.model.js";

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
  date: new Date("2099-10-01T00:00:00.000Z"),
  startTime: "10:00",
  endTime: "11:00",
  status: "pending",
  ...overrides,
});

const adminCookie = await login("test-admin@example.com", "passwordAdmin");
const workerCookie = await login("test-worker@example.com", "passwordWorker");

test("6.2.4-B Appointment/Service tenant coherence fail-closed", async (t) => {
  const foreignService = await Service.create({
    name: "FOREIGN_SERVICE_SECRET_624B",
    description: "foreign tenant service that must never leak",
    duration: 47,
    price: 987654,
    depositAmount: 321,
    business: seed.businessB._id,
    workers: [seed.workerB._id],
    isActive: true,
  });

  const corrupt = await makeAppointment({ service: foreignService._id });

  await t.test("Admin A detail/timeline fallan 404 sin exponer Service B", async () => {
    const detail = await request(`/appointments/${corrupt._id}`, { cookie: adminCookie });
    assert.equal(detail.status, 404);
    const detailBody = await detail.text();
    assert.doesNotMatch(detailBody, /FOREIGN_SERVICE_SECRET_624B/u);
    assert.doesNotMatch(detailBody, /987654/u);
    assert.doesNotMatch(detailBody, /321/u);

    const timeline = await request(`/appointments/${corrupt._id}/timeline`, { cookie: adminCookie });
    assert.equal(timeline.status, 404);
    const timelineBody = await timeline.text();
    assert.doesNotMatch(timelineBody, /FOREIGN_SERVICE_SECRET_624B/u);
  });

  await t.test("Admin A no puede transicionar un Appointment incoherente y status permanece intacto", async () => {
    for (const action of ["confirm", "complete", "cancel"]) {
      const response = await request(`/appointments/${corrupt._id}/${action}`, {
        method: "PATCH",
        cookie: adminCookie,
      });
      assert.equal(response.status, 404, action);
      assert.equal((await Appointment.findById(corrupt._id)).status, "pending", action);
    }
  });

  await t.test("profesional A tampoco puede operar el recurso incoherente", async () => {
    assert.equal((await request(`/appointments/${corrupt._id}`, { cookie: workerCookie })).status, 404);
    assert.equal((await request(`/appointments/${corrupt._id}/cancel`, {
      method: "PATCH",
      cookie: workerCookie,
    })).status, 404);
    assert.equal((await Appointment.findById(corrupt._id)).status, "pending");
  });

  await t.test("/appointments/my omite incoherentes y no serializa datos de Service B", async () => {
    const valid = await makeAppointment({ startTime: "12:00", endTime: "13:00" });
    const response = await request("/appointments/my", { cookie: adminCookie });
    assert.equal(response.status, 200);
    const body = await response.json();
    const ids = body.payload.map((appointment) => appointment._id);
    assert.ok(ids.includes(valid._id.toString()));
    assert.ok(!ids.includes(corrupt._id.toString()));

    const serialized = JSON.stringify(body);
    assert.doesNotMatch(serialized, /FOREIGN_SERVICE_SECRET_624B/u);
    assert.doesNotMatch(serialized, /987654/u);
  });

  await t.test("Service válido del mismo tenant sigue accesible aunque esté inactivo", async () => {
    const inactiveService = await Service.create({
      name: "Inactive Same Tenant 624B",
      duration: 30,
      price: 1000,
      depositAmount: 0,
      business: seed.business._id,
      workers: [seed.worker._id],
      isActive: false,
    });
    const historical = await makeAppointment({
      service: inactiveService._id,
      startTime: "14:00",
      endTime: "14:30",
    });

    const detail = await request(`/appointments/${historical._id}`, { cookie: adminCookie });
    assert.equal(detail.status, 200);
    const payload = (await detail.json()).payload;
    assert.equal(payload.service._id, inactiveService._id.toString());
    assert.equal(payload.service.name, "Inactive Same Tenant 624B");
  });

  await t.test("Service inexistente también falla closed antes de CAS", async () => {
    const removableService = await Service.create({
      name: "Removed Same Tenant 624B",
      duration: 30,
      price: 1000,
      depositAmount: 0,
      business: seed.business._id,
      workers: [seed.worker._id],
      isActive: true,
    });
    const orphaned = await makeAppointment({
      service: removableService._id,
      startTime: "15:00",
      endTime: "15:30",
    });
    await Service.deleteOne({ _id: removableService._id });

    assert.equal((await request(`/appointments/${orphaned._id}`, { cookie: adminCookie })).status, 404);
    assert.equal((await request(`/appointments/${orphaned._id}/confirm`, {
      method: "PATCH",
      cookie: adminCookie,
    })).status, 404);
    assert.equal((await Appointment.findById(orphaned._id)).status, "pending");
  });
});

test.after(async () => teardown(server, sessionStore));
