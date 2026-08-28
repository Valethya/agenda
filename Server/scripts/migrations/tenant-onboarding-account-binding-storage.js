import mongoose from "mongoose";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";
import { urlMongo } from "../../src/config/env.js";
import { assertPendingOnboardingIndexesReady } from "./pending-onboarding-storage.js";
import {
  PENDING_ONBOARDING_CHANNEL,
  PENDING_ONBOARDING_PURPOSE,
} from "../../src/db/models/pendingOnboarding.model.js";

export const TENANT_ONBOARDING_CHALLENGE_INDEX_SPEC = Object.freeze({
  collection: "tenantonboardingchallenges",
  name: "tenant_onboarding_challenge_pending_unique",
  key: Object.freeze({ pendingOnboarding: 1 }),
  options: Object.freeze({ unique: true }),
});

export const USER_EMAIL_UNIQUE_INDEX_SPEC = Object.freeze({
  collection: "users",
  name: "email_1",
  key: Object.freeze({ email: 1 }),
  options: Object.freeze({ unique: true }),
});

const specs = Object.freeze([
  TENANT_ONBOARDING_CHALLENGE_INDEX_SPEC,
  USER_EMAIL_UNIQUE_INDEX_SPEC,
]);

const entries = (value) => Object.entries(value ?? {});
const keyEquals = (actual, expected) => isDeepStrictEqual(entries(actual), entries(expected));
const normalizeCollation = (value) => {
  if (value === undefined || value === null) return null;
  if (value.locale === "simple" && Object.keys(value).length === 1) return null;
  return value;
};
const normalizedOptions = (index) => ({
  unique: index?.unique === true,
  sparse: index?.sparse === true,
  hidden: index?.hidden === true,
  expireAfterSeconds: Number.isInteger(index?.expireAfterSeconds)
    ? index.expireAfterSeconds
    : null,
  partialFilterExpression: index?.partialFilterExpression ?? null,
  collation: normalizeCollation(index?.collation),
});
const expectedOptions = () => ({
  unique: true,
  sparse: false,
  hidden: false,
  expireAfterSeconds: null,
  partialFilterExpression: null,
  collation: null,
});
const exactIndex = (index, spec) => (
  keyEquals(index?.key, spec.key)
  && isDeepStrictEqual(normalizedOptions(index), expectedOptions())
);
const collectionExists = async (db, name) => Boolean(await db
  .listCollections({ name }, { nameOnly: true })
  .hasNext());
const listIndexes = async (db, collection) => (
  await collectionExists(db, collection)
    ? db.collection(collection).listIndexes().toArray()
    : []
);

const assertNoIncompatibleIndex = (indexes, spec) => {
  const sameName = indexes.find((index) => index.name === spec.name);
  if (sameName && !exactIndex(sameName, spec)) {
    throw new Error(`Storage C2 bloqueado: índice incompatible ${spec.collection}.${spec.name}`);
  }

  const sameKeys = indexes.filter((index) => index.name !== "_id_" && keyEquals(index.key, spec.key));
  if (sameKeys.some((index) => !exactIndex(index, spec))) {
    throw new Error(`Storage C2 bloqueado: opciones incompatibles para ${spec.collection}.${spec.name}`);
  }
};

const assertUserEmailDataCompatible = async (db) => {
  if (!await collectionExists(db, USER_EMAIL_UNIQUE_INDEX_SPEC.collection)) return;
  const users = db.collection(USER_EMAIL_UNIQUE_INDEX_SPEC.collection);

  const missing = await users.findOne({
    $or: [
      { email: { $exists: false } },
      { email: { $size: 0 } },
    ],
  });
  if (missing) throw new Error("Storage C2 bloqueado: existe User sin email canónico");

  const malformed = await users.aggregate([
    { $unwind: "$email" },
    { $match: { $expr: { $ne: [{ $type: "$email" }, "string"] } } },
    { $limit: 1 },
  ]).next();
  if (malformed) throw new Error("Storage C2 bloqueado: existe User con email no textual");

  const nonCanonical = await users.aggregate([
    { $unwind: "$email" },
    { $match: { $expr: { $eq: [{ $type: "$email" }, "string"] } } },
    {
      $match: {
        $expr: {
          $ne: ["$email", { $toLower: { $trim: { input: "$email" } } }],
        },
      },
    },
    { $limit: 1 },
  ]).next();
  if (nonCanonical) {
    throw new Error("Storage C2 bloqueado: existe User con email fuera de normalización trim+lowercase");
  }

  const duplicate = await users.aggregate([
    { $unwind: "$email" },
    { $group: { _id: "$email", users: { $addToSet: "$_id" } } },
    { $match: { "users.1": { $exists: true } } },
    { $limit: 1 },
  ]).next();
  if (duplicate) throw new Error("Storage C2 bloqueado: existen Users distintos con el mismo email");
};

