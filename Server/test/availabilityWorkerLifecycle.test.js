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
});

await Shift.create({
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

test("6.2.3 worker availability lifecycle remains tenant-scoped", async (t) => {
  await t.test("soft delete only deactivates Membership and preserves Shift/Block", async () => {
    const shiftsABefore = await Shift.countDocuments({ business: seed.business._id, worker: seed.worker._id });
    await deleteWorker(seed.worker._id, seed.business._id, true);

    const inactiveA = await Membership.findById(membershipA._id);
    assert.equal(inactiveA?.isActive, false);
    assert.equal(
      await Shift.countDocuments({ business: seed.business._id, worker: seed.worker._id }),
      shiftsABefore,
    );
    assert.ok(await Block.findById(blockA._id));
    assert.ok(await Membership.findById(membershipB._id));
    assert.ok(await Block.findById(blockB._id));
  });

  await t.test("hard delete A removes only Shift/Block A and preserves B plus global User", async () => {
    await Membership.updateOne({ _id: membershipA._id }, { $set: { isActive: true } });
    const shiftB = await Shift.findOne({ business: seed.businessB._id, worker: seed.worker._id, dayOfWeek: 1 });
    assert.ok(shiftB);

    await deleteWorker(seed.worker._id, seed.business._id, false);

    assert.equal(await Membership.findById(membershipA._id), null);
    assert.equal(
      await Shift.countDocuments({ business: seed.business._id, worker: seed.worker._id }),
      0,
    );
    assert.equal(
      await Block.countDocuments({ business: seed.business._id, worker: seed.worker._id }),
      0,
    );

    const remainingMembershipB = await Membership.findById(membershipB._id);
    const remainingShiftB = await Shift.findById(shiftB._id);
    const remainingBlockB = await Block.findById(blockB._id);
    const globalUser = await User.findById(seed.worker._id);
    assert.equal(remainingMembershipB?.isActive, true);
    assert.ok(remainingShiftB);
    assert.ok(remainingBlockB);
    assert.equal(globalUser?.isActive, true);
  });
});

test.after(async () => {
  await teardown(null, null);
});
