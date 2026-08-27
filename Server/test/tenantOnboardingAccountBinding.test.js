import "./setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import app, { sessionStore } from "../src/app.js";
import { connectDB } from "../src/db/db.js";
import { cleanTestData, seedTestData, teardown } from "./fixtures.js";
import ClientContactVerification from "../src/db/models/clientContactVerification.model.js";
import Membership from "../src/db/models/membership.model.js";
import PendingOnboarding from "../src/db/models/pendingOnboarding.model.js";
import TenantOnboardingChallenge from "../src/db/models/tenantOnboardingChallenge.model.js";
import User from "../src/db/models/user.model.js";
import {
  consumeExactVerificationForBusiness,
  issueVerificationForBusiness,
} from "../src/services/clientContactVerification.service.js";
import {
  TENANT_ONBOARDING_TTL_MS,
  bindTenantOnboardingAccount,
  issueTenantOnboarding,
} from "../src/services/tenantOnboarding.service.js";
import { createHash, isValidPassword } from "../src/utils/password.js";

await connectDB();
await cleanTestData();
const seed = await seedTestData();
await PendingOnboarding.init();
await TenantOnboardingChallenge.init();
await ClientContactVerification.init();
await User.init();

const server = app.listen(0);
const { port } = server.address();
const baseUrl = `http://localhost:${port}/api`;
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const delivered = new Map();

app.locals.tenantOnboardingDeliver = async (payload) => {
  delivered.set(payload.destination, payload);
  return true;
};

const request = async (path, { method = "GET", cookie, body } = {}) => fetch(`${baseUrl}${path}`, {
  method,
  headers: {
    ...(cookie ? { Cookie: cookie } : {}),
    ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
  },
  ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
});

const login = async (email, password) => {
  const response = await request("/login", { method: "POST", body: { email, password } });
  assert.ok(response.status === 200 || response.status === 201, `login ${email}: ${response.status}`);
  return response.headers.get("set-cookie");
};

const adminCookie = await login("test-admin@example.com", "passwordAdmin");
const workerCookie = await login("test-worker@example.com", "passwordWorker");

const directIssue = async ({
  email,
  businessId = seed.business._id,
  issuerUserId = seed.admin._id,
} = {}) => {
  let delivery;
  const result = await issueTenantOnboarding({
    businessId,
    issuerUserId,
    email,
    deliver: async (payload) => {
      delivery = payload;
      return true;
    },
  });
  assert.ok(delivery?.challengeSecret);
  return { result, delivery };
};

const createPlainUser = async ({
  email,
  password = "candidatePassword",
  active = true,
  passwordHash,
  business,
} = {}) => User.create({
  firstName: "Candidate",
  lastName: "Person",
  email: [email],
  password: passwordHash || await createHash(password),
  role: "user",
  ...(business ? { business } : {}),
  isActive: active,
});

const membershipCount = () => Membership.countDocuments();
const genericBindingFailure = (error) => error?.code === "TENANT_ONBOARDING_BINDING_FAILED";

