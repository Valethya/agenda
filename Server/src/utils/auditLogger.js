import AuditLog from "../db/models/auditLog.model.js";
import logger from "../config/logger.js";

/**
 * Registra un evento de auditoría en la base de datos y lo imprime en consola.
 * 
 * @param {Object} logParams
 * @param {string} [logParams.appointmentId] - ID de la cita asociada
 * @param {string} [logParams.userId] - ID del usuario asociado
 * @param {string} logParams.event - Nombre del evento (ej. APPOINTMENT_REQUEST_RECEIVED)
 * @param {string} [logParams.level] - Nivel de severidad (INFO, SUCCESS, WARN, ERROR, CRITICAL)
 * @param {string} logParams.message - Mensaje descriptivo amigable
 * @param {string} [logParams.technicalMessage] - Detalle técnico para depuración
 * @param {Object} [logParams.metadata] - Información adicional relevante
 */
export const logEvent = async ({
  appointmentId,
  userId,
  event,
  level = "INFO",
  message,
  technicalMessage = "",
  metadata = {}
}) => {
  try {
    // 1. Guardar en base de datos
    const auditLog = await AuditLog.create({
      appointmentId,
      userId,
      event,
      level,
      message,
      technicalMessage,
      metadata
    });

    // 2. Formatear y mostrar en consola durante desarrollo
    const colors = {
      INFO: "\x1b[36m",      // Cyan
      SUCCESS: "\x1b[32m",   // Verde
      WARN: "\x1b[33m",      // Amarillo
      ERROR: "\x1b[31m",     // Rojo
      CRITICAL: "\x1b[41m\x1b[37m" // Fondo rojo, texto blanco
    };
    const reset = "\x1b[0m";
    const levelColor = colors[level] || "";

    console.log(
      `[AUDIT_LOG] ${levelColor}[${level}]${reset} Event: ${event} | Message: ${message}` +
      (technicalMessage ? ` | Tech: ${technicalMessage}` : "") +
      (appointmentId ? ` | Appointment: ${appointmentId}` : "")
    );

    return auditLog;
  } catch (error) {
    // Evitamos bloquear el flujo principal si el logger falla, pero registramos el error
    logger.error(`[AuditLogger Error] Falló al guardar en DB: ${error.message}`);
  }
};
