import "dotenv/config";

import { createHash as createNodeHash, randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import mongoose, { mongo } from "mongoose";
import {
  createHash as hashPassword,
  isValidPassword,
} from "../../src/utils/password.js";
import { isExactMembershipUniqueIndex } from "../migrations/membership-authority-audit.js";
import {
  fingerprintMongoTarget,
  validateTargetFingerprint,
} from "../migrations/membership-authority-provenance.js";

export const MEMBERSHIP_BASELINE_BOOTSTRAP_VERSION = "2.0.0";
export const MEMBERSHIP_BASELINE_CONFIRMATION = "CREATE_MEMBERSHIP_BASELINE";
export const MEMBERSHIP_BASELINE_LOCK_COLLECTION =
  "membership_baseline_locks";
export const MEMBERSHIP_BASELINE_LOCK_KEY = "membership-baseline-v1";
export const MEMBERSHIP_BASELINE_LOCK_TTL_MS = 30 * 60 * 1000;

export const MEMBERSHIP_BASELINE_COLLECTIONS = Object.freeze([
  "businesses",
  "memberships",
  "users",
]);

const ALLOWED_ENVIRONMENTS = new Set(["development", "test"]);
const RESERVED_DATABASES = new Set(["admin", "config", "local"]);
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
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const PASSWORD_HASH_PATTERN = /^\$2[abxy]\$\d{2}\$[./A-Za-z0-9]{53}$/u;

const BASELINE_DEFINITION = Object.freeze([
  {
    key: "atmosfera",
    name: "Atmósfera",
    slug: "atmosfera",
    identity: {
      key: "atmosfera-admin",
      firstName: "Administración",
      lastName: "Atmósfera",
      role: "admin",
      emailVariable: "BASELINE_ATMOSFERA_ADMIN_EMAIL",
      passwordVariable: "BASELINE_ATMOSFERA_ADMIN_PASSWORD",
    },
  },
  {
    key: "dam",
    name: "DAM",
    slug: "dam",
    identity: {
      key: "dam-admin",
      firstName: "Administración",
      lastName: "DAM",
      role: "admin",
      emailVariable: "BASELINE_DAM_ADMIN_EMAIL",
      passwordVariable: "BASELINE_DAM_ADMIN_PASSWORD",
    },
  },
]);

const requireEnvironmentValue = (environment, variable) => {
  const value = environment[variable];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`La variable ${variable} es obligatoria`);
  }
  return value.trim();
};

const validateOwnerInput = (owner, definition) => {
  if (!owner || typeof owner !== "object" || Array.isArray(owner)) {
    throw new Error(`Los datos del propietario ${definition.key} son obligatorios`);
  }

  const firstName = typeof owner.firstName === "string" ? owner.firstName.trim() : "";
  const lastName = typeof owner.lastName === "string" ? owner.lastName.trim() : "";
  const email = typeof owner.email === "string" ? owner.email.trim().toLowerCase() : "";
  const password = typeof owner.password === "string" ? owner.password : "";

  if (!firstName || firstName.length > 80) {
    throw new Error(`El nombre del propietario ${definition.key} no es válido`);
  }
  if (!lastName || lastName.length > 80) {
    throw new Error(`El apellido del propietario ${definition.key} no es válido`);
  }
  if (!EMAIL_PATTERN.test(email) || email.length > 254) {
    throw new Error(`El correo del propietario ${definition.key} no es válido`);
  }
  if (password.length < 12 || password.length > 256) {
    throw new Error(
      `La contraseña del propietario ${definition.key} debe tener entre 12 y 256 caracteres`,
    );
  }

  return { firstName, lastName, email, password };
};

export const buildMembershipBaselineManifestFromOwners = (owners) => {
  const businesses = BASELINE_DEFINITION.map((definition) => ({
    key: definition.key,
    name: definition.name,
    slug: definition.slug,
    isActive: true,
  }));

  const users = BASELINE_DEFINITION.map((definition) => {
    const identity = definition.identity;
    const owner = validateOwnerInput(owners?.[definition.key], definition);
    return {
      key: identity.key,
      businessKey: definition.key,
      ...owner,
      role: identity.role,
      isActive: true,
    };
  });

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

export const buildMembershipBaselineManifest = (environment = process.env) => {
  const owners = Object.fromEntries(
    BASELINE_DEFINITION.map((definition) => {
      const identity = definition.identity;
      return [
        definition.key,
        {
          firstName: identity.firstName,
          lastName: identity.lastName,
          email: requireEnvironmentValue(environment, identity.emailVariable),
          password: requireEnvironmentValue(environment, identity.passwordVariable),
        },
      ];
    }),
  );
  return buildMembershipBaselineManifestFromOwners(owners);
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
    if (Object.hasOwn(options, optionName)) {
      throw new Error(`Opción duplicada: --${key}`);
    }
    options[optionName] = value;
    if (inlineValue === undefined) index += 1;
  }

  return options;
};

