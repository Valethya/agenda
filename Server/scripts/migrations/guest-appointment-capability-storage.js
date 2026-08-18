import mongoose from "mongoose";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";
import { urlMongo } from "../../src/config/env.js";
import { CLIENT_CONTACT_VERIFICATION_RETENTION_SECONDS } from "../../src/security/clientContactVerificationRetention.constants.js";
import { GUEST_APPOINTMENT_ARTIFACT_RETENTION_SECONDS } from "../../src/security/guestAppointmentArtifactRetention.constants.js";

const canonicalizeOptionValue = (value) => {
  if (Array.isArray(value)) return value.map(canonicalizeOptionValue);
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalizeOptionValue(value[key])]),
    );
  }
  return value;
};

const normalizeCollation = (value) => {
  if (value === undefined || value === null) return null;
  const normalized = canonicalizeOptionValue(value);
  if (
    normalized
    && normalized.locale === "simple"
    && Object.keys(normalized).length === 1
  ) {
    return null;
  }
  return normalized;
};

const spec = (collection, name, key, options = {}) => Object.freeze({
  collection,
  name,
  key: Object.freeze({ ...key }),
  options: Object.freeze({
    unique: options.unique === true,
    expireAfterSeconds: Number.isInteger(options.expireAfterSeconds)
      ? options.expireAfterSeconds
      : null,
    sparse: options.sparse === true,
    partialFilterExpression: options.partialFilterExpression === undefined
      ? null
      : canonicalizeOptionValue(options.partialFilterExpression),
    collation: normalizeCollation(options.collation),
    hidden: options.hidden === true,
  }),
});

export const GUEST_APPOINTMENT_C2_INDEX_SPECS = Object.freeze([
  spec(
    "clientcontactverifications",
    "client_verification_business_purpose_secret_status_expiry",
    { business: 1, purpose: 1, secretHash: 1, status: 1, expiresAt: 1 },
  ),
  spec(
    "clientcontactverifications",
    "client_verification_expiry_retention_ttl",
    { expiresAt: 1 },
    { expireAfterSeconds: CLIENT_CONTACT_VERIFICATION_RETENTION_SECONDS },
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
    "guestappointmentverificationdeliveries",
    "guest_appointment_delivery_retention_ttl",
    { purgeAfter: 1 },
    { expireAfterSeconds: 0 },
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
    "guestappointmentcapabilities",
    "guest_appointment_capability_expiry_retention_ttl",
    { expiresAt: 1 },
    { expireAfterSeconds: GUEST_APPOINTMENT_ARTIFACT_RETENTION_SECONDS },
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
  spec(
    "guestappointmentverificationjobs",
    "guest_appointment_job_terminal_ttl",
    { purgeAfter: 1 },
    { expireAfterSeconds: 0 },
  ),
  spec(
    "guestappointmentintakebuckets",
    "guest_appointment_intake_bucket_ttl",
    { expiresAt: 1 },
    { expireAfterSeconds: 0 },
  ),
]);

const isTtlSpec = (expected) => expected.options.expireAfterSeconds !== null;
const structuralSpecs = () => GUEST_APPOINTMENT_C2_INDEX_SPECS.filter((entry) => !isTtlSpec(entry));
const ttlSpecs = () => GUEST_APPOINTMENT_C2_INDEX_SPECS.filter(isTtlSpec);
const orderedEntries = (value) => Object.entries(value ?? {});
const keyEquals = (actual, expected) => isDeepStrictEqual(
  orderedEntries(actual),
  orderedEntries(expected),
);

const normalizedPhysicalOptions = (index) => ({
  unique: index?.unique === true,
  expireAfterSeconds: Number.isInteger(index?.expireAfterSeconds)
    ? index.expireAfterSeconds
    : null,
  sparse: index?.sparse === true,
  partialFilterExpression: index?.partialFilterExpression === undefined
    ? null
    : canonicalizeOptionValue(index.partialFilterExpression),
  collation: normalizeCollation(index?.collation),
  hidden: index?.hidden === true,
});

const optionsEqual = (index, expected) => isDeepStrictEqual(
  normalizedPhysicalOptions(index),
  expected.options,
);

const exactIndex = (index, expected) => (
  keyEquals(index?.key, expected.key) && optionsEqual(index, expected)
);

const relevantCollections = () => [
  ...new Set(GUEST_APPOINTMENT_C2_INDEX_SPECS.map((entry) => entry.collection)),
];

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

  const sameKeyIndexes = indexes.filter((index) => (
    index.name !== "_id_" && keyEquals(index.key, expected.key)
  ));
  if (sameKeyIndexes.some((index) => !optionsEqual(index, expected))) {
    throw new Error(`Storage 6.2.5-C2 bloqueado: opciones incompatibles para ${expected.collection}.${expected.name}`);
  }
};

