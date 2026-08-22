import './setup.js';
import test from "node:test";
import assert from "node:assert/strict";

// Debe configurarse antes de importar app/config: el origin público está permitido
// por CORS, pero no pertenece a la surface administrativa del panel.
process.env.FRONTEND_URL = "http://panel.example";
process.env.CORS_ORIGINS = "http://panel.example,http://public.example";

const [{ default: app, sessionStore }, { connectDB }, fixtures, models] = await Promise.all([
  import("../src/app.js"),
  import("../src/db/db.js"),
  import("./fixtures.js"),
  Promise.all([
    import("../src/db/models/appointment.model.js"),
    import("../src/db/models/membership.model.js"),
    import("../src/db/models/user.model.js"),
    import("../src/db/models/business.model.js"),
  ]),
]);

const { seedTestData, cleanTestData, teardown } = fixtures;
const [AppointmentModule, MembershipModule, UserModule, BusinessModule] = models;
const Appointment = AppointmentModule.default;
const Membership = MembershipModule.default;
const User = UserModule.default;
const Business = BusinessModule.default;

await connectDB();
await cleanTestData();
const seed = await seedTestData();

const server = app.listen(0);
const { port } = server.address();
const baseUrl = `http://localhost:${port}/api`;
const panelOrigin = "http://panel.example";
const publicOrigin = "http://public.example";

