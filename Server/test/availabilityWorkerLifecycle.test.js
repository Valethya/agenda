import "./setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import { connectDB } from "../src/db/db.js";
import { cleanTestData, seedTestData, teardown } from "./fixtures.js";
import Membership from "../src/db/models/membership.model.js";
import Shift from "../src/db/models/shift.model.js";
import Block from "../src/db/models/block.model.js";
import User from "../src/db/models/user.model.js";
import { deleteWorker } from "../src/services/user.service.js";

await connectDB();
await cleanTestData();
const seed = await seedTestData();

const membershipA = await Membership.findOne({
  user: seed.worker._id,
  business: seed.business._id,
  role: "worker",
});
const membershipB = await Membership.create({
  user: seed.worker._id,
  business: seed.businessB._id,
  role: "worker",
  isActive: true,
  isBookable: true,
});

const shiftB = await Shift.create({
  business: seed.businessB._id,
  worker: seed.worker._id,
  dayOfWeek: 1,
  isOpen: true,
  startTime: "14:00",
  endTime: "20:00",
  breaks: [],
});
const blockA = await Block.create({
  business: seed.business._id,
  worker: seed.worker._id,
  date: new Date("2099-02-01T00:00:00.000Z"),
  startTime: "10:00",
  endTime: "11:00",
  reason: "A",
});
const blockB = await Block.create({
  business: seed.businessB._id,
  worker: seed.worker._id,
  date: new Date("2099-02-01T00:00:00.000Z"),
  startTime: "10:00",
  endTime: "11:00",
  reason: "B",
});

test("A+A2 legacy worker lifecycle is closed without weakening tenant isolation", async (t) => {
  await t.test("legacy delete rejects and mutates neither Membership nor availability resources", async () => {
    const shiftsABefore = await Shift.countDocuments({
      business: seed.business._id,
      worker: seed.worker._id,
    });
    const shiftsBBefore = await Shift.countDocuments({
      business: seed.businessB._id,
      worker: seed.worker._id,
    });

    await assert.rejects(
      deleteWorker(seed.worker._id, seed.business._id, true),
      (error) => error?.statusCode === 409 && error?.code === "CONFLICT_ERROR",
    );
    await assert.rejects(
      deleteWorker(seed.worker._id, seed.business._id, false),
      (error) => error?.statusCode === 409 && error?.code === "CONFLICT_ERROR",
    );

    const unchangedA = await Membership.findById(membershipA._id);
    const unchangedB = await Membership.findById(membershipB._id);
    const globalUser = await User.findById(seed.worker._id);

    assert.equal(unchangedA?.isActive, true);
    assert.equal(unchangedB?.isActive, true);
    assert.equal(globalUser?.isActive, true);
    assert.equal(
      await Shift.countDocuments({ business: seed.business._id, worker: seed.worker._id }),
      shiftsABefore,
    );
    assert.equal(
      await Shift.countDocuments({ business: seed.businessB._id, worker: seed.worker._id }),
      shiftsBBefore,
    );
    assert.ok(await Shift.findById(shiftB._id));
    assert.ok(await Block.findById(blockA._id));
    assert.ok(await Block.findById(blockB._id));
  });

  await t.test("controlled tenant-scoped setup changes A without changing B", async () => {
    await Membership.updateOne(
      { _id: membershipA._id, business: seed.business._id },
      { $set: { isActive: false, isBookable: false } },
    );

    const inactiveA = await Membership.findById(membershipA._id);
    const activeB = await Membership.findById(membershipB._id);

    assert.equal(inactiveA?.isActive, false);
    assert.equal(inactiveA?.isBookable, false);
    assert.equal(activeB?.isActive, true);
    assert.equal(activeB?.isBookable, true);
    assert.ok(await Shift.findById(shiftB._id));
    assert.ok(await Block.findById(blockA._id));
    assert.ok(await Block.findById(blockB._id));
  });
});

test.after(async () => {
  await teardown(null, null);
});
