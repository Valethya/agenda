import dns from "dns";
import { fileURLToPath } from "node:url";

dns.setDefaultResultOrder("ipv4first");

import { app } from "./app.js";
import { port } from "./config/env.js";
import { connectDB } from "./db/db.js";
import { assertAvailabilityRuntimeStorageReady } from "./db/availability-cutover-gate.js";
import { assertGuestAppointmentCapabilityRuntimeStorageReady } from "./db/guest-appointment-capability-cutover-gate.js";
import { assertPublicWebRuntimeStorageReady } from "./db/public-web-cutover-gate.js";
import { assertMembershipBookabilityRuntimeStorageReady } from "./db/membership-bookability-cutover-gate.js";
import { assertTenantOnboardingRuntimeStorageReady } from "./db/tenant-onboarding-account-binding-cutover-gate.js";
import logger from "./config/logger.js";
import { initSocket } from "./config/socket.js";
import { startGuestAppointmentVerificationWorker } from "./services/guestAppointmentVerification.worker.js";
import { getConnectedDatabase, startServerLifecycle } from "./server/startServer.js";

export { getConnectedDatabase } from "./server/startServer.js";

export const startServer = (overrides = {}) => startServerLifecycle({
  connect: connectDB,
  availabilityGate: assertAvailabilityRuntimeStorageReady,
  guestCapabilityGate: assertGuestAppointmentCapabilityRuntimeStorageReady,
  publicWebGate: assertPublicWebRuntimeStorageReady,
  membershipBookabilityGate: assertMembershipBookabilityRuntimeStorageReady,
  tenantOnboardingGate: assertTenantOnboardingRuntimeStorageReady,
  database: getConnectedDatabase,
  appInstance: app,
  listenPort: port,
  socketInit: initSocket,
  workerStart: startGuestAppointmentVerificationWorker,
  processEnvironment: process.env,
  runtimeLogger: logger,
  ...overrides,
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startServer().catch((error) => {
    logger.error(`[STARTUP] ${error.message}`);
    process.exit(1);
  });
}
