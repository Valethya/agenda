import { mongo } from "mongoose";
import {
  ALLOWED_APPOINTMENT_STATUSES,
  AVAILABILITY_INDEX_SPECS,
} from "../../scripts/migrations/availability-tenantization.js";

export const AVAILABILITY_CUTOVER_ENV = "AVAILABILITY_6_2_3_CUTOVER";
export const AVAILABILITY_CUTOVER_CONFIRMATION = "AVAILABILITY_6_2_3_STORAGE_READY";

const REMOTE_ENVIRONMENTS = new Set(["staging", "production"]);
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

const hasValue = (value) => value !== undefined && value !== null && String(value).trim() !== "";
const keyEquals = (actual, expected) => JSON.stringify(actual ?? {}) === JSON.stringify(expected ?? {});
const partialEquals = (actual, expected) => JSON.stringify(actual ?? null) === JSON.stringify(expected ?? null);

export const shouldEnforceAvailabilityCutover = (processEnvironment = process.env) =>
  REMOTE_ENVIRONMENTS.has(processEnvironment?.NODE_ENV) ||
  DEPLOYMENT_ENVIRONMENT_INDICATORS.some((name) => hasValue(processEnvironment?.[name]));

const listCollectionNames = async (db) => new Set(
  (await db.listCollections({}, { nameOnly: true }).toArray()).map((entry) => entry.name),
);

const exactDesiredIndex = (index, spec) =>
  keyEquals(index?.key, spec.key) &&
  Boolean(index?.unique) === Boolean(spec.options.unique) &&
  partialEquals(index?.partialFilterExpression, spec.options.partialFilterExpression);

const hasObsoleteIndex = (indexes, spec) => indexes.some((index) =>
  index?.name !== "_id_" && keyEquals(index?.key, spec.key),
);

const assertCollectionIndexes = async (db, collectionName, desiredSpec, obsoleteSpec) => {
  const indexes = await db.collection(collectionName).listIndexes().toArray();
  if (!indexes.some((index) => exactDesiredIndex(index, desiredSpec))) {
    throw new Error(`Cutover 6.2.3 bloqueado: índice tenant faltante en ${collectionName}`);
  }
  if (hasObsoleteIndex(indexes, obsoleteSpec)) {
    throw new Error(`Cutover 6.2.3 bloqueado: índice legacy permanece en ${collectionName}`);
  }
};

const countNonObjectIdBusiness = (collection) => collection.countDocuments({
  $expr: { $ne: [{ $type: "$business" }, "objectId"] },
});

export const assertAvailabilityRuntimeStorageReady = async (
  db,
  processEnvironment = process.env,
) => {
  if (!shouldEnforceAvailabilityCutover(processEnvironment)) {
    return { enforced: false };
  }

  if (processEnvironment?.[AVAILABILITY_CUTOVER_ENV] !== AVAILABILITY_CUTOVER_CONFIRMATION) {
    throw new Error(
      `Cutover 6.2.3 bloqueado: falta ${AVAILABILITY_CUTOVER_ENV}=${AVAILABILITY_CUTOVER_CONFIRMATION}`,
    );
  }
  if (!db) throw new Error("Cutover 6.2.3 bloqueado: MongoDB no está conectado");

  const names = await listCollectionNames(db);
  for (const name of ["shifts", "blocks", "appointments"]) {
    if (!names.has(name)) {
      throw new Error(`Cutover 6.2.3 bloqueado: colección requerida ausente (${name})`);
    }
  }

  const [invalidShifts, invalidBlocks, invalidAppointmentStatuses] = await Promise.all([
    countNonObjectIdBusiness(db.collection("shifts")),
    countNonObjectIdBusiness(db.collection("blocks")),
    db.collection("appointments").countDocuments({
      status: { $nin: [...ALLOWED_APPOINTMENT_STATUSES] },
    }),
  ]);

  if (invalidShifts || invalidBlocks) {
    throw new Error("Cutover 6.2.3 bloqueado: existen Shift/Block legacy sin business BSON válido");
  }
  if (invalidAppointmentStatuses) {
    throw new Error("Cutover 6.2.3 bloqueado: existen Appointment con status físico no permitido");
  }

  await assertCollectionIndexes(
    db,
    "shifts",
    AVAILABILITY_INDEX_SPECS.shiftDesired,
    AVAILABILITY_INDEX_SPECS.shiftObsolete,
  );
  await assertCollectionIndexes(
    db,
    "blocks",
    AVAILABILITY_INDEX_SPECS.blockDesired,
    AVAILABILITY_INDEX_SPECS.blockObsolete,
  );
  await assertCollectionIndexes(
    db,
    "appointments",
    AVAILABILITY_INDEX_SPECS.appointmentDesired,
    AVAILABILITY_INDEX_SPECS.appointmentObsolete,
  );

  return { enforced: true, ready: true };
};

export const isPhysicalObjectId = (value) => value instanceof mongo.ObjectId;
