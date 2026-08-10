import "./setup.js";

import test from "node:test";
import assert from "node:assert/strict";
import { mongo } from "mongoose";
import { TEST_DB_URI } from "./setup.js";
import {
  acquireMembershipBaselineLock,
  ensureMembershipBaselineLockCollection,
  MEMBERSHIP_BASELINE_CONFIRMATION,
  MEMBERSHIP_BASELINE_LOCK_COLLECTION,
  readMembershipBaselineMetadata,
  readMembershipBaselineSource,
  runMembershipBaselineBootstrap,
} from "../scripts/bootstrap/membership-baseline.js";
import {
  createMembershipBaselineUiServer,
} from "../scripts/bootstrap/membership-baseline-ui.js";
import { fingerprintMongoTarget } from "../scripts/migrations/membership-authority-provenance.js";

const testUrl = new URL(TEST_DB_URI);
testUrl.pathname = "/agenda_membership_baseline_test";
const BASELINE_TEST_URI = testUrl.toString();
const database = testUrl.pathname.replace(/^\//u, "");
const fingerprint = fingerprintMongoTarget(BASELINE_TEST_URI, database);
const environment = {
  BASELINE_ATMOSFERA_ADMIN_EMAIL: "admin-atmosfera@baseline.example.test",
  BASELINE_ATMOSFERA_ADMIN_PASSWORD: "atmosfera-admin-safe",
  BASELINE_DAM_ADMIN_EMAIL: "admin-dam@baseline.example.test",
  BASELINE_DAM_ADMIN_PASSWORD: "dam-admin-password",
};
const uiOwners = {
  atmosfera: {
    firstName: "Owner",
    lastName: "Atmósfera",
    email: environment.BASELINE_ATMOSFERA_ADMIN_EMAIL,
    password: environment.BASELINE_ATMOSFERA_ADMIN_PASSWORD,
  },
  dam: {
    firstName: "Owner",
    lastName: "DAM",
    email: environment.BASELINE_DAM_ADMIN_EMAIL,
    password: environment.BASELINE_DAM_ADMIN_PASSWORD,
  },
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
    for (const collection of [
      MEMBERSHIP_BASELINE_LOCK_COLLECTION,
      "memberships",
      "users",
      "businesses",
    ]) {
      if ((await db.listCollections({ name: collection }).toArray()).length > 0) {
        await db.collection(collection).deleteMany({});
      }
    }
  });

const dropAuthorityCollections = () =>
  withClient(async (db) => {
    for (const collection of [
      MEMBERSHIP_BASELINE_LOCK_COLLECTION,
      "memberships",
      "users",
      "businesses",
    ]) {
      if ((await db.listCollections({ name: collection }).toArray()).length > 0) {
        await db.collection(collection).drop();
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
    for (const collection of [
      "businesses",
      "memberships",
      MEMBERSHIP_BASELINE_LOCK_COLLECTION,
      "users",
    ]) {
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
  });
  assert.equal(plan.applied, false);
  assert.equal(plan.plan.state, "empty");

  const applied = await runMembershipBaselineBootstrap({
    mongoUri: BASELINE_TEST_URI,
    options: options("apply"),
    environment,
  });
  assert.equal(applied.applied, true);
  assert.equal(applied.plan.state, "ready");
  assert.equal(applied.plan.idempotentNoop, true);

  const first = await snapshot();
  assert.equal(first.documents.businesses.length, 2);
  assert.equal(first.documents.users.length, 2);
  assert.equal(first.documents.memberships.length, 2);
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
    role === "admin" &&
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
    }),
    /parcialmente inicializada/,
  );
  assert.deepEqual(await snapshot(), before);

  await cleanAuthorityCollections();
});

