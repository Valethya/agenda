import "./setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import app, { sessionStore } from "../src/app.js";
import { connectDB } from "../src/db/db.js";
import { cleanTestData, seedTestData, teardown } from "./fixtures.js";
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
const seed = await seedTestData();
await Membership.init();
await PendingOnboarding.init();
await TenantOnboardingChallenge.init();
await User.init();

const server = app.listen(0);
const { port } = server.address();
const baseUrl = `http://localhost:${port}/api`;
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
let sequence = 0;

const nextToken = (prefix) => `${prefix}-${suffix}-${sequence += 1}`;
const request = async (path, { method = "GET", body } = {}) => fetch(`${baseUrl}${path}`, {
  method,
  headers: body !== undefined ? { "Content-Type": "application/json" } : {},
  ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
});

const createPlainUser = async ({
  email = `${nextToken("target")}@example.com`,
  password = "candidatePassword",
  active = true,
} = {}) => User.create({
  firstName: "Bound",
  lastName: "Claimant",
  email: [email],
  password: await createHash(password),
  role: "user",
  isActive: active,
});

const createTenant = async () => {
  const token = nextToken("tenant");
  const business = await Business.create({
    name: `Tenant ${token}`,
    slug: token.toLowerCase(),
    isActive: true,
  });
  const issuer = await User.create({
    firstName: "Issuer",
    lastName: "Admin",
    email: [`${token}@example.com`],
    password: await createHash("issuerPassword"),
    role: "user",
    isActive: true,
  });
  const issuerMembership = await Membership.create({
    user: issuer._id,
    business: business._id,
    role: "admin",
    isActive: true,
    isBookable: false,
  });
  return { business, issuer, issuerMembership };
};

const createBoundGrant = async ({
  businessId = seed.business._id,
  issuerUserId = seed.admin._id,
  user,
  password = "candidatePassword",
} = {}) => {
  const target = user || await createPlainUser({ password });
  const email = target.email[0];
  let delivery;
  const issued = await issueTenantOnboarding({
    businessId,
    issuerUserId,
    email,
    deliver: async (payload) => {
      delivery = payload;
      return true;
    },
  });
  assert.ok(delivery?.challengeSecret);

  await bindTenantOnboardingAccount({
    onboardingId: issued.onboardingId,
    secret: delivery.challengeSecret,
    account: { mode: "existing", password },
  });

  const pending = await PendingOnboarding.findById(issued.onboardingId);
  const challenge = await TenantOnboardingChallenge.findById(pending.accountBinding.challenge);
  assert.equal(challenge.status, "consumed");
  assert.equal(challenge.boundUser.toString(), target._id.toString());

  return { target, pending, challenge, delivery };
};

const expectConsumeFailure = async (onboardingId) => assert.rejects(
  consumeTenantOnboarding({ onboardingId }),
  (error) => error?.code === TENANT_ONBOARDING_CONSUME_ERROR_CODE
    && error?.message === "No fue posible completar el onboarding",
);

const membershipFor = ({ user, business }) => Membership.findOne({ user, business });

test("C3 valid C1+C2 grant creates exactly canonical Membership and nothing else", async () => {
  const bound = await createBoundGrant();
  const shiftsBefore = await Shift.countDocuments();
  const appointmentsBefore = await Appointment.countDocuments();
  const serviceBefore = await Service.findById(seed.service._id).lean();
  const userBefore = await User.findById(bound.target._id).lean();
  const challengeBefore = await TenantOnboardingChallenge.findById(bound.challenge._id).lean();

  const result = await consumeTenantOnboarding({ onboardingId: bound.pending._id });
  assert.equal(result.completed, true);
  assert.equal(result.onboardingId.toString(), bound.pending._id.toString());

  const memberships = await Membership.find({
    user: bound.pending.accountBinding.user,
    business: bound.pending.business,
  });
  assert.equal(memberships.length, 1);
  const membership = memberships[0];
  assert.equal(membership._id.toString(), result.membershipId.toString());
  assert.equal(membership.user.toString(), bound.pending.accountBinding.user.toString());
  assert.equal(membership.business.toString(), bound.pending.business.toString());
  assert.equal(membership.role, "worker");
  assert.equal(membership.isActive, true);
  assert.equal(membership.isBookable, false);

  const pendingAfter = await PendingOnboarding.findById(bound.pending._id);
  assert.equal(pendingAfter.status, "consumed");
  assert.equal(pendingAfter.accountBinding.user.toString(), bound.target._id.toString());
  assert.equal(pendingAfter.accountBinding.challenge.toString(), bound.challenge._id.toString());

  const challengeAfter = await TenantOnboardingChallenge.findById(bound.challenge._id).lean();
  assert.equal(challengeAfter.status, "consumed");
  assert.equal(challengeAfter.boundUser.toString(), bound.target._id.toString());
  assert.equal(challengeAfter.consumedAt.getTime(), challengeBefore.consumedAt.getTime());

  const userAfter = await User.findById(bound.target._id).lean();
  assert.equal(userAfter.role, userBefore.role);
  assert.equal(userAfter.business?.toString?.() || null, userBefore.business?.toString?.() || null);
  assert.equal(await Shift.countDocuments(), shiftsBefore);
  assert.equal(await Appointment.countDocuments(), appointmentsBefore);
  const serviceAfter = await Service.findById(seed.service._id).lean();
  assert.deepEqual(serviceAfter.workers.map(String), serviceBefore.workers.map(String));
});

