import "./setup.js";
import test from "node:test";
import assert from "node:assert/strict";

process.env.FRONTEND_URL = "http://panel.example";
process.env.CORS_ORIGINS = "http://panel.example";

const [
  { default: app, sessionStore },
  { connectDB },
  fixtures,
  { default: User },
  { default: Membership },
  { createHash },
] = await Promise.all([
  import("../src/app.js"),
  import("../src/db/db.js"),
  import("./fixtures.js"),
  import("../src/db/models/user.model.js"),
  import("../src/db/models/membership.model.js"),
  import("../src/utils/password.js"),
]);

const { seedTestData, cleanTestData, teardown } = fixtures;
await connectDB();
await cleanTestData();
await seedTestData();

const password = "super-no-membership";
const superadmin = await User.create({
  firstName: "Super",
  lastName: "NoMembership",
  email: [`super-no-membership-${Date.now()}@example.test`],
  phone: [],
  password: await createHash(password),
  role: "superadmin",
  isActive: true,
});
assert.equal(await Membership.countDocuments({ user: superadmin._id }), 0);

const server = app.listen(0);
const { port } = server.address();
const baseUrl = `http://127.0.0.1:${port}/api`;
const panelOrigin = "http://panel.example";

test("6.2.6-B superadmin global session without Membership admin is not tenant admin", async () => {
  const login = await fetch(`${baseUrl}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: panelOrigin },
    body: JSON.stringify({ email: superadmin.email[0], password }),
  });
  assert.ok([200, 201].includes(login.status), `superadmin login status inesperado: ${login.status}`);
  const cookie = login.headers.get("set-cookie");
  assert.ok(cookie);

  const denied = await fetch(`${baseUrl}/business-settings/public-web`, {
    method: "PUT",
    headers: {
      Cookie: cookie,
      Origin: panelOrigin,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      websiteUrl: "https://superadmin-is-not-tenant-admin.example.test",
      bookingUrl: "https://superadmin-is-not-tenant-admin.example.test/reservar",
    }),
  });
  assert.equal(denied.status, 403);
  assert.equal(await Membership.countDocuments({ user: superadmin._id }), 0);
});

test.after(async () => {
  await teardown(server, sessionStore);
});
