import dns from "dns";
import mongoose from "mongoose";

dns.setDefaultResultOrder("ipv4first");

import { app } from "./app.js";
import { port } from "./config/env.js";
import { connectDB } from "./db/db.js";
import { assertAvailabilityRuntimeStorageReady } from "./db/availability-cutover-gate.js";
import logger from "./config/logger.js";
import { initSocket } from "./config/socket.js";

const startServer = async () => {
  await connectDB();
  await assertAvailabilityRuntimeStorageReady(mongoose.connection.db, process.env);

  const httpServer = app.listen(port, () => {
    logger.info(`server running at port ${port}`);
  });

  initSocket(httpServer);
};

startServer().catch((error) => {
  logger.error(`[STARTUP] ${error.message}`);
  process.exit(1);
});
