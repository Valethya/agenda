import * as appointmentRepository from "../repositories/appointment.repository.js";
import * as paymentRepository from "../repositories/payment.repository.js";
import * as businessRepository from "../repositories/business.repository.js";
import * as transbankGateway from "../gateways/transbank.gateway.js";
import { emitAvailabilityChange } from "../config/socket.js";
import { NotFoundError, ValidationError } from "../utils/appError.js";
import * as mailer from "./email/emailService.js";
import * as availabilityService from "./availability.service.js";
import { logEvent } from "../utils/auditLogger.js";
import { backendUrl } from "../config/env.js";

const asId = (value) => (value?._id ?? value)?.toString?.() || "";
const sameId = (left, right) => asId(left) === asId(right);

// 1. Inicio legacy. La ruta HTTP pública está fail-closed en 6.2.6-A; esta
// función se conserva sólo hasta retirar/hardening posterior del módulo legado.
export const initiatePayment = async (appointmentId, paymentType = "deposit") => {
  try {
    const appointment = await appointmentRepository.findById(appointmentId);
    if (!appointment) {
      throw new NotFoundError("La cita especificada no existe");
    }

    const userId = appointment.client?._id || null;

    if (appointment.status !== "pending" && appointment.status !== "pending_payment") {
      throw new ValidationError(`No se puede iniciar el pago para una cita en estado: ${appointment.status}`);
    }

    const existingPayment = await paymentRepository.findByAppointmentAndStatus(appointmentId, "approved");
    if (existingPayment) {
      throw new ValidationError("Esta cita ya cuenta con un pago aprobado");
    }

    const serviceDetail = appointment.service;
    if (!serviceDetail) {
      throw new NotFoundError("El servicio asociado a la cita no existe");
    }
    const businessId = appointment.business._id || appointment.business;
    const dateStr = new Date(appointment.date).toISOString().split("T")[0];
    const availableSlots = await availabilityService.getAvailableSlots(
      appointment.worker._id.toString(),
      dateStr,
      serviceDetail._id.toString(),
      businessId,
      appointmentId
    );
    const isAvailable = availableSlots.some(
      (slot) => slot.startTime === appointment.startTime && slot.available !== false
    );
    if (!isAvailable) {
      throw new ValidationError("El horario seleccionado ya no se encuentra disponible");
    }

    let amountToCharge = serviceDetail.price;
    if (paymentType === "deposit" && serviceDetail.depositAmount > 0) {
      amountToCharge = serviceDetail.depositAmount;
    }

    const buyOrder = appointmentId;
    const sessionId = `${userId?.toString?.() || "legacy"}_${Date.now()}`;

    const business = await businessRepository.findById(businessId);
    if (!business) {
      throw new NotFoundError("El negocio asociado a la cita no existe");
    }

    const returnUrl = `${backendUrl}/api/payments/webpay-return`;

    await logEvent({
      appointmentId,
      userId,
      event: "WEBPAY_CREATE_REQUEST",
      level: "INFO",
      message: `Iniciando creación de transacción Webpay por monto ${amountToCharge} CLP (${paymentType}).`,
      metadata: { buyOrder, sessionId, amountToCharge }
    });

    const response = await transbankGateway.createTransaction(buyOrder, sessionId, amountToCharge, returnUrl);

    await logEvent({
      appointmentId,
      userId,
      event: "WEBPAY_CREATE_SUCCESS",
      level: "SUCCESS",
      message: "Transacción de Webpay creada correctamente.",
      metadata: { token: response.token, url: response.url }
    });

    await appointmentRepository.markPendingPaymentFromLegacyPayment(appointmentId);
    await paymentRepository.create({
      appointment: appointmentId,
      business: businessId,
      amount: amountToCharge,
      currency: "CLP",
      gateway: "webpay",
      transactionId: response.token,
      status: "pending",
      type: paymentType === "deposit" ? "deposit" : "full",
    });

    await logEvent({
      appointmentId,
      userId,
      event: "APPOINTMENT_PENDING_PAYMENT",
      level: "INFO",
      message: "Estado de la cita actualizado a pendiente de pago (pending_payment)."
    });

    await logEvent({
      appointmentId,
      userId,
      event: "CLIENT_REDIRECTED_TO_WEBPAY",
      level: "INFO",
      message: "Cliente redirigido a la pasarela de Webpay.",
      metadata: { token: response.token, url: response.url }
    });

    return { token: response.token, url: response.url, amount: amountToCharge };
  } catch (error) {
    await logEvent({
      appointmentId,
      event: "WEBPAY_CREATE_FAILED",
      level: "ERROR",
      message: `Error al iniciar transacción Webpay: ${error.message}`,
      technicalMessage: error.stack
    });
    throw error;
  }
};

const getPendingLegacyPayment = async (tokenWs) => {
  const payment = await paymentRepository.findByTransactionId(tokenWs);
  if (!payment || payment.status !== "pending") {
    throw new ValidationError("La transacción legacy no está pendiente o no existe");
  }
  return payment;
};

