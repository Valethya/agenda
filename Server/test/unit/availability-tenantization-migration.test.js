import test from "node:test";
import assert from "node:assert/strict";
import { Types } from "mongoose";
import {
  ACTIVE_APPOINTMENT_STATUSES,
  AVAILABILITY_DECLARED_LEGACY_APPOINTMENT_INDEX,
  AVAILABILITY_EXTERNAL_TARGET_CONFIRMATION,
  AVAILABILITY_INDEX_SPECS,
  AVAILABILITY_MAINTENANCE_CONFIRMATION,
  assertAvailabilityPreDropCheckpoint,
  buildAvailabilityTenantizationPlan,
  classifyAvailabilityDocuments,
  validateAvailabilityTenantizationOptions,
} from "../../scripts/migrations/availability-tenantization.js";
import { sanitizeAuditErrorMessage } from "../../scripts/migrations/membership-authority-provenance.js";

const id = () => new Types.ObjectId();
const fingerprint = "a".repeat(64);
const codeSha = "b".repeat(40);
const membership = (user, business) => ({ _id: id(), user, business, role: "worker", isActive: true });
const business = (_id, isActive = true) => ({ _id, isActive });
const baseSnapshot = () => ({
  shifts: [],
  blocks: [],
  memberships: [],
  businesses: [],
  appointments: [],
  shiftIndexes: [],
  blockIndexes: [],
  appointmentIndexes: [],
});

const desiredIndexes = () => ({
  shiftIndexes: [{
    name: AVAILABILITY_INDEX_SPECS.shiftDesired.options.name,
    key: AVAILABILITY_INDEX_SPECS.shiftDesired.key,
    unique: true,
  }],
  blockIndexes: [{
    name: AVAILABILITY_INDEX_SPECS.blockDesired.options.name,
    key: AVAILABILITY_INDEX_SPECS.blockDesired.key,
  }],
  appointmentIndexes: [{
    name: AVAILABILITY_INDEX_SPECS.appointmentDesired.options.name,
    key: AVAILABILITY_INDEX_SPECS.appointmentDesired.key,
    unique: true,
    partialFilterExpression: { status: { $in: [...ACTIVE_APPOINTMENT_STATUSES] } },
  }],
});

test("6.2.3 migration only infers active physical businesses", () => {
  const worker = id();
  const businessA = id();
  const businessB = id();
  const legacy = { _id: id(), worker, dayOfWeek: 1 };

  const deterministic = classifyAvailabilityDocuments(
    [legacy],
    [membership(worker, businessA)],
    [business(businessA)],
  );
  assert.equal(deterministic.deterministic.length, 1);
  assert.equal(deterministic.deterministic[0].inferredBusiness.toString(), businessA.toString());

  const ambiguous = classifyAvailabilityDocuments(
    [legacy],
    [membership(worker, businessA), membership(worker, businessB)],
    [business(businessA), business(businessB)],
  );
  assert.equal(ambiguous.ambiguous.length, 1);
  assert.equal(ambiguous.deterministic.length, 0);

  const inactive = classifyAvailabilityDocuments(
    [legacy],
    [membership(worker, businessA)],
    [business(businessA, false)],
  );
  assert.equal(inactive.unresolved.length, 1);
  assert.equal(inactive.deterministic.length, 0);

  const missing = classifyAvailabilityDocuments(
    [legacy],
    [membership(worker, businessA)],
    [],
  );
  assert.equal(missing.unresolved.length, 1);
  assert.equal(missing.deterministic.length, 0);

  assert.equal(
    classifyAvailabilityDocuments(
      [{ ...legacy, business: businessA }],
      [membership(worker, businessA)],
      [business(businessA)],
    ).alreadyMigrated.length,
    1,
  );
  assert.equal(
    classifyAvailabilityDocuments(
      [{ ...legacy, business: businessA }],
      [membership(worker, businessA)],
      [business(businessA, false)],
    ).invalidExisting.length,
    1,
  );
  assert.equal(
    classifyAvailabilityDocuments(
      [{ ...legacy, business: businessB }],
      [membership(worker, businessA)],
      [business(businessA), business(businessB)],
    ).invalidExisting.length,
    1,
  );
});

