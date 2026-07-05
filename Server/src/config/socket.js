import { Server } from "socket.io";
import logger from "./logger.js";

let io;

export const initSocket = (httpServer) => {
  io = new Server(httpServer, {
    cors: {
      origin: "*", // En producción configurar el dominio exacto del frontend
      methods: ["GET", "POST"],
      credentials: true,
    },
  });

  io.on("connection", (socket) => {
    logger.info(`Cliente WebSocket conectado: ${socket.id}`);

    // El cliente se suscribe a las actualizaciones de un día específico de un trabajador
    // Ej de sala: "availability:workerId:YYYY-MM-DD"
    socket.on("join_availability", ({ workerId, date }) => {
      if (workerId && date) {
        const room = `availability:${workerId}:${date}`;
        socket.join(room);
        logger.info(`Socket ${socket.id} se unió a la sala: ${room}`);
      }
    });

    // Salir de la sala al cambiar de vista o fecha
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

export const getIO = () => {
  if (!io) {
    throw new Error("¡Socket.io no ha sido inicializado!");
  }
  return io;
};

// Utilidad para notificar cambios de disponibilidad en tiempo real a una sala específica
export const emitAvailabilityChange = (workerId, dateStr) => {
  if (io) {
    const room = `availability:${workerId}:${dateStr}`;
    io.to(room).emit("availability_changed", { workerId, date: dateStr });
    logger.info(`WS Broadcast: Cambios de disponibilidad en la sala ${room}`);
  }
};
