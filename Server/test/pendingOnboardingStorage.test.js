import "./setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { connectDB } from "../src/db/db.js";
import Business from "../src/db/models/business.model.js";
import Membership from "../src/db/models/membership.model.js";
import PendingOnboarding from "../src/db/models/pendingOnboarding.model.js";
import Service from "../src/db/models/service.model.js";
import User from "../src/db/models/user.model.js";
import { createPendingForBusiness } from "../src/repositories/pendingOnboarding.repository.js";
import { getPublicProfessionalsForService } from "../src/services/publicBookingContract.service.js";

await connectDB();
await PendingOnboarding.init();

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const businessA = await Business.create({
  name: `Pending onboarding A ${suffix}`,
  slug: `pending-onboarding-a-${suffix}`,
});
const businessB = await Business.create({
  name: `Pending onboarding B ${suffix}`,
  slug: `pending-onboarding-b-${suffix}`,
});

const existingTargetEmail = `existing-${suffix}@example.com`;
const existingUser = await User.create({
  firstName: "Existing",
  lastName: "Target",
  email: [existingTargetEmail],
  password: "not-used-in-pending-onboarding-test",
  role: "user",
});
const bookableUser = await User.create({
  firstName: "Bookable",
  lastName: "Professional",
  email: [`bookable-${suffix}@example.com`],
  password: "not-used-in-pending-onboarding-test",
  role: "user",
});
await Membership.create({
  user: bookableUser._id,
  business: businessA._id,
  role: "worker",
  isActive: true,
  isBookable: true,
});
const service = await Service.create({
  name: `Service ${suffix}`,
  duration: 30,
  price: 10000,
  business: businessA._id,
  workers: [bookableUser._id],
  isActive: true,
});

const userCountBeforeOnboarding = await User.countDocuments();
const membershipCountBeforeOnboarding = await Membership.countDocuments();
const existingUserBefore = await User.findById(existingUser._id);
const discoveryBefore = await getPublicProfessionalsForService({
  businessId: businessA._id,
  serviceId: service._id,
});

const createdOnboardingIds = [];
const remember = (document) => {
  createdOnboardingIds.push(document._id);
  return document;
};

const assertDuplicateKey = (error) => error?.code === 11000;

