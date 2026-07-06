import dns from "dns";
dns.setDefaultResultOrder("ipv4first");

import { app } from "./app.js";
import { port } from "./config/env.js";
import { connectDB } from "./db/db.js";
import logger from "./config/logger.js";
import { initSocket } from "./config/socket.js";

logger.info("server running");

connectDB();

const httpServer = app.listen(port, () => {
  logger.info(`server running at port ${port}`);
});

// Inicializar el servidor de WebSockets en tiempo real
initSocket(httpServer);
