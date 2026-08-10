import "dotenv/config";

import path from "node:path";
import { pathToFileURL } from "node:url";
import mongoose, { mongo } from "mongoose";
import {
  fingerprintMongoTarget,
  validateTargetFingerprint,
} from "./membership-authority-provenance.js";

export const AVAILABILITY_TENANTIZATION_VERSION = "1.0.0";
export const AVAILABILITY_TENANTIZATION_CONFIRMATION = "TENANTIZE_AVAILABILITY_6_2_3";

const ALLOWED_ENVIRONMENTS = new Set(["development", "test"]);
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
const keyEquals = (actual, expected) => JSON.stringify(actual ?? {}) === JSON.stringify(expected);
const partialEquals = (actual, expected) => JSON.stringify(actual ?? null) === JSON.stringify(expected ?? null);

export const parseAvailabilityTenantizationArgs = (argv) => {
  const options = {};
  const allowed = new Set([
    "mode",
    "environment",
    "database",
    "expected-target-fingerprint",
    "confirm",
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help") {
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

    const optionName = key === "expected-target-fingerprint" ? "expectedTargetFingerprint" : key;
    if (Object.hasOwn(options, optionName)) throw new Error(`Opción duplicada: --${key}`);
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
}) => {
  const effectiveEnvironment = processEnvironment?.NODE_ENV;
  if (!ALLOWED_ENVIRONMENTS.has(effectiveEnvironment)) {
    throw new Error("NODE_ENV debe existir y ser literalmente development o test");
  }
  if (requestedEnvironment !== effectiveEnvironment) {
    throw new Error("El entorno solicitado debe coincidir exactamente con NODE_ENV");
  }

  const deploymentIndicator = DEPLOYMENT_ENVIRONMENT_INDICATORS.find((name) =>
    hasValue(processEnvironment?.[name]),
  );
  if (deploymentIndicator) {
    throw new Error("La migración 6.2.3 local no puede ejecutarse dentro de una plataforma de despliegue");
  }

  if (
    typeof database !== "string" ||
    !/^[a-zA-Z0-9_-]+$/u.test(database) ||
    RESERVED_DATABASES.has(database)
  ) {
    throw new Error("--database debe identificar una base local permitida");
  }

  const requiredSuffix = effectiveEnvironment === "test" ? "_test" : "_dev";
  if (!database.endsWith(requiredSuffix)) {
    throw new Error(`En ${effectiveEnvironment}, --database debe terminar en "${requiredSuffix}"`);
  }

  if (!mongoUri) throw new Error("MONGO_URI es obligatoria");
  let parsed;
  try {
    parsed = new URL(mongoUri);
  } catch {
    throw new Error("MONGO_URI no es válida");
  }
  if (!LOCAL_MONGO_HOSTS.has(parsed.hostname)) {
    throw new Error("6.2.3 sólo permite MongoDB local; destinos externos están rechazados");
  }

  const uriDatabase = parsed.pathname.replace(/^\//u, "");
  if (uriDatabase !== database) {
    throw new Error("La base indicada no coincide con la base codificada en MONGO_URI");
  }

  return { effectiveEnvironment };
};

export const validateAvailabilityTenantizationOptions = (
  options,
  mongoUri,
  processEnvironment = process.env,
) => {
  if (!options.mode || !["plan", "apply"].includes(options.mode)) {
    throw new Error('--mode es obligatorio y sólo acepta "plan" o "apply"');
  }

  validateAvailabilityTenantizationRuntime({
    requestedEnvironment: options.environment,
    database: options.database,
    mongoUri,
    processEnvironment,
  });

  options.expectedTargetFingerprint = validateTargetFingerprint(options.expectedTargetFingerprint);
  if (
    options.mode === "apply" &&
    options.confirm !== AVAILABILITY_TENANTIZATION_CONFIRMATION
  ) {
    throw new Error(
      `El modo apply exige --confirm=${AVAILABILITY_TENANTIZATION_CONFIRMATION}`,
    );
  }
  return options;
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
      if (!isObjectId(existingBusiness)) {
        result.invalidExisting.push(document);
        continue;
      }
      if (!byWorker.get(workerKey)?.has(objectIdKey(existingBusiness))) {
        result.invalidExisting.push(document);
        continue;
      }
      result.alreadyMigrated.push(document);
      continue;
    }

    if (businesses.length === 1) {
      result.deterministic.push({
        document,
        inferredBusiness: businesses[0],
      });
    } else if (businesses.length > 1) {
      result.ambiguous.push(document);
    } else {
      result.unresolved.push(document);
    }
  }

  return result;
};

