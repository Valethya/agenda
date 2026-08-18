import "./setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import {
  GUEST_APPOINTMENT_C2_INDEX_SPECS,
  applyGuestAppointmentCapabilityIndexes,
  assertGuestAppointmentCapabilityIndexesReady,
  assertGuestAppointmentCapabilitySupportedTopology,
  inspectGuestAppointmentCapabilityIndexes,
} from "../scripts/migrations/guest-appointment-capability-storage.js";
import {
  GUEST_APPOINTMENT_C2_CUTOVER_CONFIRMATION,
  GUEST_APPOINTMENT_C2_CUTOVER_ENV,
  assertGuestAppointmentCapabilityRuntimeStorageReady,
} from "../src/db/guest-appointment-capability-cutover-gate.js";

const isolatedUri = (label) => {
  const url = new URL(process.env.MONGO_TEST_URI);
  url.pathname = `/agenda_c2_${label}_${process.pid}_test`;
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

const orderedEntries = (value) => Object.entries(value ?? {});
const simpleCollation = (value) => (
  value === undefined
  || value === null
  || (value.locale === "simple" && Object.keys(value).length === 1)
);
const findByKeys = async (db, expected) => {
  const indexes = await db.collection(expected.collection).listIndexes().toArray();
  return indexes.find((index) => (
    JSON.stringify(orderedEntries(index.key)) === JSON.stringify(orderedEntries(expected.key))
    && Boolean(index.unique) === Boolean(expected.options.unique)
    && Boolean(index.sparse) === Boolean(expected.options.sparse)
    && Boolean(index.hidden) === Boolean(expected.options.hidden)
    && (Number.isInteger(index.expireAfterSeconds) ? index.expireAfterSeconds : null)
      === expected.options.expireAfterSeconds
    && (index.partialFilterExpression ?? null) === null
    && simpleCollation(index.collation)
  ));
};

test("6.2.5-C2 production-like storage materializes exact physical index semantics with autoIndex:false", async () => {
  await withDatabase("materialize", async (db) => {
    const before = await inspectGuestAppointmentCapabilityIndexes(db);
    assert.equal(before.length, GUEST_APPOINTMENT_C2_INDEX_SPECS.length);
    assert.ok(before.every((entry) => entry.present === false));

    const applied = await applyGuestAppointmentCapabilityIndexes(db);
    assert.equal(applied.topology, "replicaSet");
    assert.equal(applied.ready, true);
    assert.equal(applied.indexes, GUEST_APPOINTMENT_C2_INDEX_SPECS.length);

    for (const expected of GUEST_APPOINTMENT_C2_INDEX_SPECS) {
      const physical = await findByKeys(db, expected);
      assert.ok(physical, `faltó índice físico ${expected.collection}.${expected.name}`);
      assert.deepEqual(orderedEntries(physical.key), orderedEntries(expected.key));
      assert.equal(Boolean(physical.unique), Boolean(expected.options.unique));
      assert.equal(Boolean(physical.sparse), false);
      assert.equal(Boolean(physical.hidden), false);
      assert.equal(physical.partialFilterExpression, undefined);
      assert.equal(simpleCollation(physical.collation), true);
      assert.equal(
        Number.isInteger(physical.expireAfterSeconds) ? physical.expireAfterSeconds : null,
        expected.options.expireAfterSeconds,
      );
    }

    const second = await applyGuestAppointmentCapabilityIndexes(db);
    assert.equal(second.ready, true);
    assert.equal(second.indexes, GUEST_APPOINTMENT_C2_INDEX_SPECS.length);
  });
});

test("6.2.5-C2 storage fails closed when the expected physical name has incompatible keys", async () => {
  await withDatabase("bad_name", async (db) => {
    const expected = GUEST_APPOINTMENT_C2_INDEX_SPECS.find((entry) => entry.name === "guest_appointment_job_scope_unique");
    await db.createCollection(expected.collection);
    await db.collection(expected.collection).createIndex(
      { business: 1, appointment: 1 },
      { name: expected.name, unique: true },
    );
    await assert.rejects(
      applyGuestAppointmentCapabilityIndexes(db),
      /índice incompatible/u,
    );
  });
});

test("6.2.5-C2 expected physical name with incompatible semantic modifiers fails closed", async () => {
  await withDatabase("bad_name_semantics", async (db) => {
    const expected = GUEST_APPOINTMENT_C2_INDEX_SPECS.find((entry) => entry.name === "guest_appointment_job_scope_unique");
    await db.createCollection(expected.collection);
    await db.collection(expected.collection).createIndex(expected.key, {
      name: expected.name,
      unique: true,
      partialFilterExpression: { action: "cancel" },
    });
    await assert.rejects(applyGuestAppointmentCapabilityIndexes(db), /índice incompatible/u);
  });
});

test("6.2.5-C2 storage rejects unexpected partial, sparse and collation semantics", async () => {
  await withDatabase("bad_partial", async (db) => {
    const expected = GUEST_APPOINTMENT_C2_INDEX_SPECS.find((entry) => entry.name === "guest_appointment_job_scope_unique");
    await db.createCollection(expected.collection);
    await db.collection(expected.collection).createIndex(expected.key, {
      name: "same_keys_partial",
      unique: true,
      partialFilterExpression: { action: "cancel" },
    });
    await assert.rejects(applyGuestAppointmentCapabilityIndexes(db), /opciones incompatibles/u);
  });

  await withDatabase("bad_sparse", async (db) => {
    const expected = GUEST_APPOINTMENT_C2_INDEX_SPECS.find((entry) => entry.name === "guest_appointment_delivery_verification_unique");
    await db.createCollection(expected.collection);
    await db.collection(expected.collection).createIndex(expected.key, {
      name: "same_keys_sparse",
      unique: true,
      sparse: true,
    });
    await assert.rejects(applyGuestAppointmentCapabilityIndexes(db), /opciones incompatibles/u);
  });

  await withDatabase("bad_ttl_partial", async (db) => {
    const expected = GUEST_APPOINTMENT_C2_INDEX_SPECS.find((entry) => entry.name === "guest_appointment_job_terminal_ttl");
    await db.createCollection(expected.collection);
    await db.collection(expected.collection).createIndex(expected.key, {
      name: "same_ttl_partial",
      expireAfterSeconds: expected.options.expireAfterSeconds,
      partialFilterExpression: { purgeAfter: { $exists: true } },
    });
    await assert.rejects(applyGuestAppointmentCapabilityIndexes(db), /opciones incompatibles/u);
  });

  await withDatabase("bad_collation", async (db) => {
    const expected = GUEST_APPOINTMENT_C2_INDEX_SPECS.find((entry) => entry.name === "guest_appointment_job_scope_unique");
    await db.createCollection(expected.collection);
    await db.collection(expected.collection).createIndex(expected.key, {
      name: "same_keys_collation",
      unique: true,
      collation: { locale: "en", strength: 2 },
    });
    await assert.rejects(applyGuestAppointmentCapabilityIndexes(db), /opciones incompatibles/u);
  });
});

test("6.2.5-C2 storage fails closed for incompatible unique or TTL values", async () => {
  await withDatabase("bad_unique", async (db) => {
    const expected = GUEST_APPOINTMENT_C2_INDEX_SPECS.find((entry) => entry.name === "guest_appointment_delivery_verification_unique");
    await db.createCollection(expected.collection);
    await db.collection(expected.collection).createIndex(expected.key, { name: "same_keys_wrong_unique" });
    await assert.rejects(applyGuestAppointmentCapabilityIndexes(db), /opciones incompatibles/u);
  });

  await withDatabase("bad_ttl", async (db) => {
    const expected = GUEST_APPOINTMENT_C2_INDEX_SPECS.find((entry) => entry.name === "guest_appointment_job_terminal_ttl");
    await db.createCollection(expected.collection);
    await db.collection(expected.collection).createIndex(
      expected.key,
      { name: "same_keys_wrong_ttl", expireAfterSeconds: 60 },
    );
    await assert.rejects(applyGuestAppointmentCapabilityIndexes(db), /opciones incompatibles/u);
  });
});

test("6.2.5-C2 index security identity accepts a different name only with exactly equivalent semantics", async () => {
  await withDatabase("alt_name", async (db) => {
    const expected = GUEST_APPOINTMENT_C2_INDEX_SPECS[0];
    await db.createCollection(expected.collection);
    await db.collection(expected.collection).createIndex(expected.key, { name: "equivalent_diagnostic_name" });

    const result = await applyGuestAppointmentCapabilityIndexes(db);
    assert.equal(result.ready, true);
    const inspection = await inspectGuestAppointmentCapabilityIndexes(db);
    const entry = inspection.find((candidate) => candidate.name === expected.name);
    assert.equal(entry.present, true);
    assert.equal(entry.physicalName, "equivalent_diagnostic_name");
  });
});

test("6.2.5-C2 rejects standalone topology and accepts the actual CI replica set", async () => {
  await assert.rejects(
    assertGuestAppointmentCapabilitySupportedTopology({
      admin: () => ({ command: async () => ({ ok: 1, isWritablePrimary: true }) }),
    }),
    /standalone/u,
  );

  await withDatabase("topology", async (db) => {
    assert.equal(await assertGuestAppointmentCapabilitySupportedTopology(db), "replicaSet");
  });
});

test("6.2.5-C2 deployment indicators always override NODE_ENV=test", async () => {
  assert.deepEqual(
    await assertGuestAppointmentCapabilityRuntimeStorageReady(null, { NODE_ENV: "test" }),
    { enforced: false },
  );

  const remoteEnvironments = [
    { NODE_ENV: "test", RAILWAY_ENVIRONMENT: "production" },
    { NODE_ENV: "test", VERCEL: "1" },
    { NODE_ENV: "development", RAILWAY_PROJECT_ID: "project-id" },
    { NODE_ENV: "staging" },
    { NODE_ENV: "production" },
  ];

  for (const environment of remoteEnvironments) {
    await assert.rejects(
      assertGuestAppointmentCapabilityRuntimeStorageReady(null, environment),
      new RegExp(GUEST_APPOINTMENT_C2_CUTOVER_ENV, "u"),
    );
  }
});

test("6.2.5-C2 remote cutover requires confirmation and physical indexes before startup", async () => {
  await withDatabase("cutover", async (db) => {
    const remote = { NODE_ENV: "production" };
    await assert.rejects(
      assertGuestAppointmentCapabilityRuntimeStorageReady(db, remote),
      new RegExp(GUEST_APPOINTMENT_C2_CUTOVER_ENV, "u"),
    );

    const confirmed = {
      NODE_ENV: "test",
      RAILWAY_ENVIRONMENT: "production",
      [GUEST_APPOINTMENT_C2_CUTOVER_ENV]: GUEST_APPOINTMENT_C2_CUTOVER_CONFIRMATION,
    };
    await assert.rejects(
      assertGuestAppointmentCapabilityRuntimeStorageReady(db, confirmed),
      /índice físico requerido ausente\/incompatible/u,
    );

    await applyGuestAppointmentCapabilityIndexes(db);
    assert.deepEqual(
      await assertGuestAppointmentCapabilityRuntimeStorageReady(db, confirmed),
      { enforced: true, ready: true },
    );
    assert.deepEqual(
      await assertGuestAppointmentCapabilityIndexesReady(db),
      { ready: true, indexes: GUEST_APPOINTMENT_C2_INDEX_SPECS.length },
    );
  });
});
