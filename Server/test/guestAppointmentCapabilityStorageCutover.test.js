import "./setup.js";
import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import {
  GUEST_APPOINTMENT_C2_INDEX_SPECS,
  applyGuestAppointmentCapabilityIndexes,
  preflightGuestAppointmentCapabilityIndexes,
} from "../scripts/migrations/guest-appointment-capability-storage.js";

const isolatedUri = (label) => {
  const url = new URL(process.env.MONGO_TEST_URI);
  url.pathname = `/agenda_c2_cutover_${label}_${process.pid}_test`;
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

const collectionNames = async (db) => (
  (await db.listCollections({}, { nameOnly: true }).toArray()).map(({ name }) => name).sort()
);
const indexes = async (db, collection) => db.collection(collection).listIndexes().toArray();
const indexNames = async (db, collection) => (await indexes(db, collection)).map(({ name }) => name).sort();

const c1Verification = (overrides = {}) => ({
  _id: new mongoose.Types.ObjectId(),
  business: new mongoose.Types.ObjectId(),
  channel: "email",
  destination: "retention@example.com",
  purpose: "contact-control",
  secretHash: "a".repeat(64),
  status: "pending",
  expiresAt: new Date(Date.now() + 60_000),
  ...overrides,
});

test("6.2.5-C2 preflight is read-only and an empty DB applies structural indexes before TTL", async () => {
  await withDatabase("empty", async (db) => {
    const preflight = await preflightGuestAppointmentCapabilityIndexes(db);
    assert.equal(preflight.topology, "replicaSet");
    assert.equal(preflight.missingIndexes, GUEST_APPOINTMENT_C2_INDEX_SPECS.length);
    assert.deepEqual(await collectionNames(db), []);

    const applied = await applyGuestAppointmentCapabilityIndexes(db);
    assert.equal(applied.ready, true);
    assert.equal(applied.indexes, GUEST_APPOINTMENT_C2_INDEX_SPECS.length);

    const rerun = await applyGuestAppointmentCapabilityIndexes(db);
    assert.equal(rerun.ready, true);
  });
});

test("6.2.5-C2 duplicate unique preflight fails with zero index/TTL/collection writes", async () => {
  await withDatabase("duplicate", async (db) => {
    await db.createCollection("clientcontactverifications");
    const legacy = c1Verification({ expiresAt: new Date(Date.now() - (2 * 60 * 60 * 1000)) });
    await db.collection("clientcontactverifications").insertOne(legacy);

    await db.createCollection("guestappointmentverificationjobs");
    const scope = {
      business: new mongoose.Types.ObjectId(),
      appointment: new mongoose.Types.ObjectId(),
      purpose: "appointment-read-bootstrap",
      action: "read",
    };
    await db.collection("guestappointmentverificationjobs").insertMany([
      { ...scope, status: "failed", generation: 1 },
      { ...scope, status: "failed", generation: 2 },
    ]);

    const collectionsBefore = await collectionNames(db);
    const c1IndexesBefore = await indexNames(db, "clientcontactverifications");
    const jobIndexesBefore = await indexNames(db, "guestappointmentverificationjobs");

    await assert.rejects(
      preflightGuestAppointmentCapabilityIndexes(db),
      /datos duplicados impiden índice unique/u,
    );
    await assert.rejects(
      applyGuestAppointmentCapabilityIndexes(db),
      /datos duplicados impiden índice unique/u,
    );

    assert.deepEqual(await collectionNames(db), collectionsBefore);
    assert.deepEqual(await indexNames(db, "clientcontactverifications"), c1IndexesBefore);
    assert.deepEqual(await indexNames(db, "guestappointmentverificationjobs"), jobIndexesBefore);
    assert.equal(await db.collection("clientcontactverifications").countDocuments({ _id: legacy._id }), 1);
    assert.equal((await indexes(db, "clientcontactverifications")).some((index) => Number.isInteger(index.expireAfterSeconds)), false);
    assert.equal(collectionsBefore.includes("guestappointmentverificationdeliveries"), false);
    assert.equal(collectionsBefore.includes("guestappointmentcapabilities"), false);
    assert.equal(collectionsBefore.includes("guestappointmentintakebuckets"), false);
  });
});

test("6.2.5-C1 retention is collection-wide and includes contact-control", async () => {
  await withDatabase("c1_retention", async (db) => {
    await db.createCollection("clientcontactverifications");
    const verification = c1Verification();
    await db.collection("clientcontactverifications").insertOne(verification);

    await applyGuestAppointmentCapabilityIndexes(db);
    const ttl = (await indexes(db, "clientcontactverifications"))
      .find(({ name }) => name === "client_verification_expiry_retention_ttl");

    assert.ok(ttl);
    assert.deepEqual(ttl.key, { expiresAt: 1 });
    assert.equal(ttl.expireAfterSeconds, 3600);
    assert.equal(ttl.partialFilterExpression, undefined);
    assert.equal(Boolean(ttl.sparse), false);
    assert.equal(await db.collection("clientcontactverifications").countDocuments({ _id: verification._id }), 1);
  });
});

test("6.2.5-C2 completes a compatible partial topology without replacing its index", async () => {
  await withDatabase("partial", async (db) => {
    const expected = GUEST_APPOINTMENT_C2_INDEX_SPECS.find(
      ({ name }) => name === "client_verification_business_purpose_secret_status_expiry",
    );
    await db.createCollection(expected.collection);
    await db.collection(expected.collection).createIndex(expected.key, {
      name: "compatible_preexisting_name",
      collation: { locale: "simple" },
    });

    const applied = await applyGuestAppointmentCapabilityIndexes(db);
    assert.equal(applied.ready, true);
    assert.ok((await indexNames(db, expected.collection)).includes("compatible_preexisting_name"));
  });
});

test("6.2.5-C2 preflight rejects unexpected hidden semantics before apply", async () => {
  await withDatabase("hidden", async (db) => {
    const expected = GUEST_APPOINTMENT_C2_INDEX_SPECS.find(
      ({ name }) => name === "guest_appointment_job_claim",
    );
    await db.createCollection(expected.collection);
    await db.collection(expected.collection).createIndex(expected.key, {
      name: "same_keys_hidden",
      hidden: true,
    });
    const before = await indexNames(db, expected.collection);

    await assert.rejects(preflightGuestAppointmentCapabilityIndexes(db), /opciones incompatibles/u);
    await assert.rejects(applyGuestAppointmentCapabilityIndexes(db), /opciones incompatibles/u);
    assert.deepEqual(await indexNames(db, expected.collection), before);
  });
});