const assertChallengeDataCompatible = async (db) => {
  const collectionName = TENANT_ONBOARDING_CHALLENGE_INDEX_SPEC.collection;
  if (!await collectionExists(db, collectionName)) return;
  const challenges = db.collection(collectionName);

  const malformed = await challenges.findOne({
    $or: [
      { pendingOnboarding: { $exists: false } },
      { business: { $exists: false } },
      { destination: { $exists: false } },
      { secretHash: { $exists: false } },
      { expiresAt: { $exists: false } },
      { channel: { $ne: PENDING_ONBOARDING_CHANNEL } },
      { purpose: { $ne: PENDING_ONBOARDING_PURPOSE } },
    ],
  });
  if (malformed) throw new Error("Storage C2 bloqueado: existe challenge fuera del envelope tenant-onboarding");

  const nonCanonical = await challenges.findOne({
    $expr: {
      $ne: ["$destination", { $toLower: { $trim: { input: "$destination" } } }],
    },
  });
  if (nonCanonical) throw new Error("Storage C2 bloqueado: existe challenge con destino no canónico");

  const duplicate = await challenges.aggregate([
    { $group: { _id: "$pendingOnboarding", count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
    { $limit: 1 },
  ]).next();
  if (duplicate) throw new Error("Storage C2 bloqueado: existen múltiples challenges para un onboarding");
};

export const inspectTenantOnboardingAccountBindingIndexes = async (db) => {
  if (!db) throw new Error("Storage C2 bloqueado: MongoDB no está conectado");
  const result = [];

  for (const spec of specs) {
    const indexes = await listIndexes(db, spec.collection);
    assertNoIncompatibleIndex(indexes, spec);
    const physical = indexes.find((index) => exactIndex(index, spec));
    result.push({
      ...spec,
      present: Boolean(physical),
      compatible: Boolean(physical),
      physicalName: physical?.name ?? null,
      reason: physical ? null : "index-missing",
    });
  }

  return result;
};

export const assertTenantOnboardingAccountBindingIndexesReady = async (db) => {
  await assertPendingOnboardingIndexesReady(db);
  const inspection = await inspectTenantOnboardingAccountBindingIndexes(db);
  const problem = inspection.find((entry) => !entry.present || !entry.compatible);
  if (problem) {
    throw new Error(
      `Storage C2 bloqueado: índice físico requerido ausente/incompatible (${problem.collection}.${problem.name})`,
    );
  }
  return { ready: true, indexes: inspection.length + 1 };
};

export const applyTenantOnboardingAccountBindingIndexes = async (db) => {
  if (!db) throw new Error("Storage C2 bloqueado: MongoDB no está conectado");

  // C2 depends on C1 rather than silently materializing it as a side effect.
  await assertPendingOnboardingIndexesReady(db);
  await assertUserEmailDataCompatible(db);
  await assertChallengeDataCompatible(db);

  for (const spec of specs) {
    if (!await collectionExists(db, spec.collection)) {
      await db.createCollection(spec.collection);
    }
    const indexes = await listIndexes(db, spec.collection);
    assertNoIncompatibleIndex(indexes, spec);
    if (!indexes.some((index) => exactIndex(index, spec))) {
      await db.collection(spec.collection).createIndex(spec.key, {
        ...spec.options,
        name: spec.name,
      });
    }
  }

  return assertTenantOnboardingAccountBindingIndexesReady(db);
};

const runCli = async () => {
  if (!urlMongo) throw new Error("MONGO_URI no está definida");
  await mongoose.connect(urlMongo, { autoIndex: false });
  try {
    const result = await applyTenantOnboardingAccountBindingIndexes(mongoose.connection.db);
    process.stdout.write(`Storage C2 tenant onboarding listo (${result.indexes} índices requeridos).\n`);
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
