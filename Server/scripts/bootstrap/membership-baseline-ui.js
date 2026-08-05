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
  runMembershipBaselineBootstrap,
  validateMembershipBaselineOptions,
} from "./membership-baseline.js";
import {
  fingerprintMongoTarget,
  sanitizeAuditErrorMessage,
} from "../migrations/membership-authority-provenance.js";

export const MEMBERSHIP_BASELINE_UI_HOST = "127.0.0.1";
export const MEMBERSHIP_BASELINE_UI_DEFAULT_PORT = 4177;
export const MEMBERSHIP_BASELINE_UI_APPROVAL_TTL_MS = 5 * 60 * 1000;

const MAX_REQUEST_BYTES = 32 * 1024;
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
};

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
    values[key] = value;
    if (inlineValue === undefined) index += 1;
  }
  return values;
};

export const validateMembershipBaselineUiOptions = (options) => {
  validateMembershipBaselineOptions({
    mode: "plan",
    environment: options.environment,
    database: options.database,
    expectedTargetFingerprint: "0".repeat(64),
  });
  const port = options.port === undefined
    ? MEMBERSHIP_BASELINE_UI_DEFAULT_PORT
    : Number(options.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("--port debe ser un entero entre 0 y 65535");
  }
  return { environment: options.environment, database: options.database, port };
};

const canonicalRequest = ({ owners, expectedTargetFingerprint }) =>
  JSON.stringify({ expectedTargetFingerprint, owners });

const requestDigest = (secret, request) =>
  createHmac("sha256", secret).update(canonicalRequest(request), "utf8").digest();

const equalDigest = (left, right) =>
  Buffer.isBuffer(left) &&
  Buffer.isBuffer(right) &&
  left.length === right.length &&
  timingSafeEqual(left, right);

const redactError = (error, mongoUri, payload) => {
  let message = sanitizeAuditErrorMessage(error, mongoUri);
  const sensitiveValues = [
    payload?.expectedTargetFingerprint,
    ...Object.values(payload?.owners ?? {}).flatMap((owner) => [
      owner?.firstName,
      owner?.lastName,
      owner?.email,
      owner?.password,
    ]),
  ].filter((value) => typeof value === "string" && value !== "");
  for (const value of sensitiveValues) {
    message = message.split(value).join("[REDACTED]");
  }
  return message;
};

const readJson = async (request) => {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > MAX_REQUEST_BYTES) throw new Error("La solicitud supera el tamaño permitido");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("La solicitud JSON no es válida");
  }
};

const writeJson = (response, status, body) => {
  response.writeHead(status, JSON_HEADERS);
  response.end(JSON.stringify(body));
};

const renderPage = ({ csrfToken, environment, database }) => `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="bootstrap-csrf" content="${csrfToken}">
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
    <div class="context"><span><strong>Entorno</strong>${environment}</span><span><strong>Base</strong>${database}</span></div>
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
      result.textContent = body.error || 'La operación fue rechazada';
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
    finally { planButton.disabled = false; }
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
}) => {
  const validated = validateMembershipBaselineUiOptions(options);
  if (!mongoUri) throw new Error("MONGO_URI es obligatoria");
  fingerprintMongoTarget(mongoUri, validated.database);

  const csrfToken = randomBytes(32).toString("hex");
  const approvalSecret = randomBytes(32);
  const approvals = new Map();

  const server = createServer(async (request, response) => {
    if (!/^127\.0\.0\.1:\d{1,5}$/u.test(String(request.headers.host ?? ""))) {
      writeJson(response, 421, { error: "Host local no permitido" });
      return;
    }
    const requestUrl = new URL(request.url ?? "/", `http://${MEMBERSHIP_BASELINE_UI_HOST}`);
    if (request.method === "GET" && requestUrl.pathname === "/") {
      response.writeHead(200, HTML_HEADERS);
      response.end(renderPage({ csrfToken, ...validated }));
      return;
    }

    if (
      request.method !== "POST" ||
      !["/api/plan", "/api/apply"].includes(requestUrl.pathname)
    ) {
      writeJson(response, 404, { error: "Ruta no disponible" });
      return;
    }
    if (request.headers["x-bootstrap-csrf"] !== csrfToken) {
      writeJson(response, 403, { error: "Solicitud local no autorizada" });
      return;
    }
    if (!String(request.headers["content-type"] ?? "").startsWith("application/json")) {
      writeJson(response, 415, { error: "Se requiere application/json" });
      return;
    }

    let payload;
    try {
      payload = await readJson(request);
      const manifest = buildMembershipBaselineManifestFromOwners(payload.owners);
      const commonOptions = {
        environment: validated.environment,
        database: validated.database,
        expectedTargetFingerprint: payload.expectedTargetFingerprint,
      };

      if (requestUrl.pathname === "/api/plan") {
        const operation = { owners: payload.owners, expectedTargetFingerprint: payload.expectedTargetFingerprint };
        const result = await runBootstrap({
          mongoUri,
          options: { ...commonOptions, mode: "plan" },
          manifest,
        });
        let planToken = null;
        if (result.exitCode === 0 && result.plan.canApply) {
          planToken = randomUUID();
          approvals.clear();
          approvals.set(planToken, {
            digest: requestDigest(approvalSecret, operation),
            expiresAt: now() + approvalTtlMs,
          });
        }
        writeJson(response, 200, { ...result, planToken });
        return;
      }

      const approval = approvals.get(payload.planToken);
      approvals.delete(payload.planToken);
      const operation = { owners: payload.owners, expectedTargetFingerprint: payload.expectedTargetFingerprint };
      if (
        !approval ||
        approval.expiresAt < now() ||
        !equalDigest(approval.digest, requestDigest(approvalSecret, operation)) ||
        payload.confirmation !== MEMBERSHIP_BASELINE_CONFIRMATION
      ) {
        writeJson(response, 409, { error: "Debe ejecutar nuevamente un plan seguro antes de aplicar" });
        return;
      }

      const result = await runBootstrap({
        mongoUri,
        options: {
          ...commonOptions,
          mode: "apply",
          confirm: MEMBERSHIP_BASELINE_CONFIRMATION,
        },
        manifest,
      });
      writeJson(response, 200, result);
    } catch (error) {
      writeJson(response, 400, { error: redactError(error, mongoUri, payload) });
    }
  });

  return { server, csrfToken, options: validated };
};

const usage = () => {
  console.log(`Uso:
  npm run bootstrap:membership-baseline:ui -- \\
    --environment=development \\
    --database=agenda_dev \\
    [--port=${MEMBERSHIP_BASELINE_UI_DEFAULT_PORT}]

La interfaz escucha exclusivamente en ${MEMBERSHIP_BASELINE_UI_HOST} y nunca forma parte de start o dev.`);
};

export const main = async (argv = process.argv.slice(2)) => {
  const parsed = parseArguments(argv);
  if (parsed.help) {
    usage();
    return null;
  }
  const { server, options } = createMembershipBaselineUiServer({
    mongoUri: process.env.MONGO_URI,
    options: parsed,
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, MEMBERSHIP_BASELINE_UI_HOST, resolve);
  });
  const address = server.address();
  console.log(`Interfaz local disponible en http://${MEMBERSHIP_BASELINE_UI_HOST}:${address.port}`);
  console.log("No cierre esta terminal hasta terminar. Ninguna operación se ejecuta automáticamente.");
  return server;
};

const isDirectExecution =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectExecution) {
  main().catch((error) => {
    console.error(`Interfaz de baseline rechazada: ${sanitizeAuditErrorMessage(error, process.env.MONGO_URI)}`);
    process.exitCode = 1;
  });
}
