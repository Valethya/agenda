import "./setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import app, { sessionStore } from "../src/app.js";
import { connectDB } from "../src/db/db.js";
import { seedTestData, cleanTestData, teardown } from "./fixtures.js";
import User from "../src/db/models/user.model.js";
import Membership from "../src/db/models/membership.model.js";
import Shift from "../src/db/models/shift.model.js";
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

const json = async (response) => {
  const text = await response.text();
  return text ? JSON.parse(text) : null;
};

const login = async (email, password) => {
  const response = await request("/login", { method: "POST", body: { email, password } });
  return { response, payload: await json(response), cookie: response.headers.get("set-cookie") };
};

const adminA = await login("test-admin@example.com", "passwordAdmin");
const adminB = await login("user-b@example.com", "passwordUserB");
const workerA = await login("test-worker@example.com", "passwordWorker");
assert.equal(adminA.response.status, 200);
assert.equal(adminB.response.status, 200);
assert.equal(workerA.response.status, 200);

const otherWorker = await User.create({
  firstName: "Otra",
  lastName: "Profesional",
  email: ["other-worker@example.com"],
  phone: ["+56977777777"],
  password: await createHash("passwordOtherWorker"),
  role: "worker",
  business: seed.business._id,
  isActive: true,
});
await Membership.create({
  user: otherWorker._id,
  business: seed.business._id,
  role: "worker",
  isBookable: true,
  isActive: true,
});

const postShift = (cookie, body) => request("/availability/shifts", {
  method: "POST",
  cookie,
  body,
});

const validTuesday = (workerId, overrides = {}) => ({
  workerId: workerId.toString(),
  dayOfWeek: 2,
  isOpen: true,
  startTime: "09:00",
  endTime: "18:00",
  breaks: [{ startTime: "13:00", endTime: "14:00" }],
  ...overrides,
});

const slotsForMonday = async () => {
  const response = await request(
    `/availability/slots?workerId=${seed.worker._id}&serviceId=${seed.service._id}&date=2099-04-06&slug=${seed.business.slug}`,
  );
  assert.equal(response.status, 200);
  return (await json(response)).payload;
};

const slotAt = (slots, startTime) => slots.find((slot) => slot.startTime === startTime);

