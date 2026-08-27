import { assertTenantOnboardingAccountBindingIndexesReady } from "../../scripts/migrations/tenant-onboarding-account-binding-storage.js";

export const TENANT_ONBOARDING_C2_CUTOVER_ENV = "TENANT_ONBOARDING_C2_CUTOVER";
export const TENANT_ONBOARDING_C2_CUTOVER_CONFIRMATION = "TENANT_ONBOARDING_C2_STORAGE_READY";

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
const isRemoteRuntime = (environment = process.env) => (
  REMOTE_ENVIRONMENTS.has(environment?.NODE_ENV)
  || DEPLOYMENT_ENVIRONMENT_INDICATORS.some((name) => hasValue(environment?.[name]))
);

export const assertTenantOnboardingRuntimeStorageReady = async (
  db,
  processEnvironment = process.env,
) => {
  const remote = isRemoteRuntime(processEnvironment);

  // Isolated local tests materialize storage explicitly in their own behavioral
  // suites. Every actual runtime, including local development, must otherwise
  // observe the physical C1+C2 storage contract before listen().
  if (!remote && processEnvironment?.NODE_ENV === "test") return { enforced: false };

  if (
    remote
    && processEnvironment?.[TENANT_ONBOARDING_C2_CUTOVER_ENV]
      !== TENANT_ONBOARDING_C2_CUTOVER_CONFIRMATION
  ) {
    throw new Error(
      `Cutover C2 onboarding bloqueado: falta ${TENANT_ONBOARDING_C2_CUTOVER_ENV}=${TENANT_ONBOARDING_C2_CUTOVER_CONFIRMATION}`,
    );
  }

  await assertTenantOnboardingAccountBindingIndexesReady(db);
  return { enforced: true, ready: true };
};
