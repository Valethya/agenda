import "dotenv/config";

import path from "node:path";
import { pathToFileURL } from "node:url";
import * as core from "./membership-baseline-core.js";

export * from "./membership-baseline-core.js";

const BOOKABILITY_FINDING = "membershipBookabilityMismatch";

const withCanonicalMembershipManifest = (manifest) => ({
  ...manifest,
  memberships: (manifest?.memberships ?? []).map((membership) => ({
    ...membership,
    isBookable: false,
  })),
});

export const buildMembershipBaselineManifestFromOwners = (owners) =>
  withCanonicalMembershipManifest(core.buildMembershipBaselineManifestFromOwners(owners));

export const buildMembershipBaselineManifest = (environment = process.env) =>
  withCanonicalMembershipManifest(core.buildMembershipBaselineManifest(environment));

const canonicalBookabilityFinding = (source) =>
  (source?.memberships ?? []).some((membership) => membership?.isBookable !== false)
    ? BOOKABILITY_FINDING
    : null;

const appendBookabilityFinding = (plan, source) => {
  const finding = canonicalBookabilityFinding(source);
  if (!finding) return plan;
  return {
    ...plan,
    state: "partial",
    canApply: false,
    idempotentNoop: false,
    findings: [...new Set([...(plan.findings ?? []), finding])].sort(),
  };
};

export const buildMembershipBaselinePlan = (source, manifest, options = {}) =>
  appendBookabilityFinding(
    core.buildMembershipBaselinePlan(
      source,
      withCanonicalMembershipManifest(manifest),
      options,
    ),
    source,
  );

export const buildVerifiedMembershipBaselinePlan = async (
  source,
  manifest,
  passwordVerifier,
) => {
  const credentialFindings = await core.verifyMembershipBaselinePasswords(
    source,
    withCanonicalMembershipManifest(manifest),
    passwordVerifier,
  );
  return buildMembershipBaselinePlan(source, manifest, { credentialFindings });
};

const canonicalMembershipCollection = (collection) => ({
  insertMany: (documents, options) => collection.insertMany(
    documents.map((document) => ({ ...document, isBookable: false })),
    options,
  ),
});

/**
 * Mantiene el writer endurecido existente, pero intercepta exclusivamente el
 * insert físico de Membership para que el documento llegue a MongoDB con el
 * boolean canónico desde su primera materialización dentro de la transacción.
 */
export const createBaselineDocuments = async (
  db,
  manifest,
  passwordHasher,
  options = {},
) => {
  const canonicalDb = {
    collection(name) {
      const collection = db.collection(name);
      return name === "memberships"
        ? canonicalMembershipCollection(collection)
        : collection;
    },
  };
  return core.createBaselineDocuments(
    canonicalDb,
    withCanonicalMembershipManifest(manifest),
    passwordHasher,
    options,
  );
};

const transformedSourceForCore = (source) => {
  if (!canonicalBookabilityFinding(source)) return source;
  return {
    ...source,
    // El core histórico ya bloquea roles fuera del manifiesto. La transformación
    // es sólo de la vista in-memory usada por plan/apply; nunca escribe storage.
    memberships: (source.memberships ?? []).map((membership) => (
      membership?.isBookable === false
        ? membership
        : { ...membership, role: "__noncanonical_bookability__" }
    )),
  };
};

export const runMembershipBaselineBootstrap = async (options) => {
  const manifest = withCanonicalMembershipManifest(
    options?.manifest
      ?? buildMembershipBaselineManifest(options?.environment ?? process.env),
  );
  let observedNonCanonicalBookability = false;
  const suppliedReadSource = options?.readSource;
  const readSource = async (...args) => {
    const source = suppliedReadSource
      ? await suppliedReadSource(...args)
      : await core.readMembershipBaselineSource(...args);
    if (canonicalBookabilityFinding(source)) observedNonCanonicalBookability = true;
    return transformedSourceForCore(source);
  };

  const result = await core.runMembershipBaselineBootstrap({
    ...options,
    manifest,
    readSource,
    createDocuments: options?.createDocuments ?? createBaselineDocuments,
  });

  if (!observedNonCanonicalBookability) return result;
  return {
    ...result,
    plan: {
      ...result.plan,
      state: "partial",
      canApply: false,
      idempotentNoop: false,
      findings: [...new Set([...(result.plan?.findings ?? []), BOOKABILITY_FINDING])].sort(),
    },
  };
};

const usage = () => {
  console.log(`Uso:
  NODE_ENV=development npm run bootstrap:membership-baseline -- \\
    --mode=plan|apply \\
    --environment=development \\
    --database=agenda_dev \\
    --expected-target-fingerprint=<sha256-aprobado> \\
    [--confirm=${core.MEMBERSHIP_BASELINE_CONFIRMATION}]

NODE_ENV debe coincidir con --environment. El comando sólo admite development
y test, rechaza plataformas de despliegue y nunca se ejecuta durante el arranque.
Las Memberships owner se materializan siempre con isBookable=false.`);
};

export const main = async (argv = process.argv.slice(2)) => {
  const options = core.parseMembershipBaselineArgs(argv);
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
  process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

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
