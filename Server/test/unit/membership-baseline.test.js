import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mongo } from "mongoose";
import {
  acquireMembershipBaselineLock,
  buildMembershipBaselineManifest,
  buildMembershipBaselinePlan,
  buildVerifiedMembershipBaselinePlan,
  MEMBERSHIP_BASELINE_CONFIRMATION,
  MEMBERSHIP_BASELINE_LOCK_COLLECTION,
  MEMBERSHIP_BASELINE_LOCK_KEY,
  parseMembershipBaselineArgs,
  releaseMembershipBaselineLock,
  runMembershipBaselineBootstrap,
  validateMembershipBaselineOptions,
  verifyMembershipBaselinePasswords,
} from "../../scripts/bootstrap/membership-baseline.js";
import { fingerprintMongoTarget } from "../../scripts/migrations/membership-authority-provenance.js";

const manifestEnvironment = () => ({
  BASELINE_ATMOSFERA_ADMIN_EMAIL: "admin-atmosfera@example.test",
  BASELINE_ATMOSFERA_ADMIN_PASSWORD: "atmosfera-admin-safe",
  BASELINE_ATMOSFERA_WORKER_EMAIL: "worker-atmosfera@example.test",
  BASELINE_ATMOSFERA_WORKER_PASSWORD: "atmosfera-worker-safe",
  BASELINE_DAM_ADMIN_EMAIL: "admin-dam@example.test",
  BASELINE_DAM_ADMIN_PASSWORD: "dam-admin-password",
  BASELINE_DAM_WORKER_EMAIL: "worker-dam@example.test",
  BASELINE_DAM_WORKER_PASSWORD: "dam-worker-password",
});

const exactMembershipIndex = () => ({
  name: "user_1_business_1",
  key: { user: 1, business: 1 },
  unique: true,
});

const VALID_PASSWORD_HASH = `$2b$10$${"a".repeat(53)}`;

const readySource = (manifest) => {
  const businessIds = new Map(
    manifest.businesses.map((business) => [business.key, new mongo.ObjectId()]),
  );
  const userIds = new Map(
    manifest.users.map((user) => [user.key, new mongo.ObjectId()]),
  );
  const businesses = manifest.businesses.map((business) => ({
    _id: businessIds.get(business.key),
    name: business.name,
    slug: business.slug,
    isActive: true,
    owner: userIds.get(`${business.key}-admin`),
  }));
  const users = manifest.users.map((user) => ({
    _id: userIds.get(user.key),
    firstName: user.firstName,
    lastName: user.lastName,
    email: [user.email],
    password: VALID_PASSWORD_HASH,
    role: user.role,
    business: businessIds.get(user.businessKey),
    isActive: true,
  }));
  const memberships = manifest.memberships.map((membership) => ({
    _id: new mongo.ObjectId(),
    user: userIds.get(membership.userKey),
    business: businessIds.get(membership.businessKey),
    role: membership.role,
    isActive: true,
  }));

  return {
    observedCollections: ["businesses", "memberships", "users"],
    businesses,
    users,
    memberships,
    indexes: [exactMembershipIndex()],
  };
};

describe("membership baseline manifest", () => {
  it("construye claves estables sin superadmin y conserva credenciales fuera del plan", () => {
    const manifest = buildMembershipBaselineManifest(manifestEnvironment());

    assert.deepEqual(
      manifest.businesses.map(({ key, slug }) => ({ key, slug })),
      [
        { key: "atmosfera", slug: "atmosfera" },
        { key: "dam", slug: "dam" },
      ],
    );
    assert.deepEqual(
      manifest.memberships.map(({ key, role, isActive }) => ({
        key,
        role,
        isActive,
      })),
      [
        { key: "atmosfera:admin", role: "admin", isActive: true },
        { key: "atmosfera:worker", role: "worker", isActive: true },
        { key: "dam:admin", role: "admin", isActive: true },
        { key: "dam:worker", role: "worker", isActive: true },
      ],
    );

    const plan = buildMembershipBaselinePlan(
      { observedCollections: [], businesses: [], users: [], memberships: [], indexes: [] },
      manifest,
    );
    assert.equal(JSON.stringify(plan).includes("example.test"), false);
    assert.equal(JSON.stringify(plan).includes("password"), false);
  });

  it("rechaza credenciales ausentes, correos inválidos, contraseñas cortas y duplicados", () => {
    assert.throws(() => buildMembershipBaselineManifest({}), /obligatoria/);

    const invalidEmail = manifestEnvironment();
    invalidEmail.BASELINE_DAM_ADMIN_EMAIL = "invalid";
    assert.throws(() => buildMembershipBaselineManifest(invalidEmail), /correo válido/);

    const shortPassword = manifestEnvironment();
    shortPassword.BASELINE_DAM_ADMIN_PASSWORD = "short";
    assert.throws(
      () => buildMembershipBaselineManifest(shortPassword),
      /al menos 12/,
    );

    const duplicate = manifestEnvironment();
    duplicate.BASELINE_DAM_ADMIN_EMAIL = duplicate.BASELINE_ATMOSFERA_ADMIN_EMAIL;
    assert.throws(() => buildMembershipBaselineManifest(duplicate), /únicos/);
  });
});

