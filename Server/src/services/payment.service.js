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

// 1. Iniciar Transacción de Pago (Permitiendo elegir entre abono o total)
export const initiatePayment = async (appointmentId, paymentType = "deposit") => {
  try {
    const appointment = await appointmentRepository.findById(appointmentId);
    if (!appointment) {
      throw new NotFoundError("La cita especificada no existe");
    }

    const userId = appointment.client._id;

    if (appointment.status !== "pending" && appointment.status !== "pending_payment") {
      throw new ValidationError(`No se puede iniciar el pago para una cita en estado: ${appointment.status}`);
    }

    // A. Verificar si ya existe un pago aprobado para esta cita
    const existingPayment = await paymentRepository.findByAppointmentAndStatus(appointmentId, "approved");
    if (existingPayment) {
      throw new ValidationError("Esta cita ya cuenta con un pago aprobado");
    }

    // B. Re-verificar disponibilidad del horario
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
    // Verificar si el slot de hora inicio sigue libre
    const isAvailable = availableSlots.some(
      (slot) => slot.startTime === appointment.startTime && slot.available !== false
    );
    if (!isAvailable) {
      throw new ValidationError("El horario seleccionado ya no se encuentra disponible");
    }

    let amountToCharge = serviceDetail.price; // Por defecto el total del servicio

    // Si el cliente selecciona "abono" y el servicio requiere abono mínimo
    if (paymentType === "deposit" && serviceDetail.depositAmount > 0) {
      amountToCharge = serviceDetail.depositAmount;
    }

    const buyOrder = appointmentId; // Usamos el ID de la cita como BuyOrder única
    const sessionId = `${appointment.client._id.toString()}_${Date.now()}`; // sessionId único combinando el ID de cliente y timestamp
    
    // Obtener el slug del negocio asociado a la cita
    const business = await businessRepository.findById(businessId);
    const slug = business ? business.slug : "barberia";
    
    // URL de retorno del backend donde Transbank redirigirá al usuario tras el pago
    const returnUrl = `${backendUrl}/api/payments/webpay-return?slug=${slug}`;

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

    // Guardamos momentáneamente el estado como "pending_payment"
    await appointmentRepository.update(appointmentId, { status: "pending_payment" });

    // Registrar el pago en estado "pending" con el token de transacción para búsquedas indexadas ultra rápidas
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

    return {
      token: response.token,
      url: response.url, // URL de Transbank a donde redirigir al cliente
      amount: amountToCharge,
    };
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

// 2. Confirmar Pago (Commit) al regresar de Transbank
export const confirmPayment = async (tokenWs) => {
  if (!tokenWs) {
    await logEvent({
      event: "PAYMENT_ERROR",
      level: "ERROR",
      message: "Intento de confirmación de pago sin token_ws."
    });
    throw new ValidationError("El token de Webpay no está presente");
  }

  try {
    // Buscar el appointmentId de forma súper rápida usando la consulta indexada por transactionId en la colección Payment
    let appointmentId = null;
    try {
      const pendingPayment = await paymentRepository.findByTransactionId(tokenWs);
      if (pendingPayment) {
        appointmentId = pendingPayment.appointment.toString();
      }
    } catch (dbErr) {
      // Ignorar fallos de consulta secundaria
    }

    // Loguear retorno del cliente
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

    // Confirmar la transacción con Transbank
    const commitResponse = await transbankGateway.commitTransaction(tokenWs);

    // Asegurarse de tener el appointmentId correcto del buy_order retornado
    appointmentId = commitResponse.buy_order;

    await logEvent({
      appointmentId,
      event: "WEBPAY_COMMIT_SUCCESS",
      level: "SUCCESS",
      message: "Confirmación (commit) exitosa de Webpay.",
      metadata: { commitResponse }
    });

    const appointment = await appointmentRepository.findById(appointmentId);

    if (!appointment) {
      await logEvent({
        appointmentId,
        event: "PAYMENT_ERROR",
        level: "CRITICAL",
        message: "No se encontró la reserva asociada al buyOrder de Webpay.",
        metadata: { buyOrder: appointmentId }
      });
      throw new NotFoundError("La cita asociada al pago no fue encontrada");
    }

    const userId = appointment.client._id;

    // Verificar estado pendiente de pago
    if (appointment.status !== "pending_payment") {
      await logEvent({
        appointmentId,
        userId,
        event: "PAYMENT_ERROR",
        level: "WARN",
        message: `La reserva no se encuentra en estado pending_payment (Estado actual: ${appointment.status}).`,
        metadata: { currentStatus: appointment.status }
      });
      throw new ValidationError(`La cita no se encuentra en estado pendiente de pago (Estado actual: ${appointment.status})`);
    }

    // Código de respuesta 0 e status AUTHORIZED indica éxito en Webpay
    if (commitResponse.status === "AUTHORIZED" && commitResponse.response_code === 0) {
      
      await logEvent({
        appointmentId,
        userId,
        event: "WEBPAY_PAYMENT_AUTHORIZED",
        level: "SUCCESS",
        message: "Pago autorizado por Transbank.",
        metadata: { authorizationCode: commitResponse.authorization_code, amount: commitResponse.amount }
      });

      // Validar monto esperado vs pagado
      const service = appointment.service;
      const expectedDeposit = service.depositAmount > 0 ? service.depositAmount : null;
      const expectedFull = service.price;
      const isDeposit = expectedDeposit && commitResponse.amount === expectedDeposit;
      const isFull = commitResponse.amount === expectedFull;

      if (!isDeposit && !isFull) {
        await logEvent({
          appointmentId,
          userId,
          event: "PAYMENT_ERROR",
          level: "CRITICAL",
          message: `El monto pagado (${commitResponse.amount}) no coincide con el precio total (${expectedFull}) ni con el abono mínimo (${expectedDeposit}).`,
          metadata: { amountPaid: commitResponse.amount, expectedFull, expectedDeposit }
        });
        throw new ValidationError("El monto de la transacción no coincide con el configurado para el servicio.");
      }

      // Validar buyOrder
      if (commitResponse.buy_order !== appointmentId) {
        await logEvent({
          appointmentId,
          userId,
          event: "PAYMENT_ERROR",
          level: "CRITICAL",
          message: `El buyOrder retornado (${commitResponse.buy_order}) no coincide con el ID de la cita (${appointmentId}).`,
          metadata: { buyOrderPaid: commitResponse.buy_order, appointmentId }
        });
        throw new ValidationError("El buyOrder de la transacción no coincide con la reserva.");
      }

      // Actualizar el estado del pago a aprobado (búsqueda indexada ultra rápida)
      let paymentRecord;
      try {
        paymentRecord = await paymentRepository.updateByTransactionId(tokenWs, { 
            status: "approved",
            amount: commitResponse.amount, // Validado
            type: isDeposit ? "deposit" : "full"
          });
      } catch (dbError) {
        await logEvent({
          appointmentId,
          userId,
          event: "PAYMENT_ERROR",
          level: "CRITICAL",
          message: "Error al registrar el pago aprobado en la base de datos.",
          technicalMessage: dbError.message
        });
        throw dbError;
      }

      // Actualizar el estado de la cita
      try {
        await appointmentRepository.update(appointmentId, {
          status: "confirmed", // Pasa a confirmada tras el pago exitoso
          paymentStatus: isDeposit ? "partially_paid" : "fully_paid",
        });

        await logEvent({
          appointmentId,
          userId,
          event: "APPOINTMENT_CONFIRMED",
          level: "SUCCESS",
          message: "Reserva confirmada exitosamente tras validación de pago.",
          metadata: { paymentId: paymentRecord._id }
        });
      } catch (dbError) {
        await logEvent({
          appointmentId,
          userId,
          event: "APPOINTMENT_CONFIRMATION_FAILED",
          level: "CRITICAL",
          message: "Pago aprobado pero no fue posible confirmar la reserva en la base de datos.",
          technicalMessage: dbError.message
        });
        throw dbError;
      }

      // Notificar cambio de disponibilidad en tiempo real vía WebSockets
      const dateStr = new Date(appointment.date).toISOString().split("T")[0];
      emitAvailabilityChange(appointment.worker._id.toString(), dateStr);

      // Enviar correo de confirmación al cliente
      const populated = await appointmentRepository.findById(appointmentId);
      if (populated && populated.client.email) {
        try {
          await mailer.sendAppointmentConfirmedEmail(populated.client.email, populated);
          await logEvent({
            appointmentId,
            userId,
            event: "EMAIL_NOTIFICATION_SENT",
            level: "INFO",
            message: `Correo de confirmación enviado a ${populated.client.email}.`,
            metadata: { email: populated.client.email }
          });
        } catch (mailError) {
          await logEvent({
            appointmentId,
            userId,
            event: "EMAIL_NOTIFICATION_FAILED",
            level: "ERROR",
            message: `Error al enviar correo de confirmación a ${populated.client.email}.`,
            technicalMessage: mailError.message,
            metadata: { email: populated.client.email }
          });
        }
      }

      return {
        success: true,
        appointmentId,
        amount: commitResponse.amount,
        authorizationCode: commitResponse.authorization_code,
      };
    } else {
      // Si fue rechazada por Transbank
      await logEvent({
        appointmentId,
        userId,
        event: "WEBPAY_PAYMENT_REJECTED",
        level: "WARN",
        message: "Pago rechazado por la pasarela de pago (Transbank).",
        metadata: { status: commitResponse.status, responseCode: commitResponse.response_code }
      });

      // Actualizar registro de pago a rechazado en la base de datos
      try {
        await paymentRepository.updateByTransactionId(tokenWs, { status: "rejected" });
      } catch (e) {}

      await appointmentRepository.update(appointmentId, { status: "cancelled" });

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
        message: "El pago fue rechazado por Transbank",
      };
    }
  } catch (error) {
    let appointmentId = null;
    try {
      const pendingPayment = await paymentRepository.findByTransactionId(tokenWs);
      if (pendingPayment) {
        appointmentId = pendingPayment.appointment.toString();
      }
    } catch (e) {}

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
