import test from "node:test";
import assert from "node:assert/strict";
import { validateProductionConfig } from "../../src/config/productionConfig.js";
import { redactLogValue } from "../../src/config/logger.js";
import { readinessState } from "../../src/routes/health.routes.js";

const validEnv = () => ({
  NODE_ENV: "production",
  MONGO_URI: "mongodb+srv://user:password@cluster.example.mongodb.net/agenda?retryWrites=true&w=majority",
  SESSION_SECRET: "0123456789abcdef0123456789abcdef0123456789abcdef",
  FRONTEND_URL: "https://app.agenda.example",
  BACKEND_URL: "https://api.agenda.example",
  CORS_ORIGINS: "https://app.agenda.example",
  RESEND_API_KEY: "re_0123456789abcdefghijklmnopqrstuvwxyz",
  SMTP_FROM_EMAIL: "agenda@example.com",
  TRUST_PROXY_HOPS: "1",
});

test("production config accepts an explicit secure topology", () => {
  const config = validateProductionConfig(validEnv());
  assert.equal(config.production, true);
  assert.equal(config.frontendOrigin, "https://app.agenda.example");
  assert.deepEqual(config.corsOrigins, ["https://app.agenda.example"]);
});

test("production config fails closed when critical values are absent", () => {
  const env = validEnv();
  delete env.SESSION_SECRET;
  assert.throws(() => validateProductionConfig(env), /SESSION_SECRET is required/u);
});

test("production config rejects insecure defaults and incoherent origins", () => {
  assert.throws(
    () => validateProductionConfig({ ...validEnv(), SESSION_SECRET: "secret" }),
    /SESSION_SECRET/u,
  );
  assert.throws(
    () => validateProductionConfig({ ...validEnv(), FRONTEND_URL: "http://localhost:4321" }),
    /FRONTEND_URL/u,
  );
  assert.throws(
    () => validateProductionConfig({ ...validEnv(), CORS_ORIGINS: "*" }),
    /wildcard/u,
  );
  assert.throws(
    () => validateProductionConfig({ ...validEnv(), CORS_ORIGINS: "https://other.example" }),
    /must include FRONTEND_URL/u,
  );
});

test("production config rejects Mongo/session secret reuse", () => {
  const shared = validEnv().SESSION_SECRET;
  assert.throws(
    () => validateProductionConfig({ ...validEnv(), PASSWORD_MONGO: shared }),
    /must be independent/u,
  );
});

test("logger redaction removes secret-bearing fields and bearer material", () => {
  const redacted = redactLogValue({
    authorization: "Bearer abc.def.ghi",
    sessionSecret: "super-secret",
    nested: { token: "capability-secret", message: "Bearer raw-token" },
    uri: "mongodb://user:pass@example.invalid/agenda",
  });
  assert.equal(redacted.authorization, "[REDACTED]");
  assert.equal(redacted.sessionSecret, "[REDACTED]");
  assert.equal(redacted.nested.token, "[REDACTED]");
  assert.equal(redacted.nested.message, "Bearer [REDACTED]");
  assert.equal(redacted.uri, "mongodb://[REDACTED]@example.invalid/agenda");
});

test("readiness degrades without a connected database and exposes no detail", async () => {
  assert.deepEqual(await readinessState({ connection: { readyState: 0, db: null } }), { ready: false });
  assert.deepEqual(await readinessState({
    connection: { readyState: 1, db: { admin: () => ({ ping: async () => ({ ok: 1 }) }) } },
  }), { ready: true });
});