const hasEnvironmentValue = (value) =>
  value !== undefined && value !== null && String(value).trim() !== "";

export const validateMembershipBaselineRuntime = ({
  requestedEnvironment,
  database,
  processEnvironment = process.env,
}) => {
  const effectiveEnvironment = processEnvironment?.NODE_ENV;
  if (!ALLOWED_ENVIRONMENTS.has(effectiveEnvironment)) {
    throw new Error(
      "NODE_ENV debe existir y ser literalmente development o test",
    );
  }
  if (requestedEnvironment !== effectiveEnvironment) {
    throw new Error(
      "El entorno solicitado debe coincidir exactamente con NODE_ENV",
    );
  }

  const deploymentIndicator = DEPLOYMENT_ENVIRONMENT_INDICATORS.find((name) =>
    hasEnvironmentValue(processEnvironment?.[name]),
  );
  if (deploymentIndicator) {
    throw new Error(
      "El bootstrap local no puede ejecutarse dentro de una plataforma de despliegue",
    );
  }

  const requiredSuffix = effectiveEnvironment === "test" ? "_test" : "_dev";
  if (typeof database !== "string" || !database.endsWith(requiredSuffix)) {
    throw new Error(
      `En ${effectiveEnvironment}, --database debe terminar en "${requiredSuffix}"`,
    );
  }

  return { effectiveEnvironment };
};

export const validateMembershipBaselineOptions = (
  options,
  processEnvironment = process.env,
) => {
  validateMembershipBaselineRuntime({
    requestedEnvironment: options.environment,
    database: options.database,
    processEnvironment,
  });
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

export const buildMembershipBaselinePlan = (
  source,
  manifest,
  { credentialFindings = [] } = {},
) => {
  const businesses = source.businesses ?? [];
  const users = source.users ?? [];
  const memberships = source.memberships ?? [];
  const indexes = source.indexes ?? [];
  const findings = [];
  const observedCollections = [...(source.observedCollections ?? [])].sort();
  const requiredCollections = new Set(MEMBERSHIP_BASELINE_COLLECTIONS);
  const allowedCollections = new Set([
    ...MEMBERSHIP_BASELINE_COLLECTIONS,
    MEMBERSHIP_BASELINE_LOCK_COLLECTION,
  ]);
  const observedRequiredCollections = observedCollections.filter((collection) =>
    requiredCollections.has(collection),
  );
  const unexpectedCollections = observedCollections.filter(
    (collection) => !allowedCollections.has(collection),
  );

  findings.push(...credentialFindings);

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
        observed.isActive !== true
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
  const conflictingNamedIndex = indexes.some(
    (index) =>
      index?.name === "user_1_business_1" &&
      !isExactMembershipUniqueIndex(index),
  );
  if (conflictingCompoundIndex) findings.push("conflictingMembershipIndex");
  if (conflictingNamedIndex) findings.push("conflictingMembershipIndexName");

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
  const blocking =
    state === "partial" || conflictingCompoundIndex || conflictingNamedIndex;

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
      conflictingNameExists: conflictingNamedIndex,
    },
    findings: uniqueFindings,
  };
};

export const verifyMembershipBaselinePasswords = async (
  source,
  manifest,
  passwordVerifier = isValidPassword,
) => {
  const users = source.users ?? [];
  const findings = [];

  for (const expected of manifest.users) {
    const matches = users.filter((user) => emailKey(user.email) === expected.email);
    if (matches.length !== 1) continue;

    const storedHash = matches[0]?.password;
    if (
      typeof storedHash !== "string" ||
      !PASSWORD_HASH_PATTERN.test(storedHash)
    ) {
      findings.push(`invalidPasswordHash:${expected.key}`);
      continue;
    }

    try {
      const matchesDeclaredPassword = await passwordVerifier(
        expected.password,
        storedHash,
      );
      if (matchesDeclaredPassword !== true) {
        findings.push(`passwordMismatch:${expected.key}`);
      }
    } catch {
      findings.push(`passwordVerificationError:${expected.key}`);
    }
  }

  return [...new Set(findings)].sort();
};

export const buildVerifiedMembershipBaselinePlan = async (
  source,
  manifest,
  passwordVerifier = isValidPassword,
) => {
  const credentialFindings = await verifyMembershipBaselinePasswords(
    source,
    manifest,
    passwordVerifier,
  );
  return buildMembershipBaselinePlan(source, manifest, { credentialFindings });
};

