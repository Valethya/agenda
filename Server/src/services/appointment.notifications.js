/**
 * Helpers de notificación para el ciclo de vida de citas.
 * Extraídos de appointment.service.js para reducir su tamaño.
 * Ejecutan envío de correos y logging de auditoría en segundo plano.
 */
import * as mailer from "./email/emailService.js";
import * as appointmentRepository from "../repositories/appointment.repository.js";
import { logEvent } from "../utils/auditLogger.js";

/**
 * Envía la notificación correspondiente cuando se crea una cita.
 * Si confirmed → email de confirmación al cliente.
 * Si pending → email de pre-reserva al cliente + alerta al trabajador.
 */
export const notifyBookingCreated = (appointmentId, clientId, initialStatus) => {
  setImmediate(async () => {
    try {
      const populated = await appointmentRepository.findById(appointmentId);
      if (!populated || !populated.client.email) return;

      if (initialStatus === "confirmed") {
        await mailer.sendAppointmentConfirmedEmail(populated.client.email, populated);
        await logEvent({
          appointmentId,
          userId: clientId,
          event: "EMAIL_NOTIFICATION_SENT",
          level: "INFO",
          message: `Correo de confirmación directa enviado a ${populated.client.email}.`,
          metadata: { email: populated.client.email }
        });
      } else {
        await mailer.sendAppointmentBookedEmail(populated.client.email, populated);
        await logEvent({
          appointmentId,
          userId: clientId,
          event: "EMAIL_NOTIFICATION_SENT",
          level: "INFO",
          message: `Correo de pre-reserva enviado a ${populated.client.email}.`,
          metadata: { email: populated.client.email }
        });

        // Alerta al trabajador asignado
        if (populated.worker && populated.worker.email) {
          const workerEmail = Array.isArray(populated.worker.email) ? populated.worker.email[0] : populated.worker.email;
          if (workerEmail) {
            await mailer.sendWorkerPendingApprovalEmail(workerEmail, populated);
            await logEvent({
              appointmentId,
              userId: clientId,
              event: "EMAIL_NOTIFICATION_SENT",
              level: "INFO",
              message: `Correo de alerta enviado al barbero ${workerEmail}.`,
              metadata: { email: workerEmail }
            });
          }
        }
      }
    } catch (mailError) {
      await logEvent({
        appointmentId,
        userId: clientId,
        event: "EMAIL_NOTIFICATION_FAILED",
        level: "ERROR",
        message: `Error al enviar correos de la reserva.`,
        technicalMessage: mailError.message,
        metadata: { appointmentId }
      });
    }
  });
};

/**
 * Envía notificación de confirmación al cliente (segundo plano).
 */
export const notifyAppointmentConfirmed = (appointmentId, userId) => {
  setImmediate(async () => {
    try {
      const populated = await appointmentRepository.findById(appointmentId);
      if (populated && populated.client.email) {
        await mailer.sendAppointmentConfirmedEmail(populated.client.email, populated);
        await logEvent({
          appointmentId,
          userId: populated.client._id,
          event: "EMAIL_NOTIFICATION_SENT",
          level: "INFO",
          message: `Correo de confirmación enviado a ${populated.client.email}.`,
          metadata: { email: populated.client.email }
        });
      }
    } catch (mailError) {
      await logEvent({
        appointmentId,
        userId,
        event: "EMAIL_NOTIFICATION_FAILED",
        level: "ERROR",
        message: `Error al enviar correo de confirmación.`,
        technicalMessage: mailError.message,
        metadata: { appointmentId }
      });
    }
  });
};

/**
 * Envía notificación de cancelación al cliente (segundo plano).
 */
export const notifyAppointmentCancelled = (appointmentId, userId) => {
  setImmediate(async () => {
    try {
      const populated = await appointmentRepository.findById(appointmentId);
      if (populated && populated.client.email) {
        await mailer.sendAppointmentCancelledEmail(populated.client.email, populated);
        await logEvent({
          appointmentId,
          userId: populated.client._id,
          event: "EMAIL_NOTIFICATION_SENT",
          level: "INFO",
          message: `Correo de cancelación enviado a ${populated.client.email}.`,
          metadata: { email: populated.client.email }
        });
      }
    } catch (mailError) {
      await logEvent({
        appointmentId,
        userId,
        event: "EMAIL_NOTIFICATION_FAILED",
        level: "ERROR",
        message: `Error al enviar correo de cancelación.`,
        technicalMessage: mailError.message,
        metadata: { appointmentId }
      });
    }
  });
};
