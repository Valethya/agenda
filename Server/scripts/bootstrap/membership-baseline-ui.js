import "dotenv/config";

import {
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { createServer } from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildMembershipBaselineManifestFromOwners,
  MEMBERSHIP_BASELINE_CONFIRMATION,
  MembershipBaselineUnknownResultError,
  runMembershipBaselineBootstrap,
  validateMembershipBaselineOptions,
} from "./membership-baseline.js";
import {
  fingerprintMongoTarget,
  validateTargetFingerprint,
} from "../migrations/membership-authority-provenance.js";

export const MEMBERSHIP_BASELINE_UI_HOST = "127.0.0.1";
export const MEMBERSHIP_BASELINE_UI_DEFAULT_PORT = 4177;
export const MEMBERSHIP_BASELINE_UI_APPROVAL_TTL_MS = 5 * 60 * 1000;

const MAX_REQUEST_BYTES = 32 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;
const HEADERS_TIMEOUT_MS = 10_000;
const KEEP_ALIVE_TIMEOUT_MS = 1_000;
const MAX_REQUESTS_PER_SOCKET = 20;
const ALLOWED_FORWARDING_HEADERS = Object.freeze([
  "forwarded",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
]);
const HTML_HEADERS = {
  "cache-control": "no-store",
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'",
  "content-type": "text/html; charset=utf-8",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};
const JSON_HEADERS = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

class PublicRequestError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "PublicRequestError";
    this.status = status;
    this.code = code;
  }
}

const publicError = (status, code, message) =>
  new PublicRequestError(status, code, message);

const escapeHtml = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

