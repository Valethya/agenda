import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mongo } from "mongoose";
import {
  PRODUCTION_OWNER_BOOTSTRAP_CONFIRMATION,
  buildProductionOwnerManifest,
  buildProductionOwnerPlan,
  createProductionOwnerDocuments,
  parseProductionOwnerBootstrapArgs,
  validateProductionOwnerRuntime,
  verifyProductionOwnerReadyState,
} from "../../scripts/bootstrap/production-initial-owners.js";

const DEPLOYMENT_SHA = "a".repeat(40);
const processEnvironment = (extra = {}) => ({
  NODE_ENV: "production",
  RAILWAY_ENVIRONMENT_NAME: "production",
  RAILWAY_GIT_BRANCH: "master",
  RAILWAY_PROJECT_ID: "project-id",
  RAILWAY_SERVICE_ID: "service-id",
  RAILWAY_DEPLOYMENT_ID: "deployment-id",
  RAILWAY_GIT_COMMIT_SHA: DEPLOYMENT_SHA,
  ...extra,
});

const ownerEnvironment = () => ({
  PRODUCTION_BOOTSTRAP_ATMOSFERA_FIRST_NAME: "Owner",
  PRODUCTION_BOOTSTRAP_ATMOSFERA_LAST_NAME: "Atmósfera",
  PRODUCTION_BOOTSTRAP_ATMOSFERA_EMAIL: "owner-atmosfera@example.test",
  PRODUCTION_BOOTSTRAP_ATMOSFERA_PASSWORD: "atmosfera-owner-safe",
  PRODUCTION_BOOTSTRAP_DAM_FIRST_NAME: "Owner",
  PRODUCTION_BOOTSTRAP_DAM_LAST_NAME: "DAM",
  PRODUCTION_BOOTSTRAP_DAM_EMAIL: "owner-dam@example.test",
  PRODUCTION_BOOTSTRAP_DAM_PASSWORD: "dam-owner-password",
});

const exactBusinessIndex = () => ({ name: "slug_1", key: { slug: 1 }, unique: true });
const exactUserIndex = () => ({ name: "email_1", key: { email: 1 }, unique: true });
const exactMembershipIndex = () => ({
  name: "user_1_business_1",
  key: { user: 1, business: 1 },
  unique: true,
});

const readySource = (manifest) => {
  const businessIds = new Map(
    manifest.businesses.map((business) => [business.key, new mongo.ObjectId()]),
  );
  const userIds = new Map(
    manifest.users.map((user) => [user.key, new mongo.ObjectId()]),
  );
  const businesses = manifest.businesses.map((business) => ({
    _id: businessIds.get(business.key),
    name: business.name,
    slug: business.slug,
    isActive: true,
    subscriptionStatus: "active",
    owner: userIds.get(`${business.key}-admin`),
  }));
  const users = manifest.users.map((user) => ({
    _id: userIds.get(user.key),
    firstName: user.firstName,
    lastName: user.lastName,
    email: [user.email],
    password: `hash:${user.password}`,
    role: "admin",
    isActive: true,
  }));
  const memberships = manifest.memberships.map((membership) => ({
    _id: new mongo.ObjectId(),
    user: userIds.get(membership.userKey),
    business: businessIds.get(membership.businessKey),
    role: "admin",
    isActive: true,
  }));
  return {
    observedCollections: ["auditlogs", "businesses", "memberships", "users"],
    businessIndexes: [exactBusinessIndex()],
    userIndexes: [exactUserIndex()],
    membershipIndexes: [exactMembershipIndex()],
    businesses,
    users,
    memberships,
  };
};

const fakePasswordVerifier = async (password, hash) => hash === `hash:${password}`;

