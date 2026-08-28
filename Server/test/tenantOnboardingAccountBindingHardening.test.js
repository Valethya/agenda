import "./setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import app, { sessionStore } from "../src/app.js";
import { connectDB } from "../src/db/db.js";
import { cleanTestData, seedTestData, teardown } from "./fixtures.js";
import Membership from "../src/db/models/membership.model.js";
import PendingOnboarding from "../src/db/models/pendingOnboarding.model.js";
import TenantOnboardingChallenge from "../src/db/models/tenantOnboardingChallenge.model.js";
import User from "../src/db/models/user.model.js";
import * as challengeRepository from "../src/repositories/tenantOnboardingChallenge.repository.js";
import {
  TENANT_ONBOARDING_ACCOUNT_PROOF_MAX_ATTEMPTS,
  bindTenantOnboardingAccount,
  issueTenantOnboarding,
} from "../src/services/tenantOnboarding.service.js";
import { createHash } from "../src/utils/password.js";

await connectDB();
await cleanTestData();
const seed = await seedTestData();
await PendingOnboarding.init();
await TenantOnboardingChallenge.init();
await User.init();

const server = app.listen(0);
const { port } = server.address();
const baseUrl = `http://localhost:${port}/api`;
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const bindingFailure = (error) => error?.code === "TENANT_ONBOARDING_BINDING_FAILED";
const deliveryFailure = (error) => error?.code === "TENANT_ONBOARDING_DELIVERY_FAILED";
const issueFailure = (error) => error?.code === "TENANT_ONBOARDING_ISSUE_FAILED";

const createExistingUser = async ({ email, password = "correctPassword" }) => User.create({
  firstName: "Existing",
  lastName: "User",
  email: [email],
  password: await createHash(password),
  role: "user",
  isActive: true,
});

const issue = async ({
  email,
  businessId = seed.business._id,
  issuerUserId = seed.admin._id,
  ...overrides
}) => {
  let delivery;
  const result = await issueTenantOnboarding({
    businessId,
    issuerUserId,
    email,
    deliver: async (payload) => {
      delivery = payload;
      return true;
    },
    ...overrides,
  });
  return { result, delivery };
};

const bindNew = ({ onboardingId, secret, password = "newUserPassword" }) => (
  bindTenantOnboardingAccount({
    onboardingId,
    secret,
    account: {
      mode: "new",
      firstName: "Nueva",
      lastName: "Persona",
      password,
    },
  })
);

const bindExisting = ({ onboardingId, secret, password }) => (
  bindTenantOnboardingAccount({
    onboardingId,
    secret,
    account: { mode: "existing", password },
  })
);

const request = async (path, { body, headers = {} } = {}) => fetch(`${baseUrl}${path}`, {
  method: "POST",
  headers: { "Content-Type": "application/json", ...headers },
  body: JSON.stringify(body),
});

