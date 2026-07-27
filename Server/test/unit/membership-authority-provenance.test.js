import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ALLOWED_AUDIT_ENVIRONMENTS,
  fingerprintMongoTarget,
  MEMBERSHIP_AUTHORITY_AUDITOR_VERSION,
  resolveEffectiveCodeSha,
  sanitizeAuditErrorMessage,
  validateAuditEnvironment,
} from "../../scripts/migrations/membership-authority-provenance.js";

describe("membership authority provenance", () => {
  it("acepta únicamente entornos operativos documentados", () => {
    assert.deepEqual(ALLOWED_AUDIT_ENVIRONMENTS, [
      "development",
      "test",
      "staging",
      "production",
    ]);
    assert.equal(validateAuditEnvironment("production"), "production");
    assert.throws(() => validateAuditEnvironment(), /obligatorio/);
    assert.throws(
      () => validateAuditEnvironment("preview"),
      /Entorno no permitido/,
    );
  });

  it("prioriza Railway, luego GitHub y después el SHA explícito", () => {
    assert.equal(
      resolveEffectiveCodeSha({
        railwayGitCommitSha: "railway-sha",
        githubSha: "github-sha",
        explicitCodeSha: "explicit-sha",
      }),
      "railway-sha",
    );
    assert.equal(
      resolveEffectiveCodeSha({
        railwayGitCommitSha: "",
        githubSha: "github-sha",
        explicitCodeSha: "explicit-sha",
      }),
      "github-sha",
    );
    assert.equal(
      resolveEffectiveCodeSha({
        railwayGitCommitSha: "",
        githubSha: "",
        explicitCodeSha: "explicit-sha",
      }),
      "explicit-sha",
    );
    assert.equal(
      resolveEffectiveCodeSha({
        railwayGitCommitSha: "",
        githubSha: "",
        explicitCodeSha: "",
      }),
      null,
    );
  });

  it("genera un fingerprint estable sin depender de credenciales u opciones", () => {
    const first = fingerprintMongoTarget(
      "mongodb://first-user:first-pass@cluster.example:27017/agenda?authSource=admin",
      "agenda",
    );
    const sameDestination = fingerprintMongoTarget(
      "mongodb://second-user:second-pass@CLUSTER.EXAMPLE:27017/agenda?retryWrites=true",
      "agenda",
    );
    const sameCredentialsAndDestination = fingerprintMongoTarget(
      "mongodb://first-user:first-pass@cluster.example:27017/agenda?authSource=admin",
      "agenda",
    );

    assert.equal(first, sameDestination);
    assert.equal(first, sameCredentialsAndDestination);
    assert.match(first, /^[a-f0-9]{64}$/u);
  });

  it("distingue cambios de cluster o de base", () => {
    const original = fingerprintMongoTarget(
      "mongodb+srv://user:pass@cluster-a.example/agenda",
      "agenda",
    );
    const otherCluster = fingerprintMongoTarget(
      "mongodb+srv://user:pass@cluster-b.example/agenda",
      "agenda",
    );
    const otherDatabase = fingerprintMongoTarget(
      "mongodb+srv://user:pass@cluster-a.example/agenda_test",
      "agenda_test",
    );

    assert.notEqual(original, otherCluster);
    assert.notEqual(original, otherDatabase);
  });

  it("redacta URI, usuario y contraseña de mensajes de error", () => {
    const uri =
      "mongodb://private-user:private-pass@cluster.example:27017/agenda?token=secret";
    const sanitized = sanitizeAuditErrorMessage(
      new Error(`No se pudo conectar a ${uri} como private-user/private-pass`),
      uri,
    );

    assert.equal(sanitized.includes("private-user"), false);
    assert.equal(sanitized.includes("private-pass"), false);
    assert.equal(sanitized.includes("token=secret"), false);
    assert.equal(sanitized.includes("mongodb://"), false);
  });

  it("expone una versión estable del auditor", () => {
    assert.match(MEMBERSHIP_AUTHORITY_AUDITOR_VERSION, /^\d+\.\d+\.\d+$/u);
  });
});