test("dos apply concurrentes serializan la baseline y una tercera ejecución es no-op", async () => {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await cleanAuthorityCollections();

    const concurrent = await Promise.allSettled([
      runMembershipBaselineBootstrap({
        mongoUri: BASELINE_TEST_URI,
        options: options("apply"),
        environment,
      }),
      runMembershipBaselineBootstrap({
        mongoUri: BASELINE_TEST_URI,
        options: options("apply"),
        environment,
      }),
    ]);
    const fulfilled = concurrent.filter(({ status }) => status === "fulfilled");
    const rejected = concurrent.filter(({ status }) => status === "rejected");
    assert.ok(fulfilled.length >= 1);
    assert.ok(fulfilled.some(({ value }) => value.applied === true));
    assert.ok(
      rejected.length === 0 ||
      rejected.every(({ reason }) => /otra ejecución apply activa/u.test(reason.message)),
    );

    await withClient(async (db) => {
      assert.equal(await db.collection("businesses").countDocuments({}), 2);
      assert.equal(await db.collection("users").countDocuments({}), 2);
      assert.equal(await db.collection("memberships").countDocuments({}), 2);
      assert.equal(
        await db.collection(MEMBERSHIP_BASELINE_LOCK_COLLECTION).countDocuments({}),
        0,
      );

      const duplicatePairs = await db.collection("memberships").aggregate([
        { $group: { _id: { user: "$user", business: "$business" }, count: { $sum: 1 } } },
        { $match: { count: { $gt: 1 } } },
      ]).toArray();
      assert.deepEqual(duplicatePairs, []);

      const users = await db.collection("users").find({}).toArray();
      const businesses = await db.collection("businesses").find({}).toArray();
      const memberships = await db.collection("memberships").find({}).toArray();
      assert.ok(users.every(({ _id, business }) =>
        _id instanceof mongo.ObjectId && business instanceof mongo.ObjectId));
      assert.ok(businesses.every(({ _id, owner }) =>
        _id instanceof mongo.ObjectId && owner instanceof mongo.ObjectId));
      assert.ok(memberships.every(({ _id, user, business }) =>
        _id instanceof mongo.ObjectId &&
        user instanceof mongo.ObjectId &&
        business instanceof mongo.ObjectId));

      const indexes = await db.collection("memberships").listIndexes().toArray();
      assert.ok(indexes.some(
        (index) => index.unique === true &&
          JSON.stringify(index.key) === JSON.stringify({ user: 1, business: 1 }),
      ));
    });

    const third = await runMembershipBaselineBootstrap({
      mongoUri: BASELINE_TEST_URI,
      options: options("apply"),
      environment,
      passwordHasher: async () => {
        throw new Error("No debe rotar hashes durante un no-op");
      },
    });
    assert.equal(third.applied, false);
    assert.equal(third.plan.idempotentNoop, true);
  }

  await cleanAuthorityCollections();
});

