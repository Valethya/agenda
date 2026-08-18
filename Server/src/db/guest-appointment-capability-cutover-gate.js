import { assertGuestAppointmentCapabilityIndexesReady } from "../../scripts/migrations/guest-appointment-capability-storage.js";

export const GUEST_APPOINTMENT_C2_CUTOVER_ENV = "GUEST_APPOINTMENT_6_2_5_C2_CUTOVER";
export const GUEST_APPOINTMENT_C2_CUTOVER_CONFIRMATION = "GUEST_APPOINTMENT_6_2_5_C2_STORAGE_READY";

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

export const isGuestAppointmentRemoteRuntime = (processEnvironment = process.env) => (
  REMOTE_ENVIRONMENTS.has(processEnvironment?.NODE_ENV)
  || DEPLOYMENT_ENVIRONMENT_INDICATORS.some((name) => hasValue(processEnvironment?.[name]))
);

export const assertGuestAppointmentCapabilityRuntimeStorageReady = async (
  db,
  processEnvironment = process.env,
) => {
  // Integration tests create their own isolated production-like database to
  // verify autoIndex:false explicitly. Runtime startup is not gated there.
  if (processEnvironment?.NODE_ENV === "test") return { enforced: false };
  if (!isGuestAppointmentRemoteRuntime(processEnvironment)) return { enforced: false };

  if (processEnvironment?.[GUEST_APPOINTMENT_C2_CUTOVER_ENV] !== GUEST_APPOINTMENT_C2_CUTOVER_CONFIRMATION) {
    throw new Error(
      `Cutover 6.2.5-C2 bloqueado: falta ${GUEST_APPOINTMENT_C2_CUTOVER_ENV}=${GUEST_APPOINTMENT_C2_CUTOVER_CONFIRMATION}`,
    );
  }

  await assertGuestAppointmentCapabilityIndexesReady(db);
  return { enforced: true, ready: true };
};