describe("membership baseline CLI", () => {
  it("parsea opciones explícitas y rechaza modos, entornos y confirmaciones inseguras", () => {
    const parsed = parseMembershipBaselineArgs([
      "--mode=apply",
      "--environment",
      "development",
      "--database=agenda_dev",
      `--expected-target-fingerprint=${"a".repeat(64)}`,
      `--confirm=${MEMBERSHIP_BASELINE_CONFIRMATION}`,
    ]);
    assert.equal(parsed.mode, "apply");
    assert.equal(parsed.expectedTargetFingerprint, "a".repeat(64));

    assert.throws(
      () => validateMembershipBaselineOptions({ mode: "audit" }),
      /mode es obligatorio/,
    );
    assert.throws(
      () =>
        validateMembershipBaselineOptions({
          mode: "plan",
          environment: "production",
          database: "agenda",
          expectedTargetFingerprint: "a".repeat(64),
        }),
      /development o test/,
    );
    assert.throws(
      () =>
        validateMembershipBaselineOptions({
          mode: "apply",
          environment: "development",
          database: "agenda_dev",
          expectedTargetFingerprint: "a".repeat(64),
        }),
      /confirm/,
    );
    assert.throws(
      () =>
        validateMembershipBaselineOptions({
          mode: "plan",
          environment: "test",
          database: "agenda",
          expectedTargetFingerprint: "a".repeat(64),
        }),
      /terminar en "_test"/,
    );
  });

  it("rechaza un fingerprint incorrecto antes de conectar", async () => {
    let connected = false;
    await assert.rejects(
      runMembershipBaselineBootstrap({
        mongoUri: "mongodb://user:secret@cluster.example/ignored",
        options: {
          mode: "plan",
          environment: "development",
          database: "agenda_dev",
          expectedTargetFingerprint: "a".repeat(64),
        },
        environment: manifestEnvironment(),
        connect: async () => {
          connected = true;
        },
      }),
      /fingerprint/,
    );
    assert.equal(connected, false);
  });
});

