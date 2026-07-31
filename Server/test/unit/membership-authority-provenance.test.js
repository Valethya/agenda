import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ALLOWED_AUDIT_ENVIRONMENTS,
  fingerprintMongoTarget,
  MEMBERSHIP_AUTHORITY_AUDITOR_VERSION,
  resolveEffectiveCodeSha,
  resolveExpectedTargetFingerprint,
  sanitizeAuditErrorMessage,
  validateAuditEnvironment,
  validateCodeSha,
  validateExpectedMongoTarget,
  validateTargetFingerprint,
} from "../../scripts/migrations/membership-authority-provenance.js";

const sha40 = (character) => character.repeat(40);
const sha256 = (character) => character.repeat(64);

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
    assert.deepEqual(
      resolveEffectiveCodeSha({
        railwayGitCommitSha: sha40("a"),
        githubSha: sha40("b"),
        explicitCodeSha: sha40("c"),
      }),
      {
        codeSha: sha40("a"),
        codeShaSource: "railway",
      },
    );
    assert.deepEqual(
      resolveEffectiveCodeSha({
        railwayGitCommitSha: "",
        githubSha: sha40("b"),
        explicitCodeSha: sha40("c"),
      }),
      {
        codeSha: sha40("b"),
        codeShaSource: "github-actions",
      },
    );
    assert.deepEqual(
      resolveEffectiveCodeSha({
        railwayGitCommitSha: "",
        githubSha: "",
        explicitCodeSha: sha40("c"),
      }),
      {
        codeSha: sha40("c"),
        codeShaSource: "explicit",
      },
    );
    assert.deepEqual(
      resolveEffectiveCodeSha({
        railwayGitCommitSha: "",
        githubSha: "",
        explicitCodeSha: "",
      }),
      {
        codeSha: null,
        codeShaSource: null,
      },
    );
  });

  it("rechaza SHA de código arbitrarios o malformados", () => {
    assert.equal(validateCodeSha(sha40("A")), sha40("a"));
    assert.equal(validateCodeSha(sha256("b")), sha256("b"));
    for (const invalid of ["explicit-sha", "abc123", "g".repeat(40), "a".repeat(39)]) {
      assert.throws(() => validateCodeSha(invalid), /SHA efectivo del código/);
    }
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

  it("vincula staging y production con un fingerprint aprobado", () => {
    const observed = sha256("a");
    assert.deepEqual(
      validateExpectedMongoTarget({
        environment: "production",
        observedTargetFingerprint: observed,
        expectedTargetFingerprint: observed,
      }),
      {
        required: true,
        provided: true,
        matches: true,
      },
    );
    assert.throws(
      () =>
        validateExpectedMongoTarget({
          environment: "staging",
          observedTargetFingerprint: observed,
        }),
      /exige --expected-target-fingerprint/,
    );
    assert.throws(
      () =>
        validateExpectedMongoTarget({
          environment: "staging",
          observedTargetFingerprint: observed,
          expectedTargetFingerprint: sha256("b"),
        }),
      /no coincide/,
    );
  });

  it("permite development y test sin fingerprint, pero valida uno provisto", () => {
    const observed = sha256("a");
    assert.deepEqual(
      validateExpectedMongoTarget({
        environment: "test",
        observedTargetFingerprint: observed,
      }),
      {
        required: false,
        provided: false,
        matches: null,
      },
    );
    assert.throws(
      () =>
        validateExpectedMongoTarget({
          environment: "development",
          observedTargetFingerprint: observed,
          expectedTargetFingerprint: sha256("b"),
        }),
      /no coincide/,
    );
  });

  it("prioriza el fingerprint explícito sobre la variable de entorno", () => {
    assert.deepEqual(
      resolveExpectedTargetFingerprint({
        explicitExpectedTargetFingerprint: sha256("a"),
        environmentExpectedTargetFingerprint: sha256("b"),
      }),
      {
        expectedTargetFingerprint: sha256("a"),
        expectedTargetFingerprintSource: "cli",
      },
    );
    assert.deepEqual(
      resolveExpectedTargetFingerprint({
        environmentExpectedTargetFingerprint: sha256("b"),
      }),
      {
        expectedTargetFingerprint: sha256("b"),
        expectedTargetFingerprintSource: "environment-variable",
      },
    );
    assert.equal(validateTargetFingerprint(sha256("A")), sha256("a"));
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
    assert.equal(MEMBERSHIP_AUTHORITY_AUDITOR_VERSION, "1.3.0");
  });
});
