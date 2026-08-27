import "./setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { TEST_DB_URI } from "./setup.js";
import {
  PENDING_ONBOARDING_INDEX_SPEC,
  applyPendingOnboardingIndexes,
} from "../scripts/migrations/pending-onboarding-storage.js";
import {
  TENANT_ONBOARDING_CHALLENGE_INDEX_SPEC,
  USER_EMAIL_UNIQUE_INDEX_SPEC,
  applyTenantOnboardingAccountBindingIndexes,
  assertTenantOnboardingAccountBindingIndexesReady,
} from "../scripts/migrations/tenant-onboarding-account-binding-storage.js";

// This suite intentionally owns a separate database because it must drop and
// recreate the physical `users` collection/index. It must never perturb the
// shared integration database used by the suites that run before/after it.
const STORAGE_TEST_DB = "agenda_c2_account_binding_storage_test";
const connection = await mongoose.createConnection(TEST_DB_URI, {
  autoIndex: false,
  dbName: STORAGE_TEST_DB,
}).asPromise();
const db = connection.db;
const managedCollections = [
  PENDING_ONBOARDING_INDEX_SPEC.collection,
  TENANT_ONBOARDING_CHALLENGE_INDEX_SPEC.collection,
  USER_EMAIL_UNIQUE_INDEX_SPEC.collection,
];

const collectionExists = async (name) => Boolean(await db
  .listCollections({ name }, { nameOnly: true })
  .hasNext());

const reset = async () => {
  for (const name of managedCollections) {
    if (await collectionExists(name)) await db.collection(name).drop();
  }
};

const prepareC1 = async () => {
  await applyPendingOnboardingIndexes(db);
};

const rawUser = ({ email = "storage-user@example.com", id = new mongoose.Types.ObjectId() } = {}) => ({
  _id: id,
  firstName: "Storage",
  lastName: "User",
  email: [email],
  password: "not-used-by-storage-preflight",
  role: "user",
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
});

const rawChallenge = ({
  onboardingId = new mongoose.Types.ObjectId(),
  businessId = new mongoose.Types.ObjectId(),
  destination = "storage-challenge@example.com",
} = {}) => ({
  _id: new mongoose.Types.ObjectId(),
  pendingOnboarding: onboardingId,
  business: businessId,
  channel: "email",
  destination,
  purpose: "tenant-onboarding",
  secretHash: "a".repeat(64),
  status: "pending",
  expiresAt: new Date(Date.now() + 60_000),
  consumedAt: null,
  revokedAt: null,
  boundUser: null,
  createdAt: new Date(),
  updatedAt: new Date(),
});

