import test from "node:test";
import assert from "node:assert/strict";
import { Types } from "mongoose";
import {
  ACTIVE_APPOINTMENT_STATUSES,
  AVAILABILITY_INDEX_SPECS,
  buildAvailabilityTenantizationPlan,
  classifyAvailabilityDocuments,
  validateAvailabilityTenantizationOptions,
} from "../../scripts/migrations/availability-tenantization.js";

const id = () => new Types.ObjectId();
const fingerprint = "a".repeat(64);

const membership = (user, business) => ({
  _id: id(),
  user,
  business,
  role: "worker",
  isActive: true,
});

const baseSnapshot = () => ({
  shifts: [],
  blocks: [],
  memberships: [],
  appointments: [],
  shiftIndexes: [],
  blockIndexes: [],
  appointmentIndexes: [],
});

test("6.2.3 migration classifies deterministic, ambiguous, unresolved and migrated documents", () => {
  const worker = id();
  const businessA = id();
  const businessB = id();
  const legacy = { _id: id(), worker, dayOfWeek: 1 };

  const deterministic = classifyAvailabilityDocuments(
    [legacy],
    [membership(worker, businessA)],
  );
  assert.equal(deterministic.deterministic.length, 1);
  assert.equal(deterministic.deterministic[0].inferredBusiness.toString(), businessA.toString());

  const ambiguous = classifyAvailabilityDocuments(
    [legacy],
    [membership(worker, businessA), membership(worker, businessB)],
  );
  assert.equal(ambiguous.ambiguous.length, 1);
  assert.equal(ambiguous.deterministic.length, 0);

  const unresolved = classifyAvailabilityDocuments([legacy], []);
  assert.equal(unresolved.unresolved.length, 1);

  const migrated = classifyAvailabilityDocuments(
    [{ ...legacy, business: businessA }],
    [membership(worker, businessA)],
  );
  assert.equal(migrated.alreadyMigrated.length, 1);

  const invalidExisting = classifyAvailabilityDocuments(
    [{ ...legacy, business: businessB }],
    [membership(worker, businessA)],
  );
  assert.equal(invalidExisting.invalidExisting.length, 1);
});

test("6.2.3 plan fails closed when a worker belongs to multiple businesses", () => {
  const worker = id();
  const businessA = id();
  const businessB = id();
  const snapshot = baseSnapshot();
  snapshot.shifts.push({ _id: id(), worker, dayOfWeek: 1 });
  snapshot.blocks.push({ _id: id(), worker, date: new Date("2099-01-01T00:00:00.000Z") });
  snapshot.memberships.push(
    membership(worker, businessA),
    membership(worker, businessB),
  );

  const plan = buildAvailabilityTenantizationPlan(snapshot);
  assert.equal(plan.safeToApply, false);
  assert.equal(plan.counts.shifts.ambiguous, 1);
  assert.equal(plan.counts.blocks.ambiguous, 1);
  assert.ok(plan.findings.includes("shift:ambiguous:1"));
  assert.ok(plan.findings.includes("block:ambiguous:1"));
});

test("6.2.3 plan detects duplicate Shift keys after deterministic backfill", () => {
  const worker = id();
  const business = id();
  const snapshot = baseSnapshot();
  snapshot.memberships.push(membership(worker, business));
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
  const appointment = (business) => ({
    _id: id(),
    business,
    worker,
    date: when,
    startTime: "10:00",
    status: "pending",
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

test("6.2.3 plan recognizes desired physical indexes and obsolete global indexes", () => {
  const snapshot = baseSnapshot();
  snapshot.shiftIndexes = [
    { name: "worker_1_dayOfWeek_1", key: { worker: 1, dayOfWeek: 1 }, unique: true },
    { name: AVAILABILITY_INDEX_SPECS.shiftDesired.options.name, key: AVAILABILITY_INDEX_SPECS.shiftDesired.key, unique: true },
  ];
  snapshot.blockIndexes = [
    { name: "worker_1_date_1", key: { worker: 1, date: 1 } },
    { name: AVAILABILITY_INDEX_SPECS.blockDesired.options.name, key: AVAILABILITY_INDEX_SPECS.blockDesired.key },
  ];
  snapshot.appointmentIndexes = [
    {
      name: "worker_1_date_1_startTime_1",
      key: { worker: 1, date: 1, startTime: 1 },
      unique: true,
      partialFilterExpression: { status: { $ne: "cancelled" } },
    },
    {
      name: AVAILABILITY_INDEX_SPECS.appointmentDesired.options.name,
      key: AVAILABILITY_INDEX_SPECS.appointmentDesired.key,
      unique: true,
      partialFilterExpression: { status: { $in: [...ACTIVE_APPOINTMENT_STATUSES] } },
    },
  ];

  const plan = buildAvailabilityTenantizationPlan(snapshot);
  assert.equal(plan.safeToApply, true);
  assert.equal(plan.indexes.shift.desired.present, true);
  assert.deepEqual(plan.indexes.shift.obsolete, ["worker_1_dayOfWeek_1"]);
  assert.equal(plan.indexes.block.desired.present, true);
  assert.deepEqual(plan.indexes.block.obsolete, ["worker_1_date_1"]);
  assert.equal(plan.indexes.appointment.desired.present, true);
  assert.deepEqual(plan.indexes.appointment.obsolete, ["worker_1_date_1_startTime_1"]);
});

test("6.2.3 migration runtime only permits explicitly confirmed local dev/test targets", () => {
  const validOptions = {
    mode: "plan",
    environment: "development",
    database: "agenda_local_dev",
    expectedTargetFingerprint: fingerprint,
  };

  assert.doesNotThrow(() => validateAvailabilityTenantizationOptions(
    { ...validOptions },
    "mongodb://127.0.0.1:27017/agenda_local_dev",
    { NODE_ENV: "development" },
  ));

  assert.throws(() => validateAvailabilityTenantizationOptions(
    { ...validOptions, environment: "production", database: "agenda" },
    "mongodb://127.0.0.1:27017/agenda",
    { NODE_ENV: "production" },
  ), /NODE_ENV|development|test/u);

  assert.throws(() => validateAvailabilityTenantizationOptions(
    { ...validOptions },
    "mongodb+srv://cluster.example.mongodb.net/agenda_local_dev",
    { NODE_ENV: "development" },
  ), /local/u);

  assert.throws(() => validateAvailabilityTenantizationOptions(
    { ...validOptions },
    "mongodb://127.0.0.1:27017/agenda_local_dev",
    { NODE_ENV: "development", VERCEL: "1" },
  ), /plataforma de despliegue/u);

  assert.throws(() => validateAvailabilityTenantizationOptions(
    { ...validOptions, mode: "apply" },
    "mongodb://127.0.0.1:27017/agenda_local_dev",
    { NODE_ENV: "development" },
  ), /--confirm/u);
});