test("6.2.3 plan fails closed for inactive or missing Business", () => {
  const worker = id();
  const businessId = id();

  for (const businesses of [[business(businessId, false)], []]) {
    const snapshot = baseSnapshot();
    snapshot.shifts.push({ _id: id(), worker, dayOfWeek: 1 });
    snapshot.blocks.push({ _id: id(), worker, date: new Date("2099-01-01T00:00:00.000Z") });
    snapshot.memberships.push(membership(worker, businessId));
    snapshot.businesses.push(...businesses);
    const plan = buildAvailabilityTenantizationPlan(snapshot);
    assert.equal(plan.safeToApply, false);
    assert.equal(plan.counts.shifts.unresolved, 1);
    assert.equal(plan.counts.blocks.unresolved, 1);
  }
});

test("6.2.3 plan fails closed when a worker belongs to multiple active businesses", () => {
  const worker = id();
  const businessA = id();
  const businessB = id();
  const snapshot = baseSnapshot();
  snapshot.shifts.push({ _id: id(), worker, dayOfWeek: 1 });
  snapshot.blocks.push({ _id: id(), worker, date: new Date("2099-01-01T00:00:00.000Z") });
  snapshot.memberships.push(membership(worker, businessA), membership(worker, businessB));
  snapshot.businesses.push(business(businessA), business(businessB));
  const plan = buildAvailabilityTenantizationPlan(snapshot);
  assert.equal(plan.safeToApply, false);
  assert.ok(plan.findings.includes("shift:ambiguous:1"));
  assert.ok(plan.findings.includes("block:ambiguous:1"));
});

test("6.2.3 plan detects duplicate Shift keys after deterministic backfill", () => {
  const worker = id();
  const businessId = id();
  const snapshot = baseSnapshot();
  snapshot.memberships.push(membership(worker, businessId));
  snapshot.businesses.push(business(businessId));
  snapshot.shifts.push(
    { _id: id(), worker, dayOfWeek: 1 },
    { _id: id(), worker, dayOfWeek: 1 },
  );
  const plan = buildAvailabilityTenantizationPlan(snapshot);
  assert.equal(plan.safeToApply, false);
  assert.ok(plan.findings.includes("shift:targetDuplicateKeys:1"));
});

test("6.2.3 Appointment collision analysis is tenant-scoped", () => {
  const worker = id();
  const businessA = id();
  const businessB = id();
  const when = new Date("2099-01-01T00:00:00.000Z");
  const appointment = (businessId) => ({
    _id: id(), business: businessId, worker, date: when, startTime: "10:00", status: "pending",
  });
  const crossTenant = baseSnapshot();
  crossTenant.appointments.push(appointment(businessA), appointment(businessB));
  assert.equal(buildAvailabilityTenantizationPlan(crossTenant).safeToApply, true);

  const sameTenant = baseSnapshot();
  sameTenant.appointments.push(appointment(businessA), appointment(businessA));
  const plan = buildAvailabilityTenantizationPlan(sameTenant);
  assert.equal(plan.safeToApply, false);
  assert.ok(plan.findings.includes("appointment:targetDuplicateKeys:1"));
});

