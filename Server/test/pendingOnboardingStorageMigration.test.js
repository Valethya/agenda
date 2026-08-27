import "./setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { TEST_DB_URI } from "./setup.js";
import {
  PENDING_ONBOARDING_CHANNEL,
  PENDING_ONBOARDING_PURPOSE,
} from "../src/db/models/pendingOnboarding.model.js";
import {
  PENDING_ONBOARDING_INDEX_SPEC,
  applyPendingOnboardingIndexes,
  assertPendingOnboardingIndexesReady,
} from "../scripts/migrations/pending-onboarding-storage.js";

const connection = await mongoose.createConnection(TEST_DB_URI, { autoIndex: false }).asPromise();
const db = connection.db;

const collectionExists = async () => Boolean(await db
  .listCollections({ name: PENDING_ONBOARDING_INDEX_SPEC.collection }, { nameOnly: true })
  .hasNext());

const resetCollection = async () => {
  if (await collectionExists()) {
    await db.collection(PENDING_ONBOARDING_INDEX_SPEC.collection).drop();
  }
};

const futureExpiry = () => new Date(Date.now() + 60 * 60 * 1000);
const rawPending = ({
  business = new mongoose.Types.ObjectId(),
  issuer = new mongoose.Types.ObjectId(),
  email = `pending-${Math.random().toString(16).slice(2)}@example.com`,
  channel = PENDING_ONBOARDING_CHANNEL,
  purpose = PENDING_ONBOARDING_PURPOSE,
  role = "worker",
  isBookable = false,
  status = "pending",
  expiresAt = futureExpiry(),
} = {}) => ({
  _id: new mongoose.Types.ObjectId(),
  business,
  issuer,
  channel,
  email,
  purpose,
  role,
  isBookable,
  expiresAt,
  status,
  createdAt: new Date(),
  updatedAt: new Date(),
});

const duplicateKey = (error) => error?.code === 11000;

test("C1 storage script materializes and enforces the physical pending index with autoIndex=false", async (t) => {
  await resetCollection();

  await t.test("apply creates the absent collection/index and ready assertion observes the physical contract", async () => {
    assert.equal(await collectionExists(), false);

    const applied = await applyPendingOnboardingIndexes(db);
    assert.deepEqual(applied, { ready: true, indexes: 1 });
    assert.equal(await collectionExists(), true);

    const ready = await assertPendingOnboardingIndexesReady(db);
    assert.deepEqual(ready, { ready: true, indexes: 1 });

    const indexes = await db
      .collection(PENDING_ONBOARDING_INDEX_SPEC.collection)
      .listIndexes()
      .toArray();
    const physical = indexes.find((index) => index.name === PENDING_ONBOARDING_INDEX_SPEC.name);

    assert.ok(physical);
    assert.deepEqual(physical.key, { business: 1, email: 1 });
    assert.equal(physical.unique, true);
    assert.deepEqual(physical.partialFilterExpression, { status: "pending" });
    assert.equal(physical.expireAfterSeconds, undefined);
  });

  await t.test("apply is idempotent", async () => {
    const before = await db
      .collection(PENDING_ONBOARDING_INDEX_SPEC.collection)
      .listIndexes()
      .toArray();

    assert.deepEqual(await applyPendingOnboardingIndexes(db), { ready: true, indexes: 1 });

    const after = await db
      .collection(PENDING_ONBOARDING_INDEX_SPEC.collection)
      .listIndexes()
      .toArray();
    assert.equal(
      after.filter((index) => index.name === PENDING_ONBOARDING_INDEX_SPEC.name).length,
      1,
    );
    assert.equal(after.length, before.length);
  });

  await t.test("same index name with incompatible semantics fails closed", async () => {
    await resetCollection();
    await db.createCollection(PENDING_ONBOARDING_INDEX_SPEC.collection);
    await db.collection(PENDING_ONBOARDING_INDEX_SPEC.collection).createIndex(
      { business: 1, email: 1 },
      { name: PENDING_ONBOARDING_INDEX_SPEC.name },
    );

    await assert.rejects(
      applyPendingOnboardingIndexes(db),
      /índice incompatible/u,
    );
  });

  await t.test("same keys with different options fail closed even under another name", async () => {
    await resetCollection();
    await db.createCollection(PENDING_ONBOARDING_INDEX_SPEC.collection);
    await db.collection(PENDING_ONBOARDING_INDEX_SPEC.collection).createIndex(
      { business: 1, email: 1 },
      { name: "legacy_pending_business_email_unique", unique: true },
    );

    await assert.rejects(
      applyPendingOnboardingIndexes(db),
      /opciones incompatibles/u,
    );
  });

  await t.test("pre-existing duplicate pending data blocks materialization", async () => {
    await resetCollection();
    await db.createCollection(PENDING_ONBOARDING_INDEX_SPEC.collection);

    const business = new mongoose.Types.ObjectId();
    const email = "duplicate@example.com";
    await db.collection(PENDING_ONBOARDING_INDEX_SPEC.collection).insertMany([
      rawPending({ business, email }),
      rawPending({ business, email }),
    ]);

    await assert.rejects(
      applyPendingOnboardingIndexes(db),
      /pending duplicados/u,
    );
  });

  await t.test("non-canonical pending email blocks materialization", async () => {
    await resetCollection();
    await db.createCollection(PENDING_ONBOARDING_INDEX_SPEC.collection);
    await db.collection(PENDING_ONBOARDING_INDEX_SPEC.collection).insertOne(
      rawPending({ email: "  Mixed.Case@Example.COM  " }),
    );

    await assert.rejects(
      applyPendingOnboardingIndexes(db),
      /normalización canónica/u,
    );
  });

  await t.test("pending data outside the current worker/non-bookable policy blocks materialization", async () => {
    await resetCollection();
    await db.createCollection(PENDING_ONBOARDING_INDEX_SPEC.collection);
    await db.collection(PENDING_ONBOARDING_INDEX_SPEC.collection).insertOne(
      rawPending({ role: "admin", isBookable: true }),
    );

    await assert.rejects(
      applyPendingOnboardingIndexes(db),
      /política canónica worker\/non-bookable/u,
    );
  });

  await t.test("the materialized index alone enforces concurrency and preserves cross-Business reuse", async () => {
    await resetCollection();
    await applyPendingOnboardingIndexes(db);
    await assertPendingOnboardingIndexesReady(db);

    const collection = db.collection(PENDING_ONBOARDING_INDEX_SPEC.collection);
    const businessA = new mongoose.Types.ObjectId();
    const businessB = new mongoose.Types.ObjectId();
    const issuer = new mongoose.Types.ObjectId();
    const email = "concurrent@example.com";

    const attempts = await Promise.allSettled(
      Array.from({ length: 12 }, () => collection.insertOne(rawPending({
        business: businessA,
        issuer,
        email,
      }))),
    );
    const fulfilled = attempts.filter((result) => result.status === "fulfilled");
    const rejected = attempts.filter((result) => result.status === "rejected");

    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 11);
    assert.ok(rejected.every((result) => duplicateKey(result.reason)));
    assert.equal(await collection.countDocuments({ business: businessA, email, status: "pending" }), 1);

    await collection.insertOne(rawPending({ business: businessB, issuer, email }));
    assert.equal(await collection.countDocuments({ email, status: "pending" }), 2);
  });
});

test.after(async () => {
  await resetCollection();
  await connection.close();
});
