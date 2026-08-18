import dns from "dns";
import mongoose from "mongoose";
import { fileURLToPath } from "node:url";

dns.setDefaultResultOrder("ipv4first");

import { app } from "./app.js";
import { port } from "./config/env.js";
import { connectDB } from "./db/db.js";
import { assertAvailabilityRuntimeStorageReady } from "./db/availability-cutover-gate.js";
import { assertGuestAppointmentCapabilityRuntimeStorageReady } from "./db/guest-appointment-capability-cutover-gate.js";
import logger from "./config/logger.js";
import { initSocket } from "./config/socket.js";
import { startGuestAppointmentVerificationWorker } from "./services/guestAppointmentVerification.worker.js";

export const getConnectedDatabase = () => mongoose.connection.db;

const waitUntilListening = (httpServer) => {
  if (httpServer?.listening === true) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onListening = () => {
      httpServer.off("error", onError);
      resolve();
    };
    const onError = (error) => {
      httpServer.off("listening", onListening);
      reject(error);
    };
    httpServer.once("listening", onListening);
    httpServer.once("error", onError);
  });
};

export const startServer = async ({
  connect = connectDB,
  availabilityGate = assertAvailabilityRuntimeStorageReady,
  guestCapabilityGate = assertGuestAppointmentCapabilityRuntimeStorageReady,
  database = getConnectedDatabase,
  appInstance = app,
  listenPort = port,
  socketInit = initSocket,
  workerStart = startGuestAppointmentVerificationWorker,
  processEnvironment = process.env,
  runtimeLogger = logger,
} = {}) => {
  await connect();
  const db = database();
  await availabilityGate(db, processEnvironment);
  await guestCapabilityGate(db, processEnvironment);

  const httpServer = appInstance.listen(listenPort);
  await waitUntilListening(httpServer);
  runtimeLogger.info(`server running at port ${listenPort}`);

  socketInit(httpServer);
  const stopGuestVerificationWorker = workerStart();
  httpServer.once("close", stopGuestVerificationWorker);
  return httpServer;
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startServer().catch((error) => {
    logger.error(`[STARTUP] ${error.message}`);
    process.exit(1);
  });
}
