import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { connect as connectSocket } from "node:net";
import {
  createMembershipBaselineUiServer,
  isAllowedMembershipBaselineUiSocket,
  MEMBERSHIP_BASELINE_UI_HOST,
  validateMembershipBaselineUiOptions,
} from "../../scripts/bootstrap/membership-baseline-ui.js";

const mongoUri = "mongodb://local-user:local-secret@localhost:27017/ignored";
const fingerprint = "a".repeat(64);
const processEnvironment = { NODE_ENV: "test" };
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
    conflictingNameExists: false,
  },
  findings: [],
});

const activeApps = [];
afterEach(async () => {
  await Promise.all(activeApps.splice(0).map((app) => app.close()));
});

const startServer = async (runBootstrap, overrides = {}) => {
  const app = createMembershipBaselineUiServer({
    mongoUri,
    options: { environment: "test", database: "agenda_ui_test", port: 0 },
    processEnvironment,
    runBootstrap,
    ...overrides,
  });
  const address = await app.listen();
  activeApps.push(app);
  return {
    ...app,
    url: `http://${address.address}:${address.port}`,
  };
};

const requestBody = () => ({ owners: owners(), expectedTargetFingerprint: fingerprint });

const post = (app, path, body, {
  csrfToken = app.csrfToken,
  contentType = "application/json",
  headers = {},
  raw = false,
} = {}) => fetch(`${app.url}${path}`, {
  method: "POST",
  headers: {
    "content-type": contentType,
    "x-bootstrap-csrf": csrfToken,
    ...headers,
  },
  body: raw ? body : JSON.stringify(body),
});