describe("production initial owner bootstrap runtime guards", () => {
  it("acepta sólo Railway production/master con deployment SHA identificable", () => {
    assert.deepEqual(
      validateProductionOwnerRuntime({ mode: "plan" }, processEnvironment()),
      { deploymentSha: DEPLOYMENT_SHA },
    );
    assert.throws(
      () => validateProductionOwnerRuntime({ mode: "plan" }, processEnvironment({ NODE_ENV: "test" })),
      /NODE_ENV=production/u,
    );
    assert.throws(
      () => validateProductionOwnerRuntime(
        { mode: "plan" },
        processEnvironment({ RAILWAY_ENVIRONMENT_NAME: "staging" }),
      ),
      /Railway production/u,
    );
    assert.throws(
      () => validateProductionOwnerRuntime(
        { mode: "plan" },
        processEnvironment({ RAILWAY_GIT_BRANCH: "feature" }),
      ),
      /master/u,
    );
    assert.throws(
      () => validateProductionOwnerRuntime(
        { mode: "plan" },
        processEnvironment({ RAILWAY_DEPLOYMENT_ID: "" }),
      ),
      /deployment Railway/u,
    );
  });

  it("apply exige SHA exacto, fingerprint válido y confirmación literal", () => {
    const valid = {
      mode: "apply",
      approvedSha: DEPLOYMENT_SHA,
      expectedTargetFingerprint: "b".repeat(64),
      confirm: PRODUCTION_OWNER_BOOTSTRAP_CONFIRMATION,
    };
    const options = { ...valid };
    assert.deepEqual(
      validateProductionOwnerRuntime(options, processEnvironment()),
      { deploymentSha: DEPLOYMENT_SHA },
    );
    assert.equal(options.expectedTargetFingerprint, "b".repeat(64));

    assert.throws(
      () => validateProductionOwnerRuntime(
        { ...valid, approvedSha: "c".repeat(40) },
        processEnvironment(),
      ),
      /SHA aprobado/u,
    );
    assert.throws(
      () => validateProductionOwnerRuntime(
        { ...valid, confirm: "YES" },
        processEnvironment(),
      ),
      /confirm/u,
    );
    assert.throws(
      () => validateProductionOwnerRuntime(
        { ...valid, expectedTargetFingerprint: "bad" },
        processEnvironment(),
      ),
    );
  });

  it("CLI rechaza opciones desconocidas y duplicadas", () => {
    assert.deepEqual(
      parseProductionOwnerBootstrapArgs(["--mode=plan"]),
      { mode: "plan" },
    );
    assert.throws(
      () => parseProductionOwnerBootstrapArgs(["--mode=plan", "--mode=apply"]),
      /duplicada/u,
    );
    assert.throws(
      () => parseProductionOwnerBootstrapArgs(["--database=agenda"]),
      /no reconocida/u,
    );
  });
});

describe("production owner manifest and plan", () => {
  it("crea exactamente dos admins y dos Memberships sin workers", () => {
    const manifest = buildProductionOwnerManifest(ownerEnvironment());
    assert.equal(manifest.businesses.length, 2);
    assert.equal(manifest.users.length, 2);
    assert.equal(manifest.memberships.length, 2);
    assert.ok(manifest.users.every((user) => user.role === "admin"));
    assert.ok(manifest.memberships.every((membership) => membership.role === "admin"));
    assert.equal(JSON.stringify(manifest).includes("worker"), false);
  });

  it("plan ignora colecciones ajenas y exige los tres índices únicos físicos", () => {
    assert.deepEqual(
      buildProductionOwnerPlan({
        observedCollections: ["auditlogs"],
        businessIndexes: [],
        userIndexes: [],
        membershipIndexes: [],
        businesses: [],
        users: [],
        memberships: [],
      }),
      {
        version: "1.0.0",
        state: "empty",
        canApply: true,
        counts: { businesses: 0, users: 0, memberships: 0 },
        storage: {
          business: { exactUniqueExists: false, canCreateTransactionally: true },
          user: { exactUniqueExists: false, canCreateTransactionally: true },
          membership: { exactUniqueExists: false, canCreateTransactionally: true },
        },
      },
    );

    const blocked = buildProductionOwnerPlan({
      observedCollections: ["auditlogs", "memberships"],
      businessIndexes: [],
      userIndexes: [],
      membershipIndexes: [],
      businesses: [],
      users: [],
      memberships: [],
    });
    assert.equal(blocked.state, "empty");
    assert.equal(blocked.canApply, false);
    assert.equal(blocked.storage.membership.canCreateTransactionally, false);

    const readyStorage = buildProductionOwnerPlan({
      observedCollections: ["businesses", "memberships", "users"],
      businessIndexes: [exactBusinessIndex()],
      userIndexes: [exactUserIndex()],
      membershipIndexes: [exactMembershipIndex()],
      businesses: [],
      users: [],
      memberships: [],
    });
    assert.equal(readyStorage.canApply, true);
    assert.equal(readyStorage.storage.business.exactUniqueExists, true);
    assert.equal(readyStorage.storage.user.exactUniqueExists, true);
    assert.equal(readyStorage.storage.membership.exactUniqueExists, true);
  });
});