test("C2 administrative issuance is admin-only, server-scoped and non-enumerating", async (t) => {
  await t.test("active tenant admin is required", async () => {
    const noSession = await request("/team/onboardings", {
      method: "POST",
      body: { email: `unauth-${suffix}@example.com` },
    });
    assert.equal(noSession.status, 401);

    const worker = await request("/team/onboardings", {
      method: "POST",
      cookie: workerCookie,
      body: { email: `worker-${suffix}@example.com` },
    });
    assert.equal(worker.status, 403);
  });

  await t.test("caller cannot inject Business, issuer or onboarding policy", async () => {
    const response = await request("/team/onboardings", {
      method: "POST",
      cookie: adminCookie,
      body: {
        email: `inject-${suffix}@example.com`,
        businessId: seed.businessB._id.toString(),
        issuer: seed.userB._id.toString(),
        role: "admin",
        isBookable: true,
        purpose: "contact-control",
        channel: "sms",
      },
    });
    assert.equal(response.status, 400);
  });

  await t.test("response shape does not reveal whether a global User exists", async () => {
    const existingEmail = `oracle-existing-${suffix}@example.com`;
    const newEmail = `oracle-new-${suffix}@example.com`;
    await createPlainUser({ email: existingEmail });

    const before = Date.now();
    const existingResponse = await request("/team/onboardings", {
      method: "POST",
      cookie: adminCookie,
      body: { email: existingEmail.toUpperCase() },
    });
    const newResponse = await request("/team/onboardings", {
      method: "POST",
      cookie: adminCookie,
      body: { email: `  ${newEmail.toUpperCase()}  ` },
    });

    assert.equal(existingResponse.status, 202);
    assert.equal(newResponse.status, 202);
    const existingBody = await existingResponse.json();
    const newBody = await newResponse.json();
    assert.deepEqual(Object.keys(existingBody.payload).sort(), ["accepted", "expiresAt", "onboardingId"]);
    assert.deepEqual(Object.keys(newBody.payload).sort(), ["accepted", "expiresAt", "onboardingId"]);
    assert.equal(existingBody.payload.accepted, true);
    assert.equal(newBody.payload.accepted, true);

    for (const body of [existingBody, newBody]) {
      const serialized = JSON.stringify(body);
      assert.doesNotMatch(serialized, /userExists|candidate|membership|otherBusiness|conflict/iu);
    }

    const existingPending = await PendingOnboarding.findById(existingBody.payload.onboardingId);
    const newPending = await PendingOnboarding.findById(newBody.payload.onboardingId);
    for (const [pending, expectedEmail] of [[existingPending, existingEmail], [newPending, newEmail]]) {
      assert.equal(pending.business.toString(), seed.business._id.toString());
      assert.equal(pending.issuer.toString(), seed.admin._id.toString());
      assert.equal(pending.email, expectedEmail);
      assert.equal(pending.channel, "email");
      assert.equal(pending.purpose, "tenant-onboarding");
      assert.equal(pending.role, "worker");
      assert.equal(pending.isBookable, false);
      assert.equal(pending.status, "pending");
      assert.equal(pending.accountBinding, null);
      assert.ok(pending.expiresAt.getTime() > before + TENANT_ONBOARDING_TTL_MS - 5_000);
      assert.ok(pending.expiresAt.getTime() <= Date.now() + TENANT_ONBOARDING_TTL_MS);

      const challenge = await TenantOnboardingChallenge.findOne({ pendingOnboarding: pending._id })
        .select("+secretHash");
      assert.ok(challenge);
      assert.equal(challenge.business.toString(), pending.business.toString());
      assert.equal(challenge.channel, pending.channel);
      assert.equal(challenge.destination, pending.email);
      assert.equal(challenge.purpose, pending.purpose);
      assert.equal(challenge.expiresAt.getTime(), pending.expiresAt.getTime());
      assert.equal(challenge.status, "pending");
      assert.match(challenge.secretHash, /^[0-9a-f]{64}$/u);
      assert.equal(challenge.get("secret"), undefined);
      assert.equal(challenge.get("challengeSecret"), undefined);
      assert.notEqual(challenge.secretHash, delivered.get(expectedEmail).challengeSecret);
    }
  });
});