test("C3 HTTP consume is claimant-facing, bodyless and creates no tenant session", async () => {
  const bound = await createBoundGrant();
  const response = await request(`/team/onboardings/${bound.pending._id}/consume`, {
    method: "POST",
    body: {},
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("set-cookie"), null);
  const body = await response.json();
  assert.equal(body.status, "success");
  assert.equal(body.payload.completed, true);
  assert.deepEqual(Object.keys(body.payload).sort(), ["completed", "membershipId", "onboardingId"]);

  const membership = await membershipFor({
    user: bound.target._id,
    business: bound.pending.business,
  });
  assert.equal(membership.role, "worker");
  assert.equal(membership.isActive, true);
  assert.equal(membership.isBookable, false);
});

test("C3 HTTP body cannot select User, Business or privilege", async () => {
  const response = await request(`/team/onboardings/${new mongoose.Types.ObjectId()}/consume`, {
    method: "POST",
    body: {
      userId: new mongoose.Types.ObjectId().toString(),
      businessId: seed.businessB._id.toString(),
      role: "admin",
      isBookable: true,
      isActive: false,
      issuedBy: seed.userB._id.toString(),
      email: "attacker@example.com",
    },
  });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.code, "VALIDATION_ERROR");
});

test("C3 resolves exact identity without an email lookup", async () => {
  const bound = await createBoundGrant();
  const originalFindOne = User.findOne;
  User.findOne = function patchedFindOne(filter, ...rest) {
    if (filter && Object.hasOwn(filter, "email")) {
      throw new Error("C3 attempted forbidden User email identity lookup");
    }
    return originalFindOne.call(this, filter, ...rest);
  };

  try {
    await consumeTenantOnboarding({ onboardingId: bound.pending._id });
  } finally {
    User.findOne = originalFindOne;
  }

  const membership = await membershipFor({
    user: bound.pending.accountBinding.user,
    business: bound.pending.business,
  });
  assert.ok(membership);
  assert.equal(membership.user.toString(), bound.target._id.toString());
});

test("C3 fails closed when bound User no longer exists or is inactive", async (t) => {
  await t.test("exact bound User missing", async () => {
    const bound = await createBoundGrant();
    await User.deleteOne({ _id: bound.target._id });
    await expectConsumeFailure(bound.pending._id);
    assert.equal(await membershipFor({ user: bound.target._id, business: bound.pending.business }), null);
  });

  await t.test("exact bound User inactive", async () => {
    const bound = await createBoundGrant();
    await User.updateOne({ _id: bound.target._id }, { $set: { isActive: false } });
    await expectConsumeFailure(bound.pending._id);
    assert.equal(await membershipFor({ user: bound.target._id, business: bound.pending.business }), null);
  });
});