const rawPost = (app, path, body, headers = {}) => new Promise((resolve, reject) => {
  const request = httpRequest(`${app.url}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(JSON.stringify(body)),
      "x-bootstrap-csrf": app.csrfToken,
      ...headers,
    },
  }, (response) => {
    const chunks = [];
    response.on("data", (chunk) => chunks.push(chunk));
    response.on("end", () => resolve({
      body: Buffer.concat(chunks).toString("utf8"),
      headers: response.headers,
      status: response.statusCode,
    }));
  });
  request.once("error", reject);
  request.end(JSON.stringify(body));
});

const rawHttp = (app, requestTarget) => new Promise((resolve, reject) => {
  const { port } = app.address();
  const socket = connectSocket({ host: "127.0.0.1", port });
  const chunks = [];
  socket.setTimeout(2_000, () => socket.destroy(new Error("raw request timeout")));
  socket.once("connect", () => {
    socket.write(
      `GET ${requestTarget} HTTP/1.1\r\n` +
      `Host: 127.0.0.1:${port}\r\n` +
      "Connection: close\r\n\r\n",
    );
  });
  socket.on("data", (chunk) => chunks.push(chunk));
  socket.once("error", reject);
  socket.once("close", (hadError) => {
    if (!hadError) resolve(Buffer.concat(chunks).toString("utf8"));
  });
});

const plan = async (app, body = requestBody()) => {
  const response = await post(app, "/api/plan", body);
  assert.equal(response.status, 200);
  return response.json();
};

const applyBody = (body, planToken) => ({
  ...body,
  planToken,
  confirmation: "CREATE_MEMBERSHIP_BASELINE",
});

describe("membership baseline local UI", () => {
  it("rechaza entornos externos, despliegues y bases sin sufijo seguro", () => {
    assert.throws(
      () => validateMembershipBaselineUiOptions({
        environment: "production",
        database: "agenda",
      }, { NODE_ENV: "production" }),
      /NODE_ENV/u,
    );
    assert.throws(
      () => validateMembershipBaselineUiOptions({
        environment: "test",
        database: "agenda_ui_test",
      }, { NODE_ENV: "test", VERCEL: "1" }),
      /plataforma de despliegue/u,
    );
    assert.throws(
      () => validateMembershipBaselineUiOptions({
        environment: "development",
        database: "agenda",
      }, { NODE_ENV: "development" }),
      /_dev/u,
    );
    assert.throws(
      () => validateMembershipBaselineUiOptions({
        environment: "test",
        database: "agenda_ui_test",
        port: "70000",
      }, processEnvironment),
      /port/u,
    );
  });

  it("controla el bind y valida las direcciones efectivas del socket", async () => {
    const app = createMembershipBaselineUiServer({
      mongoUri,
      options: { environment: "test", database: "agenda_ui_test", port: 0 },
      processEnvironment,
      runBootstrap: async () => assert.fail("no debe ejecutar"),
    });
    await assert.rejects(
      app.listen({ port: 0, host: "0.0.0.0" }),
      /127\.0\.0\.1/u,
    );
    assert.equal(isAllowedMembershipBaselineUiSocket({
      localAddress: "127.0.0.1",
      remoteAddress: "127.0.0.1",
    }), true);
    assert.equal(isAllowedMembershipBaselineUiSocket({
      localAddress: "127.0.0.1",
      remoteAddress: "10.0.0.5",
    }), false);
    await app.close();
  });

  it("sirve el formulario sólo localmente con cabeceras endurecidas", async () => {
    const app = await startServer(async () => assert.fail("no debe conectar"));
    const response = await fetch(app.url);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("x-frame-options"), "DENY");
    assert.match(response.headers.get("content-security-policy"), /frame-ancestors 'none'/u);
    assert.match(html, /Crear propietarios iniciales/u);
    assert.match(html, /No crea trabajadores/u);
    assert.equal(html.includes(mongoUri), false);
  });

  it("rechaza request-targets malformados o absolutos sin terminar el servidor", async () => {
    let calls = 0;
    const processFailures = [];
    const onUncaught = (error) => processFailures.push(error);
    const onUnhandled = (error) => processFailures.push(error);
    process.on("uncaughtException", onUncaught);
    process.on("unhandledRejection", onUnhandled);
    const app = await startServer(async () => {
      calls += 1;
      return { plan: safePlan(), applied: false, exitCode: 0 };
    });

    try {
      const malformed = await rawHttp(app, "http://[");
      assert.match(malformed, /^HTTP\/1\.1 (?:400|421) /u);

      const absolute = await rawHttp(app, "http://evil.example/");
      assert.match(absolute, /^HTTP\/1\.1 (?:400|421) /u);

      const healthy = await fetch(app.url);
      assert.equal(healthy.status, 200);
      assert.equal(calls, 0);
      assert.deepEqual(processFailures, []);
    } finally {
      process.off("uncaughtException", onUncaught);
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("rechaza Host, Origin y cabeceras de proxy sin invocar el bootstrap", async () => {
    let calls = 0;
    const app = await startServer(async () => {
      calls += 1;
      return { plan: safePlan(), applied: false, exitCode: 0 };
    });
    const body = requestBody();
    const address = app.address();

    const maliciousHost = await rawPost(app, "/api/plan", body, {
      host: "evil.example",
    });
    assert.equal(maliciousHost.status, 421);

    const forgedLocalHost = await rawPost(app, "/api/plan", body, {
      host: "127.0.0.1:1",
    });
    assert.equal(forgedLocalHost.status, 421);

    const invalidOrigin = await post(app, "/api/plan", body, {
      headers: { origin: "https://evil.example" },
    });
    assert.equal(invalidOrigin.status, 403);

    const forwarded = await post(app, "/api/plan", body, {
      headers: {
        origin: `http://127.0.0.1:${address.port}`,
        "x-forwarded-for": "127.0.0.1",
        "x-forwarded-host": `127.0.0.1:${address.port}`,
      },
    });
    assert.equal(forwarded.status, 421);
    assert.equal(calls, 0);
  });

  it("aplica el contrato HTTP de métodos, JSON estricto y límite de 32 KiB", async () => {
    let calls = 0;
    const app = await startServer(async () => {
      calls += 1;
      return { plan: safePlan(), applied: false, exitCode: 0 };
    });

    const method = await fetch(`${app.url}/api/plan`, { method: "GET" });
    assert.equal(method.status, 405);
    assert.equal(method.headers.get("allow"), "POST");

    const invalidType = await post(app, "/api/plan", requestBody(), {
      contentType: "application/json.evil",
    });
    assert.equal(invalidType.status, 415);

    const validCharset = await post(app, "/api/plan", requestBody(), {
      contentType: "application/json; charset=UTF-8",
    });
    assert.equal(validCharset.status, 200);

    const invalidJson = await post(app, "/api/plan", "{", { raw: true });
    assert.equal(invalidJson.status, 400);

    const oversized = await post(app, "/api/plan", `{"padding":"${"x".repeat(33 * 1024)}"}`, {
      raw: true,
    });
    assert.equal(oversized.status, 413);
    assert.equal(calls, 1);
  });

  it("rechaza CSRF, campos desconocidos, omitidos y claves JSON duplicadas", async () => {
    let calls = 0;
    const app = await startServer(async () => {
      calls += 1;
      return { plan: safePlan(), applied: false, exitCode: 0 };
    });
    const body = requestBody();

    assert.equal((await post(app, "/api/plan", body, { csrfToken: "wrong" })).status, 403);
    assert.equal((await post(app, "/api/plan", { ...body, extra: true })).status, 422);
    assert.equal((await post(app, "/api/plan", { owners: body.owners })).status, 422);
    assert.equal((await post(app, "/api/plan", {
      ...body,
      owners: { ...body.owners, dam: { ...body.owners.dam, extra: true } },
    })).status, 422);

    const raw = JSON.stringify(body).replace(
      '"expectedTargetFingerprint"',
      `"expectedTargetFingerprint":"${fingerprint}","expectedTargetFingerprint"`,
    );
    assert.equal((await post(app, "/api/plan", raw, { raw: true })).status, 400);
    assert.equal(calls, 0);
  });

  it("crea un token de un solo uso ligado a cada campo operacional", async () => {
    const calls = [];
    const app = await startServer(async ({ options, manifest }) => {
      calls.push({ options, manifest });
      return {
        plan: { ...safePlan(), state: options.mode === "apply" ? "ready" : "empty" },
        applied: options.mode === "apply",
        exitCode: 0,
      };
    });
    const changes = [
      ["fingerprint", (body) => ({ ...body, expectedTargetFingerprint: "b".repeat(64) })],
      ["atmosfera.firstName", (body) => ({ ...body, owners: { ...body.owners, atmosfera: { ...body.owners.atmosfera, firstName: "Changed" } } })],
      ["atmosfera.lastName", (body) => ({ ...body, owners: { ...body.owners, atmosfera: { ...body.owners.atmosfera, lastName: "Changed" } } })],
      ["atmosfera.email", (body) => ({ ...body, owners: { ...body.owners, atmosfera: { ...body.owners.atmosfera, email: "changed-atmosfera@example.test" } } })],
      ["atmosfera.password", (body) => ({ ...body, owners: { ...body.owners, atmosfera: { ...body.owners.atmosfera, password: "changed-atmosfera-password" } } })],
      ["dam.firstName", (body) => ({ ...body, owners: { ...body.owners, dam: { ...body.owners.dam, firstName: "Changed" } } })],
      ["dam.lastName", (body) => ({ ...body, owners: { ...body.owners, dam: { ...body.owners.dam, lastName: "Changed" } } })],
      ["dam.email", (body) => ({ ...body, owners: { ...body.owners, dam: { ...body.owners.dam, email: "changed-dam@example.test" } } })],
      ["dam.password", (body) => ({ ...body, owners: { ...body.owners, dam: { ...body.owners.dam, password: "changed-dam-password" } } })],
    ];

    for (const [, change] of changes) {
      const body = requestBody();
      const planned = await plan(app, body);
      const rejected = await post(app, "/api/apply", applyBody(change(body), planned.planToken));
      assert.equal(rejected.status, 409);
    }
    assert.equal(calls.filter(({ options }) => options.mode === "apply").length, 0);
  });

  it("consume la aprobación antes de validar cualquier apply alterado", async () => {
    let applyCalls = 0;
    const app = await startServer(async ({ options }) => {
      if (options.mode === "apply") applyCalls += 1;
      return {
        plan: safePlan(),
        applied: options.mode === "apply",
        exitCode: 0,
      };
    });
    const attempts = [
      (body, token) => ({ ...applyBody(body, token), extra: true }),
      (body, token) => {
        const changed = applyBody(structuredClone(body), token);
        delete changed.owners.dam.lastName;
        return changed;
      },
      (body, token) => ({
        ...applyBody(body, token),
        owners: {
          ...body.owners,
          atmosfera: { ...body.owners.atmosfera, email: "invalid" },
        },
      }),
      (body, token) => ({
        ...applyBody(body, token),
        owners: {
          ...body.owners,
          dam: { ...body.owners.dam, password: "short" },
        },
      }),
      (body, token) => ({
        ...applyBody(body, token),
        confirmation: "WRONG",
      }),
      (body, token) => ({
        ...applyBody(body, token),
        owners: {
          ...body.owners,
          dam: { ...body.owners.dam, firstName: "Changed" },
        },
      }),
    ];

    for (const alter of attempts) {
      const body = requestBody();
      const planned = await plan(app, body);
      const rejected = await post(
        app,
        "/api/apply",
        alter(body, planned.planToken),
      );
      assert.ok(rejected.status >= 400 && rejected.status < 500);

      const retry = await post(
        app,
        "/api/apply",
        applyBody(body, planned.planToken),
      );
      assert.equal(retry.status, 409);
      assert.equal((await retry.json()).error.code, "PLAN_REQUIRED");
    }

    const duplicateBody = requestBody();
    const duplicatePlan = await plan(app, duplicateBody);
    const serialized = JSON.stringify(
      applyBody(duplicateBody, duplicatePlan.planToken),
    );
    const duplicateTokenJson = serialized.replace(
      `"planToken":"${duplicatePlan.planToken}"`,
      `"planToken":"${duplicatePlan.planToken}","planToken":"${duplicatePlan.planToken}"`,
    );
    const duplicateRejected = await post(
      app,
      "/api/apply",
      duplicateTokenJson,
      { raw: true },
    );
    assert.equal(duplicateRejected.status, 400);

    const duplicateRetry = await post(
      app,
      "/api/apply",
      applyBody(duplicateBody, duplicatePlan.planToken),
    );
    assert.equal(duplicateRetry.status, 409);
    assert.equal((await duplicateRetry.json()).error.code, "PLAN_REQUIRED");
    assert.equal(applyCalls, 0);
  });

  it("canonicaliza orden y correo, pero rechaza reutilización y confirmación incorrecta", async () => {
    let applyCalls = 0;
    const app = await startServer(async ({ options }) => {
      if (options.mode === "apply") applyCalls += 1;
      return {
        plan: { ...safePlan(), state: options.mode === "apply" ? "ready" : "empty" },
        applied: options.mode === "apply",
        exitCode: 0,
      };
    });
    const body = requestBody();
    body.owners.atmosfera.email = "  OWNER-ATMOSFERA@EXAMPLE.TEST  ";
    const planned = await plan(app, body);
    const normalized = requestBody();
    const reordered = {
      owners: {
        dam: { ...normalized.owners.dam },
        atmosfera: { ...normalized.owners.atmosfera },
      },
      expectedTargetFingerprint: normalized.expectedTargetFingerprint,
    };
    const applied = await post(app, "/api/apply", applyBody(reordered, planned.planToken));
    assert.equal(applied.status, 200);

    const replay = await post(app, "/api/apply", applyBody(reordered, planned.planToken));
    assert.equal(replay.status, 409);

    const next = await plan(app, normalized);
    const tamperedToken = `${next.planToken.slice(0, -1)}${next.planToken.endsWith("0") ? "1" : "0"}`;
    const tampered = await post(app, "/api/apply", applyBody(normalized, tamperedToken));
    assert.equal(tampered.status, 409);

    const afterTamper = await plan(app, normalized);
    const additional = await post(app, "/api/apply", {
      ...applyBody(normalized, afterTamper.planToken),
      extra: true,
    });
    assert.equal(additional.status, 422);

    const afterAdditional = await plan(app, normalized);
    const omitted = applyBody(structuredClone(normalized), afterAdditional.planToken);
    delete omitted.owners.dam.lastName;
    assert.equal((await post(app, "/api/apply", omitted)).status, 422);

    const afterOmitted = await plan(app, normalized);
    const incorrect = await post(app, "/api/apply", {
      ...applyBody(normalized, afterOmitted.planToken),
      confirmation: "WRONG",
    });
    assert.equal(incorrect.status, 409);
    assert.equal(applyCalls, 1);
  });

  it("vence el token antes, exactamente en y después del límite", async () => {
    let clock = 1_000;
    let applyCalls = 0;
    const app = await startServer(async ({ options }) => {
      if (options.mode === "apply") applyCalls += 1;
      return { plan: safePlan(), applied: false, exitCode: 0 };
    }, { now: () => clock, approvalTtlMs: 100 });

    for (const time of [1_100, 1_101]) {
      clock = 1_000;
      const planned = await plan(app);
      clock = time;
      assert.equal((await post(app, "/api/apply", applyBody(requestBody(), planned.planToken))).status, 409);
    }
    clock = 1_000;
    const valid = await plan(app);
    clock = 1_099;
    assert.equal((await post(app, "/api/apply", applyBody(requestBody(), valid.planToken))).status, 200);
    assert.equal(applyCalls, 1);
  });

  it("consume atómicamente un token ante dos apply simultáneos", async () => {
    let releaseApply;
    let applyCalls = 0;
    const applyGate = new Promise((resolve) => { releaseApply = resolve; });
    const app = await startServer(async ({ options }) => {
      if (options.mode === "apply") {
        applyCalls += 1;
        await applyGate;
      }
      return { plan: safePlan(), applied: options.mode === "apply", exitCode: 0 };
    });
    const body = requestBody();
    const planned = await plan(app, body);
    const first = post(app, "/api/apply", applyBody(body, planned.planToken));
    await new Promise((resolve) => setImmediate(resolve));
    const second = await post(app, "/api/apply", applyBody(body, planned.planToken));
    assert.equal(second.status, 409);
    releaseApply();
    assert.equal((await first).status, 200);
    assert.equal(applyCalls, 1);
  });

  it("dos planes concurrentes dejan sólo la aprobación más reciente y reiniciar invalida todos", async () => {
    const resolvers = [];
    let entered = 0;
    let enteredResolve;
    const bothEntered = new Promise((resolve) => { enteredResolve = resolve; });
    const runBootstrap = async ({ options }) => {
      if (options.mode === "apply") {
        return { plan: safePlan(), applied: true, exitCode: 0 };
      }
      entered += 1;
      if (entered === 2) enteredResolve();
      await new Promise((resolve) => resolvers.push(resolve));
      return { plan: safePlan(), applied: false, exitCode: 0 };
    };
    const app = await startServer(runBootstrap);
    const firstRequest = post(app, "/api/plan", requestBody());
    const secondRequest = post(app, "/api/plan", requestBody());
    await bothEntered;
    resolvers.shift()();
    const first = await (await firstRequest).json();
    resolvers.shift()();
    const second = await (await secondRequest).json();
    assert.equal((await post(app, "/api/apply", applyBody(requestBody(), first.planToken))).status, 409);

    const restarted = await startServer(async () => ({
      plan: safePlan(),
      applied: false,
      exitCode: 0,
    }));
    assert.equal((await post(restarted, "/api/apply", applyBody(requestBody(), second.planToken))).status, 409);
  });

  it("no expone datos crudos, normalizados ni errores de dependencias", async () => {
    const sensitiveOwners = owners();
    sensitiveOwners.atmosfera.firstName = "  Jose\u0301  ";
    sensitiveOwners.atmosfera.lastName = "  Secret Last  ";
    sensitiveOwners.atmosfera.email = "  OWNER-ATMOSFERA@EXAMPLE.TEST  ";
    const body = { owners: sensitiveOwners, expectedTargetFingerprint: fingerprint };
    const failures = [
      new Error(`driver ${mongoUri} owner-atmosfera@example.test José ${fingerprint} ${JSON.stringify(body)}`),
      `bcrypt ${sensitiveOwners.atmosfera.password}`,
      { document: body, uri: mongoUri },
    ];

    for (const failure of failures) {
      const app = await startServer(async () => { throw failure; });
      const response = await post(app, "/api/plan", body);
      const serialized = JSON.stringify(await response.json());
      assert.equal(response.status, 500);
      assert.deepEqual(JSON.parse(serialized), {
        error: {
          code: "INTERNAL_ERROR",
          message: "La operación local falló sin exponer detalles internos",
        },
      });
      for (const secret of [
        mongoUri,
        fingerprint,
        "Jose\u0301",
        "José",
        "Secret Last",
        "OWNER-ATMOSFERA@EXAMPLE.TEST",
        "owner-atmosfera@example.test",
        sensitiveOwners.atmosfera.password,
      ]) {
        assert.equal(serialized.includes(secret), false);
      }
    }
  });
});