test("C2 reissue terminalizes only the exact expired pending grant", async (t) => {
  await t.test("expired pending allows a fresh grant and revokes its still-revocable challenge", async () => {
    const email = `reissue-${suffix}@example.com`;
    const old = await issue({ email });
    const foreign = await issue({
      email,
      businessId: seed.businessB._id,
      issuerUserId: seed.userB._id,
    });

    await PendingOnboarding.updateOne(
      { _id: old.result.onboardingId },
      { $set: { expiresAt: new Date(Date.now() - 1_000) } },
    );

    const fresh = await issue({ email });
    assert.notEqual(fresh.result.onboardingId.toString(), old.result.onboardingId.toString());

    const [oldGrant, oldChallenge, newGrant, foreignGrant, foreignChallenge] = await Promise.all([
      PendingOnboarding.findById(old.result.onboardingId),
      TenantOnboardingChallenge.findOne({ pendingOnboarding: old.result.onboardingId }),
      PendingOnboarding.findById(fresh.result.onboardingId),
      PendingOnboarding.findById(foreign.result.onboardingId),
      TenantOnboardingChallenge.findOne({ pendingOnboarding: foreign.result.onboardingId }),
    ]);

    assert.equal(oldGrant.status, "revoked");
    assert.equal(oldChallenge.status, "revoked");
    assert.equal(newGrant.status, "pending");
    assert.equal(foreignGrant.status, "pending");
    assert.equal(foreignChallenge.status, "pending");
    assert.ok(foreignChallenge.deliveredAt instanceof Date);
    assert.equal(
      await PendingOnboarding.countDocuments({ business: seed.business._id, email, status: "pending" }),
      1,
    );

    await assert.rejects(
      bindNew({ onboardingId: old.result.onboardingId, secret: old.delivery.challengeSecret }),
      bindingFailure,
    );
  });

  await t.test("an unexpired pending grant still blocks a second independent issue", async () => {
    const email = `still-live-${suffix}@example.com`;
    await issue({ email });
    await assert.rejects(issue({ email }), issueFailure);
    assert.equal(
      await PendingOnboarding.countDocuments({ business: seed.business._id, email, status: "pending" }),
      1,
    );
  });

  await t.test("two concurrent reissues leave exactly one fresh pending grant", async () => {
    const email = `reissue-race-${suffix}@example.com`;
    const old = await issue({ email });
    await PendingOnboarding.updateOne(
      { _id: old.result.onboardingId },
      { $set: { expiresAt: new Date(Date.now() - 1_000) } },
    );

    const attempts = await Promise.allSettled([issue({ email }), issue({ email })]);
    assert.equal(attempts.filter((entry) => entry.status === "fulfilled").length, 1);
    assert.equal(attempts.filter((entry) => entry.status === "rejected").length, 1);

    const oldGrant = await PendingOnboarding.findById(old.result.onboardingId);
    const oldChallenge = await TenantOnboardingChallenge.findOne({ pendingOnboarding: old.result.onboardingId });
    assert.equal(oldGrant.status, "revoked");
    assert.equal(oldChallenge.status, "revoked");
    assert.equal(
      await PendingOnboarding.countDocuments({ business: seed.business._id, email, status: "pending" }),
      1,
    );
  });

  await t.test("expired grant with accountBinding keeps history but cannot block future intent", async () => {
    const email = `bound-expired-${suffix}@example.com`;
    const candidate = await createExistingUser({ email, password: "boundPassword" });
    const old = await issue({ email });
    await bindExisting({
      onboardingId: old.result.onboardingId,
      secret: old.delivery.challengeSecret,
      password: "boundPassword",
    });

    const boundBefore = await PendingOnboarding.findById(old.result.onboardingId);
    await PendingOnboarding.updateOne(
      { _id: old.result.onboardingId },
      { $set: { expiresAt: new Date(Date.now() - 1_000) } },
    );
    await assert.rejects(
      bindExisting({
        onboardingId: old.result.onboardingId,
        secret: old.delivery.challengeSecret,
        password: "boundPassword",
      }),
      bindingFailure,
    );

    const fresh = await issue({ email });
    const oldAfter = await PendingOnboarding.findById(old.result.onboardingId);
    const oldChallenge = await TenantOnboardingChallenge.findOne({ pendingOnboarding: old.result.onboardingId });
    assert.equal(oldAfter.status, "revoked");
    assert.equal(oldAfter.accountBinding.user.toString(), candidate._id.toString());
    assert.equal(oldAfter.accountBinding.user.toString(), boundBefore.accountBinding.user.toString());
    assert.equal(oldChallenge.status, "consumed");
    assert.notEqual(fresh.result.onboardingId.toString(), old.result.onboardingId.toString());
    assert.equal(
      await PendingOnboarding.countDocuments({ business: seed.business._id, email, status: "pending" }),
      1,
    );
  });
});