test("C3 revalidates issuer authority from current persistence", async (t) => {
  await t.test("issuer that lost admin role cannot consume", async () => {
    const tenant = await createTenant();
    const bound = await createBoundGrant({
      businessId: tenant.business._id,
      issuerUserId: tenant.issuer._id,
    });
    await Membership.updateOne({ _id: tenant.issuerMembership._id }, { $set: { role: "worker" } });
    await expectConsumeFailure(bound.pending._id);
    assert.equal(await membershipFor({ user: bound.target._id, business: tenant.business._id }), null);
  });

  await t.test("inactive issuer cannot consume", async () => {
    const tenant = await createTenant();
    const bound = await createBoundGrant({
      businessId: tenant.business._id,
      issuerUserId: tenant.issuer._id,
    });
    await User.updateOne({ _id: tenant.issuer._id }, { $set: { isActive: false } });
    await expectConsumeFailure(bound.pending._id);
    assert.equal(await membershipFor({ user: bound.target._id, business: tenant.business._id }), null);
  });

  await t.test("issuer admin Membership in another Business is not authority", async () => {
    const tenant = await createTenant();
    const bound = await createBoundGrant({
      businessId: tenant.business._id,
      issuerUserId: tenant.issuer._id,
    });
    await Membership.updateOne({ _id: tenant.issuerMembership._id }, { $set: { isActive: false } });
    await Membership.create({
      user: tenant.issuer._id,
      business: seed.businessB._id,
      role: "admin",
      isActive: true,
      isBookable: false,
    });
    await expectConsumeFailure(bound.pending._id);
    assert.equal(await membershipFor({ user: bound.target._id, business: tenant.business._id }), null);
  });
});

test("C3 revalidates Business operational validity", async () => {
  const tenant = await createTenant();
  const bound = await createBoundGrant({
    businessId: tenant.business._id,
    issuerUserId: tenant.issuer._id,
  });
  await Business.updateOne({ _id: tenant.business._id }, { $set: { isActive: false } });
  await expectConsumeFailure(bound.pending._id);
  assert.equal(await membershipFor({ user: bound.target._id, business: tenant.business._id }), null);
});

test("C3 rejects non-consumable PendingOnboarding lifecycle and binding states", async (t) => {
  await t.test("expired grant", async () => {
    const bound = await createBoundGrant();
    await PendingOnboarding.collection.updateOne(
      { _id: bound.pending._id },
      { $set: { expiresAt: new Date(Date.now() - 1_000) } },
    );
    await expectConsumeFailure(bound.pending._id);
    assert.equal(await membershipFor({ user: bound.target._id, business: bound.pending.business }), null);
  });

  await t.test("revoked grant", async () => {
    const bound = await createBoundGrant();
    await PendingOnboarding.updateOne({ _id: bound.pending._id }, { $set: { status: "revoked" } });
    await expectConsumeFailure(bound.pending._id);
    assert.equal(await membershipFor({ user: bound.target._id, business: bound.pending.business }), null);
  });

  await t.test("grant without accountBinding", async () => {
    const bound = await createBoundGrant();
    await PendingOnboarding.updateOne({ _id: bound.pending._id }, { $set: { accountBinding: null } });
    await expectConsumeFailure(bound.pending._id);
    assert.equal(await membershipFor({ user: bound.target._id, business: bound.pending.business }), null);
  });

  await t.test("already consumed grant cannot create a second Membership", async () => {
    const bound = await createBoundGrant();
    await consumeTenantOnboarding({ onboardingId: bound.pending._id });
    await expectConsumeFailure(bound.pending._id);
    assert.equal(await Membership.countDocuments({
      user: bound.target._id,
      business: bound.pending.business,
    }), 1);
  });
});

test("C3 revalidates the exact consumed C2 challenge", async (t) => {
  const cases = [
    {
      name: "incoherent destination",
      mutate: (bound) => TenantOnboardingChallenge.collection.updateOne(
        { _id: bound.challenge._id },
        { $set: { destination: "different@example.com" } },
      ),
    },
    {
      name: "challenge references another onboarding",
      mutate: (bound) => TenantOnboardingChallenge.collection.updateOne(
        { _id: bound.challenge._id },
        { $set: { pendingOnboarding: new mongoose.Types.ObjectId() } },
      ),
    },
    {
      name: "challenge references another Business",
      mutate: (bound) => TenantOnboardingChallenge.collection.updateOne(
        { _id: bound.challenge._id },
        { $set: { business: seed.businessB._id } },
      ),
    },
    {
      name: "challenge not consumed by C2",
      mutate: (bound) => TenantOnboardingChallenge.collection.updateOne(
        { _id: bound.challenge._id },
        { $set: { status: "pending", consumedAt: null, boundUser: null } },
      ),
    },
    {
      name: "challenge boundUser differs from accountBinding.user",
      mutate: (bound) => TenantOnboardingChallenge.collection.updateOne(
        { _id: bound.challenge._id },
        { $set: { boundUser: seed.workerB._id } },
      ),
    },
    {
      name: "challenge expiry differs from grant",
      mutate: (bound) => TenantOnboardingChallenge.collection.updateOne(
        { _id: bound.challenge._id },
        { $set: { expiresAt: new Date(bound.pending.expiresAt.getTime() - 1_000) } },
      ),
    },
  ];

  for (const fixture of cases) {
    await t.test(fixture.name, async () => {
      const bound = await createBoundGrant();
      await fixture.mutate(bound);
      await expectConsumeFailure(bound.pending._id);
      assert.equal(await membershipFor({ user: bound.target._id, business: bound.pending.business }), null);
    });
  }
});

