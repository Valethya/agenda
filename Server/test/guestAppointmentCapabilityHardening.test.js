import "./setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { connectDB } from "../src/db/db.js";
import GuestAppointmentVerificationJob from "../src/db/models/guestAppointmentVerificationJob.model.js";
import GuestAppointmentIntakeBucket from "../src/db/models/guestAppointmentIntakeBucket.model.js";
import * as jobRepository from "../src/repositories/guestAppointmentVerificationJob.repository.js";

await connectDB();

const purpose = "appointment-read-bootstrap";
const action = "read";
const businessId = new mongoose.Types.ObjectId();
const cleanupAppointments = [];
const remember = (value) => {
  cleanupAppointments.push(value);
  return value;
};

const enqueue = (appointmentId, now, overrides = {}) => jobRepository.enqueueForScope({
  businessId,
  appointmentId,
  purpose,
  action,
  now,
  intakeWindowMs: 60_000,
  intakeMaxPerWindow: 3,
  intakeBucketRetentionMs: 120_000,
  ...overrides,
});

const bucketFor = async (now) => {
  const bucketStart = Math.floor(now.getTime() / 60_000) * 60_000;
  return GuestAppointmentIntakeBucket.findById(`guest-appointment-read:${bucketStart}`).lean();
};

test("6.2.5-C2 durable intake hardening", async (t) => {
  await t.test("replays of an existing exact scope do not consume global new-storage budget", async () => {
    const appointmentId = remember(new mongoose.Types.ObjectId());
    const start = new Date("2042-01-01T00:00:00.000Z");
    const first = await enqueue(appointmentId, start);
    assert.equal(first.enqueued, true);

    const firstBucket = await bucketFor(start);
    assert.equal(firstBucket.scopeKeys.length, 1);
    assert.match(firstBucket.scopeKeys[0], /^[0-9a-f]{64}$/u);
    assert.equal(JSON.stringify(firstBucket).includes(businessId.toString()), false);
    assert.equal(JSON.stringify(firstBucket).includes(appointmentId.toString()), false);

    for (let index = 0; index < 20; index += 1) {
      const replay = await enqueue(
        appointmentId,
        new Date(start.getTime() + (index + 1) * 1000),
      );
      assert.equal(replay.enqueued, false);
      assert.equal(replay.backpressured, false);
    }

    assert.equal((await bucketFor(start)).scopeKeys.length, 1);

    const laterReplay = await enqueue(appointmentId, new Date(start.getTime() + 61_000));
    assert.equal(laterReplay.enqueued, false);
    assert.equal(laterReplay.backpressured, false);
    assert.equal(await bucketFor(new Date(start.getTime() + 61_000)), null);
    await GuestAppointmentVerificationJob.deleteOne({ business: businessId, appointment: appointmentId });
  });

  await t.test("concurrent first requests for one scope occupy only one bucket fingerprint", async () => {
    const appointmentId = remember(new mongoose.Types.ObjectId());
    const now = new Date("2042-01-02T00:00:00.000Z");
    const results = await Promise.all(
      Array.from({ length: 25 }, () => enqueue(appointmentId, now)),
    );

    assert.equal(results.filter((result) => result.enqueued).length, 1);
    assert.equal(
      await GuestAppointmentVerificationJob.countDocuments({
        business: businessId,
        appointment: appointmentId,
        purpose,
        action,
      }),
      1,
    );
    assert.equal((await bucketFor(now)).scopeKeys.length, 1);
    await GuestAppointmentVerificationJob.deleteOne({ business: businessId, appointment: appointmentId });
  });

  await t.test("eligible terminal reuse resets the existing job without charging new-storage budget", async () => {
    const appointmentId = remember(new mongoose.Types.ObjectId());
    const start = new Date("2042-01-03T00:00:00.000Z");
    const created = await enqueue(appointmentId, start, { cooldownMs: 1000 });
    const claimed = await jobRepository.claimNext({
      workerId: "hardening-worker-1",
      now: start,
      leaseMs: 1000,
    });
    assert.equal(claimed._id.toString(), created.job._id.toString());

    await jobRepository.markFailed({
      jobId: claimed._id,
      generation: claimed.generation,
      workerId: "hardening-worker-1",
      now: start,
      cooldownMs: 1000,
      retentionMs: 2000,
    });

    assert.equal((await bucketFor(start)).scopeKeys.length, 1);
    const resetTime = new Date(start.getTime() + 1001);
    const reset = await enqueue(appointmentId, resetTime, { cooldownMs: 1000 });
    assert.equal(reset.enqueued, true);
    assert.equal(reset.job._id.toString(), created.job._id.toString());
    assert.equal(reset.job.generation, 2);
    assert.equal((await bucketFor(start)).scopeKeys.length, 1);
    await GuestAppointmentVerificationJob.deleteOne({ business: businessId, appointment: appointmentId });
  });

  await t.test("unique random scopes remain globally bounded while public-facing outcome can stay uniform", async () => {
    const now = new Date("2042-01-04T00:00:00.000Z");
    const appointments = Array.from({ length: 12 }, () => remember(new mongoose.Types.ObjectId()));
    const outcomes = [];
    for (const appointmentId of appointments) outcomes.push(await enqueue(appointmentId, now));

    assert.equal(outcomes.filter((result) => result.enqueued).length, 3);
    assert.equal(outcomes.filter((result) => result.backpressured).length, 9);
    assert.equal((await bucketFor(now)).scopeKeys.length, 3);
    assert.equal(
      await GuestAppointmentVerificationJob.countDocuments({ appointment: { $in: appointments } }),
      3,
    );
  });
});

test.after(async () => {
  await GuestAppointmentVerificationJob.deleteMany({
    business: businessId,
    appointment: { $in: cleanupAppointments },
  });
  await GuestAppointmentIntakeBucket.deleteMany({ _id: /^guest-appointment-read:/u });
  await mongoose.disconnect();
});
