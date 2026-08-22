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
    assert.equal(physical.expireAfterSeconds, undefined);

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

    const confirmed = {
      NODE_ENV: "test",
      RAILWAY_ENVIRONMENT: "production",
      [PUBLIC_WEB_CUTOVER_ENV]: PUBLIC_WEB_CUTOVER_CONFIRMATION,
    };
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
