import mongoose from "mongoose";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";
import { urlMongo } from "../../src/config/env.js";

export const PUBLIC_WEB_INDEX_SPEC = Object.freeze({
  collection: "businessconfigs",
  name: "business_config_public_web_origin_fresh",
  key: Object.freeze({
    "publicWeb.verifiedOrigin": 1,
    "publicWeb.verificationStatus": 1,
    "publicWeb.verificationValidUntil": 1,
  }),
});

const orderedEntries = (value) => Object.entries(value ?? {});
const keyEquals = (actual, expected) => isDeepStrictEqual(
  orderedEntries(actual),
  orderedEntries(expected),
);

const hasUnexpectedSemantics = (index) => Boolean(
  index?.unique === true
  || index?.sparse === true
  || index?.hidden === true
  || index?.partialFilterExpression !== undefined
  || index?.expireAfterSeconds !== undefined
  || index?.collation !== undefined
);

const exactIndex = (index) => (
  keyEquals(index?.key, PUBLIC_WEB_INDEX_SPEC.key)
  && !hasUnexpectedSemantics(index)
);

const collectionExists = async (db) => Boolean(await db
  .listCollections({ name: PUBLIC_WEB_INDEX_SPEC.collection }, { nameOnly: true })
  .hasNext());

const listIndexes = async (db) => {
  if (!await collectionExists(db)) return [];
  return db.collection(PUBLIC_WEB_INDEX_SPEC.collection).listIndexes().toArray();
};

const assertNoIncompatibleIndex = (indexes) => {
  const sameName = indexes.find((index) => index.name === PUBLIC_WEB_INDEX_SPEC.name);
  if (sameName && !exactIndex(sameName)) {
    throw new Error(
      `Storage 6.2.6-B bloqueado: índice incompatible ${PUBLIC_WEB_INDEX_SPEC.collection}.${PUBLIC_WEB_INDEX_SPEC.name}`,
    );
  }

  const sameKeys = indexes.filter((index) => (
    index.name !== "_id_" && keyEquals(index.key, PUBLIC_WEB_INDEX_SPEC.key)
  ));
  if (sameKeys.some((index) => !exactIndex(index))) {
    throw new Error(
      `Storage 6.2.6-B bloqueado: opciones incompatibles para ${PUBLIC_WEB_INDEX_SPEC.collection}.${PUBLIC_WEB_INDEX_SPEC.name}`,
    );
  }
};

export const inspectPublicWebIndexes = async (db) => {
  if (!db) throw new Error("Storage 6.2.6-B bloqueado: MongoDB no está conectado");
  const exists = await collectionExists(db);
  if (!exists) {
    return [{
      ...PUBLIC_WEB_INDEX_SPEC,
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
    ...PUBLIC_WEB_INDEX_SPEC,
    present: Boolean(physical),
    compatible: Boolean(physical),
    physicalName: physical?.name ?? null,
    reason: physical ? null : "index-missing",
  }];
};

export const assertPublicWebIndexesReady = async (db) => {
  const inspection = await inspectPublicWebIndexes(db);
  const problem = inspection.find((entry) => !entry.present || !entry.compatible);
  if (problem) {
    throw new Error(
      `Storage 6.2.6-B bloqueado: índice físico requerido ausente/incompatible (${problem.collection}.${problem.name})`,
    );
  }
  return { ready: true, indexes: inspection.length };
};

export const applyPublicWebIndexes = async (db) => {
  if (!db) throw new Error("Storage 6.2.6-B bloqueado: MongoDB no está conectado");

  // Read-only preflight: reject conflicting physical semantics before mutation.
  const exists = await collectionExists(db);
  if (exists) assertNoIncompatibleIndex(await listIndexes(db));

  // Non-destructive materialization only. No drop/recreate path exists.
  if (!exists) await db.createCollection(PUBLIC_WEB_INDEX_SPEC.collection);
  const indexes = await listIndexes(db);
  if (!indexes.some((index) => exactIndex(index))) {
    await db.collection(PUBLIC_WEB_INDEX_SPEC.collection).createIndex(
      PUBLIC_WEB_INDEX_SPEC.key,
      { name: PUBLIC_WEB_INDEX_SPEC.name },
    );
  }

  return assertPublicWebIndexesReady(db);
};

const runCli = async () => {
  if (!urlMongo) throw new Error("MONGO_URI no está definida");
  await mongoose.connect(urlMongo, { autoIndex: false });
  try {
    const result = await applyPublicWebIndexes(mongoose.connection.db);
    process.stdout.write(`Storage 6.2.6-B publicWeb listo (${result.indexes} índice).\n`);
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
