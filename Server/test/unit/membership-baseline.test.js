import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mongo } from "mongoose";
import {
  buildMembershipBaselineManifest,
  buildMembershipBaselinePlan,
  MEMBERSHIP_BASELINE_CONFIRMATION,
  parseMembershipBaselineArgs,
  runMembershipBaselineBootstrap,
  validateMembershipBaselineOptions,
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
    password: "hash",
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