describe("membership baseline preflight", () => {
  it("acepta una base vacía y declara la creación del índice como pendiente", () => {
    const manifest = buildMembershipBaselineManifest(manifestEnvironment());
    const plan = buildMembershipBaselinePlan(
      { observedCollections: [], businesses: [], users: [], memberships: [], indexes: [] },
      manifest,
    );

    assert.equal(plan.state, "empty");
    assert.equal(plan.canApply, true);
    assert.equal(plan.idempotentNoop, false);
    assert.equal(plan.membershipIndex.exactUniqueExists, false);
  });

  it("acepta las tres colecciones requeridas cuando existen pero están vacías", () => {
    const manifest = buildMembershipBaselineManifest(manifestEnvironment());
    const plan = buildMembershipBaselinePlan(
      {
        observedCollections: ["businesses", "memberships", "users"],
        businesses: [],
        users: [],
        memberships: [],
        indexes: [exactMembershipIndex()],
      },
      manifest,
    );

    assert.equal(plan.state, "empty");
    assert.equal(plan.canApply, true);
  });

  it("permite la colección técnica de lock vacía sin ocultar colecciones ajenas", () => {
    const manifest = buildMembershipBaselineManifest(manifestEnvironment());
    const technicalOnly = buildMembershipBaselinePlan(
      {
        observedCollections: [
          "businesses",
          "memberships",
          MEMBERSHIP_BASELINE_LOCK_COLLECTION,
          "users",
        ],
        businesses: [],
        users: [],
        memberships: [],
        indexes: [exactMembershipIndex()],
      },
      manifest,
    );
    assert.equal(technicalOnly.state, "empty");
    assert.equal(technicalOnly.canApply, true);

    const foreign = buildMembershipBaselinePlan(
      {
        observedCollections: [MEMBERSHIP_BASELINE_LOCK_COLLECTION, "orders"],
        businesses: [],
        users: [],
        memberships: [],
        indexes: [],
      },
      manifest,
    );
    assert.equal(foreign.state, "partial");
    assert.ok(foreign.findings.includes("unexpectedCollection:orders"));
  });

  it("reconoce una baseline completa como no-op idempotente", () => {
    const manifest = buildMembershipBaselineManifest(manifestEnvironment());
    const plan = buildMembershipBaselinePlan(readySource(manifest), manifest);

    assert.equal(plan.state, "ready");
    assert.equal(plan.canApply, true);
    assert.equal(plan.idempotentNoop, true);
    assert.deepEqual(plan.findings, []);
  });

  it("bloquea una base parcial, referencias string y un índice compuesto incorrecto", () => {
    const manifest = buildMembershipBaselineManifest(manifestEnvironment());
    const partial = readySource(manifest);
    partial.memberships.pop();
    partial.users[0].business = partial.users[0].business.toHexString();
    partial.indexes = [
      { name: "user_1_business_1", key: { user: 1, business: 1 }, unique: false },
    ];

    const plan = buildMembershipBaselinePlan(partial, manifest);
    assert.equal(plan.state, "partial");
    assert.equal(plan.canApply, false);
    assert.ok(plan.findings.includes("membershipCountMismatch"));
    assert.ok(plan.findings.includes("userMismatch:atmosfera-admin"));
    assert.ok(plan.findings.includes("conflictingMembershipIndex"));
  });

  it("bloquea documentos inesperados aunque las entidades esperadas sean coherentes", () => {
    const manifest = buildMembershipBaselineManifest(manifestEnvironment());
    const source = readySource(manifest);
    source.businesses.push({
      _id: new mongo.ObjectId(),
      name: "Extra",
      slug: "extra",
      isActive: true,
    });

    const plan = buildMembershipBaselinePlan(source, manifest);
    assert.equal(plan.state, "partial");
    assert.equal(plan.canApply, false);
    assert.ok(plan.findings.includes("businessCountMismatch"));
  });

  it("bloquea restauraciones incompletas y colecciones ajenas a una baseline limpia", () => {
    const manifest = buildMembershipBaselineManifest(manifestEnvironment());
    const incomplete = buildMembershipBaselinePlan(
      {
        observedCollections: ["memberships"],
        businesses: [],
        users: [],
        memberships: [],
        indexes: [exactMembershipIndex()],
      },
      manifest,
    );
    assert.equal(incomplete.canApply, false);
    assert.ok(incomplete.findings.includes("partialRequiredCollectionSet"));

    const unexpected = buildMembershipBaselinePlan(
      {
        observedCollections: ["sessions"],
        businesses: [],
        users: [],
        memberships: [],
        indexes: [],
      },
      manifest,
    );
    assert.equal(unexpected.canApply, false);
    assert.ok(unexpected.findings.includes("unexpectedCollection:sessions"));
  });

  it("calcula el fingerprint aprobado con la representación sanitizada del destino", () => {
    const fingerprint = fingerprintMongoTarget(
      "mongodb://user:secret@localhost:27017/ignored?retryWrites=true",
      "agenda_dev",
    );
    assert.match(fingerprint, /^[a-f0-9]{64}$/u);
  });
});

