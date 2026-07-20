/**
 * Servicio de notificaciones en tiempo real vía WebSockets.
 * Abstrae Socket.IO para que los servicios no dependan directamente del transporte.
 */
import { Server } from "socket.io";
import logger from "../config/logger.js";
import { corsOrigins } from "../config/env.js";
import { sessionMiddleware } from "../app.js";
import MembershipModel from "../db/models/membership.model.js";

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

  // Compartir la sesión de Express con Socket.IO
  io.engine.use(sessionMiddleware);

  // Rechazar conexiones sin sesión autenticada
  io.use((socket, next) => {
    const sess = socket.request.session;
    if (!sess || !sess.user) {
      return next(new Error("No autorizado"));
    }
    socket.data.user = sess.user;
    socket.data.businessId = sess.user.businessId;
    next();
  });

  io.on("connection", (socket) => {
    logger.info(`Cliente WebSocket conectado: ${socket.id} (user=${socket.data.user.id})`);

    // Auto-unirse a la sala del negocio para recibir calendar_update
    if (socket.data.businessId) {
      socket.join(`business:${socket.data.businessId}`);
    }

    socket.on("join_availability", async ({ workerId, date }) => {
      if (!workerId || !date) return;

      try {
        const membership = await MembershipModel.findOne({
          user: workerId,
          business: socket.data.businessId,
          isActive: true,
        }).lean();

        if (!membership) {
          socket.emit("ws_error", { message: "El trabajador no pertenece a su negocio" });
          return;
        }

        const room = `availability:${workerId}:${date}`;
        socket.join(room);
        logger.info(`Socket ${socket.id} se unió a la sala: ${room}`);
      } catch (err) {
        logger.error(`Error al validar membresía en join_availability: ${err.message}`);
        socket.emit("ws_error", { message: "Error al unirse a la sala" });
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
 * Emite al room específico y un evento calendar_update al room del negocio.
 */
export const emitAvailabilityChange = (workerId, dateStr, businessId) => {
  if (io) {
    const room = `availability:${workerId}:${dateStr}`;
    io.to(room).emit("availability_changed", { workerId, date: dateStr });
    logger.info(`WS Broadcast: Cambios de disponibilidad en la sala ${room}`);

    if (businessId) {
      io.to(`business:${businessId}`).emit("calendar_update");
      logger.info(`WS Broadcast: calendar_update emitido a business:${businessId}`);
    }
  }
};
