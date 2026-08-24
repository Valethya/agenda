import "dotenv/config";

import path from "node:path";
import { pathToFileURL } from "node:url";
import mongoose, { mongo } from "mongoose";
import {
  fingerprintMongoTarget,
  sanitizeAuditErrorMessage,
  validateAuditEnvironment,
  validateCodeSha,
  validateTargetFingerprint,
} from "./membership-authority-provenance.js";
import { isExactMembershipUniqueIndex } from "./membership-authority-audit.js";

export const MEMBERSHIP_BOOKABILITY_MIGRATION_VERSION = "1.0.0";
export const MEMBERSHIP_BOOKABILITY_APPLY_CONFIRMATION =
  "APPLY_MEMBERSHIP_BOOKABILITY_BACKFILL";

const REMOTE_ENVIRONMENTS = new Set(["staging", "production"]);
const VALID_ROLES = new Set(["admin", "worker"]);
const DEPLOYMENT_SHA_VARIABLES = Object.freeze([
  "RAILWAY_GIT_COMMIT_SHA",
  "GITHUB_SHA",
]);

const isObjectId = (value) => value instanceof mongo.ObjectId;
const idKey = (value) => (isObjectId(value) ? value.toHexString() : null);
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

export const parseMembershipBookabilityArgs = (argv) => {
  const options = {};
  const allowed = new Set([
    "mode",
    "environment",
    "expected-target-fingerprint",
    "approved-sha",
    "confirm",
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help") {
      if (options.help) throw new Error("Opción duplicada: --help");
      options.help = true;
      continue;
    }
    if (!argument.startsWith("--")) throw new Error(`Argumento no reconocido: ${argument}`);
    const separator = argument.indexOf("=");
    const key = separator === -1 ? argument.slice(2) : argument.slice(2, separator);
    if (!allowed.has(key)) throw new Error(`Opción no reconocida: --${key}`);
    const inlineValue = separator === -1 ? undefined : argument.slice(separator + 1);
    const value = inlineValue ?? argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Falta valor para --${key}`);
    const optionName = key === "expected-target-fingerprint"
      ? "expectedTargetFingerprint"
      : key === "approved-sha"
        ? "approvedSha"
        : key;
    if (hasOwn(options, optionName)) throw new Error(`Opción duplicada: --${key}`);
    options[optionName] = value;
    if (inlineValue === undefined) index += 1;
  }
  return options;
};

const resolveDeploymentSha = (environment = process.env) => {
  for (const variable of DEPLOYMENT_SHA_VARIABLES) {
    const value = environment?.[variable];
    if (typeof value === "string" && value.trim()) {
      return { sha: validateCodeSha(value.trim()), source: variable };
    }
  }
  return { sha: null, source: null };
};

export const validateMembershipBookabilityOptions = (
  options,
  processEnvironment = process.env,
) => {
  if (!options?.mode || !["plan", "apply"].includes(options.mode)) {
    throw new Error('--mode es obligatorio y sólo acepta "plan" o "apply"');
  }
  validateAuditEnvironment(options.environment);
  const remote = REMOTE_ENVIRONMENTS.has(options.environment);

  if (!remote && processEnvironment?.NODE_ENV !== options.environment) {
    throw new Error("El entorno solicitado debe coincidir exactamente con NODE_ENV");
  }

  if (options.expectedTargetFingerprint) {
    options.expectedTargetFingerprint = validateTargetFingerprint(options.expectedTargetFingerprint);
  }

  if (options.mode === "apply") {
    if (options.confirm !== MEMBERSHIP_BOOKABILITY_APPLY_CONFIRMATION) {
      throw new Error(`apply exige --confirm=${MEMBERSHIP_BOOKABILITY_APPLY_CONFIRMATION}`);
    }
    if (!options.expectedTargetFingerprint) {
      throw new Error("apply exige --expected-target-fingerprint");
    }
    if (remote) {
      options.approvedSha = validateCodeSha(options.approvedSha);
      const deployment = resolveDeploymentSha(processEnvironment);
      if (deployment.sha && deployment.sha !== options.approvedSha) {
        throw new Error("El SHA efectivo del deployment no coincide con el SHA aprobado");
      }
    }
  }

  return options;
};

const exactMembershipIndexState = (indexes) => {
  const exact = indexes.filter(isExactMembershipUniqueIndex);
  const sameKey = indexes.filter((index) => {
    const entries = Object.entries(index?.key ?? {});
    return entries.length === 2
      && entries[0]?.[0] === "user" && entries[0]?.[1] === 1
      && entries[1]?.[0] === "business" && entries[1]?.[1] === 1;
  });
  return {
    ready: exact.length === 1 && sameKey.every(isExactMembershipUniqueIndex),
    exactCount: exact.length,
    sameKeyCount: sameKey.length,
  };
};

const addFinding = (findings, code) => findings.push(code);

export const inspectMembershipBookabilityStorage = async (db) => {
  if (!db) throw new Error("Bookability storage bloqueado: MongoDB no está conectado");

  const collectionNames = new Set(
    (await db.listCollections({}, { nameOnly: true }).toArray()).map((entry) => entry.name),
  );
  const findings = [];
  if (!collectionNames.has("memberships")) addFinding(findings, "membershipCollectionMissing");
  if (!collectionNames.has("users")) addFinding(findings, "userCollectionMissing");
  if (!collectionNames.has("businesses")) addFinding(findings, "businessCollectionMissing");

  if (findings.length > 0) {
    return {
      version: MEMBERSHIP_BOOKABILITY_MIGRATION_VERSION,
      ready: false,
      findings,
      counts: { memberships: 0, missing: 0, canonicalTrue: 0, canonicalFalse: 0, toTrue: 0, toFalse: 0 },
      index: { ready: false, exactCount: 0, sameKeyCount: 0 },
      writes: [],
    };
  }

  const [memberships, users, businesses, indexes] = await Promise.all([
    db.collection("memberships").find({}).toArray(),
    db.collection("users").find({}).toArray(),
    db.collection("businesses").find({}).toArray(),
    db.collection("memberships").listIndexes().toArray(),
  ]);

  const index = exactMembershipIndexState(indexes);
  if (!index.ready) addFinding(findings, "membershipUniqueIndexMissingOrIncompatible");

  const usersById = new Map(users.filter((user) => isObjectId(user?._id)).map((user) => [idKey(user._id), user]));
  const businessesById = new Map(businesses.filter((business) => isObjectId(business?._id)).map((business) => [idKey(business._id), business]));
  const seenPairs = new Set();
  const writes = [];
  const counts = {
    memberships: memberships.length,
    missing: 0,
    canonicalTrue: 0,
    canonicalFalse: 0,
    toTrue: 0,
    toFalse: 0,
  };

  for (const membership of memberships) {
    if (!isObjectId(membership?._id)) addFinding(findings, "membershipIdNotObjectId");
    if (!isObjectId(membership?.user)) addFinding(findings, "membershipUserNotObjectId");
    if (!isObjectId(membership?.business)) addFinding(findings, "membershipBusinessNotObjectId");

    const userId = idKey(membership?.user);
    const businessId = idKey(membership?.business);
    const pair = userId && businessId ? `${userId}:${businessId}` : null;
    if (pair) {
      if (seenPairs.has(pair)) addFinding(findings, "duplicateUserBusinessMembership");
      seenPairs.add(pair);
    }

    const user = userId ? usersById.get(userId) : null;
    const business = businessId ? businessesById.get(businessId) : null;
    if (userId && !user) addFinding(findings, "referencedUserMissing");
    if (businessId && !business) addFinding(findings, "referencedBusinessMissing");
    if (!VALID_ROLES.has(membership?.role)) addFinding(findings, "membershipRoleOutsideContract");

    if (hasOwn(membership, "isBookable")) {
      if (typeof membership.isBookable !== "boolean") {
        addFinding(findings, "isBookableNonBoolean");
        continue;
      }
      if (membership.isBookable) {
        counts.canonicalTrue += 1;
        if (membership.isActive !== true) addFinding(findings, "inactiveMembershipBookable");
        if (user && user.isActive !== true) addFinding(findings, "inactiveUserBookable");
        if (business && business.isActive !== true) addFinding(findings, "inactiveBusinessBookable");
      } else {
        counts.canonicalFalse += 1;
      }
      continue;
    }

    counts.missing += 1;
    if (!user || !business || !VALID_ROLES.has(membership?.role) || !isObjectId(membership?._id)) continue;

    const nextValue = membership.isActive === true
      && user.isActive === true
      && business.isActive === true
      && membership.role === "worker";
    writes.push({ _id: membership._id, isBookable: nextValue });
    if (nextValue) counts.toTrue += 1;
    else counts.toFalse += 1;
  }

  if (collectionNames.has("services")) {
    const services = await db.collection("services").find({}, { projection: { business: 1, workers: 1 } }).toArray();
    const membershipPairs = new Set(memberships
      .map((membership) => {
        const userId = idKey(membership?.user);
        const businessId = idKey(membership?.business);
        return userId && businessId ? `${userId}:${businessId}` : null;
      })
      .filter(Boolean));
    for (const service of services) {
      const businessId = idKey(service?.business);
      if (!businessId) {
        addFinding(findings, "serviceBusinessNotObjectId");
        continue;
      }
      for (const worker of Array.isArray(service?.workers) ? service.workers : []) {
        const workerId = idKey(worker);
        if (!workerId) addFinding(findings, "serviceWorkerNotObjectId");
        else if (!membershipPairs.has(`${workerId}:${businessId}`)) {
          addFinding(findings, "crossTenantServiceWorkerReference");
        }
      }
    }
  }

  const uniqueFindings = [...new Set(findings)].sort();
  return {
    version: MEMBERSHIP_BOOKABILITY_MIGRATION_VERSION,
    ready: uniqueFindings.length === 0 && counts.missing === 0,
    findings: uniqueFindings,
    counts,
    index,
    writes,
  };
};

export const planMembershipBookabilityMigration = async (db) => {
  const inspection = await inspectMembershipBookabilityStorage(db);
  return {
    ...inspection,
    writes: inspection.writes.length,
    canApply: inspection.findings.length === 0,
  };
};

export const assertMembershipBookabilityStorageReady = async (db) => {
  const inspection = await inspectMembershipBookabilityStorage(db);
  if (inspection.findings.length > 0) {
    throw new Error(`Bookability storage bloqueado: ${inspection.findings[0]}`);
  }
  if (inspection.counts.missing !== 0 || inspection.writes.length !== 0) {
    throw new Error("Bookability storage bloqueado: existen Memberships sin boolean canónico");
  }
  return { ready: true, counts: inspection.counts, index: inspection.index };
};

export const applyMembershipBookabilityMigration = async (db) => {
  const before = await inspectMembershipBookabilityStorage(db);
  if (before.findings.length > 0) {
    throw new Error(`Migración bookability bloqueada: ${before.findings[0]}`);
  }

  for (const write of before.writes) {
    const result = await db.collection("memberships").updateOne(
      { _id: write._id, isBookable: { $exists: false } },
      { $set: { isBookable: write.isBookable } },
    );
    if (result.matchedCount !== 1) {
      throw new Error("Migración bookability bloqueada: el estado cambió durante apply");
    }
  }

  const verified = await assertMembershipBookabilityStorageReady(db);
  return { applied: before.writes.length, ...verified };
};

const usage = () => {
  console.log(`Uso:\n  npm run migration:membership-bookability -- --mode=plan --environment=<development|test|staging|production>\n\nApply requiere además:\n  --expected-target-fingerprint=<sha256> \\\n  [--approved-sha=<git-sha> para staging/production] \\\n  --confirm=${MEMBERSHIP_BOOKABILITY_APPLY_CONFIRMATION}`);
};

export const runMembershipBookabilityMigration = async ({
  mongoUri,
  options,
  processEnvironment = process.env,
}) => {
  const validated = validateMembershipBookabilityOptions({ ...options }, processEnvironment);
  if (!mongoUri) throw new Error("MONGO_URI no está definida");

  await mongoose.connect(mongoUri, { autoIndex: false });
  try {
    const db = mongoose.connection.db;
    const database = db?.databaseName;
    if (!database) throw new Error("No fue posible identificar la base MongoDB conectada");
    const targetFingerprint = fingerprintMongoTarget(mongoUri, database);

    if (validated.expectedTargetFingerprint
      && validated.expectedTargetFingerprint !== targetFingerprint) {
      throw new Error("El fingerprint MongoDB no coincide con el destino aprobado");
    }

    if (validated.mode === "plan") {
      const plan = await planMembershipBookabilityMigration(db);
      return { mode: "plan", database, targetFingerprint, plan };
    }

    const result = await applyMembershipBookabilityMigration(db);
    return { mode: "apply", database, targetFingerprint, result };
  } finally {
    await mongoose.disconnect();
  }
};

export const main = async (argv = process.argv.slice(2)) => {
  const options = parseMembershipBookabilityArgs(argv);
  if (options.help) {
    usage();
    return 0;
  }
  const result = await runMembershipBookabilityMigration({
    mongoUri: process.env.MONGO_URI,
    options,
  });
  console.log(`Membership bookability ${result.mode} completado.`);
  console.log(`Database: ${result.database}`);
  console.log(`Target fingerprint: ${result.targetFingerprint}`);
  if (result.mode === "plan") {
    console.log(`Memberships: ${result.plan.counts.memberships}`);
    console.log(`Sin isBookable: ${result.plan.counts.missing}`);
    console.log(`Backfill true/false: ${result.plan.counts.toTrue}/${result.plan.counts.toFalse}`);
    console.log(`Hallazgos: ${result.plan.findings.length}`);
    return result.plan.canApply ? 0 : 2;
  }
  console.log(`Backfill aplicado: ${result.result.applied}`);
  return 0;
};

const isDirectExecution = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectExecution) {
  main()
    .then((exitCode) => { process.exitCode = exitCode; })
    .catch((error) => {
      console.error(sanitizeAuditErrorMessage(error, process.env.MONGO_URI));
      process.exitCode = 1;
    });
}
