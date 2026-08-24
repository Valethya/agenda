import "dotenv/config";

import path from "node:path";
import { pathToFileURL } from "node:url";
import mongoose, { mongo } from "mongoose";
import {
  MembershipBaselineUnknownResultError,
  acquireMembershipBaselineLock,
  assertMembershipBaselineLockOwnership,
  assertMembershipBaselineTransactionSupport,
  buildMembershipBaselineManifestFromOwners,
  ensureMembershipBaselineLockCollection,
  releaseMembershipBaselineLock,
  runMembershipBaselineTransaction,
} from "./membership-baseline.js";
import { isExactMembershipUniqueIndex } from "../migrations/membership-authority-audit.js";
import {
  fingerprintMongoTarget,
  validateTargetFingerprint,
} from "../migrations/membership-authority-provenance.js";
import { createHash, isValidPassword } from "../../src/utils/password.js";

export const PRODUCTION_OWNER_BOOTSTRAP_VERSION = "1.0.0";
export const PRODUCTION_OWNER_BOOTSTRAP_CONFIRMATION =
  "CREATE_INITIAL_PRODUCTION_OWNERS";

const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const OWNER_COLLECTIONS = Object.freeze(["businesses", "users", "memberships"]);
const OWNER_VARIABLES = Object.freeze({
  atmosfera: Object.freeze({
    firstName: "PRODUCTION_BOOTSTRAP_ATMOSFERA_FIRST_NAME",
    lastName: "PRODUCTION_BOOTSTRAP_ATMOSFERA_LAST_NAME",
    email: "PRODUCTION_BOOTSTRAP_ATMOSFERA_EMAIL",
    password: "PRODUCTION_BOOTSTRAP_ATMOSFERA_PASSWORD",
  }),
  dam: Object.freeze({
    firstName: "PRODUCTION_BOOTSTRAP_DAM_FIRST_NAME",
    lastName: "PRODUCTION_BOOTSTRAP_DAM_LAST_NAME",
    email: "PRODUCTION_BOOTSTRAP_DAM_EMAIL",
    password: "PRODUCTION_BOOTSTRAP_DAM_PASSWORD",
  }),
});

const normalizeEmail = (value) =>
  typeof value === "string" ? value.trim().toLowerCase() : "";
const isObjectId = (value) => value instanceof mongo.ObjectId;
const objectIdKey = (value) => (isObjectId(value) ? value.toHexString() : null);
const hasValue = (value) =>
  value !== undefined && value !== null && String(value).trim() !== "";

const requiredEnvironmentValue = (environment, name, { trim = true } = {}) => {
  const raw = environment?.[name];
  if (typeof raw !== "string" || raw.length === 0) {
    throw new Error(`La variable temporal ${name} es obligatoria`);
  }
  const value = trim ? raw.trim() : raw;
  if (value.length === 0) throw new Error(`La variable temporal ${name} es obligatoria`);
  return value;
};

export const buildProductionOwnerManifest = (environment = process.env) => {
  const owners = Object.fromEntries(
    Object.entries(OWNER_VARIABLES).map(([key, variables]) => [
      key,
      {
        firstName: requiredEnvironmentValue(environment, variables.firstName),
        lastName: requiredEnvironmentValue(environment, variables.lastName),
        email: requiredEnvironmentValue(environment, variables.email),
        password: requiredEnvironmentValue(environment, variables.password, { trim: false }),
      },
    ]),
  );
  return buildMembershipBaselineManifestFromOwners(owners);
};

