import "./setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { connectDB } from "../src/db/db.js";
import Business from "../src/db/models/business.model.js";
import Membership from "../src/db/models/membership.model.js";
import PendingOnboarding, {
  PENDING_ONBOARDING_CHANNEL,
  PENDING_ONBOARDING_PURPOSE,
} from "../src/db/models/pendingOnboarding.model.js";
import Service from "../src/db/models/service.model.js";
import User from "../src/db/models/user.model.js";
import { createPendingForBusiness } from "../src/repositories/pendingOnboarding.repository.js";
import { getPublicProfessionalsForService } from "../src/services/publicBookingContract.service.js";

await connectDB();
await PendingOnboarding.init();

const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const futureExpiry = () => new Date(Date.now() + 60 * 60 * 1000);

const businessA = await Business.create({
  name: `Pending onboarding A ${suffix}`,
  slug: `pending-onboarding-a-${suffix}`,
});
const businessB = await Business.create({
  name: `Pending onboarding B ${suffix}`,
  slug: `pending-onboarding-b-${suffix}`,
});

const issuerA = await User.create({
  firstName: "Issuer",
  lastName: "Admin A",
  email: [`issuer-a-${suffix}@example.com`],
  password: "not-used-in-pending-onboarding-test",
  role: "user",
});
const issuerB = await User.create({
  firstName: "Issuer",
  lastName: "Admin B",
  email: [`issuer-b-${suffix}@example.com`],
  password: "not-used-in-pending-onboarding-test",
  role: "user",
});
await Membership.create({
  user: issuerA._id,
  business: businessA._id,
  role: "admin",
  isActive: true,
  isBookable: false,
});
await Membership.create({
  user: issuerB._id,
  business: businessB._id,
  role: "admin",
  isActive: true,
  isBookable: false,
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

const assertDuplicateKey = (error) => error?.code === 11000;

const directEnvelope = (overrides = {}) => ({
  business: businessA._id,
  issuer: issuerA._id,
  channel: PENDING_ONBOARDING_CHANNEL,
  email: `direct-${Math.random().toString(16).slice(2)}-${suffix}@example.com`,
  purpose: PENDING_ONBOARDING_PURPOSE,
  role: "worker",
  isBookable: false,
  expiresAt: futureExpiry(),
  status: "pending",
  ...overrides,
});

test("C1 pending onboarding storage invariants", async (t) => {
  await t.test("Business and issuer are mandatory and issuer must be an active admin in the same Business", async () => {
    await assert.rejects(
      PendingOnboarding.create(directEnvelope({ business: undefined })),
      /negocio del onboarding pendiente es obligatorio/u,
    );
    await assert.rejects(
      PendingOnboarding.create(directEnvelope({ issuer: undefined })),
      /issuer del onboarding pendiente es obligatorio/u,
    );

    await assert.rejects(
      createPendingForBusiness(new mongoose.Types.ObjectId(), issuerA._id, {
        email: `missing-business-${suffix}@example.com`,
        expiresAt: futureExpiry(),
      }),
      /Business activo existente/u,
    );

    await assert.rejects(
      createPendingForBusiness(businessA._id, existingUser._id, {
        email: `unauthorized-issuer-${suffix}@example.com`,
        expiresAt: futureExpiry(),
      }),
      /admin tenant activo/u,
    );
  });

  await t.test("canonical issue fixes tenant, issuer, channel, purpose and least-privilege membership intent server-side", async () => {
    const expiresAt = futureExpiry();
    const onboarding = await createPendingForBusiness(businessA._id, issuerA._id, {
      email: `  ${existingTargetEmail.toUpperCase()}  `,
      expiresAt,
      business: businessB._id,
      issuer: issuerB._id,
      channel: "sms",
      purpose: "contact-control",
      role: "admin",
      isBookable: true,
      status: "consumed",
      user: existingUser._id,
      membership: new mongoose.Types.ObjectId(),
    });

    assert.equal(onboarding.business.toString(), businessA._id.toString());
    assert.equal(onboarding.issuer.toString(), issuerA._id.toString());
    assert.equal(onboarding.channel, "email");
    assert.equal(onboarding.email, existingTargetEmail);
    assert.equal(onboarding.purpose, "tenant-onboarding");
    assert.equal(onboarding.role, "worker");
    assert.equal(onboarding.isBookable, false);
    assert.equal(onboarding.status, "pending");
    assert.equal(onboarding.expiresAt.getTime(), expiresAt.getTime());
    assert.equal(onboarding.get("user"), undefined);
    assert.equal(onboarding.get("membership"), undefined);

    await assert.rejects(
      createPendingForBusiness(businessA._id, issuerA._id, {
        email: existingTargetEmail,
        expiresAt: futureExpiry(),
        role: "admin",
        isBookable: true,
      }),
      assertDuplicateKey,
    );
  });

  await t.test("canonical issue requires an explicit future expiration", async () => {
    await assert.rejects(
      createPendingForBusiness(businessA._id, issuerA._id, {
        email: `missing-expiry-${suffix}@example.com`,
      }),
      /expiresAt debe ser una fecha futura válida/u,
    );
    await assert.rejects(
      createPendingForBusiness(businessA._id, issuerA._id, {
        email: `past-expiry-${suffix}@example.com`,
        expiresAt: new Date(Date.now() - 1000),
      }),
      /expiresAt debe ser una fecha futura válida/u,
    );
  });

  await t.test("schema role remains limited to current tenant roles", async () => {
    await assert.rejects(
      PendingOnboarding.create(directEnvelope({
        email: `invalid-role-${suffix}@example.com`,
        role: "superadmin",
      })),
      /not a valid enum value/u,
    );
  });

  await t.test("schema keeps role and isBookable structurally independent across all four combinations", async () => {
    const combinations = [
      ["admin", true],
      ["admin", false],
      ["worker", true],
      ["worker", false],
    ];

    for (const [index, [role, isBookable]] of combinations.entries()) {
      const onboarding = await PendingOnboarding.create(directEnvelope({
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
    const onboardingA = await createPendingForBusiness(businessA._id, issuerA._id, {
      email: ` ${sharedEmail.toUpperCase()} `,
      expiresAt: futureExpiry(),
    });
    const onboardingB = await createPendingForBusiness(businessB._id, issuerB._id, {
      email: sharedEmail,
      expiresAt: futureExpiry(),
    });

    assert.equal(onboardingA.email, sharedEmail);
    assert.equal(onboardingB.email, sharedEmail);
    assert.equal(onboardingA.role, "worker");
    assert.equal(onboardingB.role, "worker");
    assert.equal(onboardingA.isBookable, false);
    assert.equal(onboardingB.isBookable, false);
    assert.notEqual(onboardingA._id.toString(), onboardingB._id.toString());
  });

  await t.test("a terminal record is distinguishable from a still-usable pending record", async () => {
    const email = `terminal-${suffix}@example.com`;
    const terminal = await PendingOnboarding.create(directEnvelope({
      email,
      status: "consumed",
    }));
    const pending = await createPendingForBusiness(businessA._id, issuerA._id, {
      email,
      expiresAt: futureExpiry(),
    });

    assert.equal(terminal.status, "consumed");
    assert.equal(pending.status, "pending");
  });

  await t.test("the database prevents concurrent equivalent pending onboardings", async () => {
    const email = `concurrent-${suffix}@example.com`;
    const attempts = await Promise.allSettled(
      Array.from({ length: 12 }, () => createPendingForBusiness(
        businessA._id,
        issuerA._id,
        {
          email: `  ${email.toUpperCase()}  `,
          expiresAt: futureExpiry(),
        },
      )),
    );

    const fulfilled = attempts.filter((result) => result.status === "fulfilled");
    const rejected = attempts.filter((result) => result.status === "rejected");

    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 11);
    assert.ok(rejected.every((result) => assertDuplicateKey(result.reason)));

    assert.equal(await PendingOnboarding.countDocuments({
      business: businessA._id,
      email,
      status: "pending",
    }), 1);
  });

  await t.test("creating onboardings creates neither User nor Membership and does not bind or mutate matching target User", async () => {
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
  await PendingOnboarding.deleteMany({ business: { $in: [businessA._id, businessB._id] } });
  await Service.deleteOne({ _id: service._id });
  await Membership.deleteMany({ business: { $in: [businessA._id, businessB._id] } });
  await User.deleteMany({
    _id: { $in: [issuerA._id, issuerB._id, existingUser._id, bookableUser._id] },
  });
  await Business.deleteMany({ _id: { $in: [businessA._id, businessB._id] } });
  await mongoose.disconnect();
});