test("C2 bearer is bindable only after trusted delivery is confirmed in storage", async (t) => {
  await t.test("before activation the delivered bearer cannot bind; success activates only the exact challenge", async () => {
    const email = `activation-barrier-${suffix}@example.com`;
    let delivery;
    let releaseActivation;
    let activationEntered;
    const activationEnteredPromise = new Promise((resolve) => { activationEntered = resolve; });
    const activationBarrier = new Promise((resolve) => { releaseActivation = resolve; });

    const issuing = issueTenantOnboarding({
      businessId: seed.business._id,
      issuerUserId: seed.admin._id,
      email,
      deliver: async (payload) => {
        delivery = payload;
        return true;
      },
      activateDelivery: async ({ pending, challenge }) => {
        activationEntered();
        await activationBarrier;
        return challengeRepository.confirmDelivered({
          challengeId: challenge._id,
          pendingOnboardingId: pending._id,
          businessId: pending.business,
          now: new Date(),
        });
      },
    });

    await activationEnteredPromise;
    const before = await TenantOnboardingChallenge.findOne({
      pendingOnboarding: delivery.onboardingId,
    });
    assert.equal(before.deliveredAt, null);
    await assert.rejects(
      bindNew({ onboardingId: delivery.onboardingId, secret: delivery.challengeSecret }),
      bindingFailure,
    );

    releaseActivation();
    const result = await issuing;
    const after = await TenantOnboardingChallenge.findOne({ pendingOnboarding: result.onboardingId });
    const pending = await PendingOnboarding.findById(result.onboardingId);
    assert.ok(after.deliveredAt instanceof Date);
    assert.equal(after.pendingOnboarding.toString(), result.onboardingId.toString());
    assert.equal(after.expiresAt.getTime(), pending.expiresAt.getTime());
  });

  await t.test("delivery failure remains non-bindable even when cleanup also fails", async () => {
    const email = `delivery-cleanup-fail-${suffix}@example.com`;
    let delivery;
    await assert.rejects(
      issueTenantOnboarding({
        businessId: seed.business._id,
        issuerUserId: seed.admin._id,
        email,
        deliver: async (payload) => {
          delivery = payload;
          return false;
        },
        cleanupUndelivered: async () => { throw new Error("cleanup unavailable"); },
      }),
      deliveryFailure,
    );

    const challenge = await TenantOnboardingChallenge.findOne({ pendingOnboarding: delivery.onboardingId });
    assert.equal(challenge.status, "pending");
    assert.equal(challenge.deliveredAt, null);
    await assert.rejects(
      bindNew({ onboardingId: delivery.onboardingId, secret: delivery.challengeSecret }),
      bindingFailure,
    );
  });

  await t.test("ambiguous provider error cannot create a functional bearer without DB confirmation", async () => {
    const email = `provider-ambiguous-${suffix}@example.com`;
    let delivery;
    await assert.rejects(
      issueTenantOnboarding({
        businessId: seed.business._id,
        issuerUserId: seed.admin._id,
        email,
        deliver: async (payload) => {
          delivery = payload;
          throw new Error("provider result unknown");
        },
        cleanupUndelivered: async () => { throw new Error("cleanup unavailable"); },
      }),
      deliveryFailure,
    );

    const challenge = await TenantOnboardingChallenge.findOne({ pendingOnboarding: delivery.onboardingId });
    assert.equal(challenge.deliveredAt, null);
    await assert.rejects(
      bindNew({ onboardingId: delivery.onboardingId, secret: delivery.challengeSecret }),
      bindingFailure,
    );
  });

  await t.test("delivery success plus activation failure leaves the mailed bearer unusable", async () => {
    const email = `activation-fail-${suffix}@example.com`;
    let delivery;
    await assert.rejects(
      issueTenantOnboarding({
        businessId: seed.business._id,
        issuerUserId: seed.admin._id,
        email,
        deliver: async (payload) => {
          delivery = payload;
          return true;
        },
        activateDelivery: async () => null,
        cleanupUndelivered: async () => { throw new Error("cleanup unavailable"); },
      }),
      deliveryFailure,
    );

    const challenge = await TenantOnboardingChallenge.findOne({ pendingOnboarding: delivery.onboardingId });
    assert.equal(challenge.deliveredAt, null);
    await assert.rejects(
      bindNew({ onboardingId: delivery.onboardingId, secret: delivery.challengeSecret }),
      bindingFailure,
    );
  });
});

