import "./setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import { connectDB } from "../src/db/db.js";
import { cleanTestData, seedTestData, teardown } from "./fixtures.js";
import GuestAppointmentCommunicationJob from "../src/db/models/guestAppointmentCommunicationJob.model.js";
import * as communicationRepository from "../src/repositories/guestAppointmentCommunicationJob.repository.js";
import { bookAppointment, buildGuestBookingContactSnapshot } from "../src/services/appointment.service.js";
import { processNextGuestAppointmentCommunicationJob } from "../src/services/guestAppointmentCommunication.worker.js";

await connectDB();
await cleanTestData();
const seed = await seedTestData();

const createBookingJob = async ({ date, email }) => {
  const appointment = await bookAppointment({
    client: null,
    worker: seed.worker._id,
    service: seed.service._id,
    businessId: seed.business._id,
    date,
    startTime: "10:00",
    paymentOption: "local",
    guestContact: buildGuestBookingContactSnapshot({ email }),
  });
  const job = await GuestAppointmentCommunicationJob.findOne({
    appointment: appointment._id,
    event: "booking",
  });
  assert.ok(job);
  return job;
};

test("I processing lease automatic retry budget", async (t) => {
  t.after(async () => teardown(null, null));

  await t.test("expired processing lease can be reclaimed through attempt 8 but never attempt 9", async () => {
    await GuestAppointmentCommunicationJob.deleteMany({});
    const job = await createBookingJob({
      date: "2099-12-01",
      email: "processing-budget@example.com",
    });

    const start = new Date("2099-01-01T00:00:00.000Z");
    const leaseMs = 10;

    for (let attempt = 1; attempt <= communicationRepository.GUEST_COMMUNICATION_MAX_ATTEMPTS; attempt += 1) {
      const now = new Date(start.getTime() + ((attempt - 1) * (leaseMs + 1)));
      const claimed = await communicationRepository.claimNext({
        workerId: `processing-budget-worker-${attempt}`,
        now,
        leaseMs,
      });
      assert.ok(claimed, `attempt ${attempt} should be claimable`);
      assert.equal(claimed._id, job._id);
      assert.equal(claimed.attempts, attempt);
      assert.equal(claimed.status, "processing");
    }

    const afterAttemptEightLease = new Date(
      start.getTime()
      + ((communicationRepository.GUEST_COMMUNICATION_MAX_ATTEMPTS - 1) * (leaseMs + 1))
      + leaseMs
      + 1,
    );
    const ninth = await communicationRepository.claimNext({
      workerId: "processing-budget-worker-9",
      now: afterAttemptEightLease,
      leaseMs,
    });
    assert.equal(ninth, null);

    const stored = await communicationRepository.findByIdForTests(job._id);
    assert.equal(stored.status, "failed");
    assert.equal(stored.attempts, communicationRepository.GUEST_COMMUNICATION_MAX_ATTEMPTS);
    assert.equal(stored.lastFailureCode, "PROCESSING_LEASE_ATTEMPTS_EXHAUSTED");
    assert.equal(stored.leaseOwner, null);
    assert.equal(stored.leaseExpiresAt, null);
    assert.ok(stored.failedAt instanceof Date);
  });

  await t.test("concurrent recovery at exhausted processing lease is fail-closed and never delivers", async () => {
    await GuestAppointmentCommunicationJob.deleteMany({});
    const job = await createBookingJob({
      date: "2099-12-02",
      email: "processing-concurrency@example.com",
    });
    const expiredAt = new Date("2099-01-02T00:00:00.000Z");

    await GuestAppointmentCommunicationJob.updateOne(
      { _id: job._id },
      {
        $set: {
          status: "processing",
          attempts: communicationRepository.GUEST_COMMUNICATION_MAX_ATTEMPTS,
          leaseOwner: "processing-dead-owner",
          leaseExpiresAt: new Date(expiredAt.getTime() - 1),
        },
      },
      { runValidators: true },
    );

    let externalDeliveries = 0;
    const deliver = async () => {
      externalDeliveries += 1;
      return { accepted: true, providerMessageId: "must-not-send" };
    };

    const [left, right] = await Promise.all([
      processNextGuestAppointmentCommunicationJob({
        workerId: "processing-concurrent-left",
        now: expiredAt,
        deliver,
      }),
      processNextGuestAppointmentCommunicationJob({
        workerId: "processing-concurrent-right",
        now: expiredAt,
        deliver,
      }),
    ]);

    assert.equal(left, null);
    assert.equal(right, null);
    assert.equal(externalDeliveries, 0);

    const stored = await communicationRepository.findByIdForTests(job._id);
    assert.equal(stored.status, "failed");
    assert.equal(stored.attempts, communicationRepository.GUEST_COMMUNICATION_MAX_ATTEMPTS);
    assert.equal(stored.lastFailureCode, "PROCESSING_LEASE_ATTEMPTS_EXHAUSTED");
    assert.equal(stored.leaseOwner, null);
    assert.equal(stored.leaseExpiresAt, null);
    assert.ok(stored.failedAt instanceof Date);
  });
});