test("F admin availability schedule hardening", async (t) => {
  await t.test("admin tenant reads and writes an eligible professional in its Business", async () => {
    const read = await request(`/availability/shifts/${seed.worker._id}`, { cookie: adminA.cookie });
    assert.equal(read.status, 200);
    const readPayload = (await json(read)).payload;
    assert.ok(readPayload.length >= 5);
    assert.ok(readPayload.every((shift) => shift.business === seed.business._id.toString()));

    const write = await postShift(adminA.cookie, validTuesday(seed.worker._id, {
      startTime: "10:00",
      endTime: "17:00",
      breaks: [{ startTime: "12:00", endTime: "12:30" }],
    }));
    assert.equal(write.status, 200);
    const saved = (await json(write)).payload;
    assert.equal(saved.business, seed.business._id.toString());
    assert.equal(saved.worker, seed.worker._id.toString());
    assert.equal(saved.startTime, "10:00");
  });

  await t.test("cross-tenant read and write fail closed", async () => {
    const read = await request(`/availability/shifts/${seed.workerB._id}`, { cookie: adminA.cookie });
    assert.equal(read.status, 404);

    const write = await postShift(adminA.cookie, validTuesday(seed.workerB._id));
    assert.equal(write.status, 404);
    assert.equal(
      await Shift.exists({ business: seed.business._id, worker: seed.workerB._id, dayOfWeek: 2 }),
      null,
    );
  });

  await t.test("worker can write its own schedule but cannot write another worker schedule", async () => {
    const own = await postShift(workerA.cookie, validTuesday(seed.worker._id, { dayOfWeek: 3 }));
    assert.equal(own.status, 200);

    const other = await postShift(workerA.cookie, validTuesday(otherWorker._id, { dayOfWeek: 3 }));
    assert.equal(other.status, 403);
  });

  await t.test("bookability comes only from active Membership, not User.role", async () => {
    const adminMembership = await Membership.findOne({ user: seed.admin._id, business: seed.business._id });
    assert.equal(adminMembership.role, "admin");
    assert.equal(adminMembership.isBookable, false);

    const roleOnly = await postShift(adminA.cookie, validTuesday(seed.admin._id, { dayOfWeek: 4 }));
    assert.equal(roleOnly.status, 404);

    adminMembership.isBookable = true;
    await adminMembership.save();
    const adminBookable = await postShift(adminA.cookie, validTuesday(seed.admin._id, { dayOfWeek: 4 }));
    assert.equal(adminBookable.status, 200);
    adminMembership.isBookable = false;
    await adminMembership.save();

    const workerMembership = await Membership.findOne({ user: seed.worker._id, business: seed.business._id });
    workerMembership.isActive = false;
    await workerMembership.save();
    const inactive = await postShift(adminA.cookie, validTuesday(seed.worker._id, { dayOfWeek: 5 }));
    assert.equal(inactive.status, 404);
    workerMembership.isActive = true;
    await workerMembership.save();
  });

  await t.test("client cannot inject tenant authority, arbitrary fields or Mongo operators", async () => {
    const foreignBusiness = await postShift(adminA.cookie, {
      ...validTuesday(seed.worker._id),
      business: seed.businessB._id.toString(),
    });
    assert.equal(foreignBusiness.status, 400);

    const unknown = await postShift(adminA.cookie, {
      ...validTuesday(seed.worker._id),
      membershipId: new User()._id.toString(),
    });
    assert.equal(unknown.status, 400);

    const operator = await postShift(adminA.cookie, {
      ...validTuesday(seed.worker._id),
      $set: { business: seed.businessB._id.toString() },
    });
    assert.equal(operator.status, 400);

    assert.equal(
      await Shift.exists({ business: seed.businessB._id, worker: seed.worker._id, dayOfWeek: 2 }),
      null,
    );
  });

  await t.test("day and real HH:MM formats are enforced", async () => {
    for (const dayOfWeek of [-1, 7]) {
      const response = await postShift(adminA.cookie, validTuesday(seed.worker._id, { dayOfWeek }));
      assert.equal(response.status, 400);
    }
    for (const startTime of ["25:00", "99:99", "12:72"]) {
      const response = await postShift(adminA.cookie, validTuesday(seed.worker._id, { startTime }));
      assert.equal(response.status, 400);
    }
  });

  await t.test("open shifts reject inverted/equal hours and invalid breaks", async () => {
    for (const [startTime, endTime] of [["18:00", "09:00"], ["09:00", "09:00"]]) {
      const response = await postShift(adminA.cookie, validTuesday(seed.worker._id, { startTime, endTime }));
      assert.equal(response.status, 400);
    }

    const outside = await postShift(adminA.cookie, validTuesday(seed.worker._id, {
      breaks: [{ startTime: "08:30", endTime: "09:30" }],
    }));
    assert.equal(outside.status, 400);

    const invertedBreak = await postShift(adminA.cookie, validTuesday(seed.worker._id, {
      breaks: [{ startTime: "13:00", endTime: "13:00" }],
    }));
    assert.equal(invertedBreak.status, 400);

    const overlap = await postShift(adminA.cookie, validTuesday(seed.worker._id, {
      breaks: [
        { startTime: "12:00", endTime: "13:30" },
        { startTime: "13:00", endTime: "14:00" },
      ],
    }));
    assert.equal(overlap.status, 400);
  });

  await t.test("partial updates validate the resulting persisted state", async () => {
    await postShift(adminA.cookie, validTuesday(seed.worker._id, {
      dayOfWeek: 6,
      startTime: "09:00",
      endTime: "18:00",
      breaks: [],
    }));
    const invalidPartial = await postShift(adminA.cookie, {
      workerId: seed.worker._id.toString(),
      dayOfWeek: 6,
      startTime: "20:00",
    });
    assert.equal(invalidPartial.status, 400);
    const persisted = await Shift.findOne({
      business: seed.business._id,
      worker: seed.worker._id,
      dayOfWeek: 6,
    });
    assert.equal(persisted.startTime, "09:00");
    assert.equal(persisted.endTime, "18:00");
  });

  await t.test("closed day yields no available slots and reopening uses breaks immediately", async () => {
    const closed = await postShift(adminA.cookie, {
      workerId: seed.worker._id.toString(),
      dayOfWeek: 1,
      isOpen: false,
    });
    assert.equal(closed.status, 200);
    let slots = await slotsForMonday();
    assert.ok(slots.length > 0);
    assert.ok(slots.every((slot) => slot.available === false));

    const reopened = await postShift(adminA.cookie, validTuesday(seed.worker._id, {
      dayOfWeek: 1,
      startTime: "09:00",
      endTime: "18:00",
      breaks: [{ startTime: "13:00", endTime: "14:00" }],
    }));
    assert.equal(reopened.status, 200);
    slots = await slotsForMonday();
    assert.equal(slotAt(slots, "13:00")?.available, false);
    assert.equal(slotAt(slots, "12:00")?.available, true);
  });

  await t.test("foreign-Business Shift never changes current tenant availability", async () => {
    await Shift.findOneAndUpdate(
      { business: seed.businessB._id, worker: seed.worker._id, dayOfWeek: 1 },
      {
        $set: {
          business: seed.businessB._id,
          worker: seed.worker._id,
          dayOfWeek: 1,
          isOpen: false,
          startTime: "09:00",
          endTime: "18:00",
          breaks: [],
        },
      },
      { upsert: true, new: true },
    );

    const slots = await slotsForMonday();
    assert.equal(slotAt(slots, "12:00")?.available, true);
  });
});

test.after(async () => {
  await teardown(server, sessionStore);
});