export class MembershipBaselineLockActiveError extends Error {
  constructor() {
    super("Bootstrap bloqueado: existe otra ejecución apply activa");
    this.name = "MembershipBaselineLockActiveError";
  }
}

export class MembershipBaselineUnknownResultError extends Error {
  constructor() {
    super(
      "No fue posible confirmar el resultado del bootstrap; ejecute --mode=plan antes de reintentar",
    );
    this.name = "MembershipBaselineUnknownResultError";
  }
}

export class MembershipBaselineLockLostError extends Error {
  constructor() {
    super("Bootstrap bloqueado: se perdió la propiedad exclusiva del lock");
    this.name = "MembershipBaselineLockLostError";
  }
}

export const acquireMembershipBaselineLock = async (
  db,
  {
    ownerId,
    now = new Date(),
    ttlMs = MEMBERSHIP_BASELINE_LOCK_TTL_MS,
  },
) => {
  const acquiredAt = new Date(now);
  const expiresAt = new Date(acquiredAt.getTime() + ttlMs);

  try {
    await db.collection(MEMBERSHIP_BASELINE_LOCK_COLLECTION).insertOne({
      _id: MEMBERSHIP_BASELINE_LOCK_KEY,
      ownerId,
      acquiredAt,
      expiresAt: expiresAt.toISOString(),
      recoveryPolicy: "manual-after-owner-termination",
    });
    return { acquiredAt, expiresAt };
  } catch (error) {
    if (error instanceof MembershipBaselineLockActiveError) throw error;
    if (error?.code === 11000) throw new MembershipBaselineLockActiveError();
    throw new Error("No fue posible adquirir el lock del bootstrap");
  }
};

export const assertMembershipBaselineLockOwnership = async (
  db,
  { ownerId },
) => {
  const lock = await db.collection(MEMBERSHIP_BASELINE_LOCK_COLLECTION)
    .findOne({ _id: MEMBERSHIP_BASELINE_LOCK_KEY });
  if (lock?.ownerId !== ownerId) {
    throw new MembershipBaselineLockLostError();
  }
  return true;
};

