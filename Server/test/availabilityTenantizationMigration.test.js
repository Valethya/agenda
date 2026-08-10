import test from "node:test";
import assert from "node:assert/strict";
import mongoose, { Types } from "mongoose";
import {
  ACTIVE_APPOINTMENT_STATUSES,
  AVAILABILITY_INDEX_SPECS,
  AVAILABILITY_TENANTIZATION_CONFIRMATION,
  AVAILABILITY_TENANTIZATION_LOCK_COLLECTION,
  AVAILABILITY_TENANTIZATION_LOCK_ID,
  runAvailabilityTenantization,
} from "../scripts/migrations/availability-tenantization.js";
import { fingerprintMongoTarget } from "../scripts/migrations/membership-authority-provenance.js";

const baseUri = process.env.MONGO_TEST_URI;
if (!baseUri) throw new Error("MONGO_TEST_URI es obligatoria para migration E2E");

const id = () => new Types.ObjectId();
const date = new Date("2099-01-01T00:00:00.000Z");

const uriFor = (database) => {
  const match = baseUri.match(/^(mongodb(?:\+srv)?:\/\/[^/]+)\/[^?]*(\?.*)?$/iu);
  if (!match) throw new Error("MONGO_TEST_URI no tiene el formato esperado");
  return `${match[1]}/${database}${match[2] ?? ""}`;
};

const withDb = async (uri, callback) => {
  const connection = mongoose.createConnection(uri, { autoIndex: false });
  await connection.asPromise();
  try {
    return await callback(connection.db);
  } finally {
    await connection.close();
  }
};

const cleanup = async (uri) => withDb(uri, (db) => db.dropDatabase());
const keyEquals = (index, expected) => JSON.stringify(index.key) === JSON.stringify(expected);

const snapshotState = async (uri) => withDb(uri, async (db) => {
  const names = (await db.listCollections({}, { nameOnly: true }).toArray())
    .map((item) => item.name)
    .sort();
  const data = {};
  for (const name of ["memberships", "shifts", "blocks", "appointments"]) {
    data[name] = names.includes(name)
      ? await db.collection(name).find({}).sort({ _id: 1 }).toArray()
      : [];
  }
  const indexes = {};
  for (const name of ["shifts", "blocks", "appointments"]) {
    indexes[name] = names.includes(name)
      ? await db.collection(name).listIndexes().toArray()
      : [];
  }
  return { names, data, indexes };
});

const seedLegacy = async (uri, { ambiguous = false } = {}) => withDb(uri, async (db) => {
  const worker = id();
  const businessA = id();
  const businessB = id();
  const shiftId = id();
  const blockId = id();
  const appointmentId = id();

  await db.collection("memberships").insertOne({
    _id: id(), user: worker, business: businessA, role: "worker", isActive: true,
  });
  if (ambiguous) {
    await db.collection("memberships").insertOne({
      _id: id(), user: worker, business: businessB, role: "worker", isActive: true,
    });
  }
  await db.collection("shifts").insertOne({
    _id: shiftId,
    worker,
    dayOfWeek: 1,
    isOpen: true,
    startTime: "09:00",
    endTime: "18:00",
    breaks: [],
  });
  await db.collection("blocks").insertOne({
    _id: blockId,
    worker,
    date,
    startTime: "11:00",
    endTime: "12:00",
    reason: "legacy",
  });
  await db.collection("appointments").insertOne({
    _id: appointmentId,
    business: businessA,
    worker,
    client: id(),
    service: id(),
    date,
    startTime: "14:00",
    endTime: "15:00",
    status: "pending",
  });

  await db.collection("shifts").createIndex(
    { worker: 1, dayOfWeek: 1 },
    { unique: true, name: "worker_1_dayOfWeek_1" },
  );
  await db.collection("blocks").createIndex(
    { worker: 1, date: 1 },
    { name: "worker_1_date_1" },
  );
  await db.collection("appointments").createIndex(
    { worker: 1, date: 1, startTime: 1 },
    {
      unique: true,
      name: "worker_1_date_1_startTime_1",
      partialFilterExpression: { status: { $in: [...ACTIVE_APPOINTMENT_STATUSES] } },
    },
  );

  return { worker, businessA, businessB, shiftId, blockId, appointmentId };
});