test("C2 exact-account proof budget is persistent, grant-scoped and concurrency-safe", async (t) => {
  await t.test("wrong secret never consumes account-proof attempts", async () => {
    const email = `wrong-secret-budget-${suffix}@example.com`;
    await createExistingUser({ email, password: "rightPassword" });
    const issued = await issue({ email });
    const wrongSecret = issued.delivery.challengeSecret === "Z".repeat(43)
      ? "Y".repeat(43)
      : "Z".repeat(43);

    await assert.rejects(
      bindExisting({ onboardingId: issued.result.onboardingId, secret: wrongSecret, password: "wrong" }),
      bindingFailure,
    );
    let challenge = await TenantOnboardingChallenge.findOne({ pendingOnboarding: issued.result.onboardingId });
    assert.equal(challenge.accountProofAttempts, 0);

    await assert.rejects(
      bindExisting({ onboardingId: issued.result.onboardingId, secret: issued.delivery.challengeSecret, password: "wrong" }),
      bindingFailure,
    );
    challenge = await TenantOnboardingChallenge.findOne({ pendingOnboarding: issued.result.onboardingId });
    assert.equal(challenge.accountProofAttempts, 1);
  });

  await t.test("failed passwords consume the grant budget and exhaustion blocks later correct password", async () => {
    const email = `budget-exhaust-${suffix}@example.com`;
    const user = await createExistingUser({ email, password: "correctAfterWrong" });
    const issued = await issue({ email });

    for (let attempt = 0; attempt < TENANT_ONBOARDING_ACCOUNT_PROOF_MAX_ATTEMPTS; attempt += 1) {
      await assert.rejects(
        bindExisting({
          onboardingId: issued.result.onboardingId,
          secret: issued.delivery.challengeSecret,
          password: `wrong-${attempt}`,
        }),
        bindingFailure,
      );
    }

    const exhausted = await TenantOnboardingChallenge.findOne({ pendingOnboarding: issued.result.onboardingId });
    assert.equal(exhausted.accountProofAttempts, TENANT_ONBOARDING_ACCOUNT_PROOF_MAX_ATTEMPTS);

    await assert.rejects(
      bindExisting({
        onboardingId: issued.result.onboardingId,
        secret: issued.delivery.challengeSecret,
        password: "correctAfterWrong",
      }),
      bindingFailure,
    );
    const pending = await PendingOnboarding.findById(issued.result.onboardingId);
    assert.equal(pending.accountBinding, null);
    assert.equal(await Membership.exists({ user: user._id, business: seed.business._id }), null);
  });

  await t.test("correct password before the limit still binds the exact User", async () => {
    const email = `budget-success-${suffix}@example.com`;
    const user = await createExistingUser({ email, password: "finalCorrectPassword" });
    const issued = await issue({ email });

    for (let attempt = 1; attempt < TENANT_ONBOARDING_ACCOUNT_PROOF_MAX_ATTEMPTS; attempt += 1) {
      await assert.rejects(
        bindExisting({
          onboardingId: issued.result.onboardingId,
          secret: issued.delivery.challengeSecret,
          password: `wrong-before-${attempt}`,
        }),
        bindingFailure,
      );
    }

    await bindExisting({
      onboardingId: issued.result.onboardingId,
      secret: issued.delivery.challengeSecret,
      password: "finalCorrectPassword",
    });
    const challenge = await TenantOnboardingChallenge.findOne({ pendingOnboarding: issued.result.onboardingId });
    const pending = await PendingOnboarding.findById(issued.result.onboardingId);
    assert.equal(challenge.accountProofAttempts, TENANT_ONBOARDING_ACCOUNT_PROOF_MAX_ATTEMPTS);
    assert.equal(challenge.status, "consumed");
    assert.equal(pending.accountBinding.user.toString(), user._id.toString());
  });

  await t.test("concurrent password attempts cannot reserve more than the persisted maximum", async () => {
    const email = `budget-race-${suffix}@example.com`;
    await createExistingUser({ email, password: "neverReached" });
    const issued = await issue({ email });

    const attempts = await Promise.allSettled(Array.from({ length: 12 }, (_, index) => (
      bindExisting({
        onboardingId: issued.result.onboardingId,
        secret: issued.delivery.challengeSecret,
        password: `concurrent-wrong-${index}`,
      })
    )));
    assert.equal(attempts.filter((entry) => entry.status === "fulfilled").length, 0);

    const challenge = await TenantOnboardingChallenge.findOne({ pendingOnboarding: issued.result.onboardingId });
    assert.equal(challenge.accountProofAttempts, TENANT_ONBOARDING_ACCOUNT_PROOF_MAX_ATTEMPTS);
  });

  await t.test("changing apparent client IP cannot evade the logical challenge budget", async () => {
    const email = `budget-ip-${suffix}@example.com`;
    await createExistingUser({ email, password: "correctAcrossIps" });
    const issued = await issue({ email });

    // Test-only proxy simulation: each request presents a distinct apparent IP.
    // The security property remains challenge-owned in Mongo, independent of IP.
    app.set("trust proxy", 1);
    try {
      for (let attempt = 0; attempt < TENANT_ONBOARDING_ACCOUNT_PROOF_MAX_ATTEMPTS; attempt += 1) {
        const response = await request(`/team/onboardings/${issued.result.onboardingId}/bind`, {
          headers: { "X-Forwarded-For": `198.51.100.${attempt + 10}` },
          body: {
            secret: issued.delivery.challengeSecret,
            account: { mode: "existing", password: `wrong-ip-${attempt}` },
          },
        });
        assert.equal(response.status, 400);
      }

      const finalResponse = await request(`/team/onboardings/${issued.result.onboardingId}/bind`, {
        headers: { "X-Forwarded-For": "203.0.113.200" },
        body: {
          secret: issued.delivery.challengeSecret,
          account: { mode: "existing", password: "correctAcrossIps" },
        },
      });
      assert.equal(finalResponse.status, 400);
    } finally {
      app.set("trust proxy", false);
    }

    const challenge = await TenantOnboardingChallenge.findOne({ pendingOnboarding: issued.result.onboardingId });
    assert.equal(challenge.accountProofAttempts, TENANT_ONBOARDING_ACCOUNT_PROOF_MAX_ATTEMPTS);
  });
});

test.after(async () => {
  await teardown(server, sessionStore);
});
