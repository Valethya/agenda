/**
 * Helpers de notificación para el ciclo de vida de citas.
 * El contacto guest se resuelve desde Appointment.guestContact; nunca desde
 * matching de User ni desde identidad global mutable.
 */
import * as mailer from "./email/emailService.js";
import * as appointmentRepository from "../repositories/appointment.repository.js";
import { logEvent } from "../utils/auditLogger.js";

const firstEmail = (email) => {
  if (Array.isArray(email)) return email[0] || null;
  return typeof email === "string" ? email : null;
};

const getNotificationContext = async (appointmentId) => {
  const populated = await appointmentRepository.findById(appointmentId);
  if (!populated) return null;

  const businessId = populated.business?._id || populated.business;
  const guestBootstrap = businessId
    ? await appointmentRepository.findGuestCapabilityBootstrapByIdAndBusiness(appointmentId, businessId)
    : null;
  const guestContact = guestBootstrap?.guestContact || null;

  const detail = typeof populated.toObject === "function" ? populated.toObject() : populated;
  if (!detail.client && guestContact) {
    detail.client = {
      firstName: guestContact.firstName || "Cliente",
      lastName: guestContact.lastName || "",
      email: [guestContact.destination],
      phone: guestContact.phone ? [guestContact.phone] : [],
    };
  }

  return {
    detail,
    recipient: guestContact?.destination || firstEmail(populated.client?.email),
    auditUserId: populated.client?._id || null,
  };
};

export const notifyBookingCreated = (appointmentId, clientId, initialStatus) => {
  setImmediate(async () => {
    try {
      const context = await getNotificationContext(appointmentId);
      if (!context?.recipient) return;

      const { detail, recipient } = context;
      if (initialStatus === "confirmed") {
        await mailer.sendAppointmentConfirmedEmail(recipient, detail);
        await logEvent({
          appointmentId,
          userId: clientId || context.auditUserId,
          event: "EMAIL_NOTIFICATION_SENT",
          level: "INFO",
          message: `Correo de confirmación directa enviado a ${recipient}.`,
          metadata: { email: recipient },
        });
      } else {
        await mailer.sendAppointmentBookedEmail(recipient, detail);
        await logEvent({
          appointmentId,
          userId: clientId || context.auditUserId,
          event: "EMAIL_NOTIFICATION_SENT",
          level: "INFO",
          message: `Correo de pre-reserva enviado a ${recipient}.`,
          metadata: { email: recipient },
        });

        if (detail.worker && detail.worker.email) {
          const workerEmail = firstEmail(detail.worker.email);
          if (workerEmail) {
            await mailer.sendWorkerPendingApprovalEmail(workerEmail, detail);
            await logEvent({
              appointmentId,
              userId: clientId || context.auditUserId,
              event: "EMAIL_NOTIFICATION_SENT",
              level: "INFO",
              message: `Correo de alerta enviado al profesional ${workerEmail}.`,
              metadata: { email: workerEmail },
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
        message: "Error al enviar correos de la reserva.",
        technicalMessage: mailError.message,
        metadata: { appointmentId },
      });
    }
  });
};

export const notifyAppointmentConfirmed = (appointmentId, userId) => {
  setImmediate(async () => {
    try {
      const context = await getNotificationContext(appointmentId);
      if (!context?.recipient) return;

      await mailer.sendAppointmentConfirmedEmail(context.recipient, context.detail);
      await logEvent({
        appointmentId,
        userId: context.auditUserId || userId,
        event: "EMAIL_NOTIFICATION_SENT",
        level: "INFO",
        message: `Correo de confirmación enviado a ${context.recipient}.`,
        metadata: { email: context.recipient },
      });
    } catch (mailError) {
      await logEvent({
        appointmentId,
        userId,
        event: "EMAIL_NOTIFICATION_FAILED",
        level: "ERROR",
        message: "Error al enviar correo de confirmación.",
        technicalMessage: mailError.message,
        metadata: { appointmentId },
      });
    }
  });
};

export const notifyAppointmentCancelled = (appointmentId, userId) => {
  setImmediate(async () => {
    try {
      const context = await getNotificationContext(appointmentId);
      if (!context?.recipient) return;

      await mailer.sendAppointmentCancelledEmail(context.recipient, context.detail);
      await logEvent({
        appointmentId,
        userId: context.auditUserId || userId,
        event: "EMAIL_NOTIFICATION_SENT",
        level: "INFO",
        message: `Correo de cancelación enviado a ${context.recipient}.`,
        metadata: { email: context.recipient },
      });
    } catch (mailError) {
      await logEvent({
        appointmentId,
        userId,
        event: "EMAIL_NOTIFICATION_FAILED",
        level: "ERROR",
        message: "Error al enviar correo de cancelación.",
        technicalMessage: mailError.message,
        metadata: { appointmentId },
      });
    }
  });
};
