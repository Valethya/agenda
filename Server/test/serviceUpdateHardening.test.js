import "./setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import app, { sessionStore } from "../src/app.js";
import { connectDB } from "../src/db/db.js";
import { seedTestData, cleanTestData, teardown } from "./fixtures.js";
import User from "../src/db/models/user.model.js";
import Membership from "../src/db/models/membership.model.js";
import Service from "../src/db/models/service.model.js";
import { createHash } from "../src/utils/password.js";
import * as serviceService from "../src/services/service.service.js";

await connectDB();
await cleanTestData();
const seed = await seedTestData();
const server = app.listen(0);
const baseUrl = `http://localhost:${server.address().port}/api`;

const request = (path, { method = "GET", cookie, body } = {}) => fetch(`${baseUrl}${path}`, {
  method,
  headers: {
    ...(cookie ? { Cookie: cookie } : {}),
    ...(body ? { "Content-Type": "application/json" } : {}),
  },
  ...(body ? { body: JSON.stringify(body) } : {}),
});

const login = async (email, password) => {
  const response = await request("/login", { method: "POST", body: { email, password } });
  assert.ok([200, 201].includes(response.status), `${email}: ${response.status}`);
  return response.headers.get("set-cookie");
};

const adminCookie = await login("test-admin@example.com", "passwordAdmin");
const originalServiceName = seed.service.name;
const canonicalCaseId = new mongoose.Types.ObjectId("abcdefabcdefabcdefabcdef");
const canonicalCaseHex = canonicalCaseId.toHexString();
const canonicalCaseUser = await User.create({
  _id: canonicalCaseId,
  firstName: "Case",
  lastName: "Professional",
  email: ["case-professional-624b@example.com"],
  phone: ["+56982220001"],
  password: await createHash("caseProfessional624B"),
  role: "worker",
  isActive: true,
});
await Membership.create({
  user: canonicalCaseUser._id,
  business: seed.business._id,
  role: "worker",
  isActive: true,
});

const noMembershipUser = await User.create({
  firstName: "No",
  lastName: "Membership Hardening",
  email: ["no-membership-hardening-624b@example.com"],
  phone: ["+56982220002"],
  password: await createHash("noMembershipHardening624B"),
  role: "user",
  isActive: true,
});

test("6.2.4-B Service update hardening", async (t) => {
  t.beforeEach(async () => {
    await Service.findByIdAndUpdate(seed.service._id, {
      $set: {
        name: originalServiceName,
        business: seed.business._id,
        workers: [seed.worker._id],
        isActive: true,
      },
    });
  });

  await t.test("business no puede mover un Service entre tenants", async () => {
    const response = await request(`/services/${seed.service._id}`, {
      method: "PUT",
      cookie: adminCookie,
      body: { business: seed.businessB._id.toString() },
    });
    assert.equal(response.status, 400);
    const persisted = await Service.findById(seed.service._id);
    assert.equal(persisted.business.toString(), seed.business._id.toString());
  });

  await t.test("Mongo update operators no atraviesan el boundary HTTP", async () => {
    const cases = [
      { body: { $set: { business: seed.businessB._id.toString() } } },
      { body: { $set: { workers: [seed.workerB._id.toString()] } } },
      { body: { $set: { workers: [noMembershipUser._id.toString()] } } },
      { body: { $unset: { business: "" } } },
      { body: { $inc: { price: 1 } } },
    ];

    for (const { body } of cases) {
      const response = await request(`/services/${seed.service._id}`, {
        method: "PUT",
        cookie: adminCookie,
        body,
      });
      assert.equal(response.status, 400, JSON.stringify(body));
    }

    const persisted = await Service.findById(seed.service._id);
    assert.equal(persisted.business.toString(), seed.business._id.toString());
    assert.deepEqual(persisted.workers.map(String), [seed.worker._id.toString()]);
  });

  await t.test("campo desconocido se rechaza y no produce modificación parcial", async () => {
    const response = await request(`/services/${seed.service._id}`, {
      method: "PUT",
      cookie: adminCookie,
      body: {
        name: "Nombre que no debe persistir 624B",
        unknownField: "forbidden",
      },
    });
    assert.equal(response.status, 400);

    const persisted = await Service.findById(seed.service._id);
    assert.equal(persisted.name, originalServiceName);
    assert.equal(persisted.business.toString(), seed.business._id.toString());
  });

  await t.test("service layer también rechaza campos fuera de allowlist sin depender de Zod", async () => {
    await assert.rejects(
      serviceService.updateService(
        seed.service._id,
        { name: "Direct unsafe update", business: seed.businessB._id },
        seed.business._id,
      ),
      /campos no permitidos/u,
    );

    const persisted = await Service.findById(seed.service._id);
    assert.equal(persisted.name, originalServiceName);
    assert.equal(persisted.business.toString(), seed.business._id.toString());
  });

  await t.test("update válido de workers sigue funcionando", async () => {
    const response = await request(`/services/${seed.service._id}`, {
      method: "PUT",
      cookie: adminCookie,
      body: { workers: [seed.admin._id.toString()] },
    });
    assert.equal(response.status, 200);

    const persisted = await Service.findById(seed.service._id);
    assert.deepEqual(persisted.workers.map(String), [seed.admin._id.toString()]);
    assert.equal(persisted.business.toString(), seed.business._id.toString());
  });

  await t.test("ObjectId equivalentes por casing se canonicalizan antes de detectar duplicados", async () => {
    const duplicateResponse = await request(`/services/${seed.service._id}`, {
      method: "PUT",
      cookie: adminCookie,
      body: { workers: [canonicalCaseHex, canonicalCaseHex.toUpperCase()] },
    });
    assert.equal(duplicateResponse.status, 400);

    const afterDuplicate = await Service.findById(seed.service._id);
    assert.deepEqual(afterDuplicate.workers.map(String), [seed.worker._id.toString()]);

    const canonicalResponse = await request(`/services/${seed.service._id}`, {
      method: "PUT",
      cookie: adminCookie,
      body: { workers: [canonicalCaseHex.toUpperCase()] },
    });
    assert.equal(canonicalResponse.status, 200);

    const persisted = await Service.findById(seed.service._id);
    assert.deepEqual(persisted.workers.map(String), [canonicalCaseHex]);
  });
});

test.after(async () => teardown(server, sessionStore));