describe("production owner ready-state verification", () => {
  it("acepta sólo la topología exacta y no exige User.business legacy", async () => {
    const manifest = buildProductionOwnerManifest(ownerEnvironment());
    const source = readySource(manifest);
    const result = await verifyProductionOwnerReadyState(
      source,
      manifest,
      fakePasswordVerifier,
    );
    assert.deepEqual(result.findings, []);
    assert.equal(result.ready, true);
    assert.equal(source.users.every((user) => user.business === undefined), true);
  });

  it("rechaza índices ausentes, User.business legacy, password mismatch, owner mismatch y datos extra", async () => {
    const manifest = buildProductionOwnerManifest(ownerEnvironment());
    const source = readySource(manifest);
    source.userIndexes = [];
    source.users[0].business = source.businesses[0]._id;
    source.users[1].password = "wrong";
    source.businesses[1].owner = new mongo.ObjectId();
    source.users.push({ _id: new mongo.ObjectId(), email: ["extra@example.test"] });

    const result = await verifyProductionOwnerReadyState(
      source,
      manifest,
      fakePasswordVerifier,
    );
    assert.equal(result.ready, false);
    assert.ok(result.findings.includes("userCountMismatch"));
    assert.ok(result.findings.includes("userEmailUniqueIndexMissing"));
    assert.ok(result.findings.some((finding) => finding.startsWith("userMismatch:")));
    assert.ok(result.findings.some((finding) => finding.startsWith("passwordMismatch:")));
    assert.ok(result.findings.some((finding) => finding.startsWith("ownerMismatch:")));
  });

  it("document writer crea owner links y Memberships sin poblar User.business", async () => {
    const manifest = buildProductionOwnerManifest(ownerEnvironment());
    const writes = new Map();
    const db = {
      collection: (name) => ({
        insertMany: async (documents) => {
          writes.set(name, documents);
          return { acknowledged: true };
        },
      }),
    };
    let ownershipChecks = 0;
    await createProductionOwnerDocuments(db, manifest, {
      passwordHasher: async (password) => `hash:${password}`,
      assertOwnership: async () => { ownershipChecks += 1; },
      session: { fake: true },
    });

    assert.equal(ownershipChecks, 3);
    assert.equal(writes.get("businesses").length, 2);
    assert.equal(writes.get("users").length, 2);
    assert.equal(writes.get("memberships").length, 2);
    assert.ok(writes.get("users").every((user) => !Object.hasOwn(user, "business")));
    for (const business of writes.get("businesses")) {
      assert.ok(writes.get("users").some((user) => user._id.equals(business.owner)));
    }
    for (const membership of writes.get("memberships")) {
      assert.equal(membership.role, "admin");
      assert.equal(membership.isActive, true);
    }
  });
});