const resolvedDocuments = (classification) => [
  ...classification.alreadyMigrated.map((document) => ({
    document,
    business: document.business,
  })),
  ...classification.deterministic.map(({ document, inferredBusiness }) => ({
    document,
    business: inferredBusiness,
  })),
];

const duplicateShiftKeys = (classification) => {
  const counts = new Map();
  for (const { document, business } of resolvedDocuments(classification)) {
    if (!Number.isInteger(document.dayOfWeek)) continue;
    const key = `${objectIdKey(business)}:${objectIdKey(document.worker)}:${document.dayOfWeek}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
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
    const key = [
      objectIdKey(appointment.business),
      objectIdKey(appointment.worker),
      appointment.date.toISOString(),
      appointment.startTime,
    ].join(":");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return {
    invalid,
    duplicateKeys: [...counts.values()].filter((count) => count > 1).length,
  };
};

const desiredIndexState = (indexes, spec) => {
  const sameKey = indexes.filter((index) => keyEquals(index.key, spec.key));
  const exact = sameKey.find((index) => {
    if (Boolean(index.unique) !== Boolean(spec.options.unique)) return false;
    if (!partialEquals(index.partialFilterExpression, spec.options.partialFilterExpression)) return false;
    return true;
  });
  return {
    present: Boolean(exact),
    conflicts: sameKey.filter((index) => index !== exact).map((index) => index.name),
  };
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
  if (appointmentConflicts.duplicateKeys) findings.push(`appointment:targetDuplicateKeys:${appointmentConflicts.duplicateKeys}`);
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
    internal: {
      shiftClassification,
      blockClassification,
    },
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
  const [shifts, blocks, memberships, appointments, shiftIndexes, blockIndexes, appointmentIndexes] = await Promise.all([
    readCollection(db, names, "shifts", { _id: 1, business: 1, worker: 1, dayOfWeek: 1 }),
    readCollection(db, names, "blocks", { _id: 1, business: 1, worker: 1, date: 1 }),
    readCollection(db, names, "memberships", { _id: 1, user: 1, business: 1, role: 1, isActive: 1 }),
    readCollection(db, names, "appointments", { _id: 1, business: 1, worker: 1, date: 1, startTime: 1, status: 1 }),
    readIndexes(db, names, "shifts"),
    readIndexes(db, names, "blocks"),
    readIndexes(db, names, "appointments"),
  ]);
  return { shifts, blocks, memberships, appointments, shiftIndexes, blockIndexes, appointmentIndexes };
};

const publicPlan = (plan) => ({
  version: plan.version,
  safeToApply: plan.safeToApply,
  findings: plan.findings,
  counts: plan.counts,
  indexes: plan.indexes,
});

const applyBackfill = async (db, plan, session) => {
  const shiftAssignments = plan.internal.shiftClassification.deterministic;
  const blockAssignments = plan.internal.blockClassification.deterministic;

  const writeAssignments = async (collectionName, assignments) => {
    if (!assignments.length) return;
    const result = await db.collection(collectionName).bulkWrite(
      assignments.map(({ document, inferredBusiness }) => ({
        updateOne: {
          filter: {
            _id: document._id,
            $or: [{ business: { $exists: false } }, { business: null }],
          },
          update: { $set: { business: inferredBusiness } },
        },
      })),
      { ordered: true, session },
    );
    if (result.modifiedCount !== assignments.length) {
      throw new Error(`Backfill concurrente detectado en ${collectionName}; se aborta la transacción`);
    }
  };

  await writeAssignments("shifts", shiftAssignments);
  await writeAssignments("blocks", blockAssignments);
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
    await db.collection(collectionName).createIndex(spec.key, spec.options);
  }
};

const dropObsoleteIndexes = async (db, collectionName, spec) => {
  const indexes = await db.collection(collectionName).listIndexes().toArray();
  const names = obsoleteIndexNames(indexes, spec);
  for (const name of names) await db.collection(collectionName).dropIndex(name);
};

const assertFinalIndexState = (plan) => {
  for (const [name, state] of Object.entries(plan.indexes)) {
    if (!state.desired.present) throw new Error(`Índice tenant faltante después de Apply: ${name}`);
    if (state.desired.conflicts.length) throw new Error(`Índice tenant conflictivo después de Apply: ${name}`);
    if (state.obsolete.length) throw new Error(`Índice global obsoleto permanece después de Apply: ${name}`);
  }
};

export const runAvailabilityTenantization = async ({
  mongoUri,
  options,
  connect = mongoose.connect.bind(mongoose),
  disconnect = mongoose.disconnect.bind(mongoose),
  connection = mongoose.connection,
}) => {
  validateAvailabilityTenantizationOptions(options, mongoUri);
  const targetFingerprint = fingerprintMongoTarget(mongoUri, options.database);
  if (targetFingerprint !== options.expectedTargetFingerprint) {
    throw new Error("El fingerprint del destino MongoDB no coincide con el confirmado");
  }

  let connected = false;
  try {
    await connect(mongoUri, { autoIndex: false });
    connected = true;
    if (connection.db?.databaseName !== options.database) {
      throw new Error("La conexión MongoDB no apunta a la base confirmada");
    }

    const snapshot = await readAvailabilityTenantizationSnapshot(connection.db);
    const initialPlan = buildAvailabilityTenantizationPlan(snapshot);
    if (options.mode === "plan") {
      return {
        mode: "plan",
        targetFingerprint,
        plan: publicPlan(initialPlan),
        exitCode: initialPlan.safeToApply ? 0 : 2,
      };
    }
    if (!initialPlan.safeToApply) {
      throw new Error("Apply rechazado: el plan contiene ambigüedades o conflictos bloqueantes");
    }

    const session = await connection.startSession();
    try {
      await session.withTransaction(async () => {
        await applyBackfill(connection.db, initialPlan, session);
      });
    } finally {
      await session.endSession();
    }

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

    await ensureDesiredIndex(connection.db, "shifts", AVAILABILITY_INDEX_SPECS.shiftDesired);
    await ensureDesiredIndex(connection.db, "blocks", AVAILABILITY_INDEX_SPECS.blockDesired);
    await ensureDesiredIndex(connection.db, "appointments", AVAILABILITY_INDEX_SPECS.appointmentDesired);

    const withNewIndexes = buildAvailabilityTenantizationPlan(
      await readAvailabilityTenantizationSnapshot(connection.db),
    );
    if (
      !withNewIndexes.indexes.shift.desired.present ||
      !withNewIndexes.indexes.block.desired.present ||
      !withNewIndexes.indexes.appointment.desired.present
    ) {
      throw new Error("No se pudieron verificar físicamente los índices tenant nuevos");
    }

    await dropObsoleteIndexes(connection.db, "shifts", AVAILABILITY_INDEX_SPECS.shiftObsolete);
    await dropObsoleteIndexes(connection.db, "blocks", AVAILABILITY_INDEX_SPECS.blockObsolete);
    await dropObsoleteIndexes(connection.db, "appointments", AVAILABILITY_INDEX_SPECS.appointmentObsolete);

    const finalPlan = buildAvailabilityTenantizationPlan(
      await readAvailabilityTenantizationSnapshot(connection.db),
    );
    assertFinalIndexState(finalPlan);
    if (!finalPlan.safeToApply) throw new Error("Auditoría final 6.2.3 no quedó segura");

    return {
      mode: "apply",
      targetFingerprint,
      initialPlan: publicPlan(initialPlan),
      finalPlan: publicPlan(finalPlan),
      exitCode: 0,
    };
  } finally {
    if (connected) await disconnect();
  }
};

const usage = () => {
  console.log(`Uso:
  npm run migration:availability-tenantization -- \\
    --mode=plan|apply \\
    --environment=development|test \\
    --database=<nombre_dev_o_test> \\
    --expected-target-fingerprint=<sha256> \\
    [--confirm=${AVAILABILITY_TENANTIZATION_CONFIRMATION}]

La migración sólo acepta MongoDB local. Plan no escribe. Apply requiere confirmación literal.`);
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
      console.error(`Migración 6.2.3 rechazada: ${error.message}`);
      process.exitCode = 1;
    });
}