test("C2 existing User binding requires channel proof plus control of the exact account", async (t) => {
  await t.test("valid channel proof alone and wrong account password produce zero binding", async () => {
    const email = `existing-wrong-${suffix}@example.com`;
    const candidate = await createPlainUser({ email, password: "correctExistingPassword" });
    const beforePassword = (await User.findById(candidate._id).select("+password")).password;
    const membershipsBefore = await membershipCount();
    const { result, delivery } = await directIssue({ email });

    await assert.rejects(
      bindTenantOnboardingAccount({
        onboardingId: result.onboardingId,
        secret: delivery.challengeSecret,
        account: { mode: "existing", password: "wrong-password" },
      }),
      genericBindingFailure,
    );

    const pending = await PendingOnboarding.findById(result.onboardingId);
    const challenge = await TenantOnboardingChallenge.findOne({ pendingOnboarding: result.onboardingId });
    const after = await User.findById(candidate._id).select("+password");
    assert.equal(pending.accountBinding, null);
    assert.equal(pending.status, "pending");
    assert.equal(challenge.status, "pending");
    assert.equal(challenge.consumedAt, null);
    assert.equal(after.password, beforePassword);
    assert.equal(await User.countDocuments({ email }), 1);
    assert.equal(await membershipCount(), membershipsBefore);
  });

  await t.test("exact current password binds that exact active User and replay fails", async () => {
    const email = `existing-ok-${suffix}@example.com`;
    const candidate = await createPlainUser({ email, password: "exactAccountPassword" });
    const membershipsBefore = await membershipCount();
    const { result, delivery } = await directIssue({ email });

    const bound = await bindTenantOnboardingAccount({
      onboardingId: result.onboardingId,
      secret: delivery.challengeSecret,
      account: { mode: "existing", password: "exactAccountPassword" },
    });
    assert.deepEqual(bound, { bound: true, onboardingId: result.onboardingId });

    const pending = await PendingOnboarding.findById(result.onboardingId);
    const challenge = await TenantOnboardingChallenge.findOne({ pendingOnboarding: result.onboardingId });
    assert.equal(pending.accountBinding.user.toString(), candidate._id.toString());
    assert.equal(pending.accountBinding.challenge.toString(), challenge._id.toString());
    assert.ok(pending.accountBinding.boundAt instanceof Date);
    assert.equal(pending.status, "pending");
    assert.equal(challenge.status, "consumed");
    assert.equal(challenge.boundUser.toString(), candidate._id.toString());
    assert.equal(await membershipCount(), membershipsBefore);

    await assert.rejects(
      bindTenantOnboardingAccount({
        onboardingId: result.onboardingId,
        secret: delivery.challengeSecret,
        account: { mode: "existing", password: "exactAccountPassword" },
      }),
      genericBindingFailure,
    );
    const afterReplay = await PendingOnboarding.findById(result.onboardingId);
    assert.equal(afterReplay.accountBinding.user.toString(), candidate._id.toString());
  });

  await t.test("pre-registered attacker account cannot be transferred by mailbox control", async () => {
    const email = `victim-${suffix}@example.com`;
    const attacker = await createPlainUser({ email, password: "attacker-secret" });
    const beforePassword = (await User.findById(attacker._id).select("+password")).password;
    const membershipsBefore = await membershipCount();
    const { result, delivery } = await directIssue({ email });

    await assert.rejects(
      bindTenantOnboardingAccount({
        onboardingId: result.onboardingId,
        secret: delivery.challengeSecret,
        account: { mode: "existing", password: "victim-controls-only-mailbox" },
      }),
      genericBindingFailure,
    );

    const pending = await PendingOnboarding.findById(result.onboardingId);
    const persisted = await User.findById(attacker._id).select("+password");
    assert.equal(pending.accountBinding, null);
    assert.equal(persisted.password, beforePassword);
    assert.equal(await User.countDocuments({ email }), 1);
    assert.equal(await membershipCount(), membershipsBefore);
  });

  await t.test("inactive, non-password-backed and already-member Users fail closed", async () => {
    const cases = [
      {
        email: `inactive-${suffix}@example.com`,
        create: () => createPlainUser({
          email: `inactive-${suffix}@example.com`,
          password: "inactivePassword",
          active: false,
        }),
        password: "inactivePassword",
      },
      {
        email: `oauth-${suffix}@example.com`,
        create: () => createPlainUser({
          email: `oauth-${suffix}@example.com`,
          passwordHash: "OAUTH_USER_NO_PASSWORD",
        }),
        password: "anything",
      },
      {
        email: `member-${suffix}@example.com`,
        create: async () => {
          const user = await createPlainUser({
            email: `member-${suffix}@example.com`,
            password: "memberPassword",
          });
          await Membership.create({
            user: user._id,
            business: seed.business._id,
            role: "worker",
            isBookable: false,
            isActive: false,
          });
          return user;
        },
        password: "memberPassword",
      },
    ];

    for (const fixture of cases) {
      const candidate = await fixture.create();
      const membershipsBefore = await membershipCount();
      const { result, delivery } = await directIssue({ email: fixture.email });
      await assert.rejects(
        bindTenantOnboardingAccount({
          onboardingId: result.onboardingId,
          secret: delivery.challengeSecret,
          account: { mode: "existing", password: fixture.password },
        }),
        genericBindingFailure,
      );
      const after = await User.findById(candidate._id);
      const pending = await PendingOnboarding.findById(result.onboardingId);
      assert.equal(after.isActive, candidate.isActive);
      assert.equal(pending.accountBinding, null);
      assert.equal(await membershipCount(), membershipsBefore);
    }
  });
});