const settleAuthorizedLegacyPayment = async ({
  tokenWs,
  appointment,
  businessId,
  paymentStatus,
  paymentType,
  amount,
}) => {
  const appointmentId = asId(appointment._id);
  const workerId = asId(appointment.worker);

  return appointmentRepository.withSerializedBookingInterval(
    { businessId, workerId, date: appointment.date },
    async (session) => {
      const currentAppointment = await appointmentRepository.findBookingTransitionById(
        appointmentId,
        { session },
      );
      if (!currentAppointment || !sameId(currentAppointment.business, businessId)) {
        throw new ValidationError("La Appointment cambió o dejó de pertenecer al Payment durante el callback");
      }

      let reconciliationReason = null;
      if (currentAppointment.status !== "pending_payment") {
        reconciliationReason = "appointment_state_changed";
      } else {
        const overlap = await appointmentRepository.findActiveOverlapForBusinessWorkerAndDate({
          businessId,
          workerId: currentAppointment.worker,
          date: currentAppointment.date,
          startTime: currentAppointment.startTime,
          endTime: currentAppointment.endTime,
          excludeAppointmentId: currentAppointment._id,
          session,
        });

        if (overlap) {
          reconciliationReason = "interval_conflict";
          const cancelled = await appointmentRepository.cancelPendingPaymentForLegacyConflict(
            currentAppointment._id,
            { session },
          );
          if (!cancelled) {
            throw new ValidationError("La Appointment cambió durante la reconciliación de overlap");
          }
        }
      }

      const paymentRecord = await paymentRepository.updatePendingByTransactionId(
        tokenWs,
        {
          $set: {
            status: "approved",
            amount,
            type: paymentType,
            authorizedAt: new Date(),
            reconciliationStatus: reconciliationReason ? "required" : "applied",
            ...(reconciliationReason ? { reconciliationReason } : {}),
          },
        },
        { session },
      );
      if (!paymentRecord) {
        throw new ValidationError("El Payment pendiente cambió durante el callback");
      }

      if (reconciliationReason) {
        return {
          activated: false,
          reconciliationReason,
          paymentRecord,
          appointment: currentAppointment,
        };
      }

      const confirmed = await appointmentRepository.confirmPendingPaymentFromLegacyPayment(
        currentAppointment._id,
        paymentStatus,
        { session },
      );
      if (!confirmed) {
        throw new ValidationError("La Appointment dejó de estar pending_payment durante el callback");
      }

      return {
        activated: true,
        reconciliationReason: null,
        paymentRecord,
        appointment: confirmed,
      };
    },
  );
};

