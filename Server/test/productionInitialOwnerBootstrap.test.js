import "./setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import {
  PRODUCTION_OWNER_BOOTSTRAP_CONFIRMATION,
  runProductionOwnerBootstrap,
} from "../scripts/bootstrap/production-initial-owners.js";

const DEPLOYMENT_SHA = "a".repeat(40);

const isolatedUri = (label) => {
  const url = new URL(process.env.MONGO_TEST_URI);
  url.pathname = `/agenda_production_owner_${label}_${process.pid}_test`;
  return url.toString();
};

const productionEnvironment = () => ({
  NODE_ENV: "production",
  RAILWAY_ENVIRONMENT_NAME: "production",
  RAILWAY_GIT_BRANCH: "master",
  RAILWAY_PROJECT_ID: "project-id",
  RAILWAY_SERVICE_ID: "service-id",
  RAILWAY_DEPLOYMENT_ID: "deployment-id",
  RAILWAY_GIT_COMMIT_SHA: DEPLOYMENT_SHA,
  PRODUCTION_BOOTSTRAP_ATMOSFERA_FIRST_NAME: "Owner",
  PRODUCTION_BOOTSTRAP_ATMOSFERA_LAST_NAME: "Atmósfera",
  PRODUCTION_BOOTSTRAP_ATMOSFERA_EMAIL: "owner-atmosfera@example.test",
  PRODUCTION_BOOTSTRAP_ATMOSFERA_PASSWORD: "atmosfera-owner-safe",
  PRODUCTION_BOOTSTRAP_DAM_FIRST_NAME: "Owner",
  PRODUCTION_BOOTSTRAP_DAM_LAST_NAME: "DAM",
  PRODUCTION_BOOTSTRAP_DAM_EMAIL: "owner-dam@example.test",
  PRODUCTION_BOOTSTRAP_DAM_PASSWORD: "dam-owner-password",
});

const withAdminConnection = async (uri, callback) => {
  const connection = mongoose.createConnection(uri, { autoIndex: false });
  await connection.asPromise();
  try {
    return await callback(connection);
  } finally {
    await connection.close();
  }
};

const resetDatabase = async (uri) => withAdminConnection(uri, async (connection) => {
  await connection.dropDatabase();
});

const applyOptions = (plan) => ({
  mode: "apply",
  approvedSha: DEPLOYMENT_SHA,
  expectedTargetFingerprint: plan.targetFingerprint,
  confirm: PRODUCTION_OWNER_BOOTSTRAP_CONFIRMATION,
});

test("production initial owner bootstrap creates exactly 2/2/2 and is idempotent", async () => {
  const uri = isolatedUri("success");
  await resetDatabase(uri);
  try {
    const plan = await runProductionOwnerBootstrap({
      mongoUri: uri,
      options: { mode: "plan" },
      environment: productionEnvironment(),
    });
    assert.equal(plan.plan.state, "empty");
    assert.equal(plan.plan.canApply, true);
    assert.deepEqual(plan.plan.counts, { businesses: 0, users: 0, memberships: 0 });

    const applied = await runProductionOwnerBootstrap({
      mongoUri: uri,
      options: applyOptions(plan),
      environment: productionEnvironment(),
    });
    assert.equal(applied.applied, true);
    assert.equal(applied.plan.state, "ready");
    assert.deepEqual(applied.plan.counts, { businesses: 2, users: 2, memberships: 2 });
    assert.equal(applied.plan.membershipIndex.exactUniqueExists, true);

    await withAdminConnection(uri, async (connection) => {
      const [businesses, users, memberships, indexes] = await Promise.all([
        connection.db.collection("businesses").find({}).toArray(),
        connection.db.collection("users").find({}).toArray(),
        connection.db.collection("memberships").find({}).toArray(),
        connection.db.collection("memberships").listIndexes().toArray(),
      ]);
      assert.equal(businesses.length, 2);
      assert.equal(users.length, 2);
      assert.equal(memberships.length, 2);
      assert.deepEqual(businesses.map((business) => business.slug).sort(), ["atmosfera", "dam"]);
      assert.ok(users.every((user) => user.role === "admin" && user.isActive === true));
      assert.ok(users.every((user) => !Object.hasOwn(user, "business")));
      assert.ok(users.every((user) => !user.password.includes("owner-safe") && !user.password.includes("owner-password")));
      assert.ok(memberships.every((membership) => membership.role === "admin" && membership.isActive === true));
      assert.ok(indexes.some((index) => (
        index.unique === true
        && index.key?.user === 1
        && index.key?.business === 1
        && Object.keys(index.key).length === 2
      )));
      for (const business of businesses) {
        assert.ok(users.some((user) => user._id.equals(business.owner)));
      }
    });

    const secondApply = await runProductionOwnerBootstrap({
      mongoUri: uri,
      options: applyOptions(plan),
      environment: productionEnvironment(),
    });
    assert.equal(secondApply.applied, false);
    assert.equal(secondApply.plan.state, "ready");
    assert.deepEqual(secondApply.plan.counts, { businesses: 2, users: 2, memberships: 2 });
  } finally {
    await resetDatabase(uri);
  }
});

test("production initial owner bootstrap blocks partial occupied state without mutation", async () => {
  const uri = isolatedUri("partial");
  await resetDatabase(uri);
  try {
    const plan = await runProductionOwnerBootstrap({
      mongoUri: uri,
      options: { mode: "plan" },
      environment: productionEnvironment(),
    });

    await withAdminConnection(uri, async (connection) => {
      await connection.db.createCollection("businesses");
      await connection.db.collection("businesses").insertOne({
        name: "Unexpected",
        slug: "unexpected",
        isActive: true,
      });
    });

    await assert.rejects(
      runProductionOwnerBootstrap({
        mongoUri: uri,
        options: applyOptions(plan),
        environment: productionEnvironment(),
      }),
      /estado existente no coincide exactamente/u,
    );

    await withAdminConnection(uri, async (connection) => {
      const collections = (await connection.db.listCollections({}, { nameOnly: true }).toArray())
        .map((item) => item.name);
      assert.equal(await connection.db.collection("businesses").countDocuments({}), 1);
      assert.equal(collections.includes("users"), false);
      assert.equal(collections.includes("memberships"), false);
    });
  } finally {
    await resetDatabase(uri);
  }
});

test("existing empty Membership collection without exact unique index fails closed", async () => {
  const uri = isolatedUri("missing_index");
  await resetDatabase(uri);
  try {
    await withAdminConnection(uri, async (connection) => {
      await connection.db.createCollection("memberships");
    });

    const plan = await runProductionOwnerBootstrap({
      mongoUri: uri,
      options: { mode: "plan" },
      environment: productionEnvironment(),
    });
    assert.equal(plan.plan.state, "empty");
    assert.equal(plan.plan.canApply, false);
    assert.equal(plan.plan.membershipIndex.exactUniqueExists, false);
    assert.equal(plan.plan.membershipIndex.canCreateTransactionally, false);

    await assert.rejects(
      runProductionOwnerBootstrap({
        mongoUri: uri,
        options: applyOptions(plan),
        environment: productionEnvironment(),
      }),
      /storage Membership incompatible/u,
    );

    await withAdminConnection(uri, async (connection) => {
      const indexes = await connection.db.collection("memberships").listIndexes().toArray();
      assert.equal(indexes.some((index) => index.key?.user === 1 && index.key?.business === 1), false);
      assert.equal(await connection.db.collection("memberships").countDocuments({}), 0);
    });
  } finally {
    await resetDatabase(uri);
  }
});