test("C2 new User creation is claimant-controlled, minimal and atomic with binding", async (t) => {
  await t.test("proved mailbox can create its own global User without tenant authority", async () => {
    const email = `new-${suffix}@example.com`;
    const chosenPassword = "claimantChosenPassword";
    const membershipsBefore = await membershipCount();
    const { result, delivery } = await directIssue({ email });

    await bindTenantOnboardingAccount({
      onboardingId: result.onboardingId,
      secret: delivery.challengeSecret,
      account: {
        mode: "new",
        firstName: "Nueva",
        lastName: "Persona",
        password: chosenPassword,
      },
    });

    const created = await User.findOne({ email }).select("+password");
    const pending = await PendingOnboarding.findById(result.onboardingId);
    const challenge = await TenantOnboardingChallenge.findOne({ pendingOnboarding: result.onboardingId });
    assert.ok(created);
    assert.equal(created.role, "user");
    assert.equal(created.business, undefined);
    assert.equal(created.isActive, true);
    assert.equal(await isValidPassword(chosenPassword, created.password), true);
    assert.equal(pending.accountBinding.user.toString(), created._id.toString());
    assert.equal(pending.status, "pending");
    assert.equal(challenge.status, "consumed");
    assert.equal(await Membership.exists({ user: created._id }), null);
    assert.equal(await membershipCount(), membershipsBefore);
  });

  await t.test("claimant cannot select arbitrary User or elevate grant policy", async () => {
    const email = `strict-bind-${suffix}@example.com`;
    const { result, delivery } = await directIssue({ email });
    const response = await request(`/team/onboardings/${result.onboardingId}/bind`, {
      method: "POST",
      body: {
        secret: delivery.challengeSecret,
        account: {
          mode: "new",
          firstName: "Strict",
          lastName: "Claimant",
          password: "strictPassword",
          userId: seed.admin._id.toString(),
          business: seed.businessB._id.toString(),
          role: "admin",
          isBookable: true,
          issuer: seed.userB._id.toString(),
          purpose: "contact-control",
          channel: "sms",
        },
      },
    });
    assert.equal(response.status, 400);
    const pending = await PendingOnboarding.findById(result.onboardingId);
    assert.equal(pending.accountBinding, null);
    assert.equal(await User.exists({ email }), null);
  });
});

test("C2 challenge scope and legacy verification purposes are strictly separated", async (t) => {
  await t.test("challenge from another Business or onboarding cannot authorize binding", async () => {
    const first = await directIssue({ email: `scope-a-${suffix}@example.com` });
    const second = await directIssue({ email: `scope-b-${suffix}@example.com` });
    const foreignBusiness = await directIssue({
      email: `scope-business-b-${suffix}@example.com`,
      businessId: seed.businessB._id,
      issuerUserId: seed.userB._id,
    });

    await assert.rejects(
      bindTenantOnboardingAccount({
        onboardingId: second.result.onboardingId,
        secret: first.delivery.challengeSecret,
        account: { mode: "new", firstName: "Wrong", lastName: "Grant", password: "password1" },
      }),
      genericBindingFailure,
    );
    await assert.rejects(
      bindTenantOnboardingAccount({
        onboardingId: foreignBusiness.result.onboardingId,
        secret: first.delivery.challengeSecret,
        account: { mode: "new", firstName: "Wrong", lastName: "Tenant", password: "password1" },
      }),
      genericBindingFailure,
    );
  });

  await t.test("contact-control and Appointment verification cannot bind Team onboarding", async () => {
    const email = `purpose-separation-${suffix}@example.com`;
    const team = await directIssue({ email });

    for (const purpose of ["contact-control", "appointment-read-bootstrap"]) {
      const legacy = await issueVerificationForBusiness({
        businessId: seed.business._id,
        channel: "email",
        destination: email,
        purpose,
      });

      await assert.rejects(
        bindTenantOnboardingAccount({
          onboardingId: team.result.onboardingId,
          secret: legacy.secret,
          account: { mode: "new", firstName: "Wrong", lastName: "Purpose", password: "password1" },
        }),
        genericBindingFailure,
      );
    }

    const teamChallenge = await TenantOnboardingChallenge.findOne({
      pendingOnboarding: team.result.onboardingId,
    });
    await assert.rejects(
      consumeExactVerificationForBusiness({
        verificationId: teamChallenge._id,
        businessId: seed.business._id,
        purpose: "appointment-read-bootstrap",
        secret: team.delivery.challengeSecret,
      }),
      /Verification no válida/u,
    );
  });
});