describe("membership baseline password verification", () => {
  it("declara ready sólo cuando las contraseñas suministradas verifican", async () => {
    const manifest = buildMembershipBaselineManifest(manifestEnvironment());
    const source = readySource(manifest);
    const plan = await buildVerifiedMembershipBaselinePlan(
      source,
      manifest,
      async () => true,
    );

    assert.equal(plan.state, "ready");
    assert.equal(plan.canApply, true);
    assert.deepEqual(plan.findings, []);
  });

  it("bloquea contraseñas distintas sin incluir secretos ni hashes en el plan", async () => {
    const manifest = buildMembershipBaselineManifest(manifestEnvironment());
    const source = readySource(manifest);
    const plan = await buildVerifiedMembershipBaselinePlan(
      source,
      manifest,
      async (plainPassword) => plainPassword !== manifest.users[0].password,
    );
    const serialized = JSON.stringify(plan);

    assert.equal(plan.state, "partial");
    assert.equal(plan.canApply, false);
    assert.ok(plan.findings.includes("passwordMismatch:atmosfera-admin"));
    for (const user of manifest.users) {
      assert.equal(serialized.includes(user.password), false);
    }
    assert.equal(serialized.includes(VALID_PASSWORD_HASH), false);
  });

  it("distingue hashes vacíos, inválidos y errores del verificador", async () => {
    const manifest = buildMembershipBaselineManifest(manifestEnvironment());
    const emptyHash = readySource(manifest);
    emptyHash.users[0].password = "";
    const invalidHash = readySource(manifest);
    invalidHash.users[1].password = "not-a-bcrypt-hash";
    const verifierError = readySource(manifest);

    assert.deepEqual(
      await verifyMembershipBaselinePasswords(
        emptyHash,
        manifest,
        async () => true,
      ),
      ["invalidPasswordHash:atmosfera-admin"],
    );
    assert.deepEqual(
      await verifyMembershipBaselinePasswords(
        invalidHash,
        manifest,
        async () => true,
      ),
      ["invalidPasswordHash:atmosfera-worker"],
    );
    const failures = await verifyMembershipBaselinePasswords(
      verifierError,
      manifest,
      async () => {
        throw new Error("secret verifier detail");
      },
    );
    assert.deepEqual(failures, manifest.users.map(
      (user) => `passwordVerificationError:${user.key}`,
    ).sort());
    assert.equal(JSON.stringify(failures).includes("secret verifier detail"), false);
  });
});

