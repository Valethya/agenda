import './setup.js';
import test from "node:test";
import assert from "node:assert/strict";

process.env.FRONTEND_URL = "http://panel.example";
process.env.CORS_ORIGINS = "http://panel.example,http://public.example";

const [
  { default: app, sessionStore },
  { connectDB },
  fixtures,
  { default: User },
  { default: Business },
  { default: Membership },
  passwordUtils,
] = await Promise.all([
  import("../src/app.js"),
  import("../src/db/db.js"),
  import("./fixtures.js"),
  import("../src/db/models/user.model.js"),
  import("../src/db/models/business.model.js"),
  import("../src/db/models/membership.model.js"),
  import("../src/utils/password.js"),
]);

const { seedTestData, cleanTestData, teardown } = fixtures;
const { createHash } = passwordUtils;

await connectDB();
await cleanTestData();
const seed = await seedTestData();

await Membership.create({
  user: seed.admin._id,
  business: seed.businessB._id,
  role: "admin",
  isActive: true,
});

await User.create({
  firstName: "Global",
  lastName: "Superadmin",
  email: ["superadmin-origin@example.com"],
  phone: ["+56977770000"],
  password: await createHash("passwordSuperadmin"),
  role: "superadmin",
  isActive: true,
});

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
  assert.equal(response.headers.get("access-control-allow-credentials"), "true");
  const cookie = response.headers.get("set-cookie");
  assert.ok(cookie);
  return cookie;
};

const request = (path, { cookie, origin = publicOrigin, method = "GET", body } = {}) => fetch(
  `${baseUrl}${path}`,
  {
    method,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(origin ? { Origin: origin } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    redirect: "manual",
  },
);

const readMe = async (cookie) => {
  const response = await request("/me", { cookie, origin: panelOrigin });
  assert.equal(response.status, 200);
  return (await response.json()).payload;
};

const assertPublicOriginBlocked = async (response) => {
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("access-control-allow-origin"), publicOrigin);
  assert.equal(response.headers.get("access-control-allow-credentials"), null);
};

test("6.2.6-A trusted authenticated origin boundary", async (t) => {
  const adminCookie = await login("test-admin@example.com", "passwordAdmin");
  const superadminCookie = await login("superadmin-origin@example.com", "passwordSuperadmin");

  await t.test("public origin + admin cookie no puede leer /me", async () => {
    await assertPublicOriginBlocked(await request("/me", { cookie: adminCookie }));
    const current = await readMe(adminCookie);
    assert.equal(current.id, seed.admin._id.toString());
  });

  await t.test("public origin + admin cookie no puede cambiar Business de sesión", async () => {
    const before = await readMe(adminCookie);
    assert.equal(before.businessId, seed.business._id.toString());

    await assertPublicOriginBlocked(await request("/switch-business", {
      cookie: adminCookie,
      method: "POST",
      body: { businessId: seed.businessB._id.toString() },
    }));

    const after = await readMe(adminCookie);
    assert.equal(after.businessId, seed.business._id.toString());
  });

  await t.test("public origin + admin cookie no puede destruir la sesión con logout", async () => {
    await assertPublicOriginBlocked(await request("/logout", {
      cookie: adminCookie,
      method: "POST",
    }));
    const after = await readMe(adminCookie);
    assert.equal(after.id, seed.admin._id.toString());
  });

  await t.test("public origin + superadmin cookie no obtiene businesses, metrics ni analytics", async () => {
    for (const path of ["/superadmin/businesses", "/superadmin/metrics", "/superadmin/analytics"]) {
      await assertPublicOriginBlocked(await request(path, { cookie: superadminCookie }));
    }
  });

  await t.test("public origin + superadmin cookie no crea, toggles ni impersona", async () => {
    const countBefore = await Business.countDocuments({});
    const activeBefore = (await Business.findById(seed.business._id)).isActive;

    await assertPublicOriginBlocked(await request("/superadmin/businesses", {
      cookie: superadminCookie,
      method: "POST",
      body: {
        name: "Blocked Origin Business",
        slug: "blocked-origin-business",
        ownerEmail: "blocked-owner@example.com",
        ownerPassword: "password123",
        ownerFirstName: "Blocked",
        ownerLastName: "Owner",
      },
    }));
    assert.equal(await Business.countDocuments({}), countBefore);

    await assertPublicOriginBlocked(await request(`/superadmin/businesses/${seed.business._id}/status`, {
      cookie: superadminCookie,
      method: "PATCH",
    }));
    assert.equal((await Business.findById(seed.business._id)).isActive, activeBefore);

    await assertPublicOriginBlocked(await request(`/superadmin/businesses/${seed.business._id}/impersonate`, {
      cookie: superadminCookie,
      method: "POST",
    }));
    const current = await readMe(superadminCookie);
    assert.equal(current.role, "superadmin");
    assert.equal(current.originalUser, null);
  });

  await t.test("trusted panel origin conserva operaciones legítimas de admin y superadmin", async () => {
    const switchToB = await request("/switch-business", {
      cookie: adminCookie,
      origin: panelOrigin,
      method: "POST",
      body: { businessId: seed.businessB._id.toString() },
    });
    assert.equal(switchToB.status, 200);
    assert.equal((await readMe(adminCookie)).businessId, seed.businessB._id.toString());

    const switchBack = await request("/switch-business", {
      cookie: adminCookie,
      origin: panelOrigin,
      method: "POST",
      body: { businessId: seed.business._id.toString() },
    });
    assert.equal(switchBack.status, 200);

    for (const path of ["/superadmin/businesses", "/superadmin/metrics", "/superadmin/analytics"]) {
      const response = await request(path, { cookie: superadminCookie, origin: panelOrigin });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("access-control-allow-credentials"), "true");
    }

    const createResponse = await request("/superadmin/businesses", {
      cookie: superadminCookie,
      origin: panelOrigin,
      method: "POST",
      body: {
        name: "Trusted Origin Business",
        slug: "trusted-origin-business",
        ownerEmail: "trusted-owner@example.com",
        ownerPassword: "password123",
        ownerFirstName: "Trusted",
        ownerLastName: "Owner",
      },
    });
    assert.equal(createResponse.status, 201);
    const createdPayload = (await createResponse.json()).payload;
    const createdId = createdPayload.business._id || createdPayload.business.id;
    assert.ok(createdId);

    const toggle = await request(`/superadmin/businesses/${createdId}/status`, {
      cookie: superadminCookie,
      origin: panelOrigin,
      method: "PATCH",
    });
    assert.equal(toggle.status, 200);
    assert.equal((await Business.findById(createdId)).isActive, false);

    const impersonate = await request(`/superadmin/businesses/${seed.business._id}/impersonate`, {
      cookie: superadminCookie,
      origin: panelOrigin,
      method: "POST",
    });
    assert.equal(impersonate.status, 200);
    const impersonated = await readMe(superadminCookie);
    assert.equal(impersonated.businessId, seed.business._id.toString());
    assert.ok(impersonated.originalUser);

    const stop = await request("/stop-impersonating", {
      cookie: superadminCookie,
      origin: panelOrigin,
      method: "POST",
    });
    assert.equal(stop.status, 200);
    const restored = await readMe(superadminCookie);
    assert.equal(restored.role, "superadmin");
  });
});

test.after(async () => {
  await teardown(server, sessionStore);
});
