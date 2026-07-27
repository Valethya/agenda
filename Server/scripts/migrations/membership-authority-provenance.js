import { createHash } from "node:crypto";

export const MEMBERSHIP_AUTHORITY_AUDITOR_VERSION = "1.2.0";

export const ALLOWED_AUDIT_ENVIRONMENTS = Object.freeze([
  "development",
  "test",
  "staging",
  "production",
]);

export const validateAuditEnvironment = (environment) => {
  if (!environment) {
    throw new Error("--environment es obligatorio");
  }

  if (!ALLOWED_AUDIT_ENVIRONMENTS.includes(environment)) {
    throw new Error(
      `Entorno no permitido. Use uno de: ${ALLOWED_AUDIT_ENVIRONMENTS.join(", ")}`,
    );
  }

  return environment;
};

const SHA256_PATTERN = /^[a-f0-9]{64}$/iu;
const GIT_SHA_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/iu;

export const validateTargetFingerprint = (fingerprint) => {
  if (!SHA256_PATTERN.test(fingerprint ?? "")) {
    throw new Error(
      "El fingerprint esperado debe ser un SHA-256 hexadecimal de 64 caracteres",
    );
  }

  return fingerprint.toLowerCase();
};

export const validateCodeSha = (codeSha) => {
  if (!GIT_SHA_PATTERN.test(codeSha ?? "")) {
    throw new Error(
      "El SHA efectivo del código debe ser hexadecimal y tener 40 o 64 caracteres",
    );
  }

  return codeSha.toLowerCase();
};

const parseMongoTarget = (mongoUri, databaseName) => {
  if (typeof mongoUri !== "string") {
    throw new Error("MONGO_URI no es una URI MongoDB válida");
  }

  const match = mongoUri.match(/^(mongodb(?:\+srv)?):\/\/(.+)$/i);
  if (!match) {
    throw new Error("MONGO_URI no es una URI MongoDB válida");
  }

  const scheme = match[1].toLowerCase();
  const withoutOptions = match[2].split(/[?#]/u, 1)[0];
  const authorityAndPath = withoutOptions.slice(withoutOptions.lastIndexOf("@") + 1);
  const slashIndex = authorityAndPath.indexOf("/");
  const authority =
    slashIndex === -1 ? authorityAndPath : authorityAndPath.slice(0, slashIndex);

  const hosts = authority
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean)
    .sort();

  if (hosts.length === 0 || !databaseName || typeof databaseName !== "string") {
    throw new Error("MONGO_URI no es una URI MongoDB válida");
  }

  return `${scheme}://${hosts.join(",")}/${encodeURIComponent(databaseName)}`;
};

export const fingerprintMongoTarget = (mongoUri, databaseName) =>
  createHash("sha256")
    .update(parseMongoTarget(mongoUri, databaseName), "utf8")
    .digest("hex");

export const resolveEffectiveCodeSha = ({
  railwayGitCommitSha = process.env.RAILWAY_GIT_COMMIT_SHA,
  githubSha = process.env.GITHUB_SHA,
  explicitCodeSha =
    process.env.MEMBERSHIP_AUTHORITY_CODE_SHA ?? process.env.AUDITOR_CODE_SHA,
} = {}) => {
  const candidates = [
    ["railway", railwayGitCommitSha],
    ["github-actions", githubSha],
    ["explicit", explicitCodeSha],
  ];

  for (const [source, value] of candidates) {
    if (value) {
      return {
        codeSha: validateCodeSha(value),
        codeShaSource: source,
      };
    }
  }

  return {
    codeSha: null,
    codeShaSource: null,
  };
};

export const resolveExpectedTargetFingerprint = ({
  explicitExpectedTargetFingerprint,
  environmentExpectedTargetFingerprint =
    process.env.MEMBERSHIP_AUTHORITY_EXPECTED_TARGET_FINGERPRINT,
} = {}) => {
  const value =
    explicitExpectedTargetFingerprint || environmentExpectedTargetFingerprint;
  if (!value) {
    return {
      expectedTargetFingerprint: null,
      expectedTargetFingerprintSource: null,
    };
  }

  return {
    expectedTargetFingerprint: validateTargetFingerprint(value),
    expectedTargetFingerprintSource: explicitExpectedTargetFingerprint
      ? "cli"
      : "environment-variable",
  };
};

export const validateExpectedMongoTarget = ({
  environment,
  observedTargetFingerprint,
  expectedTargetFingerprint,
}) => {
  validateAuditEnvironment(environment);
  const observed = validateTargetFingerprint(observedTargetFingerprint);
  const required = environment === "staging" || environment === "production";

  if (required && !expectedTargetFingerprint) {
    throw new Error(
      `El entorno ${environment} exige --expected-target-fingerprint`,
    );
  }

  if (!expectedTargetFingerprint) {
    return {
      required,
      provided: false,
      matches: null,
    };
  }

  const expected = validateTargetFingerprint(expectedTargetFingerprint);
  if (expected !== observed) {
    throw new Error(
      "El fingerprint del destino MongoDB no coincide con el destino aprobado",
    );
  }

  return {
    required,
    provided: true,
    matches: true,
  };
};

const redactValue = (message, value) => {
  if (!value || typeof value !== "string") return message;
  return message.split(value).join("[REDACTED]");
};

export const sanitizeAuditErrorMessage = (error, mongoUri) => {
  let message =
    error instanceof Error ? error.message : String(error ?? "Error desconocido");

  message = redactValue(message, mongoUri);
  message = message.replace(
    /mongodb(?:\+srv)?:\/\/[^\s"'`]+/giu,
    "[REDACTED_MONGO_URI]",
  );

  if (typeof mongoUri === "string") {
    const credentialsMatch = mongoUri.match(
      /^mongodb(?:\+srv)?:\/\/([^@/]+)@/iu,
    );
    if (credentialsMatch) {
      for (const credential of credentialsMatch[1].split(":")) {
        message = redactValue(message, credential);
        try {
          message = redactValue(message, decodeURIComponent(credential));
        } catch {
          // La URI inválida ya queda cubierta por la redacción completa.
        }
      }
    }
  }

  return message;
};