test("C2 rejects unusable grants/challenges without consuming the grant", async (t) => {
  const cases = [
    {
      name: "expired grant",
      mutate: (pending) => PendingOnboarding.updateOne(
        { _id: pending._id },
        { $set: { expiresAt: new Date(Date.now() - 1_000) } },
      ),
    },
    {
      name: "revoked grant",
      mutate: (pending) => PendingOnboarding.updateOne({ _id: pending._id }, { $set: { status: "revoked" } }),
    },
    {
      name: "consumed grant",
      mutate: (pending) => PendingOnboarding.updateOne({ _id: pending._id }, { $set: { status: "consumed" } }),
    },
    {
      name: "expired challenge",
      mutate: (pending) => TenantOnboardingChallenge.updateOne(
        { pendingOnboarding: pending._id },
        { $set: { expiresAt: new Date(Date.now() - 1_000) } },
      ),
    },
    {
      name: "used challenge",
      mutate: (pending) => TenantOnboardingChallenge.updateOne(
        { pendingOnboarding: pending._id },
        { $set: { status: "consumed", consumedAt: new Date() } },
      ),
    },
  ];

  for (const fixture of cases) {
    await t.test(fixture.name, async () => {
      const email = `${fixture.name.replaceAll(" ", "-")}-${suffix}@example.com`;
      const issued = await directIssue({ email });
      const pendingBefore = await PendingOnboarding.findById(issued.result.onboardingId);
      await fixture.mutate(pendingBefore);

      await assert.rejects(
        bindTenantOnboardingAccount({
          onboardingId: issued.result.onboardingId,
          secret: issued.delivery.challengeSecret,
          account: { mode: "new", firstName: "State", lastName: "Blocked", password: "password1" },
        }),
        genericBindingFailure,
      );
      const after = await PendingOnboarding.findById(issued.result.onboardingId);
      assert.equal(after.accountBinding, null);
      assert.equal(await User.exists({ email }), null);
    });
  }
});

test("C2 concurrency never produces last-write-wins or account takeover", async (t) => {
  await t.test("two simultaneous binds leave at most one exact User bound", async () => {
    const email = `concurrent-bind-${suffix}@example.com`;
    const issued = await directIssue({ email });
    const attempts = await Promise.allSettled([
      bindTenantOnboardingAccount({
        onboardingId: issued.result.onboardingId,
        secret: issued.delivery.challengeSecret,
        account: { mode: "new", firstName: "First", lastName: "Claimant", password: "passwordOne" },
      }),
      bindTenantOnboardingAccount({
        onboardingId: issued.result.onboardingId,
        secret: issued.delivery.challengeSecret,
        account: { mode: "new", firstName: "Second", lastName: "Claimant", password: "passwordTwo" },
      }),
    ]);

    assert.equal(attempts.filter((entry) => entry.status === "fulfilled").length, 1);
    assert.equal(attempts.filter((entry) => entry.status === "rejected").length, 1);
    const users = await User.find({ email });
    assert.equal(users.length, 1);
    const pending = await PendingOnboarding.findById(issued.result.onboardingId);
    assert.equal(pending.accountBinding.user.toString(), users[0]._id.toString());
    assert.equal(pending.status, "pending");
  });

  await t.test("race between absence check and external User creation fails closed on the losing side", async () => {
    const email = `creation-race-${suffix}@example.com`;
    const issued = await directIssue({ email });
    const externalId = new mongoose.Types.ObjectId();
    const externalPassword = await createHash("externalOwnerPassword");

    const [bindingAttempt, externalAttempt] = await Promise.allSettled([
      bindTenantOnboardingAccount({
        onboardingId: issued.result.onboardingId,
        secret: issued.delivery.challengeSecret,
        account: { mode: "new", firstName: "Mailbox", lastName: "Owner", password: "mailboxPassword" },
      }),
      User.create({
        _id: externalId,
        firstName: "External",
        lastName: "Racer",
        email: [email],
        password: externalPassword,
        role: "user",
        isActive: true,
      }),
    ]);

    const users = await User.find({ email });
    assert.equal(users.length, 1);
    const pending = await PendingOnboarding.findById(issued.result.onboardingId);

    if (externalAttempt.status === "fulfilled") {
      assert.equal(bindingAttempt.status, "rejected");
      assert.equal(users[0]._id.toString(), externalId.toString());
      assert.equal(pending.accountBinding, null);
    } else {
      assert.equal(bindingAttempt.status, "fulfilled");
      assert.notEqual(users[0]._id.toString(), externalId.toString());
      assert.equal(pending.accountBinding.user.toString(), users[0]._id.toString());
    }

    assert.notEqual(pending.accountBinding?.user?.toString(), externalId.toString());
    assert.equal(await Membership.exists({ user: users[0]._id }), null);
  });
});

test.after(async () => {
  delete app.locals.tenantOnboardingDeliver;
  await teardown(server, sessionStore);
});