test("C3 never reactivates or mutates an existing Membership", async (t) => {
  await t.test("active Membership blocks consume", async () => {
    const bound = await createBoundGrant();
    const existing = await Membership.create({
      user: bound.target._id,
      business: bound.pending.business,
      role: "worker",
      isActive: true,
      isBookable: true,
    });
    await expectConsumeFailure(bound.pending._id);
    const after = await Membership.findById(existing._id);
    assert.equal(after.isActive, true);
    assert.equal(after.isBookable, true);
    assert.equal(await Membership.countDocuments({ user: bound.target._id, business: bound.pending.business }), 1);
  });

  await t.test("inactive Membership blocks consume without reactivation", async () => {
    const bound = await createBoundGrant();
    const existing = await Membership.create({
      user: bound.target._id,
      business: bound.pending.business,
      role: "worker",
      isActive: false,
      isBookable: true,
    });
    await expectConsumeFailure(bound.pending._id);
    const after = await Membership.findById(existing._id);
    assert.equal(after.isActive, false);
    assert.equal(after.isBookable, true);
    assert.equal(await Membership.countDocuments({ user: bound.target._id, business: bound.pending.business }), 1);
  });
});

test("C3 same-grant concurrent consumes produce exactly one success", async () => {
  const bound = await createBoundGrant();
  const outcomes = await Promise.allSettled([
    consumeTenantOnboarding({ onboardingId: bound.pending._id }),
    consumeTenantOnboarding({ onboardingId: bound.pending._id }),
  ]);

  assert.equal(outcomes.filter((entry) => entry.status === "fulfilled").length, 1);
  assert.equal(outcomes.filter((entry) => entry.status === "rejected").length, 1);
  assert.equal(await Membership.countDocuments({
    user: bound.target._id,
    business: bound.pending.business,
  }), 1);
  const pending = await PendingOnboarding.findById(bound.pending._id);
  assert.equal(pending.status, "consumed");
});

test("C3 vs concurrent Membership creation never duplicates or overwrites", async () => {
  const bound = await createBoundGrant();
  const outcomes = await Promise.allSettled([
    consumeTenantOnboarding({ onboardingId: bound.pending._id }),
    Membership.create({
      user: bound.target._id,
      business: bound.pending.business,
      role: "worker",
      isActive: false,
      isBookable: true,
    }),
  ]);

  assert.equal(outcomes.filter((entry) => entry.status === "fulfilled").length, 1);
  assert.equal(await Membership.countDocuments({
    user: bound.target._id,
    business: bound.pending.business,
  }), 1);

  const membership = await membershipFor({ user: bound.target._id, business: bound.pending.business });
  const pending = await PendingOnboarding.findById(bound.pending._id);
  if (outcomes[0].status === "fulfilled") {
    assert.equal(membership.isActive, true);
    assert.equal(membership.isBookable, false);
    assert.equal(pending.status, "consumed");
  } else {
    assert.equal(membership.isActive, false);
    assert.equal(membership.isBookable, true);
    assert.equal(pending.status, "pending");
  }
});

test("C3 issuer-authority loss racing consume is serialized by the Business fence", async () => {
  const tenant = await createTenant();
  const secondAdmin = await createPlainUser();
  await Membership.create({
    user: secondAdmin._id,
    business: tenant.business._id,
    role: "admin",
    isActive: true,
    isBookable: false,
  });
  const bound = await createBoundGrant({
    businessId: tenant.business._id,
    issuerUserId: tenant.issuer._id,
  });

  const lossSession = await mongoose.startSession();
  try {
    lossSession.startTransaction();
    await Business.findOneAndUpdate(
      { _id: tenant.business._id, isActive: true },
      { $inc: { teamAdminRevision: 1 } },
      { new: true, session: lossSession },
    );
    await Membership.updateOne(
      { _id: tenant.issuerMembership._id },
      { $set: { role: "worker" } },
      { session: lossSession },
    );

    const consumeOutcome = consumeTenantOnboarding({ onboardingId: bound.pending._id })
      .then((value) => ({ status: "fulfilled", value }))
      .catch((reason) => ({ status: "rejected", reason }));
    await new Promise((resolve) => setTimeout(resolve, 25));
    await lossSession.commitTransaction();

    const outcome = await consumeOutcome;
    assert.equal(outcome.status, "rejected");
    assert.equal(outcome.reason.code, TENANT_ONBOARDING_CONSUME_ERROR_CODE);
    assert.equal(await membershipFor({ user: bound.target._id, business: tenant.business._id }), null);
  } finally {
    if (lossSession.inTransaction()) await lossSession.abortTransaction();
    await lossSession.endSession();
  }
});