test("una transacción expirada se recupera y el propietario anterior queda cercado", async () => {
  await dropAuthorityCollections();
  const client = new mongo.MongoClient(BASELINE_TEST_URI);
  await client.connect();
  const db = client.db(database);
  const admin = client.db("admin");
  const session = client.startSession();
  try {
    await admin.command({ setParameter: 1, transactionLifetimeLimitSeconds: 1 });
    await ensureMembershipBaselineLockCollection(db);
    session.startTransaction({
      readConcern: { level: "local" },
      writeConcern: { w: "majority" },
    });
    await acquireMembershipBaselineLock(db, {
      ownerId: "suspended-owner",
      session,
    });
    const metadata = await readMembershipBaselineMetadata(db);
    const source = await readMembershipBaselineSource(db, { metadata, session });
    assert.equal(source.businesses.length, 0);
    assert.equal(source.users.length, 0);
    assert.equal(source.memberships.length, 0);

    await new Promise((resolve) => setTimeout(resolve, 1_500));

    let recovered;
    const recoveryDeadline = Date.now() + 75_000;
    while (!recovered && Date.now() < recoveryDeadline) {
      try {
        recovered = await runMembershipBaselineBootstrap({
          mongoUri: BASELINE_TEST_URI,
          options: options("apply"),
          environment,
        });
      } catch (error) {
        if (!/otra ejecución apply activa/u.test(error.message)) throw error;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    assert.equal(recovered?.applied, true);

    await assert.rejects(
      db.collection("businesses").insertOne(
        { marker: "must-not-commit" },
        { session },
      ),
    );

    assert.equal(await db.collection("businesses").countDocuments({}), 2);
    assert.equal(await db.collection("users").countDocuments({}), 2);
    assert.equal(await db.collection("memberships").countDocuments({}), 2);
    assert.equal(
      await db.collection(MEMBERSHIP_BASELINE_LOCK_COLLECTION).countDocuments({}),
      0,
    );
  } finally {
    try {
      if (session.inTransaction()) await session.abortTransaction();
    } catch {}
    await session.endSession();
    await admin.command({ setParameter: 1, transactionLifetimeLimitSeconds: 60 });
    await client.close();
    await dropAuthorityCollections();
  }
});

test("cada fallo controlado revierte colecciones, índice y documentos", async () => {
  const stages = [
    "before:functional-mutations",
    "collection:businesses",
    "collection:memberships",
    "collection:users",
    "index:memberships",
    "documents:businesses",
    "documents:users",
    "documents:memberships",
  ];

  for (const stage of stages) {
    await dropAuthorityCollections();
    await assert.rejects(
      runMembershipBaselineBootstrap({
        mongoUri: BASELINE_TEST_URI,
        options: options("apply"),
        environment,
        mutationCheckpoint: async (observedStage) => {
          if (observedStage === stage) throw new Error(`controlled:${stage}`);
        },
      }),
      new RegExp(`controlled:${stage}`, "u"),
    );

    await withClient(async (db) => {
      const collections = (await db.listCollections({}, { nameOnly: true }).toArray())
        .map(({ name }) => name);
      for (const collection of ["businesses", "users", "memberships"]) {
        assert.equal(collections.includes(collection), false);
      }
      assert.equal(
        await db.collection(MEMBERSHIP_BASELINE_LOCK_COLLECTION).countDocuments({}),
        0,
      );
    });
  }
  await dropAuthorityCollections();
});

test("credenciales diferentes bloquean plan y apply sin rotar hashes ni escribir", async () => {
  await cleanAuthorityCollections();
  await runMembershipBaselineBootstrap({
    mongoUri: BASELINE_TEST_URI,
    options: options("apply"),
    environment,
  });

  const original = await snapshot();
  const changedEnvironment = {
    ...environment,
    BASELINE_ATMOSFERA_ADMIN_PASSWORD: "different-atmosfera-admin-password",
  };
  const matching = await runMembershipBaselineBootstrap({
    mongoUri: BASELINE_TEST_URI,
    options: options("plan"),
    environment,
  });
  assert.equal(matching.plan.state, "ready");
  assert.equal(matching.plan.canApply, true);

  const mismatch = await runMembershipBaselineBootstrap({
    mongoUri: BASELINE_TEST_URI,
    options: options("plan"),
    environment: changedEnvironment,
  });
  assert.equal(mismatch.plan.state, "partial");
  assert.equal(mismatch.plan.canApply, false);
  assert.ok(mismatch.plan.findings.includes("passwordMismatch:atmosfera-admin"));
  assert.equal(
    JSON.stringify(mismatch.plan).includes(
      changedEnvironment.BASELINE_ATMOSFERA_ADMIN_PASSWORD,
    ),
    false,
  );

  await assert.rejects(
    runMembershipBaselineBootstrap({
      mongoUri: BASELINE_TEST_URI,
      options: options("apply"),
      environment: changedEnvironment,
    }),
    /parcialmente inicializada/u,
  );
  assert.deepEqual(await snapshot(), original);

  const stillMatching = await runMembershipBaselineBootstrap({
    mongoUri: BASELINE_TEST_URI,
    options: options("apply"),
    environment,
  });
  assert.equal(stillMatching.applied, false);
  assert.equal(stillMatching.plan.idempotentNoop, true);
  assert.deepEqual(await snapshot(), original);

  await cleanAuthorityCollections();
});

test("la interfaz local ejecuta plan y apply reales sin persistir credenciales", async () => {
  await cleanAuthorityCollections();
  const app = createMembershipBaselineUiServer({
    mongoUri: BASELINE_TEST_URI,
    options: { environment: "test", database, port: 0 },
  });
  const address = await app.listen();
  const baseUrl = `http://${address.address}:${address.port}`;
  const request = async (path, body) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-bootstrap-csrf": app.csrfToken,
      },
      body: JSON.stringify(body),
    });
    return { response, body: await response.json() };
  };

  try {
    const payload = { owners: uiOwners, expectedTargetFingerprint: fingerprint };
    const planned = await request("/api/plan", payload);
    assert.equal(planned.response.status, 200);
    assert.equal(planned.body.plan.state, "empty");
    assert.ok(planned.body.planToken);

    const applied = await request("/api/apply", {
      ...payload,
      planToken: planned.body.planToken,
      confirmation: MEMBERSHIP_BASELINE_CONFIRMATION,
    });
    assert.equal(applied.response.status, 200);
    assert.equal(applied.body.applied, true);
    assert.equal(applied.body.plan.state, "ready");

    const verified = await request("/api/plan", payload);
    assert.equal(verified.body.plan.state, "ready");
    assert.equal(verified.body.plan.idempotentNoop, true);

    const serialized = JSON.stringify({ planned: planned.body, applied: applied.body });
    for (const owner of Object.values(uiOwners)) {
      assert.equal(serialized.includes(owner.email), false);
      assert.equal(serialized.includes(owner.password), false);
    }

    await withClient(async (db) => {
      assert.equal(await db.collection("businesses").countDocuments({}), 2);
      assert.equal(await db.collection("users").countDocuments({}), 2);
      assert.equal(await db.collection("memberships").countDocuments({}), 2);
      assert.equal(
        await db.collection(MEMBERSHIP_BASELINE_LOCK_COLLECTION).countDocuments({}),
        0,
      );
    });
  } finally {
    await app.close();
    await cleanAuthorityCollections();
  }
});