const loadPhysicalState = async (db) => {
  const names = new Set(
    (await db.listCollections({}, { nameOnly: true }).toArray()).map((entry) => entry.name),
  );
  const indexesByCollection = new Map();

  for (const collectionName of relevantCollections()) {
    if (!names.has(collectionName)) continue;
    indexesByCollection.set(collectionName, await listIndexes(db, collectionName));
  }

  return { names, indexesByCollection };
};

const inspectSpecsFromState = (state, specs) => specs.map((expected) => {
  if (!state.names.has(expected.collection)) {
    return {
      ...expected,
      physicalName: null,
      present: false,
      compatible: false,
      reason: "collection-missing",
    };
  }

  const indexes = state.indexesByCollection.get(expected.collection) ?? [];
  const sameName = indexes.find((index) => index.name === expected.name);
  const sameKeys = indexes.filter((index) => (
    index.name !== "_id_" && keyEquals(index.key, expected.key)
  ));
  const exact = sameKeys.find((index) => exactIndex(index, expected));
  const hasSemanticConflict = sameKeys.some((index) => !optionsEqual(index, expected));
  const present = Boolean(exact) && !hasSemanticConflict;

  return {
    ...expected,
    physicalName: exact?.name ?? null,
    present,
    compatible: present,
    reason: present
      ? null
      : sameName || sameKeys.length > 0
        ? "index-incompatible"
        : "index-missing",
  };
});

export const inspectGuestAppointmentCapabilityIndexes = async (db) => {
  const state = await loadPhysicalState(db);
  return inspectSpecsFromState(state, GUEST_APPOINTMENT_C2_INDEX_SPECS);
};

const duplicateAggregationId = (expected) => Object.fromEntries(
  Object.keys(expected.key).map((field) => [
    field,
    { $ifNull: [`$${field}`, null] },
  ]),
);

const assertUniqueDataCompatible = async (db, expected, collectionExists) => {
  if (!expected.options.unique || !collectionExists) return;

  const duplicate = await db.collection(expected.collection).aggregate(
    [
      {
        $group: {
          _id: duplicateAggregationId(expected),
          count: { $sum: 1 },
        },
      },
      { $match: { count: { $gt: 1 } } },
      { $limit: 1 },
    ],
    {
      allowDiskUse: false,
      collation: { locale: "simple" },
    },
  ).next();

  if (duplicate) {
    throw new Error(
      `Storage 6.2.5-C2 bloqueado: datos duplicados impiden índice unique ${expected.collection}.${expected.name}`,
    );
  }
};

const assertStateHasNoPredictableConflicts = async (db, state) => {
  for (const expected of GUEST_APPOINTMENT_C2_INDEX_SPECS) {
    if (!state.names.has(expected.collection)) continue;
    const indexes = state.indexesByCollection.get(expected.collection) ?? [];
    assertNoIncompatiblePhysicalIndex(indexes, expected);
  }

  for (const expected of GUEST_APPOINTMENT_C2_INDEX_SPECS) {
    await assertUniqueDataCompatible(db, expected, state.names.has(expected.collection));
  }
};