test("C3 loses safely when grant becomes terminal before its commit", async () => {
  const bound = await createBoundGrant();
  const revokeSession = await mongoose.startSession();
  try {
    revokeSession.startTransaction();
    await PendingOnboarding.updateOne(
      { _id: bound.pending._id, status: "pending" },
      { $set: { status: "revoked" } },
      { session: revokeSession },
    );

    const consumeOutcome = consumeTenantOnboarding({ onboardingId: bound.pending._id })
      .then((value) => ({ status: "fulfilled", value }))
      .catch((reason) => ({ status: "rejected", reason }));
    await new Promise((resolve) => setTimeout(resolve, 25));
    await revokeSession.commitTransaction();

    const outcome = await consumeOutcome;
    assert.equal(outcome.status, "rejected");
    assert.equal(outcome.reason.code, TENANT_ONBOARDING_CONSUME_ERROR_CODE);
    assert.equal(await membershipFor({ user: bound.target._id, business: bound.pending.business }), null);
    assert.equal((await PendingOnboarding.findById(bound.pending._id)).status, "revoked");
  } finally {
    if (revokeSession.inTransaction()) await revokeSession.abortTransaction();
    await revokeSession.endSession();
  }
});

test("C3 rolls back grant reservation/terminalization when Membership creation fails", async () => {
  const bound = await createBoundGrant();
  const before = await PendingOnboarding.findById(bound.pending._id).lean();
  const originalCreate = Membership.create;
  Membership.create = async function failMembershipCreation() {
    throw new Error("injected membership write failure");
  };

  try {
    await expectConsumeFailure(bound.pending._id);
  } finally {
    Membership.create = originalCreate;
  }

  const pending = await PendingOnboarding.findById(bound.pending._id).lean();
  assert.equal(pending.status, "pending");
  assert.equal(pending.updatedAt.getTime(), before.updatedAt.getTime());
  assert.equal(await membershipFor({ user: bound.target._id, business: bound.pending.business }), null);
});

test("C3 rolls back Membership when final PendingOnboarding terminalization fails", async () => {
  const bound = await createBoundGrant();
  const originalFindOneAndUpdate = PendingOnboarding.findOneAndUpdate;
  PendingOnboarding.findOneAndUpdate = function failTerminalization(filter, update, options) {
    if (update?.$set?.status === "consumed") return Promise.resolve(null);
    return originalFindOneAndUpdate.call(this, filter, update, options);
  };

  try {
    await expectConsumeFailure(bound.pending._id);
  } finally {
    PendingOnboarding.findOneAndUpdate = originalFindOneAndUpdate;
  }

  const pending = await PendingOnboarding.findById(bound.pending._id);
  assert.equal(pending.status, "pending");
  assert.equal(await membershipFor({ user: bound.target._id, business: bound.pending.business }), null);
});

test("C3 claimant failures remain generic and do not disclose internal cause", async () => {
  const revoked = await createBoundGrant();
  await PendingOnboarding.updateOne({ _id: revoked.pending._id }, { $set: { status: "revoked" } });

  const inactive = await createBoundGrant();
  await User.updateOne({ _id: inactive.target._id }, { $set: { isActive: false } });

  const responses = [];
  for (const onboardingId of [revoked.pending._id, inactive.pending._id]) {
    const response = await request(`/team/onboardings/${onboardingId}/consume`, {
      method: "POST",
      body: {},
    });
    assert.equal(response.status, 400);
    responses.push(await response.json());
  }

  assert.equal(responses[0].code, TENANT_ONBOARDING_CONSUME_ERROR_CODE);
  assert.equal(responses[1].code, TENANT_ONBOARDING_CONSUME_ERROR_CODE);
  assert.equal(responses[0].message, responses[1].message);
  for (const body of responses) {
    assert.doesNotMatch(
      JSON.stringify(body),
      /membership.*inactive|issuer|challenge|boundUser|user exists|admin of/iu,
    );
  }
});

test.after(async () => {
  await teardown(server, sessionStore);
});
