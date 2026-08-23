import "./setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import {
  PUBLIC_WEB_INDEX_SPEC,
  applyPublicWebIndexes,
  assertPublicWebIndexesReady,
  inspectPublicWebIndexes,
} from "../scripts/migrations/public-web-storage.js";
import {
  PUBLIC_WEB_CUTOVER_CONFIRMATION,
  PUBLIC_WEB_CUTOVER_ENV,
  assertPublicWebRuntimeStorageReady,
} from "../src/db/public-web-cutover-gate.js";
import BusinessConfig from "../src/db/models/businessConfig.model.js";

const isolatedUri = (label) => {
  const url = new URL(process.env.MONGO_TEST_URI);
  url.pathname = `/agenda_public_web_${label}_${process.pid}_test`;
  return url.toString();
};

const withDatabase = async (label, callback) => {
  const connection = mongoose.createConnection(isolatedUri(label), { autoIndex: false });
  await connection.asPromise();
  try {
    return await callback(connection.db);
  } finally {
    await connection.dropDatabase();
    await connection.close();
  }
};

const withConnection = async (label, options, callback) => {
  const connection = mongoose.createConnection(isolatedUri(label), options);
  await connection.asPromise();
  try {
    return await callback(connection);
  } finally {
    await connection.dropDatabase();
    await connection.close();
  }
};

const confirmedRemoteEnv = () => ({
  NODE_ENV: "test",
  RAILWAY_ENVIRONMENT: "production",
  [PUBLIC_WEB_CUTOVER_ENV]: PUBLIC_WEB_CUTOVER_CONFIRMATION,
});

test("6.2.6-B production-like storage materializes the non-unique fresh-origin index with autoIndex:false", async () => {
  await withDatabase("materialize", async (db) => {
    const before = await inspectPublicWebIndexes(db);
    assert.equal(before.length, 1);
    assert.equal(before[0].present, false);

    const applied = await applyPublicWebIndexes(db);
    assert.deepEqual(applied, { ready: true, indexes: 1 });

    const indexes = await db.collection(PUBLIC_WEB_INDEX_SPEC.collection).listIndexes().toArray();
    const physical = indexes.find((index) => index.name === PUBLIC_WEB_INDEX_SPEC.name);
    assert.ok(physical);
    assert.deepEqual(Object.entries(physical.key), Object.entries(PUBLIC_WEB_INDEX_SPEC.key));
    assert.notEqual(physical.unique, true);
    assert.equal(physical.partialFilterExpression, undefined);
    assert.equal(physical.sparse, undefined);
    assert.equal(physical.hidden, undefined);
    assert.equal(physical.expireAfterSeconds, undefined);
    assert.equal(physical.collation, undefined);

    assert.deepEqual(await assertPublicWebIndexesReady(db), { ready: true, indexes: 1 });
    assert.deepEqual(await applyPublicWebIndexes(db), { ready: true, indexes: 1 });
  });
});

test("6.2.6-B storage rejects incompatible physical semantics without drop/recreate", async () => {
  await withDatabase("incompatible", async (db) => {
    await db.createCollection(PUBLIC_WEB_INDEX_SPEC.collection);
    await db.collection(PUBLIC_WEB_INDEX_SPEC.collection).createIndex(
      { "publicWeb.verifiedOrigin": 1 },
      { name: PUBLIC_WEB_INDEX_SPEC.name, unique: true },
    );

    await assert.rejects(applyPublicWebIndexes(db), /índice incompatible/u);
    const indexes = await db.collection(PUBLIC_WEB_INDEX_SPEC.collection).listIndexes().toArray();
    const existing = indexes.find((index) => index.name === PUBLIC_WEB_INDEX_SPEC.name);
    assert.deepEqual(existing.key, { "publicWeb.verifiedOrigin": 1 });
    assert.equal(existing.unique, true);
  });
});