export const parseProductionOwnerBootstrapArgs = (argv) => {
  const options = {};
  const allowed = new Set([
    "mode",
    "expected-target-fingerprint",
    "approved-sha",
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
    if (!value || value.startsWith("--")) throw new Error(`Falta valor para --${key}`);
    const optionName = key === "expected-target-fingerprint"
      ? "expectedTargetFingerprint"
      : key === "approved-sha"
        ? "approvedSha"
        : key;
    if (Object.hasOwn(options, optionName)) {
      throw new Error(`Opción duplicada: --${key}`);
    }
    options[optionName] = value;
    if (inlineValue === undefined) index += 1;
  }
  return options;
};

export const validateProductionOwnerRuntime = (
  options,
  environment = process.env,
) => {
  if (!options?.mode || !["plan", "apply"].includes(options.mode)) {
    throw new Error('--mode es obligatorio y sólo acepta "plan" o "apply"');
  }
  if (environment.NODE_ENV !== "production") {
    throw new Error("El bootstrap productivo exige NODE_ENV=production");
  }
  if (environment.RAILWAY_ENVIRONMENT_NAME !== "production") {
    throw new Error("El bootstrap productivo sólo puede ejecutarse en Railway production");
  }
  if (environment.RAILWAY_GIT_BRANCH !== "master") {
    throw new Error("El bootstrap productivo sólo puede ejecutarse desde master");
  }
  for (const required of [
    "RAILWAY_PROJECT_ID",
    "RAILWAY_SERVICE_ID",
    "RAILWAY_DEPLOYMENT_ID",
    "RAILWAY_GIT_COMMIT_SHA",
  ]) {
    if (!hasValue(environment[required])) {
      throw new Error("El bootstrap productivo exige un deployment Railway identificable");
    }
  }
  const deploymentSha = String(environment.RAILWAY_GIT_COMMIT_SHA).trim().toLowerCase();
  if (!SHA_PATTERN.test(deploymentSha)) {
    throw new Error("RAILWAY_GIT_COMMIT_SHA no es un SHA válido");
  }

  if (options.mode === "apply") {
    const approvedSha = String(options.approvedSha || "").trim().toLowerCase();
    if (!SHA_PATTERN.test(approvedSha)) {
      throw new Error("--approved-sha es obligatorio para apply");
    }
    if (approvedSha !== deploymentSha) {
      throw new Error("El deployment Railway no coincide con el SHA aprobado");
    }
    if (options.confirm !== PRODUCTION_OWNER_BOOTSTRAP_CONFIRMATION) {
      throw new Error(
        `apply exige --confirm=${PRODUCTION_OWNER_BOOTSTRAP_CONFIRMATION}`,
      );
    }
    options.expectedTargetFingerprint = validateTargetFingerprint(
      options.expectedTargetFingerprint,
    );
    options.approvedSha = approvedSha;
  }

  return { deploymentSha };
};

const isExactUniqueSingleFieldIndex = (index, field) => {
  const entries = Object.entries(index?.key ?? {});
  return entries.length === 1
    && entries[0]?.[0] === field
    && entries[0]?.[1] === 1
    && index?.unique === true
    && index?.sparse !== true
    && index?.partialFilterExpression === undefined
    && index?.collation === undefined
    && index?.hidden !== true
    && index?.expireAfterSeconds === undefined;
};

const collectionCounts = (source) => ({
  businesses: source.businesses?.length ?? 0,
  users: source.users?.length ?? 0,
  memberships: source.memberships?.length ?? 0,
});

const storageStatus = (source) => {
  const observed = new Set(source.observedCollections ?? []);
  const businessIndexReady = (source.businessIndexes ?? []).some((index) =>
    isExactUniqueSingleFieldIndex(index, "slug"));
  const userIndexReady = (source.userIndexes ?? []).some((index) =>
    isExactUniqueSingleFieldIndex(index, "email"));
  const membershipIndexReady = (source.membershipIndexes ?? []).some(isExactMembershipUniqueIndex);
  return {
    business: {
      exactUniqueExists: businessIndexReady,
      canCreateTransactionally: !observed.has("businesses"),
    },
    user: {
      exactUniqueExists: userIndexReady,
      canCreateTransactionally: !observed.has("users"),
    },
    membership: {
      exactUniqueExists: membershipIndexReady,
      canCreateTransactionally: !observed.has("memberships"),
    },
  };
};

const storageCanApply = (storage) => Object.values(storage).every((status) => (
  status.exactUniqueExists || status.canCreateTransactionally
));

export const readProductionOwnerSource = async (
  db,
  { session, metadata } = {},
) => {
  const observedCollections = metadata?.observedCollections
    ? [...metadata.observedCollections].sort()
    : (await db.listCollections({}, { nameOnly: true }).toArray())
      .map((collection) => collection.name)
      .sort();
  const observed = new Set(observedCollections);
  const readIndexes = async (collection, supplied) => {
    if (Array.isArray(supplied)) return supplied;
    return observed.has(collection)
      ? db.collection(collection).listIndexes().toArray()
      : [];
  };
  const [businesses, users, memberships, businessIndexes, userIndexes, membershipIndexes] =
    await Promise.all([
      observed.has("businesses")
        ? db.collection("businesses").find({}, { session }).toArray()
        : [],
      observed.has("users")
        ? db.collection("users").find({}, { session }).toArray()
        : [],
      observed.has("memberships")
        ? db.collection("memberships").find({}, { session }).toArray()
        : [],
      readIndexes("businesses", metadata?.businessIndexes),
      readIndexes("users", metadata?.userIndexes),
      readIndexes("memberships", metadata?.membershipIndexes),
    ]);
  return {
    observedCollections,
    businesses,
    users,
    memberships,
    businessIndexes,
    userIndexes,
    membershipIndexes,
  };
};

export const buildProductionOwnerPlan = (source) => {
  const counts = collectionCounts(source);
  const empty = Object.values(counts).every((count) => count === 0);
  const storage = storageStatus(source);
  return {
    version: PRODUCTION_OWNER_BOOTSTRAP_VERSION,
    state: empty ? "empty" : "occupied",
    canApply: empty && storageCanApply(storage),
    counts,
    storage,
  };
};

const findOneBySlug = (items, slug) => items.filter((item) => item?.slug === slug);
const findOneByEmail = (items, email) => items.filter((item) => (
  Array.isArray(item?.email)
  && item.email.length === 1
  && normalizeEmail(item.email[0]) === email
));

export const verifyProductionOwnerReadyState = async (
  source,
  manifest,
  passwordVerifier = isValidPassword,
) => {
  const counts = collectionCounts(source);
  const findings = [];
  if (counts.businesses !== 2) findings.push("businessCountMismatch");
  if (counts.users !== 2) findings.push("userCountMismatch");
  if (counts.memberships !== 2) findings.push("membershipCountMismatch");
  const storage = storageStatus(source);
  if (!storage.business.exactUniqueExists) findings.push("businessSlugUniqueIndexMissing");
  if (!storage.user.exactUniqueExists) findings.push("userEmailUniqueIndexMissing");
  if (!storage.membership.exactUniqueExists) findings.push("membershipUniqueIndexMissing");

  const businessByKey = new Map();
  const userByKey = new Map();

  for (const expected of manifest.businesses) {
    const matches = findOneBySlug(source.businesses ?? [], expected.slug);
    if (
      matches.length !== 1
      || !isObjectId(matches[0]._id)
      || !isObjectId(matches[0].owner)
      || matches[0].name !== expected.name
      || matches[0].isActive !== true
      || matches[0].subscriptionStatus !== "active"
    ) {
      findings.push(`businessMismatch:${expected.key}`);
      continue;
    }
    businessByKey.set(expected.key, matches[0]);
  }

  for (const expected of manifest.users) {
    const matches = findOneByEmail(source.users ?? [], expected.email);
    const business = businessByKey.get(expected.businessKey);
    if (
      matches.length !== 1
      || !isObjectId(matches[0]._id)
      || matches[0].firstName !== expected.firstName
      || matches[0].lastName !== expected.lastName
      || matches[0].role !== "admin"
      || matches[0].isActive !== true
      || Object.hasOwn(matches[0], "business")
    ) {
      findings.push(`userMismatch:${expected.key}`);
      continue;
    }
    try {
      const validPassword = await passwordVerifier(expected.password, matches[0].password);
      if (validPassword !== true) findings.push(`passwordMismatch:${expected.key}`);
    } catch {
      findings.push(`passwordVerificationError:${expected.key}`);
    }
    userByKey.set(expected.key, matches[0]);
    if (business && objectIdKey(business.owner) !== objectIdKey(matches[0]._id)) {
      findings.push(`ownerMismatch:${expected.businessKey}`);
    }
  }

  for (const expected of manifest.memberships) {
    const user = userByKey.get(expected.userKey);
    const business = businessByKey.get(expected.businessKey);
    const matches = (source.memberships ?? []).filter((membership) => (
      user
      && business
      && isObjectId(membership?._id)
      && isObjectId(membership?.user)
      && isObjectId(membership?.business)
      && objectIdKey(membership.user) === objectIdKey(user._id)
      && objectIdKey(membership.business) === objectIdKey(business._id)
    ));
    if (
      matches.length !== 1
      || matches[0].role !== "admin"
      || matches[0].isActive !== true
      || matches[0].isBookable !== false
    ) {
      findings.push(`membershipMismatch:${expected.key}`);
    }
  }

  return {
    ready: findings.length === 0,
    findings: [...new Set(findings)].sort(),
    counts,
    storage,
  };
};

const createCollectionWithUniqueIndex = async (
  db,
  {
    collection,
    key,
    name,
    session,
  },
) => {
  await db.createCollection(collection, { session });
  await db.collection(collection).createIndex(key, {
    unique: true,
    name,
    session,
  });
};

export const ensureProductionOwnerStorage = async (
  db,
  source,
  {
    assertOwnership = async () => {},
    session,
  } = {},
) => {
  const storage = storageStatus(source);
  const definitions = [
    {
      collection: "businesses",
      status: storage.business,
      key: { slug: 1 },
      name: "slug_1",
    },
    {
      collection: "users",
      status: storage.user,
      key: { email: 1 },
      name: "email_1",
    },
    {
      collection: "memberships",
      status: storage.membership,
      key: { user: 1, business: 1 },
      name: "user_1_business_1",
    },
  ];

  for (const definition of definitions) {
    if (definition.status.exactUniqueExists) continue;
    if (!definition.status.canCreateTransactionally) {
      throw new Error(
        `Bootstrap productivo bloqueado: índice único requerido ausente en ${definition.collection}`,
      );
    }
    await assertOwnership();
    await createCollectionWithUniqueIndex(db, {
      collection: definition.collection,
      key: definition.key,
      name: definition.name,
      session,
    });
  }
};

export const createProductionOwnerDocuments = async (
  db,
  manifest,
  {
    passwordHasher = createHash,
    assertOwnership = async () => {},
    session,
  } = {},
) => {
  const now = new Date();
  const businessIds = new Map(
    manifest.businesses.map((business) => [business.key, new mongo.ObjectId()]),
  );
  const userIds = new Map(
    manifest.users.map((user) => [user.key, new mongo.ObjectId()]),
  );
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
    role: "admin",
    phone: [],
    isActive: true,
    createdAt: now,
    updatedAt: now,
  }));
  const memberships = manifest.memberships.map((membership) => ({
    _id: new mongo.ObjectId(),
    user: userIds.get(membership.userKey),
    business: businessIds.get(membership.businessKey),
    role: "admin",
    isActive: true,
    isBookable: false,
    createdAt: now,
    updatedAt: now,
  }));

  await assertOwnership();
  await db.collection("businesses").insertMany(businesses, { ordered: true, session });
  await assertOwnership();
  await db.collection("users").insertMany(users, { ordered: true, session });
  await assertOwnership();
  await db.collection("memberships").insertMany(memberships, { ordered: true, session });
};

