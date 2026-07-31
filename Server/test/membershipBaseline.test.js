import "./setup.js";

import test from "node:test";
import assert from "node:assert/strict";
import { mongo } from "mongoose";
import { TEST_DB_URI } from "./setup.js";
import {
  MEMBERSHIP_BASELINE_CONFIRMATION,
  runMembershipBaselineBootstrap,
} from "../scripts/bootstrap/membership-baseline.js";
import { fingerprintMongoTarget } from "../scripts/migrations/membership-authority-provenance.js";

const testUrl = new URL(TEST_DB_URI);
testUrl.pathname = "/agenda_membership_baseline_test";
const BASELINE_TEST_URI = testUrl.toString();
const database = testUrl.pathname.replace(/^\//u, "");
const fingerprint = fingerprintMongoTarget(BASELINE_TEST_URI, database);
const environment = {
  BASELINE_ATMOSFERA_ADMIN_EMAIL: "admin-atmosfera@baseline.example.test",
  BASELINE_ATMOSFERA_ADMIN_PASSWORD: "atmosfera-admin-safe",
  BASELINE_ATMOSFERA_WORKER_EMAIL: "worker-atmosfera@baseline.example.test",
  BASELINE_ATMOSFERA_WORKER_PASSWORD: "atmosfera-worker-safe",
  BASELINE_DAM_ADMIN_EMAIL: "admin-dam@baseline.example.test",
  BASELINE_DAM_ADMIN_PASSWORD: "dam-admin-password",
  BASELINE_DAM_WORKER_EMAIL: "worker-dam@baseline.example.test",
  BASELINE_DAM_WORKER_PASSWORD: "dam-worker-password",
};

const options = (mode) => ({
  mode,
  environment: "test",
  database,
  expectedTargetFingerprint: fingerprint,
  confirm: mode === "apply" ? MEMBERSHIP_BASELINE_CONFIRMATION : undefined,
});

const withClient = async (callback) => {
  const client = new mongo.MongoClient(BASELINE_TEST_URI);
  await client.connect();
  try {
    return await callback(client.db(database));
  } finally {
    await client.close();
  }
};

const cleanAuthorityCollections = () =>
  withClient(async (db) => {
    for (const collection of ["memberships", "users", "businesses"]) {
      if ((await db.listCollections({ name: collection }).toArray()).length > 0) {
        await db.collection(collection).deleteMany({});
      }
    }
  });

const snapshot = () =>
  withClient(async (db) => {
    const collections = (
      await db.listCollections({}, { nameOnly: true }).toArray()
    )
      .map(({ name }) => name)
      .sort();
    const result = { collections, documents: {}, indexes: {} };
    for (const collection of ["businesses", "memberships", "users"]) {
      if (!collections.includes(collection)) continue;
      result.documents[collection] = await db
        .collection(collection)
        .find({})
        .sort({ _id: 1 })
        .toArray();
      result.indexes[collection] = await db
        .collection(collection)
        .listIndexes()
        .toArray();
    }
    return result;
  });

test("bootstrap de autoridad crea BSON reales, verifica el índice y es idempotente", async () => {
  await cleanAuthorityCollections();

  const plan = await runMembershipBaselineBootstrap({
    mongoUri: BASELINE_TEST_URI,
    options: options("plan"),
    environment,
    passwordHasher: async (password) => `hash:${password}`,
  });
  assert.equal(plan.applied, false);
  assert.equal(plan.plan.state, "empty");

  const applied = await runMembershipBaselineBootstrap({
    mongoUri: BASELINE_TEST_URI,
    options: options("apply"),
    environment,
    passwordHasher: async (password) => `hash:${password}`,
  });
  assert.equal(applied.applied, true);
  assert.equal(applied.plan.state, "ready");
  assert.equal(applied.plan.idempotentNoop, true);

  const first = await snapshot();
  assert.equal(first.documents.businesses.length, 2);
  assert.equal(first.documents.users.length, 4);
  assert.equal(first.documents.memberships.length, 4);
  assert.ok(first.documents.businesses.every(({ _id, owner }) =>
    _id instanceof mongo.ObjectId && owner instanceof mongo.ObjectId));
  assert.ok(first.documents.users.every(({ _id, business, isActive }) =>
    _id instanceof mongo.ObjectId &&
    business instanceof mongo.ObjectId &&
    isActive === true));
  assert.ok(first.documents.memberships.every(({ _id, user, business, role, isActive }) =>
    _id instanceof mongo.ObjectId &&
    user instanceof mongo.ObjectId &&
    business instanceof mongo.ObjectId &&
    ["admin", "worker"].includes(role) &&
    isActive === true));
  assert.ok(
    first.indexes.memberships.some(
      (index) =>
        index.unique === true &&
        JSON.stringify(index.key) === JSON.stringify({ user: 1, business: 1 }),
    ),
  );

  const repeated = await runMembershipBaselineBootstrap({
    mongoUri: BASELINE_TEST_URI,
    options: options("apply"),
    environment,
    passwordHasher: async () => {
      throw new Error("No debe recalcular contraseñas durante un no-op");
    },
  });
  assert.equal(repeated.applied, false);
  assert.equal(repeated.plan.idempotentNoop, true);
  assert.deepEqual(await snapshot(), first);

  await cleanAuthorityCollections();
});

test("bootstrap bloquea una base parcialmente inicializada sin modificarla", async () => {
  await cleanAuthorityCollections();
  await withClient(async (db) => {
    await db.collection("businesses").insertOne({
      _id: new mongo.ObjectId(),
      name: "Atmósfera",
      slug: "atmosfera",
      isActive: true,
    });
  });
  const before = await snapshot();

  await assert.rejects(
    runMembershipBaselineBootstrap({
      mongoUri: BASELINE_TEST_URI,
      options: options("apply"),
      environment,
      passwordHasher: async (password) => `hash:${password}`,
    }),
    /parcialmente inicializada/,
  );
  assert.deepEqual(await snapshot(), before);

  await cleanAuthorityCollections();
});
