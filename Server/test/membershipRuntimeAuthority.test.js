import "./setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import app, { sessionStore } from "../src/app.js";
import { connectDB } from "../src/db/db.js";
import { seedTestData, cleanTestData, teardown } from "./fixtures.js";
import User from "../src/db/models/user.model.js";
import Membership from "../src/db/models/membership.model.js";
import { createHash } from "../src/utils/password.js";

await connectDB();
await cleanTestData();
const seed = await seedTestData();
const server = app.listen(0);
const { port } = server.address();
const baseUrl = `http://localhost:${port}/api`;

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
  const payload = await response.json();
  return { response, payload, cookie: response.headers.get("set-cookie") };
};

const adminMembership = async () => Membership.findOne({ user: seed.admin._id, business: seed.business._id });

test("6.2.2-D runtime Membership authority", async (t) => {
  await t.test("Membership admin activa permite una operación admin", async () => {
    const { cookie } = await login("test-admin@example.com", "passwordAdmin");
    const response = await request("/business-settings/metrics", { cookie });
    assert.equal(response.status, 200);
  });

  await t.test("revocar Membership después del login deniega inmediatamente", async () => {
    const { cookie } = await login("test-admin@example.com", "passwordAdmin");
    const membership = await adminMembership();
    membership.isActive = false;
    await membership.save();

    try {
      const protectedResponse = await request("/business-settings/metrics", { cookie });
      assert.equal(protectedResponse.status, 403);

      const meResponse = await request("/me", { cookie });
      assert.equal(meResponse.status, 401);
    } finally {
      membership.isActive = true;
      await membership.save();
    }
  });

  await t.test("User.role=admin sin Membership no concede sesión tenant", async () => {
    const password = await createHash("legacyOnlyPassword");
    await User.create({
      firstName: "Legacy",
      lastName: "Admin",
      email: ["legacy-admin-no-membership@example.com"],
      password,
      role: "admin",
      business: seed.business._id,
      isActive: true,
    });

    const { response } = await login("legacy-admin-no-membership@example.com", "legacyOnlyPassword");
    assert.equal(response.status, 401);
  });

  await t.test("Membership admin prevalece sobre User.role worker", async () => {
    await User.findByIdAndUpdate(seed.admin._id, { role: "worker" });
    try {
      const { cookie } = await login("test-admin@example.com", "passwordAdmin");
      const response = await request("/business-settings/metrics", { cookie });
      assert.equal(response.status, 200);
    } finally {
      await User.findByIdAndUpdate(seed.admin._id, { role: "admin" });
    }
  });

  await t.test("cambiar Membership admin a worker invalida el admin copiado en sesión", async () => {
    const { cookie } = await login("test-admin@example.com", "passwordAdmin");
    const membership = await adminMembership();
    membership.role = "worker";
    await membership.save();

    try {
      const response = await request("/business-settings/metrics", { cookie });
      assert.equal(response.status, 403);

      const meResponse = await request("/me", { cookie });
      assert.equal(meResponse.status, 200);
      const me = await meResponse.json();
      assert.equal(me.payload.role, "worker");
    } finally {
      membership.role = "admin";
      await membership.save();
    }
  });

  await t.test("Membership de Business A no permite cambiar contexto a Business B", async () => {
    const { cookie } = await login("test-admin@example.com", "passwordAdmin");
    const response = await request("/switch-business", {
      method: "POST",
      cookie,
      body: { businessId: seed.businessB._id.toString() },
    });
    assert.equal(response.status, 401);
  });

  await t.test("selección temporal vuelve a consultar Membership activa", async () => {
    const password = await createHash("multiMembershipPassword");
    const multi = await User.create({
      firstName: "Multi",
      lastName: "Tenant",
      email: ["multi-membership@example.com"],
      password,
      role: "admin",
      isActive: true,
    });
    const membershipA = await Membership.create({ user: multi._id, business: seed.business._id, role: "admin", isActive: true });
    const membershipB = await Membership.create({ user: multi._id, business: seed.businessB._id, role: "worker", isActive: true });

    const { response, payload, cookie } = await login("multi-membership@example.com", "multiMembershipPassword");
    assert.equal(response.status, 200);
    assert.equal(payload.status, "needs_selection");

    membershipB.isActive = false;
    await membershipB.save();
    const selectResponse = await request("/select-membership", {
      method: "POST",
      cookie,
      body: { membershipId: membershipB._id.toString() },
    });
    assert.equal(selectResponse.status, 401);

    await Membership.deleteMany({ _id: { $in: [membershipA._id, membershipB._id] } });
    await User.findByIdAndDelete(multi._id);
  });

  await t.test("superadmin selecciona contexto sin adquirir admin tenant", async () => {
    const password = await createHash("superadminPassword");
    const superadmin = await User.create({
      firstName: "Super",
      lastName: "Admin",
      email: ["runtime-superadmin@example.com"],
      password,
      role: "superadmin",
      isActive: true,
    });

    const { cookie } = await login("runtime-superadmin@example.com", "superadminPassword");
    const switchResponse = await request("/switch-business", {
      method: "POST",
      cookie,
      body: { businessId: seed.business._id.toString() },
    });
    assert.equal(switchResponse.status, 200);

    const tenantResponse = await request("/business-settings/metrics", { cookie });
    assert.equal(tenantResponse.status, 403);

    const membership = await Membership.create({
      user: superadmin._id,
      business: seed.business._id,
      role: "admin",
      isActive: true,
    });
    try {
      const withMembership = await request("/business-settings/metrics", { cookie });
      assert.equal(withMembership.status, 200);
    } finally {
      await Membership.findByIdAndDelete(membership._id);
      await User.findByIdAndDelete(superadmin._id);
    }
  });

  await t.test("Membership rechaza el rol de plataforma superadmin", async () => {
    await assert.rejects(
      Membership.create({
        user: seed.admin._id,
        business: seed.businessB._id,
        role: "superadmin",
        isActive: true,
      }),
      /superadmin|enum/u,
    );
  });
});

test.after(async () => {
  await teardown(server, sessionStore);
});
