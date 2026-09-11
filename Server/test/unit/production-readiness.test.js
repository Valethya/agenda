import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { validateProductionConfig } from "../../src/config/productionConfig.js";
import { redactLogValue } from "../../src/config/logger.js";
import { readinessState } from "../../src/routes/health.routes.js";
import { sessionCookieOptionsFor } from "../../src/config/sessionPolicy.js";
import {
  isBearerAuthorizedGuestConsumeRoute,
  isDynamicPublicHeadlessRoute,
} from "../../src/config/corsPolicy.js";

const validEnv = () => ({
  NODE_ENV: "production",
  MONGO_URI: "mongodb+srv://example-user:example-password@cluster.example.invalid/agenda?retryWrites=true&w=majority",
  SESSION_SECRET: "unit-test-session-material-0123456789-abcdef-XYZ",
  FRONTEND_URL: "https://app.agenda.example",
  BACKEND_URL: "https://api.agenda.example",
  CORS_ORIGINS: "https://app.agenda.example",
  RESEND_API_KEY: "unit-test-provider-key-material-0123456789",
  SMTP_FROM_EMAIL: "agenda@example.com",
  TRUST_PROXY_HOPS: "1",
});

const request = (method, path, preflightMethod = "") => ({
  method,
  path,
  originalUrl: path,
  get: (name) => (name.toLowerCase() === "access-control-request-method" ? preflightMethod : undefined),
});

test("production config accepts an explicit secure topology", () => {
  const config = validateProductionConfig(validEnv());
  assert.equal(config.production, true);
  assert.equal(config.frontendOrigin, "https://app.agenda.example");
  assert.deepEqual(config.corsOrigins, ["https://app.agenda.example"]);
  assert.equal(config.trustProxyHops, 1);
});

test("production config fails closed when critical values are absent", () => {
  for (const key of ["MONGO_URI", "SESSION_SECRET", "FRONTEND_URL", "BACKEND_URL", "CORS_ORIGINS", "RESEND_API_KEY", "SMTP_FROM_EMAIL", "TRUST_PROXY_HOPS"]) {
    const env = validEnv();
    delete env[key];
    assert.throws(() => validateProductionConfig(env), new RegExp(`${key} is required`, "u"));
  }
});

test("actual production env module exits import when critical config is missing without printing values", () => {
  const env = validEnv();
  delete env.SESSION_SECRET;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", "import('./src/config/env.js')"], {
    cwd: process.cwd(),
    env: { ...process.env, ...env, SESSION_SECRET: "" },
    encoding: "utf8",
  });
  assert.notEqual(child.status, 0);
  assert.match(child.stderr, /SESSION_SECRET is required/u);
  assert.doesNotMatch(child.stderr, /example-password/u);
  assert.doesNotMatch(child.stderr, /unit-test-provider-key-material/u);
});

test("production config rejects insecure defaults and incoherent origins", () => {
  assert.throws(() => validateProductionConfig({ ...validEnv(), SESSION_SECRET: "secret" }), /SESSION_SECRET/u);
  assert.throws(() => validateProductionConfig({ ...validEnv(), FRONTEND_URL: "http://localhost:4321" }), /FRONTEND_URL/u);
  assert.throws(() => validateProductionConfig({ ...validEnv(), CORS_ORIGINS: "*" }), /wildcard/u);
  assert.throws(() => validateProductionConfig({ ...validEnv(), CORS_ORIGINS: "https://other.example" }), /must include FRONTEND_URL/u);
  assert.throws(() => validateProductionConfig({ ...validEnv(), TRUST_PROXY_HOPS: "0" }), /TRUST_PROXY_HOPS/u);
  assert.throws(() => validateProductionConfig({ ...validEnv(), TRUST_PROXY_HOPS: "9" }), /TRUST_PROXY_HOPS/u);
  assert.throws(() => validateProductionConfig({ ...validEnv(), SMTP_FROM_EMAIL: "not-an-email" }), /SMTP_FROM_EMAIL/u);
});

test("production config rejects Mongo/session secret reuse", () => {
  const shared = validEnv().SESSION_SECRET;
  assert.throws(() => validateProductionConfig({ ...validEnv(), PASSWORD_MONGO: shared }), /must be independent/u);
});

test("session cookie policy differs safely between development and production", () => {
  assert.deepEqual(sessionCookieOptionsFor("production"), {
    httpOnly: true,
    maxAge: 86_400_000,
    secure: true,
    sameSite: "none",
  });
  assert.deepEqual(sessionCookieOptionsFor("development"), {
    httpOnly: true,
    maxAge: 86_400_000,
    secure: false,
    sameSite: "lax",
  });
});

test("publicWeb CORS classifies all guest challenge/verify routes and bearer consumes coherently", () => {
  for (const action of ["read", "cancel", "reschedule"]) {
    assert.equal(isDynamicPublicHeadlessRoute(request("POST", `/api/guest-appointments/${action}/challenge`)), true);
    assert.equal(isDynamicPublicHeadlessRoute(request("OPTIONS", `/api/guest-appointments/${action}/verify`, "POST")), true);
    assert.equal(isBearerAuthorizedGuestConsumeRoute(request("POST", `/api/guest-appointments/${action}`)), true);
    assert.equal(isBearerAuthorizedGuestConsumeRoute(request("OPTIONS", `/api/guest-appointments/${action}`, "POST")), true);
  }
  assert.equal(isDynamicPublicHeadlessRoute(request("POST", "/api/admin/team")), false);
  assert.equal(isBearerAuthorizedGuestConsumeRoute(request("POST", "/api/guest-appointments/read/challenge")), false);
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
  assert.deepEqual(await readinessState({
    connection: { readyState: 1, db: { admin: () => ({ ping: async () => { throw new Error("private detail"); } }) } },
  }), { ready: false });
});