export const preflightGuestAppointmentCapabilityIndexes = async (db) => {
  const topology = await assertGuestAppointmentCapabilitySupportedTopology(db);
  const state = await loadPhysicalState(db);
  await assertStateHasNoPredictableConflicts(db, state);

  const inspection = inspectSpecsFromState(state, GUEST_APPOINTMENT_C2_INDEX_SPECS);
  return {
    topology,
    indexes: inspection.length,
    missingIndexes: inspection.filter((entry) => !entry.present).length,
    missingCollections: relevantCollections().filter((name) => !state.names.has(name)).length,
  };
};

const createOptions = (expected) => {
  const options = { name: expected.name };
  if (expected.options.unique) options.unique = true;
  if (expected.options.expireAfterSeconds !== null) {
    options.expireAfterSeconds = expected.options.expireAfterSeconds;
  }
  if (expected.options.sparse) options.sparse = true;
  if (expected.options.partialFilterExpression !== null) {
    options.partialFilterExpression = expected.options.partialFilterExpression;
  }
  options.collation = expected.options.collation ?? { locale: "simple" };
  if (expected.options.hidden) options.hidden = true;
  return options;
};

const ensureRelevantCollections = async (db) => {
  const names = new Set(
    (await db.listCollections({}, { nameOnly: true }).toArray()).map((entry) => entry.name),
  );

  for (const collectionName of relevantCollections()) {
    if (names.has(collectionName)) continue;
    await db.createCollection(collectionName);
    names.add(collectionName);
  }
};

const assertSpecsReady = async (db, specs) => {
  const state = await loadPhysicalState(db);
  const inspection = inspectSpecsFromState(state, specs);
  const problem = inspection.find((entry) => !entry.present || !entry.compatible);
  if (problem) {
    throw new Error(
      `Storage 6.2.5-C2 bloqueado: índice físico requerido ausente/incompatible (${problem.collection}.${problem.name})`,
    );
  }
  return inspection;
};

const materializeSpecs = async (db, specs, { recheckUnique = false } = {}) => {
  for (const expected of specs) {
    const indexes = await listIndexes(db, expected.collection);
    assertNoIncompatiblePhysicalIndex(indexes, expected);
    if (indexes.some((index) => exactIndex(index, expected))) continue;

    if (recheckUnique && expected.options.unique) {
      await assertUniqueDataCompatible(db, expected, true);
    }

    await db.collection(expected.collection).createIndex(
      expected.key,
      createOptions(expected),
    );

    const after = await listIndexes(db, expected.collection);
    assertNoIncompatiblePhysicalIndex(after, expected);
    if (!after.some((index) => exactIndex(index, expected))) {
      throw new Error(`Storage 6.2.5-C2 bloqueado: no se materializó ${expected.collection}.${expected.name}`);
    }
  }
};

export const assertGuestAppointmentCapabilityIndexesReady = async (db) => {
  await assertGuestAppointmentCapabilitySupportedTopology(db);
  const inspection = await assertSpecsReady(db, GUEST_APPOINTMENT_C2_INDEX_SPECS);
  return { ready: true, indexes: inspection.length };
};

export const applyGuestAppointmentCapabilityIndexes = async (db) => {
  // PHASE 1 — complete read-only preflight.
  const preflight = await preflightGuestAppointmentCapabilityIndexes(db);

  // PHASE 2 — structural/non-destructive materialization.
  await ensureRelevantCollections(db);
  await materializeSpecs(db, structuralSpecs(), { recheckUnique: true });
  await assertSpecsReady(db, structuralSpecs());

  // Re-read all cleanup targets before activating the first new TTL.
  const beforeTtl = await loadPhysicalState(db);
  for (const expected of ttlSpecs()) {
    const indexes = beforeTtl.indexesByCollection.get(expected.collection) ?? [];
    assertNoIncompatiblePhysicalIndex(indexes, expected);
  }

  // PHASE 3 — TTL/cleanup materialization.
  await materializeSpecs(db, ttlSpecs());

  // PHASE 4 — final physical verification.
  const ready = await assertGuestAppointmentCapabilityIndexesReady(db);
  return { ...ready, topology: preflight.topology };
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
