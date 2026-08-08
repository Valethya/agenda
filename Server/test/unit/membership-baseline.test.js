import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mongo } from "mongoose";
import {
  acquireMembershipBaselineLock,
  assertMembershipBaselineLockOwnership,
  buildMembershipBaselineManifest,
  buildMembershipBaselineManifestFromOwners,
  buildMembershipBaselinePlan,
  buildVerifiedMembershipBaselinePlan,
  createBaselineDocuments,
  ensureCollectionsAndMembershipIndex,
  MEMBERSHIP_BASELINE_CONFIRMATION,
  MEMBERSHIP_BASELINE_LOCK_COLLECTION,
  MEMBERSHIP_BASELINE_LOCK_KEY,
  parseMembershipBaselineArgs,
  releaseMembershipBaselineLock,
  runMembershipBaselineBootstrap,
  validateMembershipBaselineOptions,
  validateMembershipBaselineRuntime,
  verifyMembershipBaselinePasswords,
} from "../../scripts/bootstrap/membership-baseline.js";
import { fingerprintMongoTarget } from "../../scripts/migrations/membership-authority-provenance.js";

const manifestEnvironment = () => ({
  BASELINE_ATMOSFERA_ADMIN_EMAIL: "admin-atmosfera@example.test",
  BASELINE_ATMOSFERA_ADMIN_PASSWORD: "atmosfera-admin-safe",
  BASELINE_DAM_ADMIN_EMAIL: "admin-dam@example.test",
  BASELINE_DAM_ADMIN_PASSWORD: "dam-admin-password",
});

