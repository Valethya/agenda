import './setup.js';
import test from "node:test";
import assert from "node:assert/strict";
import app, { sessionStore } from "../src/app.js";
import { connectDB } from "../src/db/db.js";
import { seedTestData, cleanTestData, teardown } from "./fixtures.js";
import Appointment from "../src/db/models/appointment.model.js";
import User from "../src/db/models/user.model.js";
import Membership from "../src/db/models/membership.model.js";
import { createHash } from "../src/utils/password.js";

await connectDB();
await cleanTestData();
const seed = await seedTestData();

const guestAppointment = await Appointment.create({
  client: null,
  worker: seed.worker._id,
  service: seed.service._id,
  business: seed.business._id,
  date: new Date("2099-03-02T00:00:00.000Z"),
  startTime: "10:00",
  endTime: "11:00",
  status: "pending",
  guestContact: {
    channel: "email",
    destination: "panel-guest@example.com",
    firstName: "Panel",
    lastName: "Guest",
    phone: "+56970000111",
    provenance: "guest-booking-input-v1",
    capturedAt: new Date("2099-02-28T12:00:00.000Z"),
  },
});

const unauthorizedPassword = await createHash("passwordUnauthorized");
const unauthorizedWorker = await User.create({
  firstName: "Worker",
  lastName: "NoAsignado",
  email: ["worker-no-asignado@example.com"],
  phone: ["+56970000112"],
  password: unauthorizedPassword,
  role: "worker",
  business: seed.business._id,
  isActive: true,
});
await Membership.create({
  user: unauthorizedWorker._id,
  business: seed.business._id,
  role: "worker",
  isActive: true,
});

const server = app.listen(0);
const { port } = server.address();
const baseUrl = `http://localhost:${port}/api`;
const panelOrigin = "http://localhost:4321";

const login = async (email, password) => {
  const response = await fetch(`${baseUrl}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  assert.ok(response.status === 200 || response.status === 201);
  return response.headers.get("set-cookie");
};

const panelHeaders = (cookie, slug = seed.business.slug) => ({
  Cookie: cookie,
  Origin: panelOrigin,
  // Igual que /admin?slug=...: el slug viaja como contexto, pero no selecciona surface.
  "x-business-slug": slug,
});

const assertGuestOperationalClient = (client) => {
  assert.deepEqual(client, {
    kind: "guest",
    firstName: "Panel",
    lastName: "Guest",
    email: "panel-guest@example.com",
    phone: "+56970000111",
  });
};

test("6.2.6-A panel surface compatibility y guest operational projection", async (t) => {
  const adminCookie = await login("test-admin@example.com", "passwordAdmin");

  await t.test("/admin?slug=A carga workers, services, appointments y shifts por rutas internas del servidor", async () => {
    const headers = panelHeaders(adminCookie);

    const workersResponse = await fetch(`${baseUrl}/internal/users/workers`, { headers });
    assert.equal(workersResponse.status, 200);
    const workersData = await workersResponse.json();
    assert.ok(workersData.payload.some((worker) => worker._id === seed.worker._id.toString()));
    const worker = workersData.payload.find((entry) => entry._id === seed.worker._id.toString());
    assert.ok(worker.email);
    assert.equal(worker.role, "worker");

    const servicesResponse = await fetch(`${baseUrl}/internal/services`, { headers });
    assert.equal(servicesResponse.status, 200);
    const servicesData = await servicesResponse.json();
    const service = servicesData.payload.find((entry) => entry._id === seed.service._id.toString());
    assert.ok(service);
    assert.ok(Array.isArray(service.workers));
    assert.equal(service.isActive, true);

    const appointmentsResponse = await fetch(`${baseUrl}/appointments/my`, { headers });
    assert.equal(appointmentsResponse.status, 200);
    const appointmentsData = await appointmentsResponse.json();
    const guest = appointmentsData.payload.find((entry) => entry._id === guestAppointment._id.toString());
    assert.ok(guest);
    assertGuestOperationalClient(guest.client);
    assert.ok(!("guestContact" in guest));
    assert.ok(!("provenance" in guest.client));
    assert.ok(!("capturedAt" in guest.client));

    const shiftsResponse = await fetch(`${baseUrl}/availability/shifts/${seed.worker._id}`, { headers });
    assert.equal(shiftsResponse.status, 200);
    const shiftsData = await shiftsResponse.json();
    assert.ok(shiftsData.payload.length > 0);
    assert.ok(shiftsData.payload.every((shift) => shift.business === seed.business._id.toString()));
  });

  await t.test("admin A ve contacto guest operacional sólo en Appointment A protegida", async () => {
    const response = await fetch(`${baseUrl}/appointments/${guestAppointment._id}`, {
      headers: panelHeaders(adminCookie),
    });
    assert.equal(response.status, 200);
    const data = await response.json();
    assertGuestOperationalClient(data.payload.client);
    assert.ok(!("guestContact" in data.payload));
  });

  await t.test("profesional asignado ve sólo contacto operacional necesario", async () => {
    const workerCookie = await login("test-worker@example.com", "passwordWorker");
    const response = await fetch(`${baseUrl}/appointments/${guestAppointment._id}`, {
      headers: panelHeaders(workerCookie),
    });
    assert.equal(response.status, 200);
    const data = await response.json();
    assertGuestOperationalClient(data.payload.client);
    assert.ok(!("guestContact" in data.payload));
  });

  await t.test("worker no asignado no adquiere acceso por guestContact", async () => {
    const cookie = await login("worker-no-asignado@example.com", "passwordUnauthorized");
    const detail = await fetch(`${baseUrl}/appointments/${guestAppointment._id}`, {
      headers: panelHeaders(cookie),
    });
    assert.equal(detail.status, 404);

    const mine = await fetch(`${baseUrl}/appointments/my`, { headers: panelHeaders(cookie) });
    assert.equal(mine.status, 200);
    const data = await mine.json();
    assert.ok(!data.payload.some((entry) => entry._id === guestAppointment._id.toString()));
  });

  await t.test("Business B no puede leer Appointment guest de A", async () => {
    const cookieB = await login("user-b@example.com", "passwordUserB");
    const response = await fetch(`${baseUrl}/appointments/${guestAppointment._id}`, {
      headers: panelHeaders(cookieB, seed.businessB.slug),
    });
    assert.equal(response.status, 404);
  });
});

test.after(async () => {
  await teardown(server, sessionStore);
});
