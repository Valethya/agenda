import { assertPublicWebIndexesReady } from "../../scripts/migrations/public-web-storage.js";
import { isGuestAppointmentRemoteRuntime } from "./guest-appointment-capability-cutover-gate.js";

export const PUBLIC_WEB_CUTOVER_ENV = "PUBLIC_WEB_6_2_6_B_CUTOVER";
export const PUBLIC_WEB_CUTOVER_CONFIRMATION = "PUBLIC_WEB_6_2_6_B_STORAGE_READY";

export const assertPublicWebRuntimeStorageReady = async (
  db,
  processEnvironment = process.env,
) => {
  const remote = isGuestAppointmentRemoteRuntime(processEnvironment);

  // Local development/test may use Mongoose autoIndex for convenience. Any
  // deployment indicator wins over NODE_ENV=test and requires the explicit,
  // physically verified migration before HTTP opens.
  if (!remote) return { enforced: false };

  if (processEnvironment?.[PUBLIC_WEB_CUTOVER_ENV] !== PUBLIC_WEB_CUTOVER_CONFIRMATION) {
    throw new Error(
      `Cutover 6.2.6-B bloqueado: falta ${PUBLIC_WEB_CUTOVER_ENV}=${PUBLIC_WEB_CUTOVER_CONFIRMATION}`,
    );
  }

  await assertPublicWebIndexesReady(db);
  return { enforced: true, ready: true };
};