test("6.2.3 Appointment status audit is exhaustive and cancelled is legitimate", () => {
  const worker = id();
  const businessId = id();
  const when = new Date("2099-01-01T00:00:00.000Z");
  const valid = (status) => ({
    _id: id(), business: businessId, worker, date: when, startTime: "10:00", status,
  });

  const unknown = baseSnapshot();
  unknown.appointments.push(valid("legacy_unknown"));
  const unknownPlan = buildAvailabilityTenantizationPlan(unknown);
  assert.equal(unknownPlan.safeToApply, false);
  assert.equal(unknownPlan.counts.appointments.invalidStatus, 1);
  assert.ok(unknownPlan.findings.includes("appointment:invalidStatus:1"));

  const missing = baseSnapshot();
  missing.appointments.push({ _id: id(), business: businessId, worker, date: when, startTime: "10:00" });
  const missingPlan = buildAvailabilityTenantizationPlan(missing);
  assert.equal(missingPlan.safeToApply, false);
  assert.equal(missingPlan.counts.appointments.invalidStatus, 1);

  const cancelled = baseSnapshot();
  cancelled.appointments.push(valid("cancelled"));
  assert.equal(buildAvailabilityTenantizationPlan(cancelled).safeToApply, true);

  for (const status of ACTIVE_APPOINTMENT_STATUSES) {
    const snapshot = baseSnapshot();
    snapshot.appointments.push(valid(status));
    assert.equal(buildAvailabilityTenantizationPlan(snapshot).safeToApply, true);
  }
});

test("6.2.3 records the declared legacy Appointment index as $ne cancelled", () => {
  assert.deepEqual(
    AVAILABILITY_DECLARED_LEGACY_APPOINTMENT_INDEX.options.partialFilterExpression,
    { status: { $ne: "cancelled" } },
  );
});

test("6.2.3 plan recognizes desired physical indexes and obsolete global indexes", () => {
  const snapshot = baseSnapshot();
  Object.assign(snapshot, desiredIndexes());
  snapshot.shiftIndexes.unshift({ name: "worker_1_dayOfWeek_1", key: { worker: 1, dayOfWeek: 1 }, unique: true });
  snapshot.blockIndexes.unshift({ name: "worker_1_date_1", key: { worker: 1, date: 1 } });
  snapshot.appointmentIndexes.unshift({
    name: "worker_1_date_1_startTime_1",
    key: AVAILABILITY_DECLARED_LEGACY_APPOINTMENT_INDEX.key,
    unique: true,
    partialFilterExpression: AVAILABILITY_DECLARED_LEGACY_APPOINTMENT_INDEX.options.partialFilterExpression,
  });
  const plan = buildAvailabilityTenantizationPlan(snapshot);
  assert.equal(plan.safeToApply, true);
  assert.equal(plan.indexes.shift.desired.present, true);
  assert.deepEqual(plan.indexes.shift.obsolete, ["worker_1_dayOfWeek_1"]);
  assert.equal(plan.indexes.block.desired.present, true);
  assert.deepEqual(plan.indexes.block.obsolete, ["worker_1_date_1"]);
  assert.equal(plan.indexes.appointment.desired.present, true);
  assert.deepEqual(plan.indexes.appointment.obsolete, ["worker_1_date_1_startTime_1"]);
});

test("6.2.3 checkpoint pre-drop requires a fully safe migrated state and all desired indexes", () => {
  const safe = baseSnapshot();
  Object.assign(safe, desiredIndexes());
  const safePlan = buildAvailabilityTenantizationPlan(safe);
  assert.equal(assertAvailabilityPreDropCheckpoint(safePlan), true);

  const legacy = baseSnapshot();
  Object.assign(legacy, desiredIndexes());
  const worker = id();
  const businessId = id();
  legacy.memberships.push(membership(worker, businessId));
  legacy.businesses.push(business(businessId));
  legacy.shifts.push({ _id: id(), worker, dayOfWeek: 1 });
  assert.throws(
    () => assertAvailabilityPreDropCheckpoint(buildAvailabilityTenantizationPlan(legacy)),
    /legacy|pre-drop/u,
  );

  const missingIndex = baseSnapshot();
  assert.throws(
    () => assertAvailabilityPreDropCheckpoint(buildAvailabilityTenantizationPlan(missingIndex)),
    /índice tenant/u,
  );
});

test("6.2.3 local runtime remains limited to explicit local development/test targets", () => {
  const validOptions = {
    mode: "plan",
    environment: "development",
    database: "agenda_local_dev",
    expectedTargetFingerprint: fingerprint,
  };
  const validated = validateAvailabilityTenantizationOptions(
    { ...validOptions },
    "mongodb://127.0.0.1:27017/agenda_local_dev",
    { NODE_ENV: "development" },
  );
  assert.equal(validated.targetKind, "local");
  assert.throws(() => validateAvailabilityTenantizationOptions(
    { ...validOptions },
    "mongodb+srv://cluster.example.mongodb.net/agenda_local_dev",
    { NODE_ENV: "development" },
  ), /externo|local/u);
});

