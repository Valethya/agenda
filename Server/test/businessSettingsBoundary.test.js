import './setup.js';
import test from "node:test";
import assert from "node:assert/strict";
import app, { sessionStore } from "../src/app.js";
import { connectDB } from "../src/db/db.js";
import { seedTestData, cleanTestData, teardown } from "./fixtures.js";
import BusinessConfig from "../src/db/models/businessConfig.model.js";

await connectDB();
await cleanTestData();
const seed = await seedTestData();

const server = app.listen(0);
const { port } = server.address();
const baseUrl = `http://localhost:${port}/api`;

const login = async (email, password) => {
  const response = await fetch(`${baseUrl}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  assert.ok(response.status === 200 || response.status === 201);
  return response.headers.get("set-cookie");
};

test("6.2.6-A Business Settings boundary", async (t) => {
  await t.test("GET público/anónimo no expone BusinessConfig ni crea defaults", async () => {
    assert.equal(await BusinessConfig.countDocuments({ business: seed.business._id }), 0);

    const response = await fetch(`${baseUrl}/business-settings?businessId=${seed.business._id}`);
    assert.equal(response.status, 401);
    assert.equal(await BusinessConfig.countDocuments({ business: seed.business._id }), 0);
  });

  await t.test("origin público con cookie admin no puede provocar inicialización", async () => {
    const cookie = await login("test-admin@example.com", "passwordAdmin");
    assert.equal(await BusinessConfig.countDocuments({ business: seed.business._id }), 0);

    const response = await fetch(`${baseUrl}/business-settings`, {
      headers: {
        Cookie: cookie,
        Origin: "https://public-headless.example",
      },
    });
    assert.equal(response.status, 403);
    assert.equal(await BusinessConfig.countDocuments({ business: seed.business._id }), 0);
  });

  await t.test("Membership vigente puede cargar config interna y sólo entonces inicializar defaults", async () => {
    const cookie = await login("test-admin@example.com", "passwordAdmin");
    const response = await fetch(`${baseUrl}/business-settings`, {
      headers: { Cookie: cookie },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.status, "success");
    assert.equal(body.payload.business._id, seed.business._id.toString());
    assert.ok(body.payload.businessName);
    assert.equal(await BusinessConfig.countDocuments({ business: seed.business._id }), 1);
  });
});

test.after(async () => {
  await teardown(server, sessionStore);
});