const loginAdmin = async () => {
  const response = await fetch(`${baseUrl}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: panelOrigin },
    body: JSON.stringify({ email: "test-admin@example.com", password: "passwordAdmin" }),
  });
  assert.ok(response.status === 200 || response.status === 201);
  return response.headers.get("set-cookie");
};

const publicHeaders = (cookie, extras = {}) => ({
  Cookie: cookie,
  Origin: publicOrigin,
  // Deliberadamente malicioso: el servidor debe ignorarlo como frontera de trust.
  "x-agenda-surface": "internal",
  ...extras,
});

const panelHeaders = (cookie, extras = {}) => ({
  Cookie: cookie,
  Origin: panelOrigin,
  "x-business-slug": seed.business.slug,
  ...extras,
});

const assertPublicService = (service) => {
  assert.deepEqual(
    Object.keys(service).sort(),
    ["business", "depositAmount", "description", "duration", "id", "name", "price"],
  );
  for (const forbidden of ["workers", "isActive", "createdAt", "updatedAt"]) {
    assert.ok(!(forbidden in service));
  }
};

const assertPublicWorker = (worker) => {
  assert.deepEqual(Object.keys(worker).sort(), ["firstName", "id", "lastName"]);
  for (const forbidden of ["email", "phone", "role", "business", "isActive"]) {
    assert.ok(!(forbidden in worker));
  }
};

const expectForbiddenInternalReads = async (cookie) => {
  const headers = panelHeaders(cookie);
  const responses = await Promise.all([
    fetch(`${baseUrl}/internal/services`, { headers }),
    fetch(`${baseUrl}/internal/users/workers`, { headers }),
    fetch(`${baseUrl}/appointments/my`, { headers }),
    fetch(`${baseUrl}/availability/shifts/${seed.worker._id}`, { headers }),
  ]);
  for (const response of responses) assert.equal(response.status, 403);
};

test("6.2.6-A internal surface server boundary y live Membership authority", async (t) => {
  const adminCookie = await loginAdmin();

  await t.test("origin público permitido + cookie + header internal sigue recibiendo Services públicos", async () => {
    const response = await fetch(`${baseUrl}/services?businessId=${seed.business._id}`, {
      headers: publicHeaders(adminCookie),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), publicOrigin);
    const data = await response.json();
    assert.ok(data.payload.length > 0);
    data.payload.forEach(assertPublicService);
  });

  await t.test("origin público permitido + cookie + header internal sigue recibiendo Workers públicos", async () => {
    const response = await fetch(
      `${baseUrl}/users/workers?businessId=${seed.business._id}&serviceId=${seed.service._id}`,
      { headers: publicHeaders(adminCookie) },
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), publicOrigin);
    const data = await response.json();
    assert.ok(data.payload.length > 0);
    data.payload.forEach(assertPublicWorker);
  });

  await t.test("origin público no puede activar schema interno de Appointment con isSuggestion", async () => {
    const before = await Appointment.countDocuments({});
    const response = await fetch(`${baseUrl}/appointments?businessId=${seed.business._id}`, {
      method: "POST",
      headers: publicHeaders(adminCookie, { "Content-Type": "application/json" }),
      body: JSON.stringify({
        worker: seed.worker._id.toString(),
        service: seed.service._id.toString(),
        date: "2099-05-05",
        startTime: "09:00",
        isSuggestion: true,
        clientInfo: {
          firstName: "Public",
          lastName: "Attacker",
          email: "surface-attacker@example.com",
          phone: "+56970000901",
        },
      }),
    });
    assert.equal(response.status, 400);
    const data = await response.json();
    assert.equal(data.code, "VALIDATION_ERROR");
    assert.equal(await Appointment.countDocuments({}), before);
    assert.equal(await User.findOne({ email: "surface-attacker@example.com" }), null);
  });

  await t.test("origin público no puede activar paymentOption del schema interno", async () => {
    const before = await Appointment.countDocuments({});
    const response = await fetch(`${baseUrl}/appointments?businessId=${seed.business._id}`, {
      method: "POST",
      headers: publicHeaders(adminCookie, { "Content-Type": "application/json" }),
      body: JSON.stringify({
        worker: seed.worker._id.toString(),
        service: seed.service._id.toString(),
        date: "2099-05-05",
        startTime: "10:00",
        paymentOption: "local",
        clientInfo: {
          firstName: "Public",
          lastName: "Attacker",
          email: "payment-knob-attacker@example.com",
          phone: "+56970000902",
        },
      }),
    });
    assert.equal(response.status, 400);
    const data = await response.json();
    assert.equal(data.code, "VALIDATION_ERROR");
    assert.equal(await Appointment.countDocuments({}), before);
  });

  await t.test("origin público permitido no puede entrar a mounts internos aunque declare internal", async () => {
    const headers = publicHeaders(adminCookie);
    const reads = await Promise.all([
      fetch(`${baseUrl}/internal/services`, { headers }),
      fetch(`${baseUrl}/internal/users/workers`, { headers }),
      fetch(`${baseUrl}/appointments/my`, { headers }),
      fetch(`${baseUrl}/availability/shifts/${seed.worker._id}`, { headers }),
    ]);

    for (const response of reads) {
      assert.equal(response.status, 403);
      assert.equal(response.headers.get("access-control-allow-origin"), publicOrigin);
    }

    const create = await fetch(`${baseUrl}/internal/appointments`, {
      method: "POST",
      headers: publicHeaders(adminCookie, { "Content-Type": "application/json" }),
      body: JSON.stringify({
        worker: seed.worker._id.toString(),
        service: seed.service._id.toString(),
        date: "2099-05-05",
        startTime: "11:00",
        isSuggestion: true,
        clientInfo: {
          firstName: "Blocked",
          lastName: "Internal",
          email: "blocked-internal@example.com",
          phone: "+56970000903",
        },
      }),
    });
    assert.equal(create.status, 403);
    assert.equal(create.headers.get("access-control-allow-origin"), publicOrigin);
  });

  await t.test("panel de origen confiable conserva workers, services, appointments y shifts", async () => {
    const headers = panelHeaders(adminCookie);
    const workers = await fetch(`${baseUrl}/internal/users/workers`, { headers });
    const services = await fetch(`${baseUrl}/internal/services`, { headers });
    const appointments = await fetch(`${baseUrl}/appointments/my`, { headers });
    const shifts = await fetch(`${baseUrl}/availability/shifts/${seed.worker._id}`, { headers });

    assert.equal(workers.status, 200);
    assert.equal(services.status, 200);
    assert.equal(appointments.status, 200);
    assert.equal(shifts.status, 200);

    const workersData = await workers.json();
    assert.ok(workersData.payload.some((worker) => worker.email));
    const servicesData = await services.json();
    assert.ok(servicesData.payload.some((service) => Array.isArray(service.workers)));
  });

  await t.test("revocar Membership después de login bloquea toda surface interna inmediatamente", async () => {
    const membership = await Membership.findOne({ user: seed.admin._id, business: seed.business._id });
    assert.ok(membership);
    await Membership.updateOne({ _id: membership._id }, { $set: { isActive: false } });
    try {
      await expectForbiddenInternalReads(adminCookie);
      const publicResponse = await fetch(`${baseUrl}/services?businessId=${seed.business._id}`, {
        headers: publicHeaders(adminCookie),
      });
      assert.equal(publicResponse.status, 200);
    } finally {
      await Membership.updateOne({ _id: membership._id }, { $set: { isActive: true } });
    }
  });

  await t.test("User desactivado después de login no conserva authority interna", async () => {
    await User.updateOne({ _id: seed.admin._id }, { $set: { isActive: false } });
    try {
      await expectForbiddenInternalReads(adminCookie);
    } finally {
      await User.updateOne({ _id: seed.admin._id }, { $set: { isActive: true } });
    }
  });

  await t.test("Business desactivado después de login no conserva authority interna", async () => {
    await Business.updateOne({ _id: seed.business._id }, { $set: { isActive: false } });
    try {
      await expectForbiddenInternalReads(adminCookie);
    } finally {
      await Business.updateOne({ _id: seed.business._id }, { $set: { isActive: true } });
    }
  });

  await t.test("rol Membership inválido no se convierte en authority por datos legacy de User", async () => {
    const membership = await Membership.findOne({ user: seed.admin._id, business: seed.business._id });
    assert.ok(membership);
    await Membership.collection.updateOne({ _id: membership._id }, { $set: { role: "legacy-admin" } });
    try {
      await expectForbiddenInternalReads(adminCookie);
    } finally {
      await Membership.collection.updateOne({ _id: membership._id }, { $set: { role: "admin" } });
    }
  });
});

test.after(async () => {
  await teardown(server, sessionStore);
});
