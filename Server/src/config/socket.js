/**
 * Servicio de notificaciones en tiempo real vía WebSockets.
 * La sesión aporta contexto; la autoridad tenant se revalida contra Membership.
 */
import { Server } from "socket.io";
import logger from "../config/logger.js";
import { corsOrigins } from "../config/env.js";
import { sessionMiddleware, sessionStore } from "../app.js";
import * as membershipRepository from "../repositories/membership.repository.js";
import * as userRepository from "../repositories/user.repository.js";
import { findTenantAuthority } from "../services/tenantAuthority.service.js";

let io;

const availabilityRoom = (businessId, workerId, date) =>
  `availability:${businessId}:${workerId}:${date}`;

const getStoredSession = (socket) => new Promise((resolve, reject) => {
  const sessionId = socket.request.sessionID;
  if (!sessionId) return resolve(null);
  sessionStore.get(sessionId, (error, session) => {
    if (error) reject(error);
    else resolve(session || null);
  });
});

const revalidateSocketTenant = async (socket) => {
  const storedSession = await getStoredSession(socket);
  const sessionUser = storedSession?.user;
  if (!sessionUser?.id || !sessionUser.businessId) return null;
  if (sessionUser.businessId.toString() !== socket.data.businessId?.toString()) return null;

  const authority = await findTenantAuthority(sessionUser.id, sessionUser.businessId);
  if (!authority) return null;
  socket.data.tenantRole = authority.role;
  return authority;
};

const revokeSocketTenantAccess = (socket) => {
  if (socket.data.businessId) socket.leave(`business:${socket.data.businessId}`);
  for (const room of [...socket.rooms]) {
    if (room.startsWith("availability:")) socket.leave(room);
  }
  socket.data.tenantRole = null;
};

export const initSocket = (httpServer) => {
  const allowedOrigins = corsOrigins.split(",").map((o) => o.trim());
  io = new Server(httpServer, {
    cors: { origin: allowedOrigins, methods: ["GET", "POST"], credentials: true },
  });

  io.engine.use(sessionMiddleware);

  io.use(async (socket, next) => {
    try {
      const sess = socket.request.session;
      if (!sess?.user?.id) return next(new Error("No autorizado"));

      const user = await userRepository.findById(sess.user.id);
      if (!user || user.isActive !== true) return next(new Error("No autorizado"));

      socket.data.userId = user._id.toString();
      socket.data.businessId = sess.user.businessId?.toString() || null;
      socket.data.globalRole = user.role;
      socket.data.tenantRole = null;

      if (socket.data.businessId) {
        const authority = await findTenantAuthority(user._id, socket.data.businessId, { user });
        if (authority) socket.data.tenantRole = authority.role;
        else if (user.role !== "superadmin") return next(new Error("No autorizado"));
      } else if (user.role !== "superadmin") {
        return next(new Error("No autorizado"));
      }

      next();
    } catch (error) {
      logger.error(`Error al autenticar WebSocket: ${error.message}`);
      next(new Error("No autorizado"));
    }
  });

  io.on("connection", (socket) => {
    logger.info(`Cliente WebSocket conectado: ${socket.id} (user=${socket.data.userId})`);
    if (socket.data.businessId && socket.data.tenantRole) socket.join(`business:${socket.data.businessId}`);

    socket.on("join_availability", async ({ workerId, date }) => {
      if (!workerId || !date) return;
      try {
        const authority = await revalidateSocketTenant(socket);
        if (!authority) {
          revokeSocketTenantAccess(socket);
          socket.emit("ws_error", { message: "La autoridad del negocio ya no está vigente" });
          return;
        }

        const workerMembership = await membershipRepository.findActiveByUserAndBusiness(workerId, authority.businessId);
        if (!workerMembership || workerMembership.role !== "worker") {
          socket.emit("ws_error", { message: "El trabajador no pertenece a su negocio" });
          return;
        }

        const room = availabilityRoom(authority.businessId.toString(), workerId, date);
        socket.join(room);
        logger.info(`Socket ${socket.id} se unió a la sala: ${room}`);
      } catch (err) {
        logger.error(`Error al validar autoridad en join_availability: ${err.message}`);
        socket.emit("ws_error", { message: "Error al unirse a la sala" });
      }
    });

    socket.on("leave_availability", ({ workerId, date }) => {
      if (workerId && date && socket.data.businessId) {
        socket.leave(availabilityRoom(socket.data.businessId, workerId, date));
      }
    });

    socket.on("disconnect", () => logger.info(`Cliente WebSocket desconectado: ${socket.id}`));
  });

  return io;
};

export const getIO = () => {
  if (!io) throw new Error("¡Socket.io no ha sido inicializado!");
  return io;
};

const pruneTenantSockets = async (businessId) => {
  const businessRoom = `business:${businessId}`;
  for (const socket of io.sockets.sockets.values()) {
    if (!socket.rooms.has(businessRoom)) continue;
    try {
      if (!await revalidateSocketTenant(socket)) revokeSocketTenantAccess(socket);
    } catch (error) {
      logger.error(`Error al revalidar socket ${socket.id}: ${error.message}`);
      revokeSocketTenantAccess(socket);
    }
  }
};

const emitTenantAvailabilityChange = async (workerId, dateStr, businessId) => {
  await pruneTenantSockets(businessId);

  const room = availabilityRoom(businessId, workerId, dateStr);
  io.to(room).emit("availability_changed", { workerId, date: dateStr });
  logger.info(`WS Broadcast: Cambios de disponibilidad en la sala ${room}`);

  const businessRoom = `business:${businessId}`;
  io.to(businessRoom).emit("calendar_update");
  logger.info(`WS Broadcast: calendar_update emitido a ${businessRoom}`);
};

export const emitAvailabilityChange = (workerId, dateStr, businessId) => {
  if (!io || !businessId) return;
  void emitTenantAvailabilityChange(workerId, dateStr, businessId).catch((error) => {
    logger.error(`Error al emitir actualización tenant por WebSocket: ${error.message}`);
  });
};