test("C2 account binding storage is physical, idempotent and fail-closed with autoIndex=false", async (t) => {
  await reset();

  await t.test("C2 refuses to run when the required C1 physical index is absent", async () => {
    await assert.rejects(
      applyTenantOnboardingAccountBindingIndexes(db),
      /Storage C1 bloqueado/u,
    );
  });

  await t.test("apply materializes challenge and User-email barriers after C1 is ready", async () => {
    await prepareC1();
    const result = await applyTenantOnboardingAccountBindingIndexes(db);
    assert.deepEqual(result, { ready: true, indexes: 3 });
    assert.deepEqual(await assertTenantOnboardingAccountBindingIndexesReady(db), {
      ready: true,
      indexes: 3,
    });

    const challengeIndexes = await db
      .collection(TENANT_ONBOARDING_CHALLENGE_INDEX_SPEC.collection)
      .listIndexes()
      .toArray();
    const challengeIndex = challengeIndexes.find(
      (index) => index.name === TENANT_ONBOARDING_CHALLENGE_INDEX_SPEC.name,
    );
    assert.ok(challengeIndex);
    assert.deepEqual(challengeIndex.key, { pendingOnboarding: 1 });
    assert.equal(challengeIndex.unique, true);
    assert.equal(challengeIndex.expireAfterSeconds, undefined);

    const userIndexes = await db
      .collection(USER_EMAIL_UNIQUE_INDEX_SPEC.collection)
      .listIndexes()
      .toArray();
    const emailIndex = userIndexes.find((index) => index.name === USER_EMAIL_UNIQUE_INDEX_SPEC.name);
    assert.ok(emailIndex);
    assert.deepEqual(emailIndex.key, { email: 1 });
    assert.equal(emailIndex.unique, true);
  });

  await t.test("apply is idempotent", async () => {
    const beforeChallenge = await db
      .collection(TENANT_ONBOARDING_CHALLENGE_INDEX_SPEC.collection)
      .listIndexes()
      .toArray();
    const beforeUsers = await db
      .collection(USER_EMAIL_UNIQUE_INDEX_SPEC.collection)
      .listIndexes()
      .toArray();

    assert.deepEqual(await applyTenantOnboardingAccountBindingIndexes(db), {
      ready: true,
      indexes: 3,
    });

    const afterChallenge = await db
      .collection(TENANT_ONBOARDING_CHALLENGE_INDEX_SPEC.collection)
      .listIndexes()
      .toArray();
    const afterUsers = await db
      .collection(USER_EMAIL_UNIQUE_INDEX_SPEC.collection)
      .listIndexes()
      .toArray();
    assert.equal(afterChallenge.length, beforeChallenge.length);
    assert.equal(afterUsers.length, beforeUsers.length);
  });

  await t.test("same challenge index name with incompatible semantics fails closed", async () => {
    await reset();
    await prepareC1();
    await db.createCollection(TENANT_ONBOARDING_CHALLENGE_INDEX_SPEC.collection);
    await db.collection(TENANT_ONBOARDING_CHALLENGE_INDEX_SPEC.collection).createIndex(
      { pendingOnboarding: 1 },
      { name: TENANT_ONBOARDING_CHALLENGE_INDEX_SPEC.name },
    );

    await assert.rejects(
      applyTenantOnboardingAccountBindingIndexes(db),
      /índice incompatible/u,
    );
  });

  await t.test("same challenge keys with different options/name fail closed", async () => {
    await reset();
    await prepareC1();
    await db.createCollection(TENANT_ONBOARDING_CHALLENGE_INDEX_SPEC.collection);
    await db.collection(TENANT_ONBOARDING_CHALLENGE_INDEX_SPEC.collection).createIndex(
      { pendingOnboarding: 1 },
      { name: "legacy_onboarding_challenge_lookup" },
    );

    await assert.rejects(
      applyTenantOnboardingAccountBindingIndexes(db),
      /opciones incompatibles/u,
    );
  });

  await t.test("incompatible User email index fails closed", async () => {
    await reset();
    await prepareC1();
    await db.createCollection(USER_EMAIL_UNIQUE_INDEX_SPEC.collection);
    await db.collection(USER_EMAIL_UNIQUE_INDEX_SPEC.collection).createIndex(
      { email: 1 },
      { name: USER_EMAIL_UNIQUE_INDEX_SPEC.name },
    );

    await assert.rejects(
      applyTenantOnboardingAccountBindingIndexes(db),
      /índice incompatible/u,
    );
  });

  await t.test("duplicate global User emails block materialization", async () => {
    await reset();
    await prepareC1();
    await db.createCollection(USER_EMAIL_UNIQUE_INDEX_SPEC.collection);
    const users = db.collection(USER_EMAIL_UNIQUE_INDEX_SPEC.collection);
    await users.insertMany([
      rawUser({ email: "duplicate-global@example.com" }),
      rawUser({ email: "duplicate-global@example.com" }),
    ]);

    await assert.rejects(
      applyTenantOnboardingAccountBindingIndexes(db),
      /Users distintos con el mismo email/u,
    );
  });

  await t.test("non-canonical User email blocks materialization", async () => {
    await reset();
    await prepareC1();
    await db.createCollection(USER_EMAIL_UNIQUE_INDEX_SPEC.collection);
    await db.collection(USER_EMAIL_UNIQUE_INDEX_SPEC.collection).insertOne(
      rawUser({ email: "  Mixed.User@Example.COM  " }),
    );

    await assert.rejects(
      applyTenantOnboardingAccountBindingIndexes(db),
      /email fuera de normalización/u,
    );
  });

  await t.test("multiple challenges for one exact onboarding block materialization", async () => {
    await reset();
    await prepareC1();
    await db.createCollection(TENANT_ONBOARDING_CHALLENGE_INDEX_SPEC.collection);
    const onboardingId = new mongoose.Types.ObjectId();
    await db.collection(TENANT_ONBOARDING_CHALLENGE_INDEX_SPEC.collection).insertMany([
      rawChallenge({ onboardingId }),
      rawChallenge({ onboardingId }),
    ]);

    await assert.rejects(
      applyTenantOnboardingAccountBindingIndexes(db),
      /múltiples challenges/u,
    );
  });

  await t.test("materialized User email index closes concurrent duplicate creation", async () => {
    await reset();
    await prepareC1();
    await applyTenantOnboardingAccountBindingIndexes(db);
    const users = db.collection(USER_EMAIL_UNIQUE_INDEX_SPEC.collection);
    const attempts = await Promise.allSettled(
      Array.from({ length: 8 }, () => users.insertOne(rawUser({
        email: "physical-race@example.com",
      }))),
    );
    assert.equal(attempts.filter((entry) => entry.status === "fulfilled").length, 1);
    assert.equal(attempts.filter((entry) => entry.status === "rejected").length, 7);
    assert.ok(attempts
      .filter((entry) => entry.status === "rejected")
      .every((entry) => entry.reason?.code === 11000));
  });
});

test.after(async () => {
  await db.dropDatabase();
  await connection.close();
});
