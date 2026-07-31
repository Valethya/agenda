import "dotenv/config";

import path from "node:path";
import { pathToFileURL } from "node:url";
import mongoose, { mongo } from "mongoose";
import { createHash as hashPassword } from "../../src/utils/password.js";
import { isExactMembershipUniqueIndex } from "../migrations/membership-authority-audit.js";
import {
  fingerprintMongoTarget,
  sanitizeAuditErrorMessage,
  validateTargetFingerprint,
} from "../migrations/membership-authority-provenance.js";

export const MEMBERSHIP_BASELINE_BOOTSTRAP_VERSION = "1.0.0";
export const MEMBERSHIP_BASELINE_CONFIRMATION = "CREATE_MEMBERSHIP_BASELINE";

export const MEMBERSHIP_BASELINE_COLLECTIONS = Object.freeze([
  "businesses",
  "memberships",
  "users",
]);

const ALLOWED_ENVIRONMENTS = new Set(["development", "test"]);
const RESERVED_DATABASES = new Set(["admin", "config", "local"]);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

const BASELINE_DEFINITION = Object.freeze([
  {
    key: "atmosfera",
    name: "Atmósfera",
    slug: "atmosfera",
    identities: [
      {
        key: "atmosfera-admin",
        firstName: "Administración",
        lastName: "Atmósfera",
        role: "admin",
        emailVariable: "BASELINE_ATMOSFERA_ADMIN_EMAIL",
        passwordVariable: "BASELINE_ATMOSFERA_ADMIN_PASSWORD",
      },
      {
        key: "atmosfera-worker",
        firstName: "Profesional",
        lastName: "Atmósfera",
        role: "worker",
        emailVariable: "BASELINE_ATMOSFERA_WORKER_EMAIL",
        passwordVariable: "BASELINE_ATMOSFERA_WORKER_PASSWORD",
      },
    ],
  },
  {
    key: "dam",
    name: "DAM",
    slug: "dam",
    identities: [
      {
        key: "dam-admin",
        firstName: "Administración",
        lastName: "DAM",
        role: "admin",
        emailVariable: "BASELINE_DAM_ADMIN_EMAIL",
        passwordVariable: "BASELINE_DAM_ADMIN_PASSWORD",
      },
      {
        key: "dam-worker",
        firstName: "Profesional",
        lastName: "DAM",
        role: "worker",
        emailVariable: "BASELINE_DAM_WORKER_EMAIL",
        passwordVariable: "BASELINE_DAM_WORKER_PASSWORD",
      },
    ],
  },
]);

const requireEnvironmentValue = (environment, variable) => {
  const value = environment[variable];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`La variable ${variable} es obligatoria`);
  }
  return value.trim();
};

export const buildMembershipBaselineManifest = (environment = process.env) => {
  const businesses = BASELINE_DEFINITION.map((definition) => ({
    key: definition.key,
    name: definition.name,
    slug: definition.slug,
    isActive: true,
  }));

  const users = BASELINE_DEFINITION.flatMap((definition) =>
    definition.identities.map((identity) => {
      const email = requireEnvironmentValue(
        environment,
        identity.emailVariable,
      ).toLowerCase();
      const password = requireEnvironmentValue(
        environment,
        identity.passwordVariable,
      );

      if (!EMAIL_PATTERN.test(email)) {
        throw new Error(`La variable ${identity.emailVariable} no es un correo válido`);
      }
      if (password.length < 12) {
        throw new Error(
          `La variable ${identity.passwordVariable} debe tener al menos 12 caracteres`,
        );
      }

      return {
        key: identity.key,
        businessKey: definition.key,
        firstName: identity.firstName,
        lastName: identity.lastName,
        email,
        password,
        role: identity.role,
        isActive: true,
      };
    }),
  );

  const uniqueEmails = new Set(users.map((user) => user.email));
  if (uniqueEmails.size !== users.length) {
    throw new Error("Los correos de la baseline deben ser únicos");
  }

  const memberships = users.map((user) => ({
    key: `${user.businessKey}:${user.role}`,
    userKey: user.key,
    businessKey: user.businessKey,
    role: user.role,
    isActive: true,
  }));

  return {
    version: MEMBERSHIP_BASELINE_BOOTSTRAP_VERSION,
    businesses,
    users,
    memberships,
  };
};