const openConnection = async (mongoUri) => {
  const connection = mongoose.createConnection(mongoUri, { autoIndex: false });
  await connection.asPromise();
  return connection;
};

const sourceWithPlannedIndexes = (source) => {
  const next = {
    observedCollections: [...new Set([
      ...(source.observedCollections ?? []),
      ...OWNER_COLLECTIONS,
    ])].sort(),
    businessIndexes: [...(source.businessIndexes ?? [])],
    userIndexes: [...(source.userIndexes ?? [])],
    membershipIndexes: [...(source.membershipIndexes ?? [])],
  };
  if (!next.businessIndexes.some((index) => isExactUniqueSingleFieldIndex(index, "slug"))) {
    next.businessIndexes.push({ name: "slug_1", key: { slug: 1 }, unique: true });
  }
  if (!next.userIndexes.some((index) => isExactUniqueSingleFieldIndex(index, "email"))) {
    next.userIndexes.push({ name: "email_1", key: { email: 1 }, unique: true });
  }
  if (!next.membershipIndexes.some(isExactMembershipUniqueIndex)) {
    next.membershipIndexes.push({
      name: "user_1_business_1",
      key: { user: 1, business: 1 },
      unique: true,
    });
  }
  return next;
};

export const runProductionOwnerBootstrap = async ({
  mongoUri,
  options,
  environment = process.env,
  connection: suppliedConnection,
  connect = openConnection,
  manifest: suppliedManifest,
  passwordHasher = createHash,
  passwordVerifier = isValidPassword,
}) => {
  const validatedOptions = { ...options };
  const { deploymentSha } = validateProductionOwnerRuntime(validatedOptions, environment);
  if (!mongoUri) throw new Error("MONGO_URI es obligatoria");

  const connection = suppliedConnection ?? await connect(mongoUri);
  const shouldClose = !suppliedConnection;
  let mutationStarted = false;
  try {
    const database = connection?.db?.databaseName;
    if (!database) throw new Error("No fue posible identificar la base MongoDB conectada");
    const targetFingerprint = fingerprintMongoTarget(mongoUri, database);

    if (validatedOptions.mode === "plan") {
      const source = await readProductionOwnerSource(connection.db);
      return {
        applied: false,
        database,
        deploymentSha,
        targetFingerprint,
        plan: buildProductionOwnerPlan(source),
      };
    }

    if (validatedOptions.expectedTargetFingerprint !== targetFingerprint) {
      throw new Error("El fingerprint MongoDB no coincide con el destino aprobado");
    }
    const manifest = suppliedManifest ?? buildProductionOwnerManifest(environment);
    await assertMembershipBaselineTransactionSupport(connection.db);
    await ensureMembershipBaselineLockCollection(connection.db);

    const result = await runMembershipBaselineTransaction(connection, async (session) => {
      const ownerId = new mongo.ObjectId().toHexString();
      let lockAcquired = false;
      try {
        await acquireMembershipBaselineLock(connection.db, { ownerId, session });
        lockAcquired = true;
        const assertOwnership = () =>
          assertMembershipBaselineLockOwnership(connection.db, { ownerId, session });
        await assertOwnership();

        const source = await readProductionOwnerSource(connection.db, { session });
        const plan = buildProductionOwnerPlan(source);

        if (plan.state === "occupied") {
          const ready = await verifyProductionOwnerReadyState(
            source,
            manifest,
            passwordVerifier,
          );
          if (!ready.ready) {
            throw new Error("Bootstrap productivo bloqueado: el estado existente no coincide exactamente");
          }
          return { applied: false, ready };
        }
        if (!plan.canApply) {
          throw new Error("Bootstrap productivo bloqueado: storage de identidad incompatible");
        }

        mutationStarted = true;
        await ensureProductionOwnerStorage(connection.db, source, {
          assertOwnership,
          session,
        });
        await createProductionOwnerDocuments(connection.db, manifest, {
          passwordHasher,
          assertOwnership,
          session,
        });
        await assertOwnership();

        const verificationSource = await readProductionOwnerSource(connection.db, {
          session,
          metadata: sourceWithPlannedIndexes(source),
        });
        const ready = await verifyProductionOwnerReadyState(
          verificationSource,
          manifest,
          passwordVerifier,
        );
        if (!ready.ready) {
          throw new Error("Bootstrap productivo bloqueado: verificación transaccional falló");
        }
        return { applied: true, ready };
      } finally {
        if (lockAcquired) {
          const released = await releaseMembershipBaselineLock(connection.db, {
            ownerId,
            session,
          });
          if (released !== true) throw new MembershipBaselineUnknownResultError();
        }
      }
    });

    const postSource = await readProductionOwnerSource(connection.db);
    const postVerification = await verifyProductionOwnerReadyState(
      postSource,
      manifest,
      passwordVerifier,
    );
    if (!postVerification.ready) throw new MembershipBaselineUnknownResultError();

    return {
      applied: result.applied,
      database,
      deploymentSha,
      targetFingerprint,
      plan: {
        version: PRODUCTION_OWNER_BOOTSTRAP_VERSION,
        state: "ready",
        canApply: false,
        counts: postVerification.counts,
        storage: postVerification.storage,
      },
    };
  } finally {
    if (shouldClose) {
      try {
        await connection.close();
      } catch {
        if (mutationStarted) throw new MembershipBaselineUnknownResultError();
        throw new Error("No fue posible cerrar la conexión aislada");
      }
    }
  }
};