const optionsFor = (database, mode = "apply") => ({
  mode,
  environment: "test",
  database,
  expectedTargetFingerprint: fingerprintMongoTarget(uriFor(database), database),
  ...(mode === "apply" ? { confirm: AVAILABILITY_TENANTIZATION_CONFIRMATION } : {}),
});

const assertLegacyIndexesPresent = (state) => {
  assert.ok(state.indexes.shifts.some((index) => keyEquals(index, { worker: 1, dayOfWeek: 1 })));
  assert.ok(state.indexes.blocks.some((index) => keyEquals(index, { worker: 1, date: 1 })));
  assert.ok(
    state.indexes.appointments.some((index) =>
      keyEquals(index, { worker: 1, date: 1, startTime: 1 })
    ),
  );
};

const assertTenantIndexesPresent = (state) => {
  const shift = state.indexes.shifts.find((index) =>
    keyEquals(index, AVAILABILITY_INDEX_SPECS.shiftDesired.key)
  );
  const block = state.indexes.blocks.find((index) =>
    keyEquals(index, AVAILABILITY_INDEX_SPECS.blockDesired.key)
  );
  const appointment = state.indexes.appointments.find((index) =>
    keyEquals(index, AVAILABILITY_INDEX_SPECS.appointmentDesired.key)
  );
  assert.equal(shift?.unique, true);
  assert.ok(block);
  assert.equal(appointment?.unique, true);
  assert.deepEqual(
    appointment?.partialFilterExpression,
    { status: { $in: [...ACTIVE_APPOINTMENT_STATUSES] } },
  );
  assert.equal(
    state.indexes.shifts.some((index) => keyEquals(index, { worker: 1, dayOfWeek: 1 })),
    false,
  );
  assert.equal(
    state.indexes.blocks.some((index) => keyEquals(index, { worker: 1, date: 1 })),
    false,
  );
  assert.equal(
    state.indexes.appointments.some((index) =>
      keyEquals(index, { worker: 1, date: 1, startTime: 1 })
    ),
    false,
  );
};