test("C1 pending onboarding storage invariants", async (t) => {
  await t.test("Business is mandatory and repository rejects a missing Business", async () => {
    await assert.rejects(
      PendingOnboarding.create({
        email: `no-business-${suffix}@example.com`,
        role: "worker",
        isBookable: false,
      }),
      /negocio del onboarding pendiente es obligatorio/u,
    );

    await assert.rejects(
      createPendingForBusiness(new mongoose.Types.ObjectId(), {
        email: `missing-business-${suffix}@example.com`,
        role: "worker",
        isBookable: false,
      }),
      /Business existente/u,
    );
  });

  await t.test("email is canonically trimmed and lowercased without binding to an existing User", async () => {
    const onboarding = remember(await createPendingForBusiness(businessA._id, {
      email: `  ${existingTargetEmail.toUpperCase()}  `,
      role: "worker",
      isBookable: false,
      user: existingUser._id,
      membership: new mongoose.Types.ObjectId(),
      business: businessB._id,
      status: "consumed",
    }));

    assert.equal(onboarding.business.toString(), businessA._id.toString());
    assert.equal(onboarding.email, existingTargetEmail);
    assert.equal(onboarding.status, "pending");
    assert.equal(onboarding.get("user"), undefined);
    assert.equal(onboarding.get("membership"), undefined);

    await assert.rejects(
      createPendingForBusiness(businessA._id, {
        email: existingTargetEmail,
        role: "admin",
        isBookable: true,
      }),
      assertDuplicateKey,
    );
  });

  await t.test("role only accepts current tenant roles", async () => {
    await assert.rejects(
      createPendingForBusiness(businessA._id, {
        email: `invalid-role-${suffix}@example.com`,
        role: "superadmin",
        isBookable: false,
      }),
      /not a valid enum value/u,
    );
  });

  await t.test("role and isBookable remain independent across all four combinations", async () => {
    const combinations = [
      ["admin", true],
      ["admin", false],
      ["worker", true],
      ["worker", false],
    ];

    for (const [index, [role, isBookable]] of combinations.entries()) {
      const onboarding = remember(await createPendingForBusiness(businessA._id, {
        email: `combo-${index}-${suffix}@example.com`,
        role,
        isBookable,
      }));
      assert.equal(onboarding.role, role);
      assert.equal(onboarding.isBookable, isBookable);
      assert.equal(typeof onboarding.isBookable, "boolean");
    }
  });

  await t.test("the same normalized email can be pending in different Businesses", async () => {
    const sharedEmail = `shared-${suffix}@example.com`;
    const onboardingA = remember(await createPendingForBusiness(businessA._id, {
      email: ` ${sharedEmail.toUpperCase()} `,
      role: "admin",
      isBookable: false,
    }));
    const onboardingB = remember(await createPendingForBusiness(businessB._id, {
      email: sharedEmail,
      role: "worker",
      isBookable: true,
    }));

    assert.equal(onboardingA.email, sharedEmail);
    assert.equal(onboardingB.email, sharedEmail);
    assert.notEqual(onboardingA._id.toString(), onboardingB._id.toString());
  });

  await t.test("a terminal record is distinguishable from a still-usable pending record", async () => {
    const email = `terminal-${suffix}@example.com`;
    const terminal = remember(await PendingOnboarding.create({
      business: businessA._id,
      email,
      role: "worker",
      isBookable: false,
      status: "consumed",
    }));
    const pending = remember(await createPendingForBusiness(businessA._id, {
      email,
      role: "admin",
      isBookable: true,
    }));

    assert.equal(terminal.status, "consumed");
    assert.equal(pending.status, "pending");
  });

  await t.test("the database prevents concurrent equivalent pending onboardings", async () => {
    const email = `concurrent-${suffix}@example.com`;
    const attempts = await Promise.allSettled(
      Array.from({ length: 12 }, () => createPendingForBusiness(businessA._id, {
        email: `  ${email.toUpperCase()}  `,
        role: "worker",
        isBookable: false,
      })),
    );

    const fulfilled = attempts.filter((result) => result.status === "fulfilled");
    const rejected = attempts.filter((result) => result.status === "rejected");

    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 11);
    assert.ok(rejected.every((result) => assertDuplicateKey(result.reason)));
    remember(fulfilled[0].value);

    assert.equal(await PendingOnboarding.countDocuments({
      business: businessA._id,
      email,
      status: "pending",
    }), 1);
  });

  await t.test("creating onboardings creates neither User nor Membership and does not mutate matching User", async () => {
    assert.equal(await User.countDocuments(), userCountBeforeOnboarding);
    assert.equal(await Membership.countDocuments(), membershipCountBeforeOnboarding);

    const existingUserAfter = await User.findById(existingUser._id);
    assert.deepEqual(existingUserAfter.email, existingUserBefore.email);
    assert.equal(existingUserAfter.updatedAt.getTime(), existingUserBefore.updatedAt.getTime());

    assert.equal(PendingOnboarding.schema.path("user"), undefined);
    assert.equal(PendingOnboarding.schema.path("membership"), undefined);
    assert.equal(PendingOnboarding.schema.path("binding"), undefined);
  });

  await t.test("pending onboarding does not affect current public discovery/bookability runtime", async () => {
    const discoveryAfter = await getPublicProfessionalsForService({
      businessId: businessA._id,
      serviceId: service._id,
    });

    assert.deepEqual(discoveryAfter, discoveryBefore);
    assert.deepEqual(discoveryAfter, [{
      id: bookableUser._id.toString(),
      firstName: "Bookable",
      lastName: "Professional",
    }]);
  });
});

test.after(async () => {
  await PendingOnboarding.deleteMany({
    _id: { $in: createdOnboardingIds },
  });
  await Service.deleteOne({ _id: service._id });
  await Membership.deleteMany({ business: { $in: [businessA._id, businessB._id] } });
  await User.deleteMany({ _id: { $in: [existingUser._id, bookableUser._id] } });
  await Business.deleteMany({ _id: { $in: [businessA._id, businessB._id] } });
  await mongoose.disconnect();
});
