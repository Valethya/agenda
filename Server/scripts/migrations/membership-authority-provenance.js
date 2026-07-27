import { createHash } from "node:crypto";

export const MEMBERSHIP_AUTHORITY_AUDITOR_VERSION = "1.1.0";

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
} = {}) =>
  railwayGitCommitSha || githubSha || explicitCodeSha || null;

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
