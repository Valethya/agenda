import './setup.js';
import test from "node:test";
import assert from "node:assert/strict";

process.env.FRONTEND_URL = "http://panel.example";
process.env.CORS_ORIGINS = "http://panel.example,http://public.example";

const [{ default: app, sessionStore }, { connectDB }, fixtures, { default: BusinessConfig }] = await Promise.all([
  import("../src/app.js"),
  import("../src/db/db.js"),
  import("./fixtures.js"),
  import("../src/db/models/businessConfig.model.js"),
]);

const { seedTestData, cleanTestData, teardown } = fixtures;

await connectDB();
await cleanTestData();
const seed = await seedTestData();

const server = app.listen(0);
const { port } = server.address();
const baseUrl = `http://localhost:${port}/api`;
const panelOrigin = "http://panel.example";
const publicOrigin = "http://public.example";
const availabilityDate = "2099-01-05";

const login = async (email, password) => {
  const response = await fetch(`${baseUrl}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: panelOrigin },
    body: JSON.stringify({ email, password }),
  });
  assert.ok(response.status === 200 || response.status === 201);
  return response.headers.get("set-cookie");
};

const getSettings = async (cookie) => {
  const response = await fetch(`${baseUrl}/business-settings`, {
    headers: { Cookie: cookie, Origin: panelOrigin },
  });
  assert.equal(response.status, 200);
  return { response, body: await response.json() };
};

const getSlotStarts = async () => {
  const response = await fetch(
    `${baseUrl}/availability/slots?businessId=${seed.business._id}&workerId=${seed.worker._id}&serviceId=${seed.service._id}&date=${availabilityDate}`,
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  return body.payload.map((slot) => slot.startTime);
};

const sortedKeys = (value) => Object.keys(value).sort();

test("6.2.6-A Business Settings boundary", async (t) => {
  await t.test("GET público/anónimo no expone BusinessConfig ni crea defaults", async () => {
    assert.equal(await BusinessConfig.countDocuments({ business: seed.business._id }), 0);

    const response = await fetch(`${baseUrl}/business-settings?businessId=${seed.business._id}`, {
      headers: { Origin: publicOrigin },
    });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("access-control-allow-origin"), publicOrigin);
    assert.equal(response.headers.get("access-control-allow-credentials"), null);
    assert.equal(await BusinessConfig.countDocuments({ business: seed.business._id }), 0);
  });

  await t.test("origin público permitido por CORS + cookie admin no puede provocar inicialización", async () => {
    const cookie = await login("test-admin@example.com", "passwordAdmin");
    assert.equal(await BusinessConfig.countDocuments({ business: seed.business._id }), 0);

    const response = await fetch(`${baseUrl}/business-settings`, {
      headers: {
        Cookie: cookie,
        Origin: publicOrigin,
      },
    });
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("access-control-allow-origin"), publicOrigin);
    assert.equal(response.headers.get("access-control-allow-credentials"), null);
    assert.equal(await BusinessConfig.countDocuments({ business: seed.business._id }), 0);
  });

  await t.test("slotDuration canónico y DTO permanecen estables antes/después de materializar config", async () => {
    const cookie = await login("test-admin@example.com", "passwordAdmin");
    assert.equal(await BusinessConfig.countDocuments({ business: seed.business._id }), 0);

    const before = await getSettings(cookie);
    assert.equal(before.response.headers.get("access-control-allow-credentials"), "true");
    assert.equal(before.body.status, "success");

    const beforePayload = before.body.payload;
    const expectedRootKeys = [
      "appointmentSettings",
      "business",
      "businessName",
      "cancellationSettings",
      "emailSettings",
      "paymentSettings",
      "uiSettings",
      "workingHours",
    ];
    assert.deepEqual(sortedKeys(beforePayload), expectedRootKeys);
    assert.deepEqual(sortedKeys(beforePayload.business), ["_id", "name", "slug"]);
    assert.equal(beforePayload.business._id, seed.business._id.toString());
    assert.equal(beforePayload.business.name, seed.business.name);
    assert.equal(beforePayload.business.slug, seed.business.slug);
    assert.equal(beforePayload.appointmentSettings.slotDuration, 60);
    assert.equal(await BusinessConfig.countDocuments({ business: seed.business._id }), 0);

    const slotsBefore = await getSlotStarts();
    assert.ok(slotsBefore.length > 2);
    assert.deepEqual(slotsBefore.slice(0, 4), ["09:00", "10:00", "11:00", "12:00"]);

    const putResponse = await fetch(`${baseUrl}/business-settings`, {
      method: "PUT",
      headers: {
        Cookie: cookie,
        Origin: panelOrigin,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        appointmentSettings: { bufferTime: 15 },
      }),
    });
    assert.equal(putResponse.status, 200);

    const persisted = await BusinessConfig.findOne({ business: seed.business._id });
    assert.ok(persisted);
    assert.equal(persisted.business.toString(), seed.business._id.toString());
    assert.equal(persisted.appointmentSettings.bufferTime, 15);
    assert.equal(persisted.appointmentSettings.slotDuration, 60);
    assert.equal(await BusinessConfig.countDocuments({ business: seed.business._id }), 1);

    const after = await getSettings(cookie);
    const afterPayload = after.body.payload;
    assert.deepEqual(sortedKeys(afterPayload), expectedRootKeys);
    assert.deepEqual(sortedKeys(afterPayload.business), ["_id", "name", "slug"]);
    assert.equal(afterPayload.business._id, seed.business._id.toString());
    assert.equal(afterPayload.business.name, beforePayload.business.name);
    assert.equal(afterPayload.business.slug, beforePayload.business.slug);
    assert.equal(afterPayload.appointmentSettings.slotDuration, beforePayload.appointmentSettings.slotDuration);
    assert.equal(afterPayload.appointmentSettings.bufferTime, 15);

    const slotsAfter = await getSlotStarts();
    assert.deepEqual(slotsAfter, slotsBefore);
  });
});

test.after(async () => {
  await teardown(server, sessionStore);
});
