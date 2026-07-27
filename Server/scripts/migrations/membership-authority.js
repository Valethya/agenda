import "dotenv/config";

import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import mongoose from "mongoose";
import {
  buildMembershipAuthorityReport,
  readMembershipAuthoritySnapshot,
} from "./membership-authority-audit.js";
import {
  fingerprintMongoTarget,
  MEMBERSHIP_AUTHORITY_AUDITOR_VERSION,
  resolveEffectiveCodeSha,
  sanitizeAuditErrorMessage,
  validateAuditEnvironment,
} from "./membership-authority-provenance.js";

const EXIT_UNSAFE = 2;

export const parseMembershipAuthorityArgs = (argv) => {
  const options = {
    mode: "audit",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help") {
      options.help = true;
      continue;
    }

    if (!argument.startsWith("--")) {
      throw new Error(`Argumento no reconocido: ${argument}`);
    }

    const separatorIndex = argument.indexOf("=");
    const key =
      separatorIndex === -1 ? argument.slice(2) : argument.slice(2, separatorIndex);
    const inlineValue =
      separatorIndex === -1 ? undefined : argument.slice(separatorIndex + 1);
    const value = inlineValue ?? argv[index + 1];

    if (!["mode", "environment", "database", "report", "code-sha"].includes(key)) {
      throw new Error(`Opción no reconocida: --${key}`);
    }

    if (!value || value.startsWith("--")) {
      throw new Error(`Falta valor para --${key}`);
    }

    options[key === "code-sha" ? "codeSha" : key] = value;
    if (inlineValue === undefined) index += 1;
  }

  return options;
};

const usage = () => {
  console.log(`Uso:
  npm run migration:membership-authority -- \\
    --mode=audit \\
    --environment=production \\
    --database=agenda \\
    --report=./artifacts/membership-authority-audit.json

El único modo disponible en 6.2.2-B es audit. Nunca escribe en MongoDB.`);
};

export const runMembershipAuthorityAudit = async ({
  mongoUri,
  environment,
  database,
  report,
  explicitCodeSha,
  connect = mongoose.connect.bind(mongoose),
  disconnect = mongoose.disconnect.bind(mongoose),
  connection = mongoose.connection,
  startSession,
  now = () => new Date(),
}) => {
  validateAuditEnvironment(environment);
  if (!mongoUri) throw new Error("MONGO_URI es obligatoria");
  if (!database) throw new Error("--database es obligatorio");
  if (!report) throw new Error("--report es obligatorio");
  const targetFingerprint = fingerprintMongoTarget(mongoUri, database);

  let connected = false;
  try {
    await connect(mongoUri, { autoIndex: false });
    connected = true;

    const actualDatabase = connection.db?.databaseName;
    if (actualDatabase !== database) {
      throw new Error(
        `Base rechazada: se confirmó "${database}" pero la conexión apunta a "${actualDatabase ?? "<desconocida>"}"`,
      );
    }

    const { snapshot, readStrategy } = await readMembershipAuthoritySnapshot(
      connection.db,
      {
        startSession:
          startSession ?? connection.startSession?.bind(connection),
      },
    );
    const absoluteReportPath = path.resolve(report);
    const auditReport = buildMembershipAuthorityReport(snapshot, {
      environment,
      mongoTargetFingerprint: targetFingerprint,
      codeSha: resolveEffectiveCodeSha({ explicitCodeSha }),
      auditorVersion: MEMBERSHIP_AUTHORITY_AUDITOR_VERSION,
      readStrategy,
      generatedAt: now().toISOString(),
    });

    await mkdir(path.dirname(absoluteReportPath), { recursive: true, mode: 0o700 });
    await writeFile(
      absoluteReportPath,
      `${JSON.stringify(auditReport, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    await chmod(absoluteReportPath, 0o600);

    return {
      report: auditReport,
      reportPath: absoluteReportPath,
      exitCode: auditReport.canonicalPayload.safeToApply ? 0 : EXIT_UNSAFE,
    };
  } finally {
    if (connected) await disconnect();
  }
};

export const main = async (argv = process.argv.slice(2)) => {
  const options = parseMembershipAuthorityArgs(argv);

  if (options.help) {
    usage();
    return 0;
  }

  if (options.mode !== "audit") {
    throw new Error(
      `Modo rechazado: "${options.mode}". 6.2.2-B sólo implementa --mode=audit`,
    );
  }

  validateAuditEnvironment(options.environment);

  const result = await runMembershipAuthorityAudit({
    mongoUri: process.env.MONGO_URI,
    environment: options.environment,
    database: options.database,
    report: options.report,
    explicitCodeSha: options.codeSha,
  });

  const { canonicalPayload, checksum, metadata } = result.report;
  console.log(`Audit Membership completado en modo read-only.`);
  console.log(`Entorno confirmado: ${metadata.environment}`);
  console.log(`Base: ${canonicalPayload.databaseName}`);
  console.log(`Estrategia de lectura: ${metadata.readStrategy}`);
  console.log(`Checksum: ${checksum.value}`);
  console.log(`Candidatas: ${canonicalPayload.counts.candidates}`);
  console.log(`Bloqueos: ${canonicalPayload.findings.filter((item) => item.blocking).length}`);
  console.log(`safeToApply: ${canonicalPayload.safeToApply}`);
  console.log(`Informe: ${result.reportPath}`);

  return result.exitCode;
};

const isDirectExecution =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectExecution) {
  main()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      console.error(
        `Audit Membership rechazado: ${sanitizeAuditErrorMessage(
          error,
          process.env.MONGO_URI,
        )}`,
      );
      process.exitCode = 1;
    });
}
