import "./setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { connectDB } from "../src/db/db.js";
import { cleanTestData, teardown } from "./fixtures.js";
import Appointment from "../src/db/models/appointment.model.js";
import Business from "../src/db/models/business.model.js";
import Membership from "../src/db/models/membership.model.js";
import PendingOnboarding from "../src/db/models/pendingOnboarding.model.js";
import Service from "../src/db/models/service.model.js";
import Shift from "../src/db/models/shift.model.js";
import TenantOnboardingChallenge from "../src/db/models/tenantOnboardingChallenge.model.js";
import User from "../src/db/models/user.model.js";
import {
  bindTenantOnboardingAccount,
  issueTenantOnboarding,
} from "../src/services/tenantOnboarding.service.js";
import {
  TENANT_ONBOARDING_CONSUME_ERROR_CODE,
  consumeTenantOnboarding,
} from "../src/services/tenantOnboardingConsume.service.js";
import { createHash } from "../src/utils/password.js";

await connectDB();
await cleanTestData();
await Membership.init();
await PendingOnboarding.init();
await TenantOnboardingChallenge.init();
await User.init();

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
let sequence = 0;
const nextToken = (prefix) => `${prefix}-${suffix}-${sequence += 1}`;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const createFixture = async () => {
  const token = nextToken("issuer-race");
  const business = await Business.create({
    name: `Issuer race ${token}`,
    slug: token.toLowerCase(),
    isActive: true,
  });
  const issuer = await User.create({
    firstName: "Issuer",
    lastName: "Admin",
    email: [`${token}-issuer@example.com`],
    password: await createHash("issuerPassword"),
    role: "user",
    isActive: true,
  });
  await Membership.create({
    user: issuer._id,
    business: business._id,
    role: "admin",
    isActive: true,
    isBookable: false,
  });
  const target = await User.create({
    firstName: "Bound",
    lastName: "Claimant",
    email: [`${token}-target@example.com`],
    password: await createHash("candidatePassword"),
    role: "user",
    isActive: true,
  });

  let delivery;
  const issued = await issueTenantOnboarding({
    businessId: business._id,
    issuerUserId: issuer._id,
    email: target.email[0],
    deliver: async (payload) => {
      delivery = payload;
      return true;
    },
  });
  assert.ok(delivery?.challengeSecret);

  await bindTenantOnboardingAccount({
    onboardingId: issued.onboardingId,
    secret: delivery.challengeSecret,
    account: { mode: "existing", password: "candidatePassword" },
  });

  const pending = await PendingOnboarding.findById(issued.onboardingId);
  const challenge = await TenantOnboardingChallenge.findById(pending.accountBinding.challenge);
  assert.equal(pending.status, "pending");
  assert.equal(pending.accountBinding.user.toString(), target._id.toString());
  assert.equal(challenge.status, "consumed");
  assert.equal(challenge.boundUser.toString(), target._id.toString());

  return { business, issuer, target, pending, challenge };
};

const sideEffectSnapshot = async () => ({
  shifts: await Shift.countDocuments(),
  services: await Service.countDocuments(),
  appointments: await Appointment.countDocuments(),
});

test("C3 serializes against issuer User active -> inactive when deactivation wins", async () => {
  const fixture = await createFixture();
  const before = await sideEffectSnapshot();
  const challengeConsumedAt = fixture.challenge.consumedAt.getTime();
  const deactivationSession = await mongoose.startSession();

  try {
    deactivationSession.startTransaction();
    const deactivation = await User.updateOne(
      { _id: fixture.issuer._id, isActive: true },
      { $set: { isActive: false } },
      { session: deactivationSession },
    );
    assert.equal(deactivation.modifiedCount, 1);

    const consumeOutcome = consumeTenantOnboarding({ onboardingId: fixture.pending._id })
      .then((value) => ({ status: "fulfilled", value }))
      .catch((reason) => ({ status: "rejected", reason }));

    // The deactivation transaction owns a write on the issuer User. C3 must not
    // be able to finish while that write is unresolved; before the User fence
    // existed, this consume could pass on a stale snapshot and settle here.
    const beforeCommitState = await Promise.race([
      consumeOutcome.then(() => "settled"),
      delay(75).then(() => "blocked"),
    ]);
    assert.equal(beforeCommitState, "blocked");

    await deactivationSession.commitTransaction();

    const outcome = await consumeOutcome;
    assert.equal(outcome.status, "rejected");
    assert.equal(outcome.reason.code, TENANT_ONBOARDING_CONSUME_ERROR_CODE);
    assert.equal((await User.findById(fixture.issuer._id)).isActive, false);
    assert.equal(await Membership.findOne({
      user: fixture.target._id,
      business: fixture.business._id,
    }), null);

    const pendingAfter = await PendingOnboarding.findById(fixture.pending._id);
    assert.equal(pendingAfter.status, "pending");
    assert.equal(pendingAfter.accountBinding.user.toString(), fixture.target._id.toString());
    assert.equal(pendingAfter.accountBinding.challenge.toString(), fixture.challenge._id.toString());
    assert.equal(pendingAfter.accountBinding.boundAt.getTime(), fixture.pending.accountBinding.boundAt.getTime());

    const challengeAfter = await TenantOnboardingChallenge.findById(fixture.challenge._id);
    assert.equal(challengeAfter.status, "consumed");
    assert.equal(challengeAfter.boundUser.toString(), fixture.target._id.toString());
    assert.equal(challengeAfter.consumedAt.getTime(), challengeConsumedAt);
    assert.deepEqual(await sideEffectSnapshot(), before);
  } finally {
    if (deactivationSession.inTransaction()) await deactivationSession.abortTransaction();
    await deactivationSession.endSession();
  }
});

test("C3 may commit first; later issuer deactivation does not roll Membership back", async () => {
  const fixture = await createFixture();
  const result = await consumeTenantOnboarding({ onboardingId: fixture.pending._id });
  assert.equal(result.completed, true);

  const membershipBefore = await Membership.findById(result.membershipId);
  assert.ok(membershipBefore);
  assert.equal(membershipBefore.user.toString(), fixture.target._id.toString());
  assert.equal(membershipBefore.business.toString(), fixture.business._id.toString());
  assert.equal(membershipBefore.role, "worker");
  assert.equal(membershipBefore.isActive, true);
  assert.equal(membershipBefore.isBookable, false);

  const deactivationSession = await mongoose.startSession();
  try {
    await deactivationSession.withTransaction(async () => {
      const deactivation = await User.updateOne(
        { _id: fixture.issuer._id, isActive: true },
        { $set: { isActive: false } },
        { session: deactivationSession },
      );
      assert.equal(deactivation.modifiedCount, 1);
    });
  } finally {
    await deactivationSession.endSession();
  }

  assert.equal((await User.findById(fixture.issuer._id)).isActive, false);
  const membershipAfter = await Membership.findById(result.membershipId);
  assert.ok(membershipAfter);
  assert.equal(membershipAfter.isActive, true);
  assert.equal(membershipAfter.role, "worker");
  assert.equal(membershipAfter.isBookable, false);
  assert.equal((await PendingOnboarding.findById(fixture.pending._id)).status, "consumed");
  assert.equal((await TenantOnboardingChallenge.findById(fixture.challenge._id)).status, "consumed");
});

test.after(async () => {
  await teardown();
});
