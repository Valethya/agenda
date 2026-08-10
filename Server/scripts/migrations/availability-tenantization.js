import "dotenv/config";

import { randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import mongoose, { mongo } from "mongoose";
import {
  fingerprintMongoTarget,
  resolveEffectiveCodeSha,
  sanitizeAuditErrorMessage,
  validateCodeSha,
  validateTargetFingerprint,
} from "./membership-authority-provenance.js";

export const AVAILABILITY_TENANTIZATION_VERSION = "1.1.1";
export const AVAILABILITY_TENANTIZATION_CONFIRMATION = "TENANTIZE_AVAILABILITY_6_2_3";
export const AVAILABILITY_EXTERNAL_TARGET_CONFIRMATION = "AUTHORIZE_EXTERNAL_AVAILABILITY_TARGET";
export const AVAILABILITY_MAINTENANCE_CONFIRMATION = "MAINTENANCE_WINDOW_CONFIRMED";
export const AVAILABILITY_TENANTIZATION_LOCK_COLLECTION = "availability_tenantization_locks";
export const AVAILABILITY_TENANTIZATION_LOCK_ID = "availability-6-2-3";
export const AVAILABILITY_TENANTIZATION_LOCK_PROTOCOL_VERSION = 1;
export const AVAILABILITY_TENANTIZATION_LOCK_LEASE_MS = 120_000;
export const AVAILABILITY_TENANTIZATION_DDL_MAX_TIME_MS = 30_000;
export const AVAILABILITY_TENANTIZATION_MAX_COMMIT_TIME_MS = 15_000;

const ALLOWED_ENVIRONMENTS = new Set(["development", "test", "staging", "production"]);
const LOCAL_ENVIRONMENTS = new Set(["development", "test"]);
const REMOTE_ENVIRONMENTS = new Set(["staging", "production"]);
const RESERVED_DATABASES = new Set(["admin", "config", "local"]);
const LOCAL_MONGO_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
const DEPLOYMENT_ENVIRONMENT_INDICATORS = Object.freeze([
  "AWS_LAMBDA_FUNCTION_NAME",
  "DYNO",
  "FLY_APP_NAME",
  "K_SERVICE",
  "NETLIFY",
  "RAILWAY_ENVIRONMENT",
  "RAILWAY_ENVIRONMENT_ID",
  "RAILWAY_PROJECT_ID",
  "RENDER",
  "RENDER_SERVICE_ID",
  "VERCEL",
  "VERCEL_ENV",
  "WEBSITE_INSTANCE_ID",
]);

export const ACTIVE_APPOINTMENT_STATUSES = Object.freeze([
  "pending_payment",
  "pending",
  "confirmed",
  "completed",
]);

export const AVAILABILITY_INDEX_SPECS = Object.freeze({
  shiftDesired: {
    key: { business: 1, worker: 1, dayOfWeek: 1 },
    options: { unique: true, name: "shift_business_worker_day_unique" },
  },
  shiftObsolete: { key: { worker: 1, dayOfWeek: 1 } },
  blockDesired: {
    key: { business: 1, worker: 1, date: 1 },
    options: { name: "block_business_worker_date" },
  },
  blockObsolete: { key: { worker: 1, date: 1 } },
  appointmentDesired: {
    key: { business: 1, worker: 1, date: 1, startTime: 1 },
    options: {
      unique: true,
      partialFilterExpression: { status: { $in: [...ACTIVE_APPOINTMENT_STATUSES] } },
      name: "appointment_business_worker_date_start_active_unique",
    },
  },
  appointmentObsolete: { key: { worker: 1, date: 1, startTime: 1 } },
});

const isObjectId = (value) => value instanceof mongo.ObjectId;
const objectIdKey = (value) => (isObjectId(value) ? value.toHexString() : null);
const hasValue = (value) => value !== undefined && value !== null && String(value).trim() !== "";
const keyEquals = (actual, expected) => JSON.stringify(actual ?? {}) === JSON.stringify(expected ?? {});
const partialEquals = (actual, expected) => JSON.stringify(actual ?? null) === JSON.stringify(expected ?? null);
const addMs = (date, milliseconds) => new Date(new Date(date).getTime() + milliseconds);

const parseMongoUriTarget = (mongoUri) => {
  if (typeof mongoUri !== "string") throw new Error("MONGO_URI no es válida");
  const match = mongoUri.match(/^mongodb(?:\+srv)?:\/\/(.+)$/iu);
  if (!match) throw new Error("MONGO_URI no es válida");

  const withoutOptions = match[1].split(/[?#]/u, 1)[0];
  const authorityAndPath = withoutOptions.slice(withoutOptions.lastIndexOf("@") + 1);
  const slashIndex = authorityAndPath.indexOf("/");
  if (slashIndex === -1) {
    throw new Error("MONGO_URI debe codificar explícitamente la base de datos");
  }

  const authority = authorityAndPath.slice(0, slashIndex);
  const encodedDatabase = authorityAndPath.slice(slashIndex + 1);
  const hosts = authority.split(",").map((entry) => entry.trim()).filter(Boolean);
  if (!hosts.length || !encodedDatabase) throw new Error("MONGO_URI no es válida");

  let database;
  try {
    database = decodeURIComponent(encodedDatabase);
  } catch {
    throw new Error("MONGO_URI no es válida");
  }

  const hostnames = hosts.map((entry) => {
    if (entry.startsWith("[")) {
      const close = entry.indexOf("]");
      return close === -1 ? entry.toLowerCase() : entry.slice(0, close + 1).toLowerCase();
    }
    return entry.split(":", 1)[0].toLowerCase();
  });

  return { database, hostnames };
};

export const parseAvailabilityTenantizationArgs = (argv) => {
  const options = {};
  const allowed = new Set([
    "mode",
    "environment",
    "database",
    "expected-target-fingerprint",
    "expected-code-sha",
    "allow-external-target",
    "maintenance-window",
    "confirm",
  ]);
  const optionNames = {
    "expected-target-fingerprint": "expectedTargetFingerprint",
    "expected-code-sha": "expectedCodeSha",
    "allow-external-target": "allowExternalTarget",
    "maintenance-window": "maintenanceWindow",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help") {
      options.help = true;
      continue;
    }
    if (!argument.startsWith("--")) throw new Error(`Argumento no reconocido: ${argument}`);

    const separator = argument.indexOf("=");
    const name = separator === -1 ? argument.slice(2) : argument.slice(2, separator);
    if (!allowed.has(name)) throw new Error(`Opción no reconocida: --${name}`);

    const inlineValue = separator === -1 ? undefined : argument.slice(separator + 1);
    const value = inlineValue ?? argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Falta valor para --${name}`);

    const optionName = optionNames[name] ?? name;
    if (Object.hasOwn(options, optionName)) throw new Error(`Opción duplicada: --${name}`);
    options[optionName] = value;
    if (inlineValue === undefined) index += 1;
  }

  return options;
};

export const validateAvailabilityTenantizationRuntime = ({
  requestedEnvironment,
  database,
  mongoUri,
  processEnvironment = process.env,
  allowExternalTarget,
  maintenanceWindow,
  mode,
  expectedCodeSha,
}) => {
  const effectiveEnvironment = processEnvironment?.NODE_ENV;
  if (!ALLOWED_ENVIRONMENTS.has(effectiveEnvironment)) {
    throw new Error("NODE_ENV debe existir y ser literalmente development, test, staging o production");
  }
  if (requestedEnvironment !== effectiveEnvironment) {
    throw new Error("El entorno solicitado debe coincidir exactamente con NODE_ENV");
  }

  const deploymentIndicator = DEPLOYMENT_ENVIRONMENT_INDICATORS.find((name) =>
    hasValue(processEnvironment?.[name]),
  );
  if (deploymentIndicator) {
    throw new Error(
      "La migración 6.2.3 debe ejecutarse desde un operador aislado, no dentro de una plataforma de despliegue",
    );
  }

  if (
    typeof database !== "string" ||
    !/^[a-zA-Z0-9_-]+$/u.test(database) ||
    RESERVED_DATABASES.has(database)
  ) {
    throw new Error("--database debe identificar una base permitida mediante un nombre literal seguro");
  }

  if (!mongoUri) throw new Error("MONGO_URI es obligatoria");
  const target = parseMongoUriTarget(mongoUri);
  if (target.database !== database) {
    throw new Error("La base indicada no coincide con la base codificada en MONGO_URI");
  }
  const localTarget = target.hostnames.every((hostname) => LOCAL_MONGO_HOSTS.has(hostname));

  if (LOCAL_ENVIRONMENTS.has(effectiveEnvironment)) {
    const requiredSuffix = effectiveEnvironment === "test" ? "_test" : "_dev";
    if (!database.endsWith(requiredSuffix)) {
      throw new Error(`En ${effectiveEnvironment}, --database debe terminar en "${requiredSuffix}"`);
    }
    if (!localTarget) {
      throw new Error(
        "development/test sólo permiten MongoDB local; un destino externo exige staging/production y autorización explícita",
      );
    }
    return { effectiveEnvironment, targetKind: "local", effectiveCodeSha: null };
  }

  if (!REMOTE_ENVIRONMENTS.has(effectiveEnvironment)) throw new Error("Entorno operativo no reconocido");
  if (localTarget) {
    throw new Error("staging/production requieren un destino externo explícitamente autorizado");
  }
  if (allowExternalTarget !== AVAILABILITY_EXTERNAL_TARGET_CONFIRMATION) {
    throw new Error(
      `El destino externo exige --allow-external-target=${AVAILABILITY_EXTERNAL_TARGET_CONFIRMATION}`,
    );
  }
  if (mode === "apply" && maintenanceWindow !== AVAILABILITY_MAINTENANCE_CONFIRMATION) {
    throw new Error(
      `Apply externo exige --maintenance-window=${AVAILABILITY_MAINTENANCE_CONFIRMATION}`,
    );
  }

  const expected = validateCodeSha(expectedCodeSha);
  const { codeSha } = resolveEffectiveCodeSha({
    railwayGitCommitSha: processEnvironment?.RAILWAY_GIT_COMMIT_SHA ?? null,
    githubSha: processEnvironment?.GITHUB_SHA ?? null,
    explicitCodeSha: processEnvironment?.AVAILABILITY_TENANTIZATION_CODE_SHA ?? null,
  });
  if (!codeSha) {
    throw new Error(
      "El destino externo exige provenance del SHA efectivo mediante AVAILABILITY_TENANTIZATION_CODE_SHA o proveedor soportado",
    );
  }
  if (codeSha !== expected) {
    throw new Error("El SHA efectivo del código no coincide con --expected-code-sha");
  }

  return { effectiveEnvironment, targetKind: "external", effectiveCodeSha: codeSha };
};

export const validateAvailabilityTenantizationOptions = (
  options,
  mongoUri,
  processEnvironment = process.env,
) => {
  if (!options.mode || !["plan", "apply"].includes(options.mode)) {
    throw new Error('--mode es obligatorio y sólo acepta "plan" o "apply"');
  }

  options.expectedTargetFingerprint = validateTargetFingerprint(options.expectedTargetFingerprint);
  const runtime = validateAvailabilityTenantizationRuntime({
    requestedEnvironment: options.environment,
    database: options.database,
    mongoUri,
    processEnvironment,
    allowExternalTarget: options.allowExternalTarget,
    maintenanceWindow: options.maintenanceWindow,
    mode: options.mode,
    expectedCodeSha: options.expectedCodeSha,
  });

  if (options.mode === "apply" && options.confirm !== AVAILABILITY_TENANTIZATION_CONFIRMATION) {
    throw new Error(`El modo apply exige --confirm=${AVAILABILITY_TENANTIZATION_CONFIRMATION}`);
  }

  return { ...options, ...runtime };
};

const membershipsByWorker = (memberships) => {
  const result = new Map();
  for (const membership of memberships) {
    if (
      membership?.role !== "worker" ||
      membership?.isActive !== true ||
      !isObjectId(membership.user) ||
      !isObjectId(membership.business)
    ) continue;

    const worker = objectIdKey(membership.user);
    if (!result.has(worker)) result.set(worker, new Map());
    result.get(worker).set(objectIdKey(membership.business), membership.business);
  }
  return result;
};

export const classifyAvailabilityDocuments = (documents, memberships) => {
  const byWorker = membershipsByWorker(memberships);
  const result = {
    alreadyMigrated: [],
    deterministic: [],
    ambiguous: [],
    unresolved: [],
    invalidExisting: [],
  };

  for (const document of documents) {
    if (!isObjectId(document?._id) || !isObjectId(document?.worker)) {
      result.unresolved.push(document);
      continue;
    }

    const workerKey = objectIdKey(document.worker);
    const businesses = [...(byWorker.get(workerKey)?.values() ?? [])];
    const existingBusiness = document.business;

    if (existingBusiness !== undefined && existingBusiness !== null) {
      if (!isObjectId(existingBusiness) || !byWorker.get(workerKey)?.has(objectIdKey(existingBusiness))) {
        result.invalidExisting.push(document);
      } else {
        result.alreadyMigrated.push(document);
      }
      continue;
    }

    if (businesses.length === 1) {
      result.deterministic.push({ document, inferredBusiness: businesses[0] });
    } else if (businesses.length > 1) {
      result.ambiguous.push(document);
    } else {
      result.unresolved.push(document);
    }
  }

  return result;
};

const resolvedDocuments = (classification) => [
  ...classification.alreadyMigrated.map((document) => ({ document, business: document.business })),
  ...classification.deterministic.map(({ document, inferredBusiness }) => ({
    document,
    business: inferredBusiness,
  })),
];

const duplicateShiftKeys = (classification) => {
  const counts = new Map();
  for (const { document, business } of resolvedDocuments(classification)) {
    if (!Number.isInteger(document.dayOfWeek)) continue;
    const identity = `${objectIdKey(business)}:${objectIdKey(document.worker)}:${document.dayOfWeek}`;
    counts.set(identity, (counts.get(identity) ?? 0) + 1);
  }
  return [...counts.values()].filter((count) => count > 1).length;
};

const activeAppointmentConflicts = (appointments) => {
  const counts = new Map();
  let invalid = 0;

  for (const appointment of appointments) {
    if (!ACTIVE_APPOINTMENT_STATUSES.includes(appointment?.status)) continue;
    if (
      !isObjectId(appointment.business) ||
      !isObjectId(appointment.worker) ||
      !(appointment.date instanceof Date) ||
      Number.isNaN(appointment.date.getTime()) ||
      typeof appointment.startTime !== "string"
    ) {
      invalid += 1;
      continue;
    }

    const identity = [
      objectIdKey(appointment.business),
      objectIdKey(appointment.worker),
      appointment.date.toISOString(),
      appointment.startTime,
    ].join(":");
    counts.set(identity, (counts.get(identity) ?? 0) + 1);
  }

  return {
    invalid,
    duplicateKeys: [...counts.values()].filter((count) => count > 1).length,
  };
};

const exactDesiredIndex = (index, spec) =>
  keyEquals(index?.key, spec.key) &&
  Boolean(index?.unique) === Boolean(spec.options.unique) &&
  partialEquals(index?.partialFilterExpression, spec.options.partialFilterExpression);

const desiredIndexState = (indexes, spec) => {
  const exact = indexes.find((index) => exactDesiredIndex(index, spec));
  const conflicts = indexes
    .filter((index) => {
      const sameKey = keyEquals(index.key, spec.key);
      const sameName = index.name === spec.options.name;
      return (sameKey || sameName) && index !== exact;
    })
    .map((index) => index.name);

  return { present: Boolean(exact), conflicts: [...new Set(conflicts)] };
};

const obsoleteIndexNames = (indexes, spec) => indexes
  .filter((index) => index.name !== "_id_" && keyEquals(index.key, spec.key))
  .map((index) => index.name);

export const buildAvailabilityTenantizationPlan = ({
  shifts = [],
  blocks = [],
  memberships = [],
  appointments = [],
  shiftIndexes = [],
  blockIndexes = [],
  appointmentIndexes = [],
}) => {
  const shiftClassification = classifyAvailabilityDocuments(shifts, memberships);
  const blockClassification = classifyAvailabilityDocuments(blocks, memberships);
  const appointmentConflicts = activeAppointmentConflicts(appointments);
  const shiftDuplicateKeys = duplicateShiftKeys(shiftClassification);

  const indexes = {
    shift: {
      desired: desiredIndexState(shiftIndexes, AVAILABILITY_INDEX_SPECS.shiftDesired),
      obsolete: obsoleteIndexNames(shiftIndexes, AVAILABILITY_INDEX_SPECS.shiftObsolete),
    },
    block: {
      desired: desiredIndexState(blockIndexes, AVAILABILITY_INDEX_SPECS.blockDesired),
      obsolete: obsoleteIndexNames(blockIndexes, AVAILABILITY_INDEX_SPECS.blockObsolete),
    },
    appointment: {
      desired: desiredIndexState(appointmentIndexes, AVAILABILITY_INDEX_SPECS.appointmentDesired),
      obsolete: obsoleteIndexNames(appointmentIndexes, AVAILABILITY_INDEX_SPECS.appointmentObsolete),
    },
  };

  const findings = [];
  const addClassificationFindings = (name, classification) => {
    if (classification.ambiguous.length) findings.push(`${name}:ambiguous:${classification.ambiguous.length}`);
    if (classification.unresolved.length) findings.push(`${name}:unresolved:${classification.unresolved.length}`);
    if (classification.invalidExisting.length) findings.push(`${name}:invalidExisting:${classification.invalidExisting.length}`);
  };

  addClassificationFindings("shift", shiftClassification);
  addClassificationFindings("block", blockClassification);
  if (shiftDuplicateKeys) findings.push(`shift:targetDuplicateKeys:${shiftDuplicateKeys}`);
  if (appointmentConflicts.invalid) findings.push(`appointment:invalidActive:${appointmentConflicts.invalid}`);
  if (appointmentConflicts.duplicateKeys) {
    findings.push(`appointment:targetDuplicateKeys:${appointmentConflicts.duplicateKeys}`);
  }
  for (const [name, state] of Object.entries(indexes)) {
    if (state.desired.conflicts.length) findings.push(`${name}:conflictingDesiredIndex`);
  }

  return {
    version: AVAILABILITY_TENANTIZATION_VERSION,
    safeToApply: findings.length === 0,
    findings,
    counts: {
      shifts: {
        total: shifts.length,
        alreadyMigrated: shiftClassification.alreadyMigrated.length,
        deterministic: shiftClassification.deterministic.length,
        ambiguous: shiftClassification.ambiguous.length,
        unresolved: shiftClassification.unresolved.length,
        invalidExisting: shiftClassification.invalidExisting.length,
      },
      blocks: {
        total: blocks.length,
        alreadyMigrated: blockClassification.alreadyMigrated.length,
        deterministic: blockClassification.deterministic.length,
        ambiguous: blockClassification.ambiguous.length,
        unresolved: blockClassification.unresolved.length,
        invalidExisting: blockClassification.invalidExisting.length,
      },
      appointments: {
        total: appointments.length,
        invalidActive: appointmentConflicts.invalid,
        duplicateActiveKeys: appointmentConflicts.duplicateKeys,
      },
    },
    indexes,
    internal: { shiftClassification, blockClassification },
  };
};

const collectionNames = async (db) => new Set(
  (await db.listCollections({}, { nameOnly: true }).toArray()).map((item) => item.name),
);

const readCollection = async (db, names, name, projection) => {
  if (!names.has(name)) return [];
  return db.collection(name).find({}, { projection }).toArray();
};

const readIndexes = async (db, names, name) => {
  if (!names.has(name)) return [];
  return db.collection(name).listIndexes().toArray();
};

export const readAvailabilityTenantizationSnapshot = async (db) => {
  const names = await collectionNames(db);
  const [
    shifts,
    blocks,
    memberships,
    appointments,
    shiftIndexes,
    blockIndexes,
    appointmentIndexes,
  ] = await Promise.all([
    readCollection(db, names, "shifts", { _id: 1, business: 1, worker: 1, dayOfWeek: 1 }),
    readCollection(db, names, "blocks", { _id: 1, business: 1, worker: 1, date: 1 }),
    readCollection(db, names, "memberships", { _id: 1, user: 1, business: 1, role: 1, isActive: 1 }),
    readCollection(
      db,
      names,
      "appointments",
      { _id: 1, business: 1, worker: 1, date: 1, startTime: 1, status: 1 },
    ),
    readIndexes(db, names, "shifts"),
    readIndexes(db, names, "blocks"),
    readIndexes(db, names, "appointments"),
  ]);

  return {
    shifts,
    blocks,
    memberships,
    appointments,
    shiftIndexes,
    blockIndexes,
    appointmentIndexes,
  };
};

const publicPlan = (plan) => ({
  version: plan.version,
  safeToApply: plan.safeToApply,
  findings: plan.findings,
  counts: plan.counts,
  indexes: plan.indexes,
});

export class AvailabilityTenantizationLockActiveError extends Error {
  constructor() {
    super("Migración bloqueada: existe otra ejecución Apply activa");
    this.name = "AvailabilityTenantizationLockActiveError";
  }
}

export class AvailabilityTenantizationLockLostError extends Error {
  constructor() {
    super("Migración bloqueada: se perdió la propiedad exclusiva del lock");
    this.name = "AvailabilityTenantizationLockLostError";
  }
}

export class AvailabilityTenantizationTransactionRequiredError extends Error {
  constructor() {
    super("Migración bloqueada: Apply requiere un MongoDB que admita transacciones");
    this.name = "AvailabilityTenantizationTransactionRequiredError";
  }
}

export const assertAvailabilityTenantizationTransactionSupport = async (db) => {
  let hello;
  try {
    hello = await db.admin().command({ hello: 1 });
  } catch {
    throw new AvailabilityTenantizationTransactionRequiredError();
  }
  if (!hello?.setName) throw new AvailabilityTenantizationTransactionRequiredError();
  return true;
};

export const ensureAvailabilityTenantizationLockCollection = async (db) => {
  const exists = await db
    .listCollections({ name: AVAILABILITY_TENANTIZATION_LOCK_COLLECTION }, { nameOnly: true })
    .hasNext();
  if (exists) return false;

  try {
    await db.createCollection(AVAILABILITY_TENANTIZATION_LOCK_COLLECTION);
    return true;
  } catch (error) {
    if (error?.code === 48 || error?.codeName === "NamespaceExists") return false;
    throw new Error("No fue posible preparar el lock de migración");
  }
};

export const acquireAvailabilityTenantizationLock = async (
  db,
  { ownerId, now = new Date(), leaseMs = AVAILABILITY_TENANTIZATION_LOCK_LEASE_MS },
) => {
  const acquiredAt = new Date(now);
  const leaseUntil = addMs(acquiredAt, leaseMs);
  const collection = db.collection(AVAILABILITY_TENANTIZATION_LOCK_COLLECTION);

  try {
    await collection.insertOne({
      _id: AVAILABILITY_TENANTIZATION_LOCK_ID,
      ownerId,
      fencingToken: 1,
      leaseUntil,
      protocolVersion: AVAILABILITY_TENANTIZATION_LOCK_PROTOCOL_VERSION,
      fencingMechanism: "lease-token",
      createdAt: acquiredAt,
      updatedAt: acquiredAt,
    });
  } catch (error) {
    if (error?.code !== 11000) throw new Error("No fue posible adquirir el lock de migración");

    const takeover = await collection.updateOne(
      {
        _id: AVAILABILITY_TENANTIZATION_LOCK_ID,
        leaseUntil: { $lte: acquiredAt },
        protocolVersion: AVAILABILITY_TENANTIZATION_LOCK_PROTOCOL_VERSION,
      },
      {
        $set: {
          ownerId,
          leaseUntil,
          fencingMechanism: "lease-token",
          updatedAt: acquiredAt,
        },
        $inc: { fencingToken: 1 },
      },
    );
    if (takeover.modifiedCount !== 1) throw new AvailabilityTenantizationLockActiveError();
  }

  const lock = await collection.findOne({
    _id: AVAILABILITY_TENANTIZATION_LOCK_ID,
    ownerId,
  });
  if (!lock || !Number.isInteger(lock.fencingToken)) {
    throw new AvailabilityTenantizationLockActiveError();
  }

  return { ownerId, fencingToken: lock.fencingToken, leaseUntil: lock.leaseUntil };
};

export const renewAvailabilityTenantizationLock = async (
  db,
  lock,
  { now = new Date(), leaseMs = AVAILABILITY_TENANTIZATION_LOCK_LEASE_MS } = {},
) => {
  const currentTime = new Date(now);
  const result = await db.collection(AVAILABILITY_TENANTIZATION_LOCK_COLLECTION).updateOne(
    {
      _id: AVAILABILITY_TENANTIZATION_LOCK_ID,
      ownerId: lock.ownerId,
      fencingToken: lock.fencingToken,
      protocolVersion: AVAILABILITY_TENANTIZATION_LOCK_PROTOCOL_VERSION,
      leaseUntil: { $gt: currentTime },
    },
    { $set: { leaseUntil: addMs(currentTime, leaseMs), updatedAt: currentTime } },
  );

  if (result.matchedCount !== 1) throw new AvailabilityTenantizationLockLostError();
  return true;
};

export const assertAvailabilityTenantizationLockOwnership = async (
  db,
  lock,
  { now = new Date() } = {},
) => {
  const current = await db.collection(AVAILABILITY_TENANTIZATION_LOCK_COLLECTION).findOne({
    _id: AVAILABILITY_TENANTIZATION_LOCK_ID,
    ownerId: lock.ownerId,
    fencingToken: lock.fencingToken,
    protocolVersion: AVAILABILITY_TENANTIZATION_LOCK_PROTOCOL_VERSION,
    leaseUntil: { $gt: new Date(now) },
  });
  if (!current) throw new AvailabilityTenantizationLockLostError();
  return true;
};

export const releaseAvailabilityTenantizationLock = async (db, lock) => {
  const result = await db.collection(AVAILABILITY_TENANTIZATION_LOCK_COLLECTION).deleteOne({
    _id: AVAILABILITY_TENANTIZATION_LOCK_ID,
    ownerId: lock.ownerId,
    fencingToken: lock.fencingToken,
    protocolVersion: AVAILABILITY_TENANTIZATION_LOCK_PROTOCOL_VERSION,
  });
  return result.deletedCount === 1;
};

const uniqueActiveWorkerBusinesses = (memberships) => {
  const unique = new Map();
  for (const membership of memberships) {
    if (
      membership?.role === "worker" &&
      membership?.isActive === true &&
      isObjectId(membership.business)
    ) {
      unique.set(objectIdKey(membership.business), membership.business);
    }
  }
  return [...unique.values()];
};

const revalidateAssignmentMembership = async (db, assignment, session) => {
  const memberships = await db.collection("memberships").find(
    { user: assignment.document.worker, role: "worker", isActive: true },
    { session, projection: { business: 1 } },
  ).toArray();

  const businesses = uniqueActiveWorkerBusinesses(memberships);
  if (
    businesses.length !== 1 ||
    objectIdKey(businesses[0]) !== objectIdKey(assignment.inferredBusiness)
  ) {
    throw new Error(
      "Backfill abortado: Membership cambió desde el plan y la inferencia ya no es determinística",
    );
  }
};

const applyBackfill = async (
  db,
  plan,
  session,
  mutationCheckpoint = async () => {},
) => {
  const writeAssignments = async (collectionName, assignments) => {
    for (const assignment of assignments) {
      await revalidateAssignmentMembership(db, assignment, session);
      await mutationCheckpoint(`before-backfill:${collectionName}`, {
        db,
        session,
        assignment,
      });

      const result = await db.collection(collectionName).updateOne(
        {
          _id: assignment.document._id,
          worker: assignment.document.worker,
          $or: [{ business: { $exists: false } }, { business: null }],
        },
        { $set: { business: assignment.inferredBusiness } },
        { session },
      );
      if (result.modifiedCount !== 1) {
        throw new Error(
          `Backfill concurrente detectado en ${collectionName}; se aborta la transacción`,
        );
      }
    }
  };

  await writeAssignments("shifts", plan.internal.shiftClassification.deterministic);
  await writeAssignments("blocks", plan.internal.blockClassification.deterministic);
};

const ensureDesiredIndex = async (db, collectionName, spec) => {
  const indexes = await db.collection(collectionName).listIndexes().toArray().catch((error) => {
    if (error?.codeName === "NamespaceNotFound") return [];
    throw error;
  });
  const state = desiredIndexState(indexes, spec);
  if (state.conflicts.length) {
    throw new Error(`Índice destino conflictivo en ${collectionName}; no se modificará automáticamente`);
  }
  if (!state.present) {
    await db.collection(collectionName).createIndex(spec.key, {
      ...spec.options,
      maxTimeMS: AVAILABILITY_TENANTIZATION_DDL_MAX_TIME_MS,
    });
  }
};

const dropObsoleteIndexes = async (db, collectionName, spec) => {
  const indexes = await db.collection(collectionName).listIndexes().toArray();
  const names = obsoleteIndexNames(indexes, spec);
  for (const name of names) {
    await db.collection(collectionName).dropIndex(name, {
      maxTimeMS: AVAILABILITY_TENANTIZATION_DDL_MAX_TIME_MS,
    });
  }
};

const assertFinalIndexState = (plan) => {
  for (const [name, state] of Object.entries(plan.indexes)) {
    if (!state.desired.present) {
      throw new Error(`Índice tenant faltante después de Apply: ${name}`);
    }
    if (state.desired.conflicts.length) {
      throw new Error(`Índice tenant conflictivo después de Apply: ${name}`);
    }
    if (state.obsolete.length) {
      throw new Error(`Índice global obsoleto permanece después de Apply: ${name}`);
    }
  }
};

export const assertAvailabilityPreDropCheckpoint = (plan) => {
  if (!plan.safeToApply) {
    throw new Error("Checkpoint pre-drop rechazado: el estado dejó de ser seguro");
  }
  if (plan.counts.shifts.deterministic !== 0 || plan.counts.blocks.deterministic !== 0) {
    throw new Error("Checkpoint pre-drop rechazado: aparecieron documentos legacy pendientes");
  }
  for (const [name, state] of Object.entries(plan.indexes)) {
    if (!state.desired.present || state.desired.conflicts.length) {
      throw new Error(`Checkpoint pre-drop rechazado: índice tenant inválido en ${name}`);
    }
  }
  return true;
};

const runBackfillTransaction = async (connection, callback) => {
  const session = await connection.startSession();
  try {
    session.startTransaction({
      readConcern: { level: "snapshot" },
      writeConcern: { w: "majority" },
      readPreference: "primary",
      maxCommitTimeMS: AVAILABILITY_TENANTIZATION_MAX_COMMIT_TIME_MS,
    });
    const result = await callback(session);
    await session.commitTransaction();
    return result;
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction().catch(() => {});
    throw error;
  } finally {
    await session.endSession();
  }
};

export const runAvailabilityTenantization = async ({
  mongoUri,
  options,
  processEnvironment = process.env,
  connect = mongoose.connect.bind(mongoose),
  disconnect = mongoose.disconnect.bind(mongoose),
  connection = mongoose.connection,
  ownerIdFactory = randomUUID,
  ensureLockCollection = ensureAvailabilityTenantizationLockCollection,
  acquireLock = acquireAvailabilityTenantizationLock,
  renewLock = renewAvailabilityTenantizationLock,
  assertLockOwner = assertAvailabilityTenantizationLockOwnership,
  releaseLock = releaseAvailabilityTenantizationLock,
  assertTransactionSupport = assertAvailabilityTenantizationTransactionSupport,
  ensureIndex = ensureDesiredIndex,
  dropIndexes = dropObsoleteIndexes,
  stageCheckpoint = async () => {},
  mutationCheckpoint = async () => {},
}) => {
  const validatedOptions = validateAvailabilityTenantizationOptions(
    { ...options },
    mongoUri,
    processEnvironment,
  );
  const targetFingerprint = fingerprintMongoTarget(mongoUri, validatedOptions.database);
  if (targetFingerprint !== validatedOptions.expectedTargetFingerprint) {
    throw new Error("El fingerprint del destino MongoDB no coincide con el confirmado");
  }

  let connected = false;
  let lock = null;

  try {
    await connect(mongoUri, { autoIndex: false });
    connected = true;
    if (connection.db?.databaseName !== validatedOptions.database) {
      throw new Error("La conexión MongoDB no apunta a la base confirmada");
    }

    const initialPlan = buildAvailabilityTenantizationPlan(
      await readAvailabilityTenantizationSnapshot(connection.db),
    );
    if (validatedOptions.mode === "plan") {
      return {
        mode: "plan",
        targetFingerprint,
        targetKind: validatedOptions.targetKind,
        effectiveCodeSha: validatedOptions.effectiveCodeSha,
        plan: publicPlan(initialPlan),
        exitCode: initialPlan.safeToApply ? 0 : 2,
      };
    }
    if (!initialPlan.safeToApply) {
      throw new Error("Apply rechazado: el plan contiene ambigüedades o conflictos bloqueantes");
    }

    await assertTransactionSupport(connection.db);
    await ensureLockCollection(connection.db);
    lock = await acquireLock(connection.db, { ownerId: ownerIdFactory() });

    const checkpointLock = async () => {
      await assertLockOwner(connection.db, lock);
      await renewLock(connection.db, lock);
      await assertLockOwner(connection.db, lock);
    };

    await stageCheckpoint("after-lock-acquired", { db: connection.db, lock });
    await checkpointLock();

    const lockedPlan = buildAvailabilityTenantizationPlan(
      await readAvailabilityTenantizationSnapshot(connection.db),
    );
    if (!lockedPlan.safeToApply) {
      throw new Error("Apply rechazado: el estado cambió antes del backfill");
    }

    await stageCheckpoint("before-backfill-transaction", { db: connection.db, lock });
    await checkpointLock();
    await runBackfillTransaction(connection, async (session) => {
      // No se ejecuta DDL metadata (`listCollections`/`listIndexes`) dentro de la
      // transacción. Las asignaciones provienen del plan obtenido bajo el lock y
      // cada Membership se vuelve a consultar dentro del snapshot transaccional.
      await applyBackfill(connection.db, lockedPlan, session, mutationCheckpoint);
    });
    await checkpointLock();

    await stageCheckpoint("after-backfill", { db: connection.db, lock });
    const postBackfillPlan = buildAvailabilityTenantizationPlan(
      await readAvailabilityTenantizationSnapshot(connection.db),
    );
    if (
      !postBackfillPlan.safeToApply ||
      postBackfillPlan.counts.shifts.deterministic !== 0 ||
      postBackfillPlan.counts.blocks.deterministic !== 0
    ) {
      throw new Error("Verificación posterior al backfill falló; no se tocarán índices obsoletos");
    }

    for (const [collectionName, spec] of [
      ["shifts", AVAILABILITY_INDEX_SPECS.shiftDesired],
      ["blocks", AVAILABILITY_INDEX_SPECS.blockDesired],
      ["appointments", AVAILABILITY_INDEX_SPECS.appointmentDesired],
    ]) {
      await checkpointLock();
      await stageCheckpoint(`before-create-index:${collectionName}`, {
        db: connection.db,
        lock,
      });
      await checkpointLock();
      await ensureIndex(connection.db, collectionName, spec);
      await checkpointLock();
    }

    await stageCheckpoint("after-create-indexes", { db: connection.db, lock });
    await checkpointLock();
    const preDropPlan = buildAvailabilityTenantizationPlan(
      await readAvailabilityTenantizationSnapshot(connection.db),
    );
    assertAvailabilityPreDropCheckpoint(preDropPlan);

    await stageCheckpoint("before-drop-indexes", { db: connection.db, lock });
    await checkpointLock();
    const finalPreDropPlan = buildAvailabilityTenantizationPlan(
      await readAvailabilityTenantizationSnapshot(connection.db),
    );
    assertAvailabilityPreDropCheckpoint(finalPreDropPlan);

    for (const [collectionName, spec] of [
      ["shifts", AVAILABILITY_INDEX_SPECS.shiftObsolete],
      ["blocks", AVAILABILITY_INDEX_SPECS.blockObsolete],
      ["appointments", AVAILABILITY_INDEX_SPECS.appointmentObsolete],
    ]) {
      await checkpointLock();
      await dropIndexes(connection.db, collectionName, spec);
      await checkpointLock();
    }

    await stageCheckpoint("after-drop-indexes", { db: connection.db, lock });
    await checkpointLock();
    const finalPlan = buildAvailabilityTenantizationPlan(
      await readAvailabilityTenantizationSnapshot(connection.db),
    );
    assertFinalIndexState(finalPlan);
    if (!finalPlan.safeToApply) throw new Error("Auditoría final 6.2.3 no quedó segura");

    const released = await releaseLock(connection.db, lock);
    if (!released) throw new AvailabilityTenantizationLockLostError();
    lock = null;

    return {
      mode: "apply",
      targetFingerprint,
      targetKind: validatedOptions.targetKind,
      effectiveCodeSha: validatedOptions.effectiveCodeSha,
      initialPlan: publicPlan(initialPlan),
      finalPlan: publicPlan(finalPlan),
      exitCode: 0,
    };
  } finally {
    if (lock && connected) {
      await releaseLock(connection.db, lock).catch(() => false);
    }
    if (connected) await disconnect();
  }
};

const usage = () => {
  console.log(`Uso local:
  npm run migration:availability-tenantization -- \\
    --mode=plan|apply \\
    --environment=development|test \\
    --database=<nombre_dev_o_test> \\
    --expected-target-fingerprint=<sha256> \\
    [--confirm=${AVAILABILITY_TENANTIZATION_CONFIRMATION}]

Uso externo autorizado (no automático):
  NODE_ENV=staging|production AVAILABILITY_TENANTIZATION_CODE_SHA=<sha> \\
  npm run migration:availability-tenantization -- \\
    --mode=plan|apply \\
    --environment=staging|production \\
    --database=<nombre-exacto> \\
    --expected-target-fingerprint=<sha256> \\
    --expected-code-sha=<sha> \\
    --allow-external-target=${AVAILABILITY_EXTERNAL_TARGET_CONFIRMATION} \\
    [--maintenance-window=${AVAILABILITY_MAINTENANCE_CONFIRMATION}] \\
    [--confirm=${AVAILABILITY_TENANTIZATION_CONFIRMATION}]

Los destinos externos permanecen deny-by-default y deben operarse desde un proceso aislado, nunca desde el startup ni desde la plataforma de despliegue.`);
};

export const main = async (argv = process.argv.slice(2)) => {
  const options = parseAvailabilityTenantizationArgs(argv);
  if (options.help) {
    usage();
    return 0;
  }

  const result = await runAvailabilityTenantization({
    mongoUri: process.env.MONGO_URI,
    options,
  });

  console.log(`Migración 6.2.3 (${AVAILABILITY_TENANTIZATION_VERSION}) modo ${result.mode}.`);
  console.log(`Fingerprint confirmado: ${result.targetFingerprint}`);
  console.log(`Tipo de destino: ${result.targetKind}`);
  const report = result.mode === "plan" ? result.plan : result.finalPlan;
  console.log(`safeToApply: ${report.safeToApply}`);
  console.log(`Shift: ${JSON.stringify(report.counts.shifts)}`);
  console.log(`Block: ${JSON.stringify(report.counts.blocks)}`);
  console.log(`Appointment: ${JSON.stringify(report.counts.appointments)}`);
  if (report.findings.length) console.log(`Bloqueos: ${report.findings.join(", ")}`);
  return result.exitCode;
};

const isDirectExecution =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectExecution) {
  main()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      console.error(
        `Migración 6.2.3 rechazada: ${sanitizeAuditErrorMessage(error, process.env.MONGO_URI)}`,
      );
      process.exitCode = 1;
    });
}
