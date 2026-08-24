import { assertMembershipBookabilityStorageReady } from "../../scripts/migrations/membership-bookability.js";

export const ADMIN_TEAM_BOOKABILITY_CUTOVER_ENV = "ADMIN_TEAM_BOOKABILITY_CUTOVER";
export const ADMIN_TEAM_BOOKABILITY_CUTOVER_CONFIRMATION =
  "ADMIN_TEAM_BOOKABILITY_STORAGE_READY";

const REMOTE_ENVIRONMENTS = new Set(["staging", "production"]);
const DEPLOYMENT_ENVIRONMENT_INDICATORS = Object.freeze([
  "AWS_LAMBDA_FUNCTION_NAME",
  "DYNO",
  "FLY_APP_NAME",
  "K_SERVICE",
  "NETLIFY",
  "RAILWAY_ENVIRONMENT",
  "RAILWAY_ENVIRONMENT_ID",
  "RAILWAY_PROJECT_ID",
  "RENDER",
  "RENDER_SERVICE_ID",
  "VERCEL",
  "VERCEL_ENV",
  "WEBSITE_INSTANCE_ID",
]);

const hasValue = (value) => value !== undefined && value !== null && String(value).trim() !== "";

export const isMembershipBookabilityRemoteRuntime = (processEnvironment = process.env) => (
  REMOTE_ENVIRONMENTS.has(processEnvironment?.NODE_ENV)
  || DEPLOYMENT_ENVIRONMENT_INDICATORS.some((name) => hasValue(processEnvironment?.[name]))
);

export const assertMembershipBookabilityRuntimeStorageReady = async (
  db,
  processEnvironment = process.env,
) => {
  const remote = isMembershipBookabilityRemoteRuntime(processEnvironment);

  // Un indicador de deployment siempre gana sobre NODE_ENV=test. Sólo procesos
  // genuinamente locales quedan exentos del cutover remoto.
  if (!remote) return { enforced: false };

  if (processEnvironment?.[ADMIN_TEAM_BOOKABILITY_CUTOVER_ENV]
    !== ADMIN_TEAM_BOOKABILITY_CUTOVER_CONFIRMATION) {
    throw new Error(
      `Cutover admin-team bloqueado: falta ${ADMIN_TEAM_BOOKABILITY_CUTOVER_ENV}=${ADMIN_TEAM_BOOKABILITY_CUTOVER_CONFIRMATION}`,
    );
  }

  await assertMembershipBookabilityStorageReady(db);
  return { enforced: true, ready: true };
};