describe("membership baseline apply lock", () => {
  it("adquiere un lock inexistente con clave estable y expiración", async () => {
    let call;
    const ownerId = "owner-one";
    const db = {
      collection(name) {
        assert.equal(name, MEMBERSHIP_BASELINE_LOCK_COLLECTION);
        return {
          async findOneAndUpdate(filter, update, options) {
            call = { filter, update, options };
            return { _id: MEMBERSHIP_BASELINE_LOCK_KEY, ownerId };
          },
        };
      },
    };
    const now = new Date("2026-08-01T00:00:00.000Z");
    const lock = await acquireMembershipBaselineLock(db, {
      ownerId,
      now,
      ttlMs: 60_000,
    });

    assert.equal(call.filter._id, MEMBERSHIP_BASELINE_LOCK_KEY);
    assert.equal(call.options.upsert, true);
    assert.equal(call.options.returnDocument, "after");
    assert.equal(call.update.$set.ownerId, ownerId);
    assert.equal(lock.expiresAt.toISOString(), "2026-08-01T00:01:00.000Z");
  });

  it("rechaza un lock activo ajeno y permite recuperar uno expirado", async () => {
    const activeDb = {
      collection: () => ({
        findOneAndUpdate: async () => {
          const error = new Error("duplicate details");
          error.code = 11000;
          throw error;
        },
      }),
    };
    await assert.rejects(
      acquireMembershipBaselineLock(activeDb, { ownerId: "owner-two" }),
      /otra ejecución apply activa/,
    );

    let expiryFilter;
    const expiredDb = {
      collection: () => ({
        findOneAndUpdate: async (filter) => {
          expiryFilter = filter.$or[0].expiresAt.$lte;
          return { ownerId: "new-owner" };
        },
      }),
    };
    const now = new Date("2026-08-01T01:00:00.000Z");
    await acquireMembershipBaselineLock(expiredDb, {
      ownerId: "new-owner",
      now,
    });
    assert.deepEqual(expiryFilter, now);
  });

  it("libera únicamente el lock del owner correcto", async () => {
    const filters = [];
    const results = [1, 0];
    const db = {
      collection: () => ({
        deleteOne: async (filter) => {
          filters.push(filter);
          return { deletedCount: results.shift() };
        },
      }),
    };

    assert.equal(
      await releaseMembershipBaselineLock(db, { ownerId: "owner-one" }),
      true,
    );
    assert.equal(
      await releaseMembershipBaselineLock(db, { ownerId: "foreign-owner" }),
      false,
    );
    assert.deepEqual(filters, [
      { _id: MEMBERSHIP_BASELINE_LOCK_KEY, ownerId: "owner-one" },
      { _id: MEMBERSHIP_BASELINE_LOCK_KEY, ownerId: "foreign-owner" },
    ]);
  });

  it("plan no adquiere lock y apply lo libera en finally ante error", async () => {
    const uri = "mongodb://localhost:27017/agenda_dev";
    const expectedTargetFingerprint = fingerprintMongoTarget(uri, "agenda_dev");
    let acquired = 0;
    let released = 0;
    const observed = [];
    const db = {
      databaseName: "agenda_dev",
      listCollections: () => ({
        toArray: async () => observed.map((name) => ({ name })),
      }),
    };
    const common = {
      mongoUri: uri,
      environment: manifestEnvironment(),
      connect: async () => {},
      disconnect: async () => {},
      connection: { db },
      acquireLock: async () => {
        acquired += 1;
      },
      releaseLock: async () => {
        released += 1;
        return true;
      },
    };

    await runMembershipBaselineBootstrap({
      ...common,
      options: {
        mode: "plan",
        environment: "development",
        database: "agenda_dev",
        expectedTargetFingerprint,
      },
    });
    assert.equal(acquired, 0);
    assert.equal(released, 0);

    observed.push("foreign_collection");
    await assert.rejects(
      runMembershipBaselineBootstrap({
        ...common,
        options: {
          mode: "apply",
          environment: "development",
          database: "agenda_dev",
          expectedTargetFingerprint,
          confirm: MEMBERSHIP_BASELINE_CONFIRMATION,
        },
      }),
      /parcialmente inicializada/,
    );
    assert.equal(acquired, 1);
    assert.equal(released, 1);
  });

  it("password mismatch bloquea apply sin preparar almacenamiento ni documentos", async () => {
    const uri = "mongodb://localhost:27017/agenda_dev";
    const manifest = buildMembershipBaselineManifest(manifestEnvironment());
    let storageCalls = 0;
    let documentCalls = 0;
    let releaseCalls = 0;

    await assert.rejects(
      runMembershipBaselineBootstrap({
        mongoUri: uri,
        options: {
          mode: "apply",
          environment: "development",
          database: "agenda_dev",
          expectedTargetFingerprint: fingerprintMongoTarget(uri, "agenda_dev"),
          confirm: MEMBERSHIP_BASELINE_CONFIRMATION,
        },
        environment: manifestEnvironment(),
        connect: async () => {},
        disconnect: async () => {},
        connection: { db: { databaseName: "agenda_dev" } },
        acquireLock: async () => {},
        releaseLock: async () => {
          releaseCalls += 1;
          return true;
        },
        readSource: async () => readySource(manifest),
        passwordVerifier: async () => false,
        ensureBaselineStorage: async () => {
          storageCalls += 1;
        },
        createDocuments: async () => {
          documentCalls += 1;
        },
      }),
      /parcialmente inicializada/u,
    );
    assert.equal(storageCalls, 0);
    assert.equal(documentCalls, 0);
    assert.equal(releaseCalls, 1);
  });

  it("un fallo de verificación posterior devuelve resultado desconocido sin compensar", async () => {
    const uri = "mongodb://localhost:27017/agenda_dev";
    let reads = 0;
    let releases = 0;
    let writes = 0;

    await assert.rejects(
      runMembershipBaselineBootstrap({
        mongoUri: uri,
        options: {
          mode: "apply",
          environment: "development",
          database: "agenda_dev",
          expectedTargetFingerprint: fingerprintMongoTarget(uri, "agenda_dev"),
          confirm: MEMBERSHIP_BASELINE_CONFIRMATION,
        },
        environment: manifestEnvironment(),
        connect: async () => {},
        disconnect: async () => {},
        connection: { db: { databaseName: "agenda_dev" } },
        acquireLock: async () => {},
        releaseLock: async () => {
          releases += 1;
          return true;
        },
        readSource: async () => {
          reads += 1;
          if (reads === 1) {
            return {
              observedCollections: [],
              businesses: [],
              users: [],
              memberships: [],
              indexes: [],
            };
          }
          throw new Error("driver details must not escape");
        },
        ensureBaselineStorage: async () => {},
        createDocuments: async () => {
          writes += 1;
        },
      }),
      /ejecute --mode=plan antes de reintentar/u,
    );
    assert.equal(writes, 1);
    assert.equal(releases, 1);
  });
});