const parseArguments = (argv) => {
  const values = {};
  const allowed = new Set(["environment", "database", "port"]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help") return { help: true };
    if (!argument.startsWith("--")) {
      throw new Error(`Argumento no reconocido: ${argument}`);
    }
    const separator = argument.indexOf("=");
    const key = separator === -1 ? argument.slice(2) : argument.slice(2, separator);
    if (!allowed.has(key)) throw new Error(`Opción no reconocida: --${key}`);
    const inlineValue = separator === -1 ? undefined : argument.slice(separator + 1);
    const value = inlineValue ?? argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Falta valor para --${key}`);
    if (Object.hasOwn(values, key)) throw new Error(`Opción duplicada: --${key}`);
    values[key] = value;
    if (inlineValue === undefined) index += 1;
  }
  return values;
};

export const validateMembershipBaselineUiOptions = (
  options,
  processEnvironment = process.env,
) => {
  validateMembershipBaselineOptions({
    mode: "plan",
    environment: options.environment,
    database: options.database,
    expectedTargetFingerprint: "0".repeat(64),
  }, processEnvironment);
  const port = options.port === undefined
    ? MEMBERSHIP_BASELINE_UI_DEFAULT_PORT
    : Number(options.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("--port debe ser un entero entre 0 y 65535");
  }
  return { environment: options.environment, database: options.database, port };
};

const exactKeys = (value, expected, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw publicError(422, "INVALID_REQUEST", `${label} no es válido`);
  }
  const keys = Object.keys(value).sort();
  const expectedKeys = [...expected].sort();
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw publicError(
      422,
      "INVALID_REQUEST",
      `${label} contiene campos ausentes o desconocidos`,
    );
  }
};

const normalizeOperation = (payload, { apply }) => {
  exactKeys(
    payload,
    apply
      ? ["confirmation", "expectedTargetFingerprint", "owners", "planToken"]
      : ["expectedTargetFingerprint", "owners"],
    "La solicitud",
  );
  exactKeys(payload.owners, ["atmosfera", "dam"], "owners");
  for (const key of ["atmosfera", "dam"]) {
    exactKeys(
      payload.owners[key],
      ["email", "firstName", "lastName", "password"],
      `owners.${key}`,
    );
  }

  let manifest;
  let expectedTargetFingerprint;
  try {
    manifest = buildMembershipBaselineManifestFromOwners(payload.owners);
    expectedTargetFingerprint = validateTargetFingerprint(
      payload.expectedTargetFingerprint,
    );
  } catch {
    throw publicError(
      422,
      "INVALID_REQUEST",
      "Los datos enviados no cumplen el contrato de la baseline",
    );
  }

  const owners = Object.fromEntries(manifest.users.map((user) => [
    user.businessKey,
    {
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      password: user.password,
    },
  ]));

  if (apply) {
    if (
      typeof payload.planToken !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
        payload.planToken,
      )
    ) {
      throw publicError(
        409,
        "PLAN_REQUIRED",
        "Debe ejecutar nuevamente un plan seguro antes de aplicar",
      );
    }
    if (payload.confirmation !== MEMBERSHIP_BASELINE_CONFIRMATION) {
      throw publicError(
        409,
        "PLAN_REQUIRED",
        "Debe ejecutar nuevamente un plan seguro antes de aplicar",
      );
    }
  }

  return {
    confirmation: apply ? payload.confirmation : undefined,
    expectedTargetFingerprint,
    manifest,
    owners,
    planToken: apply ? payload.planToken : undefined,
  };
};

const canonicalRequest = ({ owners, expectedTargetFingerprint }) =>
  JSON.stringify({
    expectedTargetFingerprint,
    owners: {
      atmosfera: {
        firstName: owners.atmosfera.firstName,
        lastName: owners.atmosfera.lastName,
        email: owners.atmosfera.email,
        password: owners.atmosfera.password,
      },
      dam: {
        firstName: owners.dam.firstName,
        lastName: owners.dam.lastName,
        email: owners.dam.email,
        password: owners.dam.password,
      },
    },
  });

const requestDigest = (secret, request) =>
  createHmac("sha256", secret).update(canonicalRequest(request), "utf8").digest();

const equalDigest = (left, right) =>
  Buffer.isBuffer(left) &&
  Buffer.isBuffer(right) &&
  left.length === right.length &&
  timingSafeEqual(left, right);

const parseStrictJson = (source) => {
  let index = 0;
  const whitespace = () => {
    while (/\s/u.test(source[index] ?? "")) index += 1;
  };
  const parseString = () => {
    const start = index;
    index += 1;
    let escaped = false;
    while (index < source.length) {
      const character = source[index];
      if (!escaped && character === '"') {
        index += 1;
        return JSON.parse(source.slice(start, index));
      }
      if (!escaped && character === "\\") {
        escaped = true;
      } else {
        escaped = false;
      }
      index += 1;
    }
    throw new Error("unterminated string");
  };
  const parseValue = () => {
    whitespace();
    const character = source[index];
    if (character === '"') return parseString();
    if (character === "{") return parseObject();
    if (character === "[") return parseArray();
    for (const [literal, value] of [["true", true], ["false", false], ["null", null]]) {
      if (source.startsWith(literal, index)) {
        index += literal.length;
        return value;
      }
    }
    const number = source.slice(index).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u)?.[0];
    if (number) {
      index += number.length;
      return Number(number);
    }
    throw new Error("invalid value");
  };
  const parseObject = () => {
    index += 1;
    whitespace();
    const result = {};
    const keys = new Set();
    if (source[index] === "}") {
      index += 1;
      return result;
    }
    while (index < source.length) {
      whitespace();
      if (source[index] !== '"') throw new Error("invalid object key");
      const key = parseString();
      if (keys.has(key)) throw new Error("duplicate object key");
      keys.add(key);
      whitespace();
      if (source[index] !== ":") throw new Error("missing colon");
      index += 1;
      result[key] = parseValue();
      whitespace();
      if (source[index] === "}") {
        index += 1;
        return result;
      }
      if (source[index] !== ",") throw new Error("missing comma");
      index += 1;
    }
    throw new Error("unterminated object");
  };
  const parseArray = () => {
    index += 1;
    whitespace();
    const result = [];
    if (source[index] === "]") {
      index += 1;
      return result;
    }
    while (index < source.length) {
      result.push(parseValue());
      whitespace();
      if (source[index] === "]") {
        index += 1;
        return result;
      }
      if (source[index] !== ",") throw new Error("missing comma");
      index += 1;
    }
    throw new Error("unterminated array");
  };

  const value = parseValue();
  whitespace();
  if (index !== source.length) throw new Error("trailing data");
  return value;
};

const readJson = async (request) => {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > MAX_REQUEST_BYTES) {
      throw publicError(
        413,
        "PAYLOAD_TOO_LARGE",
        "La solicitud supera el tamaño permitido",
      );
    }
    chunks.push(chunk);
  }
  try {
    return parseStrictJson(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw publicError(400, "INVALID_JSON", "La solicitud JSON no es válida");
  }
};

const isAllowedJsonContentType = (rawValue) => {
  if (typeof rawValue !== "string") return false;
  const parts = rawValue.split(";").map((part) => part.trim());
  if (parts.shift()?.toLowerCase() !== "application/json") return false;
  if (parts.length === 0) return true;
  if (parts.length !== 1) return false;
  const separator = parts[0].indexOf("=");
  if (separator === -1) return false;
  const name = parts[0].slice(0, separator).trim().toLowerCase();
  const value = parts[0].slice(separator + 1).trim().replace(/^"|"$/gu, "").toLowerCase();
  return name === "charset" && value === "utf-8";
};

const writeJson = (response, status, body) => {
  response.writeHead(status, JSON_HEADERS);
  response.end(JSON.stringify(body));
};

const writePublicError = (response, error) => {
  if (error instanceof PublicRequestError) {
    writeJson(response, error.status, {
      error: { code: error.code, message: error.message },
    });
    return;
  }
  if (error instanceof MembershipBaselineUnknownResultError) {
    writeJson(response, 500, {
      error: {
        code: "BOOTSTRAP_UNKNOWN",
        message: "El resultado no pudo confirmarse; ejecute un nuevo plan antes de reintentar",
      },
    });
    return;
  }
  writeJson(response, 500, {
    error: {
      code: "INTERNAL_ERROR",
      message: "La operación local falló sin exponer detalles internos",
    },
  });
};

const clearSensitiveOperation = (operation) => {
  for (const owner of Object.values(operation?.owners ?? {})) {
    if (owner && typeof owner === "object") owner.password = "";
  }
  for (const user of operation?.manifest?.users ?? []) user.password = "";
};

export const isAllowedMembershipBaselineUiSocket = (socket) =>
  socket?.localAddress === MEMBERSHIP_BASELINE_UI_HOST &&
  socket?.remoteAddress === MEMBERSHIP_BASELINE_UI_HOST;

const renderPage = ({ csrfToken, environment, database }) => `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="bootstrap-csrf" content="${escapeHtml(csrfToken)}">
  <title>Baseline de propietarios</title>
  <style>
    :root { color-scheme: light; font-family: Inter, system-ui, sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #f4f4f0; color: #171717; }
    main { width: min(860px, calc(100% - 32px)); margin: 48px auto; }
    header { margin-bottom: 32px; }
    h1 { font-size: clamp(2rem, 6vw, 4rem); line-height: .95; margin: 0 0 16px; }
    p { line-height: 1.55; }
    .context, fieldset, .result { background: #fff; border: 1px solid #d7d7cf; border-radius: 14px; }
    .context { display: flex; gap: 24px; padding: 14px 18px; margin: 20px 0; flex-wrap: wrap; }
    .context strong { display: block; font-size: .78rem; text-transform: uppercase; letter-spacing: .08em; }
    form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }
    fieldset { margin: 0; padding: 22px; min-width: 0; }
    legend { font-weight: 750; padding: 0 8px; }
    label { display: block; font-size: .86rem; font-weight: 650; margin-top: 14px; }
    input { width: 100%; margin-top: 6px; padding: 11px 12px; border: 1px solid #aaa; border-radius: 8px; font: inherit; }
    .fingerprint { grid-column: 1 / -1; }
    .actions { grid-column: 1 / -1; display: flex; gap: 12px; flex-wrap: wrap; }
    button { border: 0; border-radius: 999px; padding: 12px 20px; font: inherit; font-weight: 750; cursor: pointer; }
    #plan { background: #155eef; color: white; }
    #apply { background: #ef6c22; color: #111; }
    button:disabled { opacity: .45; cursor: not-allowed; }
    .result { margin-top: 20px; padding: 18px; min-height: 76px; white-space: pre-wrap; }
    .notice { font-size: .9rem; color: #555; }
    @media (max-width: 680px) { main { margin: 24px auto; } form { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
<main>
  <header>
    <h1>Crear propietarios iniciales</h1>
    <p>Este asistente local crea únicamente las autoridades administrativas de Atmósfera y DAM. No crea trabajadores, servicios, turnos ni reservas.</p>
    <div class="context"><span><strong>Entorno</strong>${escapeHtml(environment)}</span><span><strong>Base</strong>${escapeHtml(database)}</span></div>
    <p class="notice">Las contraseñas permanecen en esta página y en memoria durante cada solicitud. No se guardan en archivos ni se muestran en el resultado.</p>
  </header>
  <form id="baseline" autocomplete="off">
    <fieldset>
      <legend>Atmósfera</legend>
      <label>Nombre<input name="atmosfera.firstName" maxlength="80" required></label>
      <label>Apellido<input name="atmosfera.lastName" maxlength="80" required></label>
      <label>Correo<input name="atmosfera.email" type="email" maxlength="254" autocomplete="off" required></label>
      <label>Contraseña<input name="atmosfera.password" type="password" minlength="12" maxlength="256" autocomplete="new-password" required></label>
    </fieldset>
    <fieldset>
      <legend>DAM</legend>
      <label>Nombre<input name="dam.firstName" maxlength="80" required></label>
      <label>Apellido<input name="dam.lastName" maxlength="80" required></label>
      <label>Correo<input name="dam.email" type="email" maxlength="254" autocomplete="off" required></label>
      <label>Contraseña<input name="dam.password" type="password" minlength="12" maxlength="256" autocomplete="new-password" required></label>
    </fieldset>
    <label class="fingerprint">Fingerprint aprobado del destino<input name="expectedTargetFingerprint" minlength="64" maxlength="64" pattern="[a-fA-F0-9]{64}" autocomplete="off" required></label>
    <div class="actions">
      <button id="plan" type="submit">Comprobar plan</button>
      <button id="apply" type="button" disabled>Crear baseline</button>
    </div>
  </form>
  <div id="result" class="result" role="status" aria-live="polite">Aún no se ha ejecutado el plan.</div>
</main>
<script>
  const form = document.querySelector('#baseline');
  const planButton = document.querySelector('#plan');
  const applyButton = document.querySelector('#apply');
  const result = document.querySelector('#result');
  const csrf = document.querySelector('meta[name="bootstrap-csrf"]').content;
  let planToken = null;

  const payload = () => {
    const data = new FormData(form);
    return {
      expectedTargetFingerprint: data.get('expectedTargetFingerprint'),
      owners: {
        atmosfera: { firstName: data.get('atmosfera.firstName'), lastName: data.get('atmosfera.lastName'), email: data.get('atmosfera.email'), password: data.get('atmosfera.password') },
        dam: { firstName: data.get('dam.firstName'), lastName: data.get('dam.lastName'), email: data.get('dam.email'), password: data.get('dam.password') },
      },
    };
  };

  const show = (body) => {
    if (body.plan) {
      result.textContent = [
        'Estado: ' + body.plan.state,
        'Aplicado: ' + Boolean(body.applied),
        'Negocios: ' + body.plan.counts.businesses,
        'Usuarios: ' + body.plan.counts.users,
        'Memberships: ' + body.plan.counts.memberships,
        'Índice exacto: ' + body.plan.membershipIndex.exactUniqueExists,
        'Hallazgos: ' + (body.plan.findings.length ? body.plan.findings.join(', ') : 'ninguno'),
      ].join('\n');
    } else {
      result.textContent = body.error?.message || 'La operación fue rechazada';
    }
  };

  const request = async (endpoint, body) => {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-bootstrap-csrf': csrf },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    show(data);
    if (!response.ok) throw new Error('request-rejected');
    return data;
  };

  form.addEventListener('input', () => { planToken = null; applyButton.disabled = true; });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    planButton.disabled = true;
    applyButton.disabled = true;
    try {
      const response = await request('/api/plan', payload());
      planToken = response.planToken || null;
      applyButton.disabled = !planToken;
    } catch { planToken = null; }
    finally { planButton.disabled = false; }
  });
  applyButton.addEventListener('click', async () => {
    if (!planToken || !confirm('¿Crear la baseline administrativa de Atmósfera y DAM?')) return;
    planButton.disabled = true;
    applyButton.disabled = true;
    try {
      await request('/api/apply', { ...payload(), planToken, confirmation: '${MEMBERSHIP_BASELINE_CONFIRMATION}' });
      planToken = null;
    } catch { planToken = null; }
    finally {
      form.querySelectorAll('input[type="password"]').forEach((input) => { input.value = ''; });
      planButton.disabled = false;
    }
  });
  window.addEventListener('beforeunload', () => {
    form.querySelectorAll('input[type="password"]').forEach((input) => { input.value = ''; });
  });
</script>
</body>
</html>`;

export const createMembershipBaselineUiServer = ({
  mongoUri,
  options,
  runBootstrap = runMembershipBaselineBootstrap,
  now = () => Date.now(),
  approvalTtlMs = MEMBERSHIP_BASELINE_UI_APPROVAL_TTL_MS,
  processEnvironment = process.env,
}) => {
  const validated = validateMembershipBaselineUiOptions(
    options,
    processEnvironment,
  );
  if (!mongoUri) throw new Error("MONGO_URI es obligatoria");
  fingerprintMongoTarget(mongoUri, validated.database);

  const csrfToken = randomBytes(32).toString("hex");
  const approvalSecret = randomBytes(32);
  const approvals = new Map();
  let planSequence = 0;

  const server = createServer(async (request, response) => {
    const localPort = request.socket.localPort;
    const expectedHost = `${MEMBERSHIP_BASELINE_UI_HOST}:${localPort}`;
    const expectedOrigin = `http://${expectedHost}`;
    const hasForwardingHeader = ALLOWED_FORWARDING_HEADERS.some(
      (header) => request.headers[header] !== undefined,
    );
    if (
      !isAllowedMembershipBaselineUiSocket(request.socket) ||
      request.headers.host !== expectedHost ||
      hasForwardingHeader
    ) {
      writePublicError(
        response,
        publicError(421, "LOCAL_BOUNDARY_REJECTED", "Conexión local no permitida"),
      );
      return;
    }
    if (
      request.headers.origin !== undefined &&
      request.headers.origin !== expectedOrigin
    ) {
      writePublicError(
        response,
        publicError(403, "ORIGIN_REJECTED", "Origen local no autorizado"),
      );
      return;
    }

    const requestUrl = new URL(request.url ?? "/", `http://${MEMBERSHIP_BASELINE_UI_HOST}`);
    if (request.method === "GET" && requestUrl.pathname === "/") {
      response.writeHead(200, HTML_HEADERS);
      response.end(renderPage({ csrfToken, ...validated }));
      return;
    }

    const allowedMethod = requestUrl.pathname === "/" ? "GET" :
      ["/api/plan", "/api/apply"].includes(requestUrl.pathname) ? "POST" : null;
    if (allowedMethod && request.method !== allowedMethod) {
      response.setHeader("allow", allowedMethod);
      writePublicError(
        response,
        publicError(405, "METHOD_NOT_ALLOWED", "Método no permitido"),
      );
      return;
    }
    if (!allowedMethod) {
      writePublicError(
        response,
        publicError(404, "NOT_FOUND", "Ruta no disponible"),
      );
      return;
    }
    if (request.headers["x-bootstrap-csrf"] !== csrfToken) {
      writePublicError(
        response,
        publicError(403, "CSRF_REJECTED", "Solicitud local no autorizada"),
      );
      return;
    }
    if (!isAllowedJsonContentType(request.headers["content-type"])) {
      writePublicError(
        response,
        publicError(415, "UNSUPPORTED_MEDIA_TYPE", "Se requiere application/json válido"),
      );
      return;
    }

    let operation;
    try {
      const payload = await readJson(request);
      const apply = requestUrl.pathname === "/api/apply";
      operation = normalizeOperation(payload, { apply });
      const commonOptions = {
        environment: validated.environment,
        database: validated.database,
        expectedTargetFingerprint: operation.expectedTargetFingerprint,
      };

      if (!apply) {
        const requestPlanSequence = ++planSequence;
        approvals.clear();
        const result = await runBootstrap({
          mongoUri,
          options: { ...commonOptions, mode: "plan" },
          manifest: operation.manifest,
          processEnvironment,
        });
        let planToken = null;
        if (
          requestPlanSequence === planSequence &&
          result.exitCode === 0 &&
          result.plan.canApply
        ) {
          planToken = randomUUID();
          approvals.set(planToken, {
            digest: requestDigest(approvalSecret, operation),
            expiresAt: now() + approvalTtlMs,
          });
        }
        writeJson(response, 200, { ...result, planToken });
        return;
      }

      const approval = approvals.get(operation.planToken);
      approvals.delete(operation.planToken);
      if (
        !approval ||
        approval.expiresAt <= now() ||
        !equalDigest(approval.digest, requestDigest(approvalSecret, operation)) ||
        operation.confirmation !== MEMBERSHIP_BASELINE_CONFIRMATION
      ) {
        throw publicError(
          409,
          "PLAN_REQUIRED",
          "Debe ejecutar nuevamente un plan seguro antes de aplicar",
        );
      }

      const result = await runBootstrap({
        mongoUri,
        options: {
          ...commonOptions,
          mode: "apply",
          confirm: MEMBERSHIP_BASELINE_CONFIRMATION,
        },
        manifest: operation.manifest,
        processEnvironment,
      });
      writeJson(response, 200, result);
    } catch (error) {
      writePublicError(response, error);
    } finally {
      clearSensitiveOperation(operation);
    }
  });

  server.requestTimeout = REQUEST_TIMEOUT_MS;
  server.headersTimeout = HEADERS_TIMEOUT_MS;
  server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;
  server.maxRequestsPerSocket = MAX_REQUESTS_PER_SOCKET;
  server.on("clientError", (_error, socket) => socket.destroy());

  let listening = false;
  const listen = async ({
    port = validated.port,
    host = MEMBERSHIP_BASELINE_UI_HOST,
  } = {}) => {
    if (host !== MEMBERSHIP_BASELINE_UI_HOST) {
      throw new Error("El servidor sólo puede enlazarse a 127.0.0.1");
    }
    if (listening) throw new Error("El servidor local ya está iniciado");
    await new Promise((resolve, reject) => {
      const onError = (error) => {
        server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        server.off("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, MEMBERSHIP_BASELINE_UI_HOST);
    });
    const address = server.address();
    if (
      !address ||
      typeof address === "string" ||
      address.address !== MEMBERSHIP_BASELINE_UI_HOST
    ) {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
      throw new Error("El bind local efectivo no pudo verificarse");
    }
    listening = true;
    return { address: address.address, port: address.port };
  };

  const close = async () => {
    approvals.clear();
    approvalSecret.fill(0);
    if (!listening) return;
    server.closeIdleConnections?.();
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    listening = false;
  };

  return {
    address: () => server.address(),
    close,
    csrfToken,
    listen,
    options: validated,
  };
};

const usage = () => {
  console.log(`Uso:
  NODE_ENV=development npm run bootstrap:membership-baseline:ui -- \\
    --environment=development \\
    --database=agenda_dev \\
    [--port=${MEMBERSHIP_BASELINE_UI_DEFAULT_PORT}]

NODE_ENV debe coincidir con --environment. La interfaz escucha exclusivamente
en ${MEMBERSHIP_BASELINE_UI_HOST} y nunca forma parte de start o dev.`);
};

export const main = async (argv = process.argv.slice(2)) => {
  const parsed = parseArguments(argv);
  if (parsed.help) {
    usage();
    return null;
  }
  const app = createMembershipBaselineUiServer({
    mongoUri: process.env.MONGO_URI,
    options: parsed,
  });
  const address = await app.listen();
  console.log(`Interfaz local disponible en http://${address.address}:${address.port}`);
  console.log("No cierre esta terminal hasta terminar. Ninguna operación se ejecuta automáticamente.");
  return app;
};

const isDirectExecution =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectExecution) {
  main().catch(() => {
    console.error("Interfaz de baseline rechazada por una configuración insegura");
    process.exitCode = 1;
  });
}