export const releaseMembershipBaselineLock = async (db, { ownerId }) => {
  const result = await db.collection(MEMBERSHIP_BASELINE_LOCK_COLLECTION)
    .deleteOne({ _id: MEMBERSHIP_BASELINE_LOCK_KEY, ownerId });
  return result.deletedCount === 1;
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

export const ensureCollectionsAndMembershipIndex = async (
  db,
  source,
  { assertOwnership = async () => {} } = {},
) => {
  const observed = new Set(source.observedCollections);
  for (const collection of MEMBERSHIP_BASELINE_COLLECTIONS) {
    if (!observed.has(collection)) {
      await assertOwnership();
      await db.createCollection(collection);
    }
  }

  const indexes = await db.collection("memberships").listIndexes().toArray();
  if (!indexes.some(isExactMembershipUniqueIndex)) {
    await assertOwnership();
    await db.collection("memberships").createIndex(
      { user: 1, business: 1 },
      { unique: true, name: "user_1_business_1" },
    );
  }
};

const deterministicObjectId = (manifest, scope, key) =>
  new mongo.ObjectId(
    createNodeHash("sha256")
      .update(`${manifest.version}:${scope}:${key}`, "utf8")
      .digest()
      .subarray(0, 12),
  );

export const createBaselineDocuments = async (
  db,
  manifest,
  passwordHasher,
  { assertOwnership = async () => {} } = {},
) => {
  const now = new Date();
  const businessIds = new Map(
    manifest.businesses.map((business) => [
      business.key,
      deterministicObjectId(manifest, "business", business.key),
    ]),
  );
  const userIds = new Map(
    manifest.users.map((user) => [
      user.key,
      deterministicObjectId(manifest, "user", user.key),
    ]),
  );
  const membershipIds = manifest.memberships.map((membership) =>
    deterministicObjectId(manifest, "membership", membership.key));
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

  await assertOwnership();
  await db.collection("businesses").insertMany(businesses, { ordered: true });
  await assertOwnership();
  await db.collection("users").insertMany(users, { ordered: true });
  await assertOwnership();
  await db.collection("memberships").insertMany(memberships, { ordered: true });
};

const openIsolatedMongooseConnection = async (mongoUri, options) => {
  const isolatedConnection = mongoose.createConnection(mongoUri, options);
  await isolatedConnection.asPromise();
  return isolatedConnection;
};

export const runMembershipBaselineBootstrap = async ({
  mongoUri,
  options,
  environment = process.env,
  processEnvironment = process.env,
  manifest: suppliedManifest,
  connect,
  disconnect,
  connection,
  openConnection = openIsolatedMongooseConnection,
  passwordHasher = hashPassword,
  passwordVerifier = isValidPassword,
  acquireLock = acquireMembershipBaselineLock,
  assertLockOwner = assertMembershipBaselineLockOwnership,
  releaseLock = releaseMembershipBaselineLock,
  ownerIdFactory = randomUUID,
  readSource = readMembershipBaselineSource,
  ensureBaselineStorage = ensureCollectionsAndMembershipIndex,
  createDocuments = createBaselineDocuments,
}) => {
  const validatedOptions = validateMembershipBaselineOptions(
    { ...options },
    processEnvironment,
  );
  const manifest = suppliedManifest ?? buildMembershipBaselineManifest(environment);
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

  let activeConnection;
  let closeConnection;
  let mutationStarted = false;
  try {
    const connectionOptions = {
      dbName: validatedOptions.database,
      autoIndex: false,
    };
    if (typeof connect === "function") {
      await connect(mongoUri, connectionOptions);
      activeConnection = connection;
      closeConnection = disconnect;
    } else {
      activeConnection = await openConnection(mongoUri, connectionOptions);
      closeConnection = activeConnection.close.bind(activeConnection);
    }

    const actualDatabase = activeConnection?.db?.databaseName;
    if (actualDatabase !== validatedOptions.database) {
      throw new Error("La base conectada no coincide con la base confirmada");
    }

    if (validatedOptions.mode === "plan") {
      const source = await readSource(activeConnection.db);
      const plan = await buildVerifiedMembershipBaselinePlan(
        source,
        manifest,
        passwordVerifier,
      );
      return { plan, applied: false, exitCode: plan.canApply ? 0 : 2 };
    }

    const ownerId = ownerIdFactory();
    let lockAcquired = false;
    try {
      await acquireLock(activeConnection.db, { ownerId });
      lockAcquired = true;

      const assertOwnership = () =>
        assertLockOwner(activeConnection.db, { ownerId });
      await assertOwnership();

      const source = await readSource(activeConnection.db);
      await assertOwnership();
      const plan = await buildVerifiedMembershipBaselinePlan(
        source,
        manifest,
        passwordVerifier,
      );
      if (!plan.canApply) {
        throw new Error(
          "Bootstrap bloqueado: la base está parcialmente inicializada o contiene contradicciones",
        );
      }
      if (plan.idempotentNoop) {
        return { plan, applied: false, exitCode: 0 };
      }

      try {
        mutationStarted = true;
        await ensureBaselineStorage(activeConnection.db, source, {
          assertOwnership,
        });
        if (plan.state === "empty") {
          await createDocuments(activeConnection.db, manifest, passwordHasher, {
            assertOwnership,
          });
        }

        await assertOwnership();

        let verification;
        try {
          const verificationSource = await readSource(activeConnection.db);
          verification = await buildVerifiedMembershipBaselinePlan(
            verificationSource,
            manifest,
            passwordVerifier,
          );
        } catch {
          throw new MembershipBaselineUnknownResultError();
        }

        if (verification.state !== "ready" || !verification.idempotentNoop) {
          throw new Error(
            "La baseline quedó en estado parcial confirmado; ejecute --mode=plan antes de reintentar",
          );
        }

        return { plan: verification, applied: true, exitCode: 0 };
      } catch (error) {
        if (
          error instanceof MembershipBaselineUnknownResultError ||
          error.message?.includes("estado parcial confirmado")
        ) {
          throw error;
        }
        if (mutationStarted) throw new MembershipBaselineUnknownResultError();
        throw error;
      }
    } finally {
      if (lockAcquired) {
        try {
          const released = await releaseLock(activeConnection.db, { ownerId });
          if (released !== true) throw new Error("lock ownership changed");
        } catch {
          throw new MembershipBaselineUnknownResultError();
        }
      }
    }
  } finally {
    if (typeof closeConnection === "function") {
      try {
        await closeConnection();
      } catch {
        if (mutationStarted) throw new MembershipBaselineUnknownResultError();
        throw new Error("No fue posible cerrar la conexión aislada");
      }
    }
  }
};

const usage = () => {
  console.log(`Uso:
  NODE_ENV=development npm run bootstrap:membership-baseline -- \\
    --mode=plan|apply \\
    --environment=development \\
    --database=agenda_dev \\
    --expected-target-fingerprint=<sha256-aprobado> \\
    [--confirm=${MEMBERSHIP_BASELINE_CONFIRMATION}]

NODE_ENV debe coincidir con --environment. El comando sólo admite development
y test, rechaza plataformas de despliegue y nunca se ejecuta durante el arranque.`);
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
    .catch(() => {
      console.error(
        "Bootstrap Membership rechazado por una configuración o estado no seguro",
      );
      process.exitCode = 1;
    });
}
