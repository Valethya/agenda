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

const login = async (email, password) => {
  const response = await fetch(`${baseUrl}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: panelOrigin },
    body: JSON.stringify({ email, password }),
  });
  assert.ok(response.status === 200 || response.status === 201);
  return response.headers.get("set-cookie");
};

test("6.2.6-A Business Settings boundary", async (t) => {
  await t.test("GET público/anónimo no expone BusinessConfig ni crea defaults", async () => {
    assert.equal(await BusinessConfig.countDocuments({ business: seed.business._id }), 0);

    const response = await fetch(`${baseUrl}/business-settings?businessId=${seed.business._id}`, {
      headers: { Origin: publicOrigin },
    });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("access-control-allow-origin"), publicOrigin);
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
    assert.equal(await BusinessConfig.countDocuments({ business: seed.business._id }), 0);
  });

  await t.test("Membership vigente desde origin del panel puede cargar config y sólo entonces inicializar defaults", async () => {
    const cookie = await login("test-admin@example.com", "passwordAdmin");
    const response = await fetch(`${baseUrl}/business-settings`, {
      headers: { Cookie: cookie, Origin: panelOrigin },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.status, "success");
    assert.ok(body.payload.businessName);

    const persisted = await BusinessConfig.findOne({ business: seed.business._id });
    assert.ok(persisted);
    assert.equal(persisted.business.toString(), seed.business._id.toString());
    assert.equal(await BusinessConfig.countDocuments({ business: seed.business._id }), 1);
  });
});

test.after(async () => {
  await teardown(server, sessionStore);
});