export const parseMembershipBaselineArgs = (argv) => {
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
    if (!argument.startsWith("--")) {
      throw new Error(`Argumento no reconocido: ${argument}`);
    }

    const separator = argument.indexOf("=");
    const key = separator === -1 ? argument.slice(2) : argument.slice(2, separator);
    if (!allowed.has(key)) throw new Error(`Opción no reconocida: --${key}`);

    const inlineValue = separator === -1 ? undefined : argument.slice(separator + 1);
    const value = inlineValue ?? argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Falta valor para --${key}`);
    }

    const optionName =
      key === "expected-target-fingerprint" ? "expectedTargetFingerprint" : key;
    options[optionName] = value;
    if (inlineValue === undefined) index += 1;
  }

  return options;
};

export const validateMembershipBaselineOptions = (options) => {
  if (!options.mode || !["plan", "apply"].includes(options.mode)) {
    throw new Error('--mode es obligatorio y sólo acepta "plan" o "apply"');
  }
  if (!ALLOWED_ENVIRONMENTS.has(options.environment)) {
    throw new Error(
      "--environment sólo acepta development o test para esta baseline preproductiva",
    );
  }
  if (
    typeof options.database !== "string" ||
    !/^[a-zA-Z0-9_-]+$/u.test(options.database) ||
    RESERVED_DATABASES.has(options.database)
  ) {
    throw new Error("--database es obligatorio y debe identificar una base permitida");
  }
  if (options.environment === "test" && !options.database.endsWith("_test")) {
    throw new Error('En test, --database debe terminar en "_test"');
  }

  options.expectedTargetFingerprint = validateTargetFingerprint(
    options.expectedTargetFingerprint,
  );

  if (
    options.mode === "apply" &&
    options.confirm !== MEMBERSHIP_BASELINE_CONFIRMATION
  ) {
    throw new Error(
      `El modo apply exige --confirm=${MEMBERSHIP_BASELINE_CONFIRMATION}`,
    );
  }

  return options;
};

const hasExactCompoundKey = (index) => {
  const entries = Object.entries(index?.key ?? {});
  return (
    entries.length === 2 &&
    entries[0]?.[0] === "user" &&
    entries[0]?.[1] === 1 &&
    entries[1]?.[0] === "business" &&
    entries[1]?.[1] === 1
  );
};

const isObjectId = (value) => value instanceof mongo.ObjectId;
const objectIdKey = (value) => (isObjectId(value) ? value.toHexString() : null);
const emailKey = (value) =>
  Array.isArray(value) && value.length === 1 && typeof value[0] === "string"
    ? value[0].toLowerCase()
    : null;

export const buildMembershipBaselinePlan = (source, manifest) => {
  const businesses = source.businesses ?? [];
  const users = source.users ?? [];
  const memberships = source.memberships ?? [];
  const indexes = source.indexes ?? [];
  const findings = [];
  const observedCollections = [...(source.observedCollections ?? [])].sort();
  const requiredCollections = new Set(MEMBERSHIP_BASELINE_COLLECTIONS);
  const observedRequiredCollections = observedCollections.filter((collection) =>
    requiredCollections.has(collection),
  );
  const unexpectedCollections = observedCollections.filter(
    (collection) => !requiredCollections.has(collection),
  );

  if (
    observedRequiredCollections.length !== 0 &&
    observedRequiredCollections.length !== MEMBERSHIP_BASELINE_COLLECTIONS.length
  ) {
    findings.push("partialRequiredCollectionSet");
  }
  for (const collection of unexpectedCollections) {
    findings.push(`unexpectedCollection:${collection}`);
  }

  const empty =
    businesses.length === 0 && users.length === 0 && memberships.length === 0;
  const expectedBusinessByKey = new Map(
    manifest.businesses.map((business) => [business.key, business]),
  );
  const expectedUserByKey = new Map(manifest.users.map((user) => [user.key, user]));
  const observedBusinessByKey = new Map();
  const observedUserByKey = new Map();

  if (!empty) {
    if (businesses.length !== manifest.businesses.length) {
      findings.push("businessCountMismatch");
    }
    if (users.length !== manifest.users.length) findings.push("userCountMismatch");
    if (memberships.length !== manifest.memberships.length) {
      findings.push("membershipCountMismatch");
    }

    for (const expected of manifest.businesses) {
      const matches = businesses.filter((business) => business.slug === expected.slug);
      if (matches.length !== 1) {
        findings.push(`businessMismatch:${expected.key}`);
        continue;
      }
      const observed = matches[0];
      if (
        !isObjectId(observed._id) ||
        observed.name !== expected.name ||
        observed.isActive !== true
      ) {
        findings.push(`businessMismatch:${expected.key}`);
        continue;
      }
      observedBusinessByKey.set(expected.key, observed);
    }

    for (const expected of manifest.users) {
      const matches = users.filter((user) => emailKey(user.email) === expected.email);
      if (matches.length !== 1) {
        findings.push(`userMismatch:${expected.key}`);
        continue;
      }
      const observed = matches[0];
      const expectedBusiness = observedBusinessByKey.get(expected.businessKey);
      if (
        !isObjectId(observed._id) ||
        !expectedBusiness ||
        objectIdKey(observed.business) !== objectIdKey(expectedBusiness._id) ||
        observed.firstName !== expected.firstName ||
        observed.lastName !== expected.lastName ||
        observed.role !== expected.role ||
        observed.isActive !== true ||
        typeof observed.password !== "string" ||
        observed.password.length === 0
      ) {
        findings.push(`userMismatch:${expected.key}`);
        continue;
      }
      observedUserByKey.set(expected.key, observed);
    }

    for (const expected of manifest.memberships) {
      const expectedUser = observedUserByKey.get(expected.userKey);
      const expectedBusiness = observedBusinessByKey.get(expected.businessKey);
      const matches = memberships.filter(
        (membership) =>
          expectedUser &&
          expectedBusiness &&
          objectIdKey(membership.user) === objectIdKey(expectedUser._id) &&
          objectIdKey(membership.business) === objectIdKey(expectedBusiness._id),
      );
      if (
        matches.length !== 1 ||
        !isObjectId(matches[0]?._id) ||
        matches[0]?.role !== expected.role ||
        matches[0]?.isActive !== true
      ) {
        findings.push(`membershipMismatch:${expected.key}`);
      }
    }

    for (const expected of manifest.businesses) {
      const business = observedBusinessByKey.get(expected.key);
      const admin = observedUserByKey.get(`${expected.key}-admin`);
      if (
        !business ||
        !admin ||
        objectIdKey(business.owner) !== objectIdKey(admin._id)
      ) {
        findings.push(`ownerMismatch:${expected.key}`);
      }
    }
  }

  const exactUniqueIndex = indexes.some(isExactMembershipUniqueIndex);
  const conflictingCompoundIndex = indexes.some(
    (index) => hasExactCompoundKey(index) && !isExactMembershipUniqueIndex(index),
  );
  if (conflictingCompoundIndex) findings.push("conflictingMembershipIndex");

  const uniqueFindings = [...new Set(findings)].sort();
  const dataMatches = !empty && uniqueFindings.every(
    (finding) => finding === "conflictingMembershipIndex",
  );
  const hasStructuralFinding = uniqueFindings.some(
    (finding) => finding !== "conflictingMembershipIndex",
  );
  const state = hasStructuralFinding
    ? "partial"
    : empty
      ? "empty"
      : dataMatches
        ? "ready"
        : "partial";
  const blocking = state === "partial" || conflictingCompoundIndex;

  return {
    version: manifest.version,
    state,
    canApply: !blocking,
    idempotentNoop: state === "ready" && exactUniqueIndex,
    expectedCollections: [...MEMBERSHIP_BASELINE_COLLECTIONS],
    observedCollections,
    counts: {
      businesses: businesses.length,
      users: users.length,
      memberships: memberships.length,
    },
    membershipIndex: {
      exactUniqueExists: exactUniqueIndex,
      conflictingDefinitionExists: conflictingCompoundIndex,
    },
    findings: uniqueFindings,
  };
};

export const readMembershipBaselineSource = async (db) => {
  const observedCollections = (await db.listCollections({}, { nameOnly: true }).toArray())
    .map((collection) => collection.name)
    .sort();
  const has = (name) => observedCollections.includes(name);

  const [businesses, users, memberships, indexes] = await Promise.all([
    has("businesses")
      ? db.collection("businesses").find({}).toArray()
      : [],
    has("users")
      ? db.collection("users").find({}).toArray()
      : [],
    has("memberships")
      ? db.collection("memberships").find({}).toArray()
      : [],
    has("memberships")
      ? db.collection("memberships").listIndexes().toArray()
      : [],
  ]);

  return { observedCollections, businesses, users, memberships, indexes };
};

const ensureCollectionsAndMembershipIndex = async (db, source) => {
  const observed = new Set(source.observedCollections);
  for (const collection of MEMBERSHIP_BASELINE_COLLECTIONS) {
    if (!observed.has(collection)) await db.createCollection(collection);
  }

  const indexes = await db.collection("memberships").listIndexes().toArray();
  if (!indexes.some(isExactMembershipUniqueIndex)) {
    await db.collection("memberships").createIndex(
      { user: 1, business: 1 },
      { unique: true, name: "user_1_business_1" },
    );
  }
};

const createBaselineDocuments = async (db, manifest, passwordHasher) => {
  const now = new Date();
  const businessIds = new Map(
    manifest.businesses.map((business) => [business.key, new mongo.ObjectId()]),
  );
  const userIds = new Map(
    manifest.users.map((user) => [user.key, new mongo.ObjectId()]),
  );
  const membershipIds = manifest.memberships.map(() => new mongo.ObjectId());
  const passwordHashes = new Map();

  for (const user of manifest.users) {
    passwordHashes.set(user.key, await passwordHasher(user.password));
  }

  const businesses = manifest.businesses.map((business) => ({
    _id: businessIds.get(business.key),
    name: business.name,
    slug: business.slug,
    isActive: true,
    subscriptionStatus: "active",
    owner: userIds.get(`${business.key}-admin`),
    createdAt: now,
    updatedAt: now,
  }));
  const users = manifest.users.map((user) => ({
    _id: userIds.get(user.key),
    firstName: user.firstName,
    lastName: user.lastName,
    email: [user.email],
    password: passwordHashes.get(user.key),
    role: user.role,
    business: businessIds.get(user.businessKey),
    phone: [],
    isActive: true,
    createdAt: now,
    updatedAt: now,
  }));
  const memberships = manifest.memberships.map((membership, index) => ({
    _id: membershipIds[index],
    user: userIds.get(membership.userKey),
    business: businessIds.get(membership.businessKey),
    role: membership.role,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  }));

  try {
    await db.collection("businesses").insertMany(businesses, { ordered: true });
    await db.collection("users").insertMany(users, { ordered: true });
    await db.collection("memberships").insertMany(memberships, { ordered: true });
  } catch (error) {
    await db.collection("memberships").deleteMany({ _id: { $in: membershipIds } });
    await db.collection("users").deleteMany({ _id: { $in: [...userIds.values()] } });
    await db
      .collection("businesses")
      .deleteMany({ _id: { $in: [...businessIds.values()] } });
    throw error;
  }
};

export const runMembershipBaselineBootstrap = async ({
  mongoUri,
  options,
  environment = process.env,
  connect = mongoose.connect.bind(mongoose),
  disconnect = mongoose.disconnect.bind(mongoose),
  connection = mongoose.connection,
  passwordHasher = hashPassword,
}) => {
  const validatedOptions = validateMembershipBaselineOptions({ ...options });
  const manifest = buildMembershipBaselineManifest(environment);
  if (!mongoUri) throw new Error("MONGO_URI es obligatoria");

  const observedFingerprint = fingerprintMongoTarget(
    mongoUri,
    validatedOptions.database,
  );
  if (observedFingerprint !== validatedOptions.expectedTargetFingerprint) {
    throw new Error(
      "El fingerprint del destino MongoDB no coincide con el destino aprobado",
    );
  }

  let connected = false;
  try {
    await connect(mongoUri, {
      dbName: validatedOptions.database,
      autoIndex: false,
    });
    connected = true;

    const actualDatabase = connection.db?.databaseName;
    if (actualDatabase !== validatedOptions.database) {
      throw new Error("La base conectada no coincide con la base confirmada");
    }

    let source = await readMembershipBaselineSource(connection.db);
    let plan = buildMembershipBaselinePlan(source, manifest);
    if (validatedOptions.mode === "plan") {
      return { plan, applied: false, exitCode: plan.canApply ? 0 : 2 };
    }
    if (!plan.canApply) {
      throw new Error(
        "Bootstrap bloqueado: la base está parcialmente inicializada o contiene contradicciones",
      );
    }
    if (plan.idempotentNoop) {
      return { plan, applied: false, exitCode: 0 };
    }

    source = await readMembershipBaselineSource(connection.db);
    plan = buildMembershipBaselinePlan(source, manifest);
    if (!plan.canApply) {
      throw new Error("Bootstrap bloqueado: el estado cambió después del preflight");
    }

    await ensureCollectionsAndMembershipIndex(connection.db, source);
    if (plan.state === "empty") {
      await createBaselineDocuments(connection.db, manifest, passwordHasher);
    }

    const verificationSource = await readMembershipBaselineSource(connection.db);
    const verification = buildMembershipBaselinePlan(verificationSource, manifest);
    if (verification.state !== "ready" || !verification.idempotentNoop) {
      throw new Error("La verificación posterior del bootstrap no resultó segura");
    }

    return { plan: verification, applied: true, exitCode: 0 };
  } finally {
    if (connected) await disconnect();
  }
};

const usage = () => {
  console.log(`Uso:
  npm run bootstrap:membership-baseline -- \\
    --mode=plan|apply \\
    --environment=development \\
    --database=agenda_dev \\
    --expected-target-fingerprint=<sha256-aprobado> \\
    [--confirm=${MEMBERSHIP_BASELINE_CONFIRMATION}]

El comando sólo admite development y test. Nunca se ejecuta durante el arranque.`);
};

export const main = async (argv = process.argv.slice(2)) => {
  const options = parseMembershipBaselineArgs(argv);
  if (options.help) {
    usage();
    return 0;
  }

  const result = await runMembershipBaselineBootstrap({
    mongoUri: process.env.MONGO_URI,
    options,
  });
  console.log(`Bootstrap Membership baseline ${options.mode} completado.`);
  console.log(`Estado: ${result.plan.state}`);
  console.log(`Aplicado: ${result.applied}`);
  console.log(`Índice físico exacto: ${result.plan.membershipIndex.exactUniqueExists}`);
  console.log(`Hallazgos bloqueantes: ${result.plan.findings.length}`);
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
      const sensitiveValues = BASELINE_DEFINITION.flatMap((business) =>
        business.identities.flatMap((identity) => [
          process.env[identity.emailVariable],
          process.env[identity.passwordVariable],
        ]),
      ).filter(Boolean);
      let message = sanitizeAuditErrorMessage(error, process.env.MONGO_URI);
      for (const value of sensitiveValues) {
        message = message.split(value).join("[REDACTED]");
      }
      console.error(`Bootstrap Membership rechazado: ${message}`);
      process.exitCode = 1;
    });
}