test("6.2.3 external target is technically supported but deny-by-default", () => {
  const externalOptions = {
    mode: "plan",
    environment: "production",
    database: "agenda",
    expectedTargetFingerprint: fingerprint,
    expectedCodeSha: codeSha,
    allowExternalTarget: AVAILABILITY_EXTERNAL_TARGET_CONFIRMATION,
  };
  const uri = "mongodb+srv://operator:secret@cluster.example.mongodb.net/agenda";
  const validated = validateAvailabilityTenantizationOptions(
    { ...externalOptions },
    uri,
    { NODE_ENV: "production", AVAILABILITY_TENANTIZATION_CODE_SHA: codeSha },
  );
  assert.equal(validated.targetKind, "external");
  assert.equal(validated.effectiveCodeSha, codeSha);

  assert.throws(() => validateAvailabilityTenantizationOptions(
    { ...externalOptions, allowExternalTarget: undefined },
    uri,
    { NODE_ENV: "production", AVAILABILITY_TENANTIZATION_CODE_SHA: codeSha },
  ), /allow-external-target/u);

  assert.throws(() => validateAvailabilityTenantizationOptions(
    { ...externalOptions, expectedCodeSha: "c".repeat(40) },
    uri,
    { NODE_ENV: "production", AVAILABILITY_TENANTIZATION_CODE_SHA: codeSha },
  ), /SHA efectivo/u);
});

test("6.2.3 external Apply additionally requires maintenance confirmation and normal Apply confirmation", () => {
  const base = {
    mode: "apply",
    environment: "staging",
    database: "agenda_staging",
    expectedTargetFingerprint: fingerprint,
    expectedCodeSha: codeSha,
    allowExternalTarget: AVAILABILITY_EXTERNAL_TARGET_CONFIRMATION,
    confirm: "TENANTIZE_AVAILABILITY_6_2_3",
  };
  const uri = "mongodb://operator:secret@db.example.net:27017/agenda_staging";
  assert.throws(() => validateAvailabilityTenantizationOptions(
    { ...base }, uri,
    { NODE_ENV: "staging", AVAILABILITY_TENANTIZATION_CODE_SHA: codeSha },
  ), /maintenance-window/u);
  const validated = validateAvailabilityTenantizationOptions(
    { ...base, maintenanceWindow: AVAILABILITY_MAINTENANCE_CONFIRMATION },
    uri,
    { NODE_ENV: "staging", AVAILABILITY_TENANTIZATION_CODE_SHA: codeSha },
  );
  assert.equal(validated.targetKind, "external");
});

test("6.2.3 rejects execution from deployment platforms even with external authorization", () => {
  const options = {
    mode: "plan",
    environment: "production",
    database: "agenda",
    expectedTargetFingerprint: fingerprint,
    expectedCodeSha: codeSha,
    allowExternalTarget: AVAILABILITY_EXTERNAL_TARGET_CONFIRMATION,
  };
  assert.throws(() => validateAvailabilityTenantizationOptions(
    options,
    "mongodb+srv://cluster.example.mongodb.net/agenda",
    { NODE_ENV: "production", AVAILABILITY_TENANTIZATION_CODE_SHA: codeSha, VERCEL: "1" },
  ), /plataforma de despliegue/u);
});

test("6.2.3 operational errors redact Mongo credentials and raw URI", () => {
  const uri = "mongodb://usuario:password-secreto@db.example.net:27017/agenda";
  const sanitized = sanitizeAuditErrorMessage(
    new Error(`falló ${uri}; usuario=usuario password=password-secreto`),
    uri,
  );
  assert.equal(sanitized.includes(uri), false);
  assert.equal(sanitized.includes("usuario"), false);
  assert.equal(sanitized.includes("password-secreto"), false);
});
