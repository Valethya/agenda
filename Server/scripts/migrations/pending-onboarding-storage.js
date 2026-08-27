import mongoose from "mongoose";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";
import { urlMongo } from "../../src/config/env.js";

export const PENDING_ONBOARDING_INDEX_SPEC = Object.freeze({
  collection: "pendingonboardings",
  name: "pending_onboarding_business_email_pending_unique",
  key: Object.freeze({ business: 1, email: 1 }),
  options: Object.freeze({
    unique: true,
    partialFilterExpression: Object.freeze({ status: "pending" }),
  }),
});

const orderedEntries = (value) => Object.entries(value ?? {});
const keyEquals = (actual, expected) => isDeepStrictEqual(
  orderedEntries(actual),
  orderedEntries(expected),
);

const normalizedOptions = (index) => ({
  unique: index?.unique === true,
  partialFilterExpression: index?.partialFilterExpression ?? null,
});

const expectedOptions = () => ({
  unique: true,
  partialFilterExpression: { status: "pending" },
});

const exactIndex = (index) => (
  keyEquals(index?.key, PENDING_ONBOARDING_INDEX_SPEC.key)
  && isDeepStrictEqual(normalizedOptions(index), expectedOptions())
);

const collectionExists = async (db) => Boolean(await db
  .listCollections({ name: PENDING_ONBOARDING_INDEX_SPEC.collection }, { nameOnly: true })
  .hasNext());

const listIndexes = async (db) => {
  if (!await collectionExists(db)) return [];
  return db.collection(PENDING_ONBOARDING_INDEX_SPEC.collection).listIndexes().toArray();
};

const assertNoIncompatibleIndex = (indexes) => {
  const sameName = indexes.find((index) => index.name === PENDING_ONBOARDING_INDEX_SPEC.name);
  if (sameName && !exactIndex(sameName)) {
    throw new Error(
      `Storage C1 bloqueado: índice incompatible ${PENDING_ONBOARDING_INDEX_SPEC.collection}.${PENDING_ONBOARDING_INDEX_SPEC.name}`,
    );
  }

  const sameKeys = indexes.filter((index) => (
    index.name !== "_id_" && keyEquals(index.key, PENDING_ONBOARDING_INDEX_SPEC.key)
  ));
  if (sameKeys.some((index) => !exactIndex(index))) {
    throw new Error(
      `Storage C1 bloqueado: opciones incompatibles para ${PENDING_ONBOARDING_INDEX_SPEC.collection}.${PENDING_ONBOARDING_INDEX_SPEC.name}`,
    );
  }
};

const assertPendingDataCompatible = async (db) => {
  if (!await collectionExists(db)) return;

  const duplicate = await db.collection(PENDING_ONBOARDING_INDEX_SPEC.collection).aggregate([
    { $match: { status: "pending" } },
    {
      $group: {
        _id: { business: "$business", email: "$email" },
        count: { $sum: 1 },
      },
    },
    { $match: { count: { $gt: 1 } } },
    { $limit: 1 },
  ]).next();

  if (duplicate) {
    throw new Error(
      "Storage C1 bloqueado: existen onboardings pending duplicados para Business + email",
    );
  }
};

export const inspectPendingOnboardingIndexes = async (db) => {
  if (!db) throw new Error("Storage C1 bloqueado: MongoDB no está conectado");

  const exists = await collectionExists(db);
  if (!exists) {
    return [{
      ...PENDING_ONBOARDING_INDEX_SPEC,
      present: false,
      compatible: false,
      physicalName: null,
      reason: "collection-missing",
    }];
  }

  const indexes = await listIndexes(db);
  assertNoIncompatibleIndex(indexes);
  const physical = indexes.find((index) => exactIndex(index));

  return [{
    ...PENDING_ONBOARDING_INDEX_SPEC,
    present: Boolean(physical),
    compatible: Boolean(physical),
    physicalName: physical?.name ?? null,
    reason: physical ? null : "index-missing",
  }];
};

export const assertPendingOnboardingIndexesReady = async (db) => {
  const inspection = await inspectPendingOnboardingIndexes(db);
  const problem = inspection.find((entry) => !entry.present || !entry.compatible);

  if (problem) {
    throw new Error(
      `Storage C1 bloqueado: índice físico requerido ausente/incompatible (${problem.collection}.${problem.name})`,
    );
  }

  return { ready: true, indexes: inspection.length };
};

export const applyPendingOnboardingIndexes = async (db) => {
  if (!db) throw new Error("Storage C1 bloqueado: MongoDB no está conectado");

  const exists = await collectionExists(db);
  if (exists) {
    assertNoIncompatibleIndex(await listIndexes(db));
    await assertPendingDataCompatible(db);
  } else {
    await db.createCollection(PENDING_ONBOARDING_INDEX_SPEC.collection);
  }

  const indexes = await listIndexes(db);
  if (!indexes.some((index) => exactIndex(index))) {
    await db.collection(PENDING_ONBOARDING_INDEX_SPEC.collection).createIndex(
      PENDING_ONBOARDING_INDEX_SPEC.key,
      {
        ...PENDING_ONBOARDING_INDEX_SPEC.options,
        name: PENDING_ONBOARDING_INDEX_SPEC.name,
      },
    );
  }

  return assertPendingOnboardingIndexesReady(db);
};

const runCli = async () => {
  if (!urlMongo) throw new Error("MONGO_URI no está definida");
  await mongoose.connect(urlMongo, { autoIndex: false });
  try {
    const result = await applyPendingOnboardingIndexes(mongoose.connection.db);
    process.stdout.write(`Storage C1 pending onboarding listo (${result.indexes} índice).\n`);
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
