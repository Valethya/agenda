/**
 * Servicio de notificaciones en tiempo real vía WebSockets.
 * Abstrae Socket.IO para que los servicios no dependan directamente del transporte.
 */
import { Server } from "socket.io";
import logger from "../config/logger.js";
import { corsOrigins } from "../config/env.js";

let io;

/**
 * Inicializa el servidor de WebSockets.
 * @param {import("http").Server} httpServer
 */
export const initSocket = (httpServer) => {
  const allowedOrigins = corsOrigins.split(",").map((o) => o.trim());

  io = new Server(httpServer, {
    cors: {
      origin: allowedOrigins,
      methods: ["GET", "POST"],
      credentials: true,
    },
  });

  io.on("connection", (socket) => {
    logger.info(`Cliente WebSocket conectado: ${socket.id}`);

    // El cliente se suscribe a las actualizaciones de un día específico de un trabajador
    socket.on("join_availability", ({ workerId, date }) => {
      if (workerId && date) {
        const room = `availability:${workerId}:${date}`;
        socket.join(room);
        logger.info(`Socket ${socket.id} se unió a la sala: ${room}`);
      }
    });

    socket.on("leave_availability", ({ workerId, date }) => {
      if (workerId && date) {
        const room = `availability:${workerId}:${date}`;
        socket.leave(room);
        logger.info(`Socket ${socket.id} salió de la sala: ${room}`);
      }
    });

    socket.on("disconnect", () => {
      logger.info(`Cliente WebSocket desconectado: ${socket.id}`);
    });
  });

  return io;
};

/**
 * Obtiene la instancia de Socket.IO.
 */
export const getIO = () => {
  if (!io) {
    throw new Error("¡Socket.io no ha sido inicializado!");
  }
  return io;
};

// --- API de notificaciones de alto nivel ---

/**
 * Notifica un cambio de disponibilidad a los clientes suscritos.
 * Emite tanto al room específico como un evento global de calendario.
 */
export const emitAvailabilityChange = (workerId, dateStr) => {
  if (io) {
    const room = `availability:${workerId}:${dateStr}`;
    io.to(room).emit("availability_changed", { workerId, date: dateStr });
    logger.info(`WS Broadcast: Cambios de disponibilidad en la sala ${room}`);
    
    io.emit("calendar_update");
    logger.info("WS Broadcast: Evento global calendar_update emitido");
  }
};