test("6.2.6-B storage rejects incompatible semantic modifiers without replacing the index", async () => {
  const cases = [
    ["sparse", { sparse: true }],
    ["hidden", { hidden: true }],
    ["partial", { partialFilterExpression: { "publicWeb.verificationStatus": "verified" } }],
    ["collation", { collation: { locale: "en", strength: 2 } }],
  ];

  for (const [label, options] of cases) {
    await withDatabase(`semantics_${label}`, async (db) => {
      await db.createCollection(PUBLIC_WEB_INDEX_SPEC.collection);
      await db.collection(PUBLIC_WEB_INDEX_SPEC.collection).createIndex(
        PUBLIC_WEB_INDEX_SPEC.key,
        { name: PUBLIC_WEB_INDEX_SPEC.name, ...options },
      );

      await assert.rejects(applyPublicWebIndexes(db), /incompatibles|incompatible/u);
      const indexes = await db.collection(PUBLIC_WEB_INDEX_SPEC.collection).listIndexes().toArray();
      assert.ok(indexes.some((index) => index.name === PUBLIC_WEB_INDEX_SPEC.name));
    });
  }
});

test("6.2.6-B Mongoose autoIndex keeps legacy BusinessConfig index but cannot create publicWeb index", async () => {
  const schemaPublicWebIndex = BusinessConfig.schema.indexes().find(([key, options]) => (
    options?.name === PUBLIC_WEB_INDEX_SPEC.name
    || JSON.stringify(Object.entries(key)) === JSON.stringify(Object.entries(PUBLIC_WEB_INDEX_SPEC.key))
  ));
  assert.equal(schemaPublicWebIndex, undefined);

  await withConnection("runtime_no_publicweb_autoindex", { autoIndex: true }, async (connection) => {
    const RuntimeBusinessConfig = connection.model(
      "BusinessConfigPublicWebAutoIndexRegression",
      BusinessConfig.schema,
      PUBLIC_WEB_INDEX_SPEC.collection,
    );
    await RuntimeBusinessConfig.init();

    const indexes = await connection.db
      .collection(PUBLIC_WEB_INDEX_SPEC.collection)
      .listIndexes()
      .toArray();

    const legacyBusinessIndex = indexes.find((index) => (
      index.key?.business === 1 && Object.keys(index.key).length === 1
    ));
    assert.ok(legacyBusinessIndex, "legacy BusinessConfig.business index must remain materialized by schema autoIndex");
    assert.equal(legacyBusinessIndex.unique, true);

    assert.equal(
      indexes.some((index) => index.name === PUBLIC_WEB_INDEX_SPEC.name),
      false,
      "publicWeb index must not be auto-materialized by Mongoose",
    );

    const inspection = await inspectPublicWebIndexes(connection.db);
    assert.equal(inspection[0].present, false);
    await assert.rejects(
      assertPublicWebRuntimeStorageReady(connection.db, confirmedRemoteEnv()),
      /índice físico requerido ausente\/incompatible/u,
    );
  });
});

test("6.2.6-B remote startup requires explicit cutover confirmation and the physical index", async () => {
  assert.deepEqual(
    await assertPublicWebRuntimeStorageReady(null, { NODE_ENV: "test" }),
    { enforced: false },
  );

  await withDatabase("cutover", async (db) => {
    const remote = { NODE_ENV: "production" };
    await assert.rejects(
      assertPublicWebRuntimeStorageReady(db, remote),
      new RegExp(PUBLIC_WEB_CUTOVER_ENV, "u"),
    );

    const confirmed = confirmedRemoteEnv();
    await assert.rejects(
      assertPublicWebRuntimeStorageReady(db, confirmed),
      /índice físico requerido ausente\/incompatible/u,
    );

    await applyPublicWebIndexes(db);
    assert.deepEqual(
      await assertPublicWebRuntimeStorageReady(db, confirmed),
      { enforced: true, ready: true },
    );
  });
});