test("6.2.3 availability migration E2E real", async (t) => {
  await t.test("plan es realmente read-only", async () => {
    const database = "agenda_availability_plan_test";
    const uri = uriFor(database);
    await cleanup(uri).catch(() => {});
    try {
      await seedLegacy(uri);
      const before = await snapshotState(uri);
      const result = await runAvailabilityTenantization({
        mongoUri: uri,
        options: optionsFor(database, "plan"),
        processEnvironment: { NODE_ENV: "test" },
      });
      assert.equal(result.mode, "plan");
      const after = await snapshotState(uri);
      assert.deepEqual(after, before);
      assert.equal(after.names.includes(AVAILABILITY_TENANTIZATION_LOCK_COLLECTION), false);
    } finally {
      await cleanup(uri).catch(() => {});
    }
  });

  await t.test("Apply migra documentos e índices físicos y el segundo Apply es idempotente", async () => {
    const database = "agenda_availability_apply_test";
    const uri = uriFor(database);
    await cleanup(uri).catch(() => {});
    try {
      const seeded = await seedLegacy(uri);
      const first = await runAvailabilityTenantization({
        mongoUri: uri,
        options: optionsFor(database),
        processEnvironment: { NODE_ENV: "test" },
      });
      assert.equal(first.exitCode, 0);
      let migrated = await snapshotState(uri);
      assert.equal(migrated.data.shifts[0].business.toString(), seeded.businessA.toString());
      assert.equal(migrated.data.blocks[0].business.toString(), seeded.businessA.toString());
      assert.equal(migrated.data.appointments[0]._id.toString(), seeded.appointmentId.toString());
      assertTenantIndexesPresent(migrated);

      const stableBeforeSecondApply = await snapshotState(uri);
      const second = await runAvailabilityTenantization({
        mongoUri: uri,
        options: optionsFor(database),
        processEnvironment: { NODE_ENV: "test" },
      });
      assert.equal(second.exitCode, 0);
      const stableAfterSecondApply = await snapshotState(uri);
      assert.deepEqual(stableAfterSecondApply.data, stableBeforeSecondApply.data);
      assertTenantIndexesPresent(stableAfterSecondApply);

      await withDb(uri, async (db) => {
        await db.collection("memberships").insertOne({
          _id: id(),
          user: seeded.worker,
          business: seeded.businessB,
          role: "worker",
          isActive: true,
        });
        await db.collection("shifts").insertOne({
          _id: id(),
          business: seeded.businessB,
          worker: seeded.worker,
          dayOfWeek: 1,
          isOpen: true,
          startTime: "14:00",
          endTime: "20:00",
          breaks: [],
        });
        await db.collection("appointments").insertOne({
          _id: id(),
          business: seeded.businessB,
          worker: seeded.worker,
          client: id(),
          service: id(),
          date,
          startTime: "14:00",
          endTime: "15:00",
          status: "pending",
        });
      });

      migrated = await snapshotState(uri);
      assert.equal(
        migrated.data.shifts.filter((item) =>
          item.worker.toString() === seeded.worker.toString() && item.dayOfWeek === 1
        ).length,
        2,
      );
      assert.equal(
        migrated.data.appointments.filter((item) =>
          item.worker.toString() === seeded.worker.toString() && item.startTime === "14:00"
        ).length,
        2,
      );
    } finally {
      await cleanup(uri).catch(() => {});
    }
  });

  await t.test("ambiguous rechaza Apply con cero writes e índices intactos", async () => {
    const database = "agenda_availability_ambiguous_test";
    const uri = uriFor(database);
    await cleanup(uri).catch(() => {});
    try {
      await seedLegacy(uri, { ambiguous: true });
      const before = await snapshotState(uri);
      await assert.rejects(
        runAvailabilityTenantization({
          mongoUri: uri,
          options: optionsFor(database),
          processEnvironment: { NODE_ENV: "test" },
        }),
        /ambigüedades|bloqueantes/u,
      );
      const after = await snapshotState(uri);
      assert.deepEqual(after.data, before.data);
      assertLegacyIndexesPresent(after);
      assert.equal(after.names.includes(AVAILABILITY_TENANTIZATION_LOCK_COLLECTION), false);
    } finally {
      await cleanup(uri).catch(() => {});
    }
  });

  await t.test("Membership cambiada antes del backfill aborta y no asigna un business distinto", async () => {
    const database = "agenda_availability_membership_race_test";
    const uri = uriFor(database);
    await cleanup(uri).catch(() => {});
    try {
      const seeded = await seedLegacy(uri);
      let changed = false;
      await assert.rejects(
        runAvailabilityTenantization({
          mongoUri: uri,
          options: optionsFor(database),
          processEnvironment: { NODE_ENV: "test" },
          stageCheckpoint: async (stage, { db }) => {
            if (stage !== "before-backfill-transaction" || changed) return;
            changed = true;
            await db.collection("memberships").updateOne(
              { user: seeded.worker, business: seeded.businessA },
              { $set: { isActive: false } },
            );
            await db.collection("memberships").insertOne({
              _id: id(),
              user: seeded.worker,
              business: seeded.businessB,
              role: "worker",
              isActive: true,
            });
          },
        }),
        /Membership cambió|inferencia/u,
      );
      const after = await snapshotState(uri);
      assert.equal(after.data.shifts[0].business, undefined);
      assert.equal(after.data.blocks[0].business, undefined);
      assertLegacyIndexesPresent(after);
    } finally {
      await cleanup(uri).catch(() => {});
    }
  });

  await t.test("un documento legacy que aparece antes del drop bloquea la eliminación de índices antiguos", async () => {
    const database = "agenda_availability_predrop_race_test";
    const uri = uriFor(database);
    await cleanup(uri).catch(() => {});
    try {
      await seedLegacy(uri);
      const lateWorker = id();
      const lateBusiness = id();
      let injected = false;
      await assert.rejects(
        runAvailabilityTenantization({
          mongoUri: uri,
          options: optionsFor(database),
          processEnvironment: { NODE_ENV: "test" },
          stageCheckpoint: async (stage, { db }) => {
            if (stage !== "before-drop-indexes" || injected) return;
            injected = true;
            await db.collection("memberships").insertOne({
              _id: id(),
              user: lateWorker,
              business: lateBusiness,
              role: "worker",
              isActive: true,
            });
            await db.collection("shifts").insertOne({
              _id: id(),
              worker: lateWorker,
              dayOfWeek: 2,
              isOpen: true,
              startTime: "09:00",
              endTime: "18:00",
              breaks: [],
            });
          },
        }),
        /legacy|pre-drop|seguro/u,
      );
      const after = await snapshotState(uri);
      assertLegacyIndexesPresent(after);
      assert.ok(
        after.indexes.shifts.some((index) =>
          keyEquals(index, AVAILABILITY_INDEX_SPECS.shiftDesired.key)
        ),
      );
    } finally {
      await cleanup(uri).catch(() => {});
    }
  });

  await t.test("pérdida del fencing lock impide continuar y nunca libera el lock ajeno", async () => {
    const database = "agenda_availability_lock_loss_test";
    const uri = uriFor(database);
    await cleanup(uri).catch(() => {});
    try {
      await seedLegacy(uri);
      let stolen = false;
      await assert.rejects(
        runAvailabilityTenantization({
          mongoUri: uri,
          options: optionsFor(database),
          processEnvironment: { NODE_ENV: "test" },
          stageCheckpoint: async (stage, { db }) => {
            if (stage !== "before-drop-indexes" || stolen) return;
            stolen = true;
            await db.collection(AVAILABILITY_TENANTIZATION_LOCK_COLLECTION).updateOne(
              { _id: AVAILABILITY_TENANTIZATION_LOCK_ID },
              {
                $set: {
                  ownerId: "replacement-owner",
                  leaseUntil: new Date(Date.now() + 120_000),
                },
                $inc: { fencingToken: 1 },
              },
            );
          },
        }),
        /lock/u,
      );
      const after = await snapshotState(uri);
      assertLegacyIndexesPresent(after);
      await withDb(uri, async (db) => {
        const lock = await db.collection(AVAILABILITY_TENANTIZATION_LOCK_COLLECTION).findOne({
          _id: AVAILABILITY_TENANTIZATION_LOCK_ID,
        });
        assert.equal(lock?.ownerId, "replacement-owner");
      });
    } finally {
      await cleanup(uri).catch(() => {});
    }
  });

  await t.test("fallo de createIndex conserva todos los índices legacy", async () => {
    const database = "agenda_availability_createindex_failure_test";
    const uri = uriFor(database);
    await cleanup(uri).catch(() => {});
    try {
      await seedLegacy(uri);
      await assert.rejects(
        runAvailabilityTenantization({
          mongoUri: uri,
          options: optionsFor(database),
          processEnvironment: { NODE_ENV: "test" },
          ensureIndex: async (db, collectionName, spec) => {
            if (collectionName === "blocks") throw new Error("simulated createIndex failure");
            await db.collection(collectionName).createIndex(spec.key, spec.options);
          },
        }),
        /simulated createIndex failure/u,
      );
      const after = await snapshotState(uri);
      assertLegacyIndexesPresent(after);
    } finally {
      await cleanup(uri).catch(() => {});
    }
  });
});
