import mongoose from "mongoose";
import { fileURLToPath } from "node:url";
import { urlMongo } from "../../src/config/env.js";

const spec = (collection, name, key, options = {}) => Object.freeze({
  collection,
  name,
  key: Object.freeze({ ...key }),
  options: Object.freeze({ unique: Boolean(options.unique) }),
});

export const GUEST_APPOINTMENT_C2_INDEX_SPECS = Object.freeze([
  spec(
    "clientcontactverifications",
    "client_verification_business_purpose_secret_status_expiry",
    { business: 1, purpose: 1, secretHash: 1, status: 1, expiresAt: 1 },
  ),
  spec(
    "guestappointmentverificationdeliveries",
    "guest_appointment_delivery_verification_unique",
    { verification: 1 },
    { unique: true },
  ),
  spec(
    "guestappointmentverificationdeliveries",
    "guest_appointment_delivery_scope_status",
    { business: 1, appointment: 1, purpose: 1, action: 1, status: 1 },
  ),
  spec(
    "guestappointmentcapabilities",
    "guest_appointment_capability_verification_unique",
    { verification: 1 },
    { unique: true },
  ),
  spec(
    "guestappointmentcapabilities",
    "guest_appointment_capability_scope_secret_status_expiry",
    { business: 1, appointment: 1, action: 1, secretHash: 1, status: 1, expiresAt: 1 },
  ),
  spec(
    "guestappointmentverificationjobs",
    "guest_appointment_job_scope_unique",
    { business: 1, appointment: 1, purpose: 1, action: 1 },
    { unique: true },
  ),
  spec(
    "guestappointmentverificationjobs",
    "guest_appointment_job_claim",
    { status: 1, leaseExpiresAt: 1, updatedAt: 1 },
  ),
]);

const orderedEntries = (value) => Object.entries(value ?? {});
const keyEquals = (actual, expected) => JSON.stringify(orderedEntries(actual)) === JSON.stringify(orderedEntries(expected));
const exactIndex = (index, expected) => (
  keyEquals(index?.key, expected.key)
  && Boolean(index?.unique) === Boolean(expected.options.unique)
);

const relevantCollections = () => [...new Set(GUEST_APPOINTMENT_C2_INDEX_SPECS.map((entry) => entry.collection))];

export const assertGuestAppointmentCapabilitySupportedTopology = async (db) => {
  if (!db) throw new Error("Storage 6.2.5-C2 bloqueado: MongoDB no está conectado");
  const hello = await db.admin().command({ hello: 1 });
  const topology = hello?.msg === "isdbgrid"
    ? "mongos"
    : typeof hello?.setName === "string" && hello.setName
      ? "replicaSet"
      : "standalone";

  if (!new Set(["replicaSet", "mongos"]).has(topology)) {
    throw new Error(`Storage 6.2.5-C2 bloqueado: topología MongoDB no soportada (${topology})`);
  }
  return topology;
};

const listIndexes = async (db, collectionName) => db.collection(collectionName).listIndexes().toArray();

const assertNoIncompatiblePhysicalIndex = (indexes, expected) => {
  const sameName = indexes.find((index) => index.name === expected.name);
  if (sameName && !exactIndex(sameName, expected)) {
    throw new Error(`Storage 6.2.5-C2 bloqueado: índice incompatible ${expected.collection}.${expected.name}`);
  }

  const sameKeys = indexes.find((index) => index.name !== "_id_" && keyEquals(index.key, expected.key));
  if (sameKeys && Boolean(sameKeys.unique) !== Boolean(expected.options.unique)) {
    throw new Error(`Storage 6.2.5-C2 bloqueado: unicidad incompatible para ${expected.collection}.${expected.name}`);
  }
};

export const inspectGuestAppointmentCapabilityIndexes = async (db) => {
  const names = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((entry) => entry.name));
  const result = [];

  for (const expected of GUEST_APPOINTMENT_C2_INDEX_SPECS) {
    if (!names.has(expected.collection)) {
      result.push({ ...expected, present: false, compatible: false, reason: "collection-missing" });
      continue;
    }
    const indexes = await listIndexes(db, expected.collection);
    const sameName = indexes.find((index) => index.name === expected.name);
    const exact = indexes.find((index) => index.name !== "_id_" && exactIndex(index, expected));
    const present = Boolean(exact);
    result.push({
      ...expected,
      physicalName: exact?.name ?? null,
      present,
      compatible: present,
      reason: present ? null : sameName ? "index-incompatible" : "index-missing",
    });
  }

  return result;
};

export const assertGuestAppointmentCapabilityIndexesReady = async (db) => {
  await assertGuestAppointmentCapabilitySupportedTopology(db);
  const inspection = await inspectGuestAppointmentCapabilityIndexes(db);
  const problem = inspection.find((entry) => !entry.present || !entry.compatible);
  if (problem) {
    throw new Error(`Storage 6.2.5-C2 bloqueado: índice físico requerido ausente/incompatible (${problem.collection}.${problem.name})`);
  }
  return { ready: true, indexes: inspection.length };
};

export const applyGuestAppointmentCapabilityIndexes = async (db) => {
  const topology = await assertGuestAppointmentCapabilitySupportedTopology(db);
  const names = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((entry) => entry.name));

  for (const collectionName of relevantCollections()) {
    if (!names.has(collectionName)) {
      await db.createCollection(collectionName);
      names.add(collectionName);
    }
  }

  for (const expected of GUEST_APPOINTMENT_C2_INDEX_SPECS) {
    const indexes = await listIndexes(db, expected.collection);
    assertNoIncompatiblePhysicalIndex(indexes, expected);
    const alreadyExact = indexes.some((index) => exactIndex(index, expected));
    if (alreadyExact) continue;

    await db.collection(expected.collection).createIndex(
      expected.key,
      { name: expected.name, unique: Boolean(expected.options.unique) },
    );

    const after = await listIndexes(db, expected.collection);
    if (!after.some((index) => exactIndex(index, expected))) {
      throw new Error(`Storage 6.2.5-C2 bloqueado: no se materializó ${expected.collection}.${expected.name}`);
    }
  }

  const ready = await assertGuestAppointmentCapabilityIndexesReady(db);
  return { ...ready, topology };
};

const runCli = async () => {
  if (!urlMongo) throw new Error("MONGO_URI no está definida");
  await mongoose.connect(urlMongo, { autoIndex: false });
  try {
    const result = await applyGuestAppointmentCapabilityIndexes(mongoose.connection.db);
    process.stdout.write(`Storage 6.2.5-C2 listo (${result.topology}, ${result.indexes} índices).\n`);
  } finally {
    await mongoose.disconnect();
  }
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCli().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
