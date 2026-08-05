import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createMembershipBaselineUiServer,
  MEMBERSHIP_BASELINE_UI_HOST,
  validateMembershipBaselineUiOptions,
} from "../../scripts/bootstrap/membership-baseline-ui.js";

const mongoUri = "mongodb://localhost:27017/ignored";
const fingerprint = "a".repeat(64);
const owners = () => ({
  atmosfera: {
    firstName: "Owner",
    lastName: "Atmósfera",
    email: "owner-atmosfera@example.test",
    password: "atmosfera-owner-safe",
  },
  dam: {
    firstName: "Owner",
    lastName: "DAM",
    email: "owner-dam@example.test",
    password: "dam-owner-password",
  },
});
const safePlan = () => ({
  version: "2.0.0",
  state: "empty",
  canApply: true,
  idempotentNoop: false,
  counts: { businesses: 0, users: 0, memberships: 0 },
  membershipIndex: {
    exactUniqueExists: false,
    conflictingDefinitionExists: false,
  },
  findings: [],
});

const activeServers = [];
afterEach(async () => {
  await Promise.all(activeServers.splice(0).map(
    (server) => new Promise((resolve) => server.close(resolve)),
  ));
});

const startServer = async (runBootstrap) => {
  const created = createMembershipBaselineUiServer({
    mongoUri,
    options: { environment: "test", database: "agenda_ui_test", port: 0 },
    runBootstrap,
  });
  await new Promise((resolve, reject) => {
    created.server.once("error", reject);
    created.server.listen(0, MEMBERSHIP_BASELINE_UI_HOST, resolve);
  });
  activeServers.push(created.server);
  const address = created.server.address();
  return {
    ...created,
    url: `http://${MEMBERSHIP_BASELINE_UI_HOST}:${address.port}`,
  };
};

const post = (app, path, body, csrfToken = app.csrfToken) =>
  fetch(`${app.url}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-bootstrap-csrf": csrfToken,
    },
    body: JSON.stringify(body),
  });

describe("membership baseline local UI", () => {
  it("rechaza entornos externos y sólo permite un puerto local válido", () => {
    assert.throws(
      () => validateMembershipBaselineUiOptions({
        environment: "production",
        database: "agenda",
      }),
      /development o test/u,
    );
    assert.throws(
      () => validateMembershipBaselineUiOptions({
        environment: "development",
        database: "agenda_dev",
        port: "70000",
      }),
      /port/u,
    );
  });

  it("sirve únicamente el formulario local con cabeceras no-store", async () => {
    const app = await startServer(async () => assert.fail("no debe conectar"));
    const response = await fetch(app.url);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.match(response.headers.get("content-security-policy"), /default-src 'none'/u);
    assert.match(html, /Crear propietarios iniciales/u);
    assert.match(html, /No crea trabajadores/u);
    assert.equal(html.includes(mongoUri), false);
  });

  it("exige CSRF y un plan seguro antes de apply", async () => {
    const app = await startServer(async () => ({
      plan: safePlan(),
      applied: false,
      exitCode: 0,
    }));
    const request = { owners: owners(), expectedTargetFingerprint: fingerprint };

    const forbidden = await post(app, "/api/plan", request, "wrong-token");
    assert.equal(forbidden.status, 403);

    const applyWithoutPlan = await post(app, "/api/apply", {
      ...request,
      confirmation: "CREATE_MEMBERSHIP_BASELINE",
    });
    assert.equal(applyWithoutPlan.status, 409);
  });

  it("crea un permiso de apply de un solo uso ligado exactamente al plan", async () => {
    const calls = [];
    const app = await startServer(async ({ options, manifest }) => {
      calls.push({ options, manifest });
      return {
        plan: { ...safePlan(), state: options.mode === "apply" ? "ready" : "empty" },
        applied: options.mode === "apply",
        exitCode: 0,
      };
    });
    const request = { owners: owners(), expectedTargetFingerprint: fingerprint };
    const plannedResponse = await post(app, "/api/plan", request);
    const planned = await plannedResponse.json();

    assert.equal(plannedResponse.status, 200);
    assert.match(planned.planToken, /^[0-9a-f-]{36}$/u);
    assert.equal(calls[0].manifest.users.length, 2);
    assert.equal(calls[0].manifest.memberships.length, 2);
    assert.ok(calls[0].manifest.memberships.every(({ role }) => role === "admin"));

    const changed = {
      ...request,
      owners: {
        ...request.owners,
        dam: { ...request.owners.dam, password: "changed-owner-password" },
      },
      planToken: planned.planToken,
      confirmation: "CREATE_MEMBERSHIP_BASELINE",
    };
    const changedResponse = await post(app, "/api/apply", changed);
    assert.equal(changedResponse.status, 409);
    assert.equal(calls.length, 1);

    const replanned = await (await post(app, "/api/plan", request)).json();
    const appliedResponse = await post(app, "/api/apply", {
      ...request,
      planToken: replanned.planToken,
      confirmation: "CREATE_MEMBERSHIP_BASELINE",
    });
    const applied = await appliedResponse.json();
    assert.equal(appliedResponse.status, 200);
    assert.equal(applied.applied, true);
    assert.equal(calls.at(-1).options.mode, "apply");

    const replay = await post(app, "/api/apply", {
      ...request,
      planToken: replanned.planToken,
      confirmation: "CREATE_MEMBERSHIP_BASELINE",
    });
    assert.equal(replay.status, 409);
  });

  it("no devuelve URI, correos ni contraseñas cuando una operación falla", async () => {
    const request = { owners: owners(), expectedTargetFingerprint: fingerprint };
    const app = await startServer(async () => {
      throw new Error(
        `fallo ${mongoUri} ${request.owners.atmosfera.email} ${request.owners.dam.password}`,
      );
    });
    const response = await post(app, "/api/plan", request);
    const serialized = JSON.stringify(await response.json());

    assert.equal(response.status, 400);
    assert.equal(serialized.includes(mongoUri), false);
    assert.equal(serialized.includes(request.owners.atmosfera.email), false);
    assert.equal(serialized.includes(request.owners.dam.password), false);
    assert.equal(serialized.includes(fingerprint), false);
  });
});