// 2. Confirmar un Payment legacy YA EXISTENTE. token_ws fija primero Payment,
// Appointment y Business localmente. Sólo después de validar ese scope se llama
// al proveedor; Webpay debe devolver exactamente el buy_order esperado.
export const confirmPayment = async (tokenWs) => {
  if (!tokenWs) {
    await logEvent({
      event: "PAYMENT_ERROR",
      level: "ERROR",
      message: "Intento de confirmación de pago sin token_ws."
    });
    throw new ValidationError("El token de Webpay no está presente");
  }

  let appointmentId = null;
  try {
    const pendingPayment = await getPendingLegacyPayment(tokenWs);
    appointmentId = asId(pendingPayment.appointment);
    const paymentBusinessId = asId(pendingPayment.business);

    const appointment = await appointmentRepository.findById(appointmentId);
    if (!appointment) {
      throw new NotFoundError("La cita asociada al pago no fue encontrada");
    }

    const businessId = asId(appointment.business);
    if (!businessId || !paymentBusinessId || !sameId(businessId, paymentBusinessId)) {
      throw new ValidationError("Payment y Appointment no pertenecen al mismo negocio");
    }

    if (appointment.status !== "pending_payment") {
      throw new ValidationError(`La cita no se encuentra en estado pendiente de pago (Estado actual: ${appointment.status})`);
    }

    const business = await businessRepository.findById(businessId);
    if (!business) {
      throw new NotFoundError("El negocio asociado al pago no existe");
    }

    const service = appointment.service;
    if (!service) {
      throw new NotFoundError("El servicio asociado a la cita no existe");
    }

    const userId = appointment.client?._id || null;

    await logEvent({
      appointmentId,
      event: "CLIENT_RETURNED_FROM_WEBPAY",
      level: "INFO",
      message: "Cliente retornó desde la pasarela de Webpay.",
      metadata: { tokenWs }
    });

    await logEvent({
      appointmentId,
      event: "WEBPAY_COMMIT_REQUEST",
      level: "INFO",
      message: "Solicitando confirmación (commit) a Webpay.",
      metadata: { tokenWs }
    });

    const commitResponse = await transbankGateway.commitTransaction(tokenWs);

    if (String(commitResponse.buy_order || "") !== appointmentId) {
      throw new ValidationError("El buyOrder de Webpay no coincide con el Payment pendiente");
    }

    await logEvent({
      appointmentId,
      event: "WEBPAY_COMMIT_SUCCESS",
      level: "SUCCESS",
      message: "Confirmación (commit) exitosa de Webpay.",
      metadata: { commitResponse }
    });

    if (commitResponse.status === "AUTHORIZED" && commitResponse.response_code === 0) {
      const expectedDeposit = service.depositAmount > 0 ? service.depositAmount : null;
      const expectedFull = service.price;
      const isDeposit = Boolean(expectedDeposit) && commitResponse.amount === expectedDeposit;
      const isFull = commitResponse.amount === expectedFull;
      if (!isDeposit && !isFull) {
        throw new ValidationError("El monto de la transacción no coincide con el configurado para el servicio.");
      }

      await logEvent({
        appointmentId,
        userId,
        event: "WEBPAY_PAYMENT_AUTHORIZED",
        level: "SUCCESS",
        message: "Pago autorizado por Transbank.",
        metadata: { authorizationCode: commitResponse.authorization_code, amount: commitResponse.amount }
      });

      // El resultado externo no concede authority para reactivar una Appointment.
      // Después del commit del proveedor se revalida estado + intervalo bajo el mismo
      // mutex de booking y Payment/Appointment se escriben atómicamente.
      const settlement = await settleAuthorizedLegacyPayment({
        tokenWs,
        appointment,
        businessId,
        paymentStatus: isDeposit ? "partially_paid" : "fully_paid",
        paymentType: isDeposit ? "deposit" : "full",
        amount: commitResponse.amount,
      });

      if (!settlement.activated) {
        await logEvent({
          appointmentId,
          userId,
          event: "WEBPAY_PAYMENT_RECONCILIATION_REQUIRED",
          level: "WARN",
          message: "Webpay autorizó el pago, pero la Appointment no fue reactivada porque su estado/intervalo cambió.",
          metadata: {
            paymentId: settlement.paymentRecord._id,
            reconciliationReason: settlement.reconciliationReason,
          },
        });

        return {
          success: false,
          paymentAuthorized: true,
          requiresReconciliation: true,
          reason: "payment_authorized_reconciliation_required",
          appointmentId,
          businessSlug: business.slug,
          amount: commitResponse.amount,
          authorizationCode: commitResponse.authorization_code,
        };
      }

      await logEvent({
        appointmentId,
        userId,
        event: "APPOINTMENT_CONFIRMED",
        level: "SUCCESS",
        message: "Reserva confirmada exitosamente tras validación de pago.",
        metadata: { paymentId: settlement.paymentRecord._id }
      });

      const dateStr = new Date(appointment.date).toISOString().split("T")[0];
      emitAvailabilityChange(appointment.worker._id.toString(), dateStr, businessId);

      const populated = await appointmentRepository.findById(appointmentId);
      const destination = Array.isArray(populated?.client?.email)
        ? populated.client.email[0]
        : populated?.client?.email;
      if (destination) {
        try {
          await mailer.sendAppointmentConfirmedEmail(destination, populated);
        } catch (mailError) {
          await logEvent({
            appointmentId,
            userId,
            event: "EMAIL_NOTIFICATION_FAILED",
            level: "ERROR",
            message: "No fue posible enviar la confirmación legacy de pago.",
            technicalMessage: mailError.message,
          });
        }
      }

      return {
        success: true,
        appointmentId,
        businessSlug: business.slug,
        amount: commitResponse.amount,
        authorizationCode: commitResponse.authorization_code,
      };
    }

    await logEvent({
      appointmentId,
      userId,
      event: "WEBPAY_PAYMENT_REJECTED",
      level: "WARN",
      message: "Pago rechazado por la pasarela de pago (Transbank).",
      metadata: { status: commitResponse.status, responseCode: commitResponse.response_code }
    });

    const rejectedPayment = await paymentRepository.updatePendingByTransactionId(
      tokenWs,
      { $set: { status: "rejected" } },
    );
    if (!rejectedPayment) throw new ValidationError("El Payment pendiente dejó de existir durante el callback");
    await appointmentRepository.cancelFromRejectedLegacyPayment(appointmentId);

    await logEvent({
      appointmentId,
      userId,
      event: "APPOINTMENT_CANCELLED",
      level: "INFO",
      message: "Reserva cancelada automáticamente debido a pago rechazado."
    });

    return {
      success: false,
      appointmentId,
      businessSlug: business.slug,
      reason: "rejected",
      message: "El pago fue rechazado por Transbank",
    };
  } catch (error) {
    await logEvent({
      appointmentId,
      event: "WEBPAY_COMMIT_FAILED",
      level: "ERROR",
      message: `Error al validar el pago con Transbank: ${error.message}`,
      technicalMessage: error.stack
    });
    throw new ValidationError(`Error al validar el pago con Transbank: ${error.message}`);
  }
};

export const getBusinessSlugByTransactionToken = async (token) => {
  if (!token) return null;

  const payment = await paymentRepository.findByTransactionId(token);
  if (!payment) return null;

  const businessId = payment.business?._id || payment.business;
  if (!businessId) return null;

  const business = await businessRepository.findById(businessId);
  return business?.slug || null;
};