const processEnvironment = (NODE_ENV, extra = {}) => ({ NODE_ENV, ...extra });

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
        { key: "dam:admin", role: "admin", isActive: true },
      ],
    );

    const plan = buildMembershipBaselinePlan(
      { observedCollections: [], businesses: [], users: [], memberships: [], indexes: [] },
      manifest,
    );
    assert.equal(JSON.stringify(plan).includes("example.test"), false);
    assert.equal(JSON.stringify(plan).includes("password"), false);
  });

  it("acepta en memoria dos propietarios administradores sin trabajadores artificiales", () => {
    const manifest = buildMembershipBaselineManifestFromOwners({
      atmosfera: {
        firstName: "Owner",
        lastName: "Atmósfera",
        email: "owner-atmosfera@example.test",
        password: "atmosfera-owner-safe",
      },
      dam: {
        firstName: "Owner",
        lastName: "DAM",
        email: "owner-dam@example.test",
        password: "dam-owner-password",
      },
    });

    assert.equal(manifest.users.length, 2);
    assert.equal(manifest.memberships.length, 2);
    assert.ok(manifest.users.every(({ role }) => role === "admin"));
    assert.ok(manifest.memberships.every(({ role }) => role === "admin"));
    assert.equal(JSON.stringify(manifest).includes("worker"), false);
  });

  it("rechaza credenciales ausentes, correos inválidos, contraseñas cortas y duplicados", () => {
    assert.throws(() => buildMembershipBaselineManifest({}), /obligatoria/);

    const invalidEmail = manifestEnvironment();
    invalidEmail.BASELINE_DAM_ADMIN_EMAIL = "invalid";
    assert.throws(
      () => buildMembershipBaselineManifest(invalidEmail),
      /correo.*no es válido/u,
    );

    const shortPassword = manifestEnvironment();
    shortPassword.BASELINE_DAM_ADMIN_PASSWORD = "short";
    assert.throws(
      () => buildMembershipBaselineManifest(shortPassword),
      /entre 12 y 256/u,
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
      () => parseMembershipBaselineArgs(["--mode=plan", "--mode=apply"]),
      /duplicada/u,
    );

    assert.throws(
      () => validateMembershipBaselineOptions({
        mode: "audit",
        environment: "development",
        database: "agenda_dev",
      }, processEnvironment("development")),
      /mode es obligatorio/,
    );
    assert.throws(
      () =>
        validateMembershipBaselineOptions({
          mode: "plan",
          environment: "production",
          database: "agenda",
          expectedTargetFingerprint: "a".repeat(64),
        }, processEnvironment("production")),
      /NODE_ENV/u,
    );
    assert.throws(
      () =>
        validateMembershipBaselineOptions({
          mode: "apply",
          environment: "development",
          database: "agenda_dev",
          expectedTargetFingerprint: "a".repeat(64),
        }, processEnvironment("development")),
      /confirm/,
    );
    assert.throws(
      () =>
        validateMembershipBaselineOptions({
          mode: "plan",
          environment: "test",
          database: "agenda",
          expectedTargetFingerprint: "a".repeat(64),
        }, processEnvironment("test")),
      /terminar en "_test"/,
    );
  });

  it("rechaza entornos efectivos ambiguos, despliegues y bases sin sufijo seguro", () => {
    const base = {
      mode: "plan",
      environment: "development",
      database: "agenda_dev",
      expectedTargetFingerprint: "a".repeat(64),
    };

    assert.throws(
      () => validateMembershipBaselineOptions(base, processEnvironment("production")),
      /NODE_ENV/u,
    );
    assert.throws(
      () => validateMembershipBaselineOptions(
        { ...base, environment: "staging" },
        processEnvironment("staging"),
      ),
      /NODE_ENV/u,
    );
    assert.throws(
      () => validateMembershipBaselineOptions(base, {}),
      /NODE_ENV/u,
    );
    assert.throws(
      () => validateMembershipBaselineOptions(base, processEnvironment("test")),
      /coincidir/u,
    );
    for (const indicator of ["RAILWAY_ENVIRONMENT", "VERCEL"]) {
      assert.throws(
        () => validateMembershipBaselineOptions(
          base,
          processEnvironment("development", { [indicator]: "active" }),
        ),
        /plataforma de despliegue/u,
      );
    }
    assert.throws(
      () => validateMembershipBaselineOptions(
        { ...base, database: "agenda" },
        processEnvironment("development"),
      ),
      /_dev/u,
    );
    assert.deepEqual(
      validateMembershipBaselineRuntime({
        requestedEnvironment: "development",
        database: "agenda_dev",
        processEnvironment: processEnvironment("development"),
      }),
      { effectiveEnvironment: "development" },
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
        processEnvironment: processEnvironment("development"),
        connect: async () => {
          connected = true;
        },
      }),
      /fingerprint/,
    );
    assert.equal(connected, false);
  });

  it("rechaza configuraciones de entorno inseguras antes de conectar", async () => {
    const uri = "mongodb://localhost:27017/agenda_dev";
    const baseOptions = {
      mode: "plan",
      environment: "development",
      database: "agenda_dev",
      expectedTargetFingerprint: fingerprintMongoTarget(uri, "agenda_dev"),
    };
    const cases = [
      { processEnvironment: processEnvironment("production") },
      { processEnvironment: processEnvironment("staging") },
      { processEnvironment: {} },
      { processEnvironment: processEnvironment("test") },
      { processEnvironment: processEnvironment("development", { RAILWAY_PROJECT_ID: "project" }) },
      { processEnvironment: processEnvironment("development", { VERCEL: "1" }) },
      {
        processEnvironment: processEnvironment("development"),
        options: { ...baseOptions, database: "agenda" },
      },
    ];

    for (const testCase of cases) {
      let connected = false;
      await assert.rejects(runMembershipBaselineBootstrap({
        mongoUri: uri,
        options: testCase.options ?? baseOptions,
        environment: manifestEnvironment(),
        processEnvironment: testCase.processEnvironment,
        connect: async () => { connected = true; },
      }));
      assert.equal(connected, false);
    }
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

  it("bloquea un índice diferente que ocupa el nombre físico requerido", () => {
    const manifest = buildMembershipBaselineManifest(manifestEnvironment());
    const source = {
      observedCollections: [],
      businesses: [],
      users: [],
      memberships: [],
      indexes: [
        { name: "user_1_business_1", key: { business: 1, user: 1 }, unique: true },
      ],
    };
    const plan = buildMembershipBaselinePlan(source, manifest);
    assert.equal(plan.state, "partial");
    assert.equal(plan.canApply, false);
    assert.equal(plan.membershipIndex.conflictingNameExists, true);
    assert.ok(plan.findings.includes("conflictingMembershipIndexName"));
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
      ["invalidPasswordHash:dam-admin"],
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

describe("membership baseline controlled mutation failures", () => {
  it("comprueba propiedad antes de crear colecciones e índice", async () => {
    const calls = [];
    const db = {
      createCollection: async (name) => { calls.push(`collection:${name}`); },
      collection: (name) => ({
        listIndexes: () => ({ toArray: async () => [] }),
        createIndex: async () => { calls.push(`index:${name}`); },
      }),
    };
    let guards = 0;
    await ensureCollectionsAndMembershipIndex(db, {
      observedCollections: [],
    }, {
      assertOwnership: async () => { guards += 1; },
    });
    assert.equal(guards, 4);
    assert.deepEqual(calls, [
      "collection:businesses",
      "collection:memberships",
      "collection:users",
      "index:memberships",
    ]);
  });

  it("propaga fallos controlados al crear colecciones o el índice", async () => {
    for (const failingCollection of ["businesses", "memberships", "users"]) {
      const db = {
        createCollection: async (name) => {
          if (name === failingCollection) throw new Error(`collection:${name}`);
        },
        collection: () => ({
          listIndexes: () => ({ toArray: async () => [] }),
          createIndex: async () => {},
        }),
      };
      await assert.rejects(
        ensureCollectionsAndMembershipIndex(db, { observedCollections: [] }),
        new RegExp(`collection:${failingCollection}`, "u"),
      );
    }

    const indexDb = {
      collection: () => ({
        listIndexes: () => ({ toArray: async () => [] }),
        createIndex: async () => { throw new Error("index:create"); },
      }),
    };
    await assert.rejects(
      ensureCollectionsAndMembershipIndex(indexDb, {
        observedCollections: ["businesses", "memberships", "users"],
      }),
      /index:create/u,
    );
  });

  it("interrumpe inserciones en cualquier colección sin compensación destructiva", async () => {
    const manifest = buildMembershipBaselineManifest(manifestEnvironment());
    for (const failingCollection of ["businesses", "users", "memberships"]) {
      const inserted = [];
      const db = {
        collection: (name) => ({
          insertMany: async (documents) => {
            if (name === failingCollection) throw new Error(`driver:${name}`);
            inserted.push({ name, count: documents.length });
          },
        }),
      };
      await assert.rejects(
        createBaselineDocuments(db, manifest, async () => VALID_PASSWORD_HASH, {
          assertOwnership: async () => true,
        }),
        new RegExp(`driver:${failingCollection}`, "u"),
      );
      assert.equal(inserted.some(({ name }) => name === failingCollection), false);
      assert.ok(inserted.every(({ count }) => count === 2));
    }
  });

  it("detiene la siguiente mutación si se pierde la propiedad durante las inserciones", async () => {
    const manifest = buildMembershipBaselineManifest(manifestEnvironment());
    const inserted = [];
    let guards = 0;
    const db = {
      collection: (name) => ({
        insertMany: async () => { inserted.push(name); },
      }),
    };

    await assert.rejects(
      createBaselineDocuments(db, manifest, async () => VALID_PASSWORD_HASH, {
        assertOwnership: async () => {
          guards += 1;
          if (guards === 2) throw new Error("lock ownership lost");
        },
      }),
      /ownership lost/u,
    );
    assert.deepEqual(inserted, ["businesses"]);
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
          async insertOne(document) {
            call = document;
            return { acknowledged: true };
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

    assert.equal(call._id, MEMBERSHIP_BASELINE_LOCK_KEY);
    assert.equal(call.ownerId, ownerId);
    assert.equal(call.expiresAt, "2026-08-01T00:01:00.000Z");
    assert.equal(call.recoveryPolicy, "manual-after-owner-termination");
    assert.equal(lock.expiresAt.toISOString(), "2026-08-01T00:01:00.000Z");
  });

  it("rechaza locks ajenos incluso vencidos; nunca los recupera automáticamente", async () => {
    const activeDb = {
      collection: () => ({
        insertOne: async () => {
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

    await assert.rejects(
      acquireMembershipBaselineLock(activeDb, {
        ownerId: "new-owner",
        now: new Date("2030-08-01T01:00:00.000Z"),
      }),
      /otra ejecución apply activa/,
    );
  });

  it("comprueba la propiedad del lock antes de permitir una mutación", async () => {
    const dbFor = (ownerId) => ({
      collection: () => ({
        findOne: async () => ({ ownerId }),
      }),
    });
    assert.equal(
      await assertMembershipBaselineLockOwnership(
        dbFor("owner-one"),
        { ownerId: "owner-one" },
      ),
      true,
    );
    await assert.rejects(
      assertMembershipBaselineLockOwnership(
        dbFor("owner-two"),
        { ownerId: "owner-one" },
      ),
      /perdió la propiedad/u,
    );
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
      processEnvironment: processEnvironment("development"),
      connect: async () => {},
      disconnect: async () => {},
      connection: { db },
      acquireLock: async () => {
        acquired += 1;
      },
      assertLockOwner: async () => true,
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
        processEnvironment: processEnvironment("development"),
        connect: async () => {},
        disconnect: async () => {},
        connection: { db: { databaseName: "agenda_dev" } },
        acquireLock: async () => {},
        assertLockOwner: async () => true,
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
        processEnvironment: processEnvironment("development"),
        connect: async () => {},
        disconnect: async () => {},
        connection: { db: { databaseName: "agenda_dev" } },
        acquireLock: async () => {},
        assertLockOwner: async () => true,
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

  it("fallos de almacenamiento, liberación y cierre nunca informan éxito", async () => {
    const uri = "mongodb://localhost:27017/agenda_dev";
    const manifest = buildMembershipBaselineManifest(manifestEnvironment());
    const emptySource = {
      observedCollections: [],
      businesses: [],
      users: [],
      memberships: [],
      indexes: [],
    };
    const base = {
      mongoUri: uri,
      options: {
        mode: "apply",
        environment: "development",
        database: "agenda_dev",
        expectedTargetFingerprint: fingerprintMongoTarget(uri, "agenda_dev"),
        confirm: MEMBERSHIP_BASELINE_CONFIRMATION,
      },
      environment: manifestEnvironment(),
      processEnvironment: processEnvironment("development"),
      connect: async () => {},
      connection: { db: { databaseName: "agenda_dev" } },
      acquireLock: async () => {},
      assertLockOwner: async () => true,
      readSource: async () => emptySource,
    };
    const successfulReads = () => {
      let reads = 0;
      return async () => ++reads === 1 ? emptySource : readySource(manifest);
    };

    for (const stage of ["createCollections", "createIndex"]) {
      await assert.rejects(
        runMembershipBaselineBootstrap({
          ...base,
          disconnect: async () => {},
          releaseLock: async () => true,
          ensureBaselineStorage: async () => { throw new Error(stage); },
          createDocuments: async () => assert.fail("no debe insertar"),
        }),
        /ejecute --mode=plan antes de reintentar/u,
      );
    }

    await assert.rejects(
      runMembershipBaselineBootstrap({
        ...base,
        disconnect: async () => {},
        releaseLock: async () => false,
        ensureBaselineStorage: async () => {},
        createDocuments: async () => {},
        readSource: successfulReads(),
        passwordVerifier: async () => true,
      }),
      /ejecute --mode=plan antes de reintentar/u,
    );

    await assert.rejects(
      runMembershipBaselineBootstrap({
        ...base,
        disconnect: async () => { throw new Error("close failed"); },
        releaseLock: async () => true,
        ensureBaselineStorage: async () => {},
        createDocuments: async () => {},
        readSource: successfulReads(),
        passwordVerifier: async () => true,
      }),
      /ejecute --mode=plan antes de reintentar/u,
    );
  });
});