const usage = () => {
  console.log(`Uso seguro en Railway production:\n\n  npm run bootstrap:production-owners -- --mode=plan\n\nLuego, sólo tras revisar fingerprint/SHA:\n\n  npm run bootstrap:production-owners -- \\\n    --mode=apply \\\n    --expected-target-fingerprint=<sha256> \\\n    --approved-sha=<git-sha-aprobado> \\\n    --confirm=${PRODUCTION_OWNER_BOOTSTRAP_CONFIRMATION}\n\nLas credenciales se leen únicamente de variables temporales PRODUCTION_BOOTSTRAP_*.`);
};

export const main = async (argv = process.argv.slice(2)) => {
  const options = parseProductionOwnerBootstrapArgs(argv);
  if (options.help) {
    usage();
    return 0;
  }
  const result = await runProductionOwnerBootstrap({
    mongoUri: process.env.MONGO_URI,
    options,
  });
  console.log("Bootstrap inicial productivo evaluado.");
  console.log(`Estado: ${result.plan.state}`);
  console.log(`Can apply: ${result.plan.canApply}`);
  console.log(`Aplicado: ${result.applied}`);
  console.log(`Database: ${result.database}`);
  console.log(`Deployment SHA: ${result.deploymentSha}`);
  console.log(`Target fingerprint: ${result.targetFingerprint}`);
  console.log(`Business/User/Membership: ${result.plan.counts.businesses}/${result.plan.counts.users}/${result.plan.counts.memberships}`);
  console.log(`Índice Business.slug exacto: ${result.plan.storage.business.exactUniqueExists}`);
  console.log(`Índice User.email exacto: ${result.plan.storage.user.exactUniqueExists}`);
  console.log(`Índice Membership exacto: ${result.plan.storage.membership.exactUniqueExists}`);
  if (options.mode === "plan") return result.plan.canApply ? 0 : 2;
  return result.plan.state === "ready" ? 0 : 2;
};

const isDirectExecution =
  process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectExecution) {
  main()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch(() => {
      console.error("Bootstrap inicial productivo rechazado por un estado o autorización no segura");
      process.exitCode = 1;
    });
}
