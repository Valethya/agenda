import * as paymentService from "../services/payment.service.js";
import { ValidationError } from "../utils/appError.js";
import { logEvent } from "../utils/auditLogger.js";

// 1. Iniciar pago para una cita
export const startPayment = async (req, res, next) => {
  try {
    const { appointmentId, paymentType } = req.body || {};

    if (!appointmentId) {
      throw new ValidationError("El campo appointmentId es obligatorio");
    }

    // paymentType puede ser "deposit" (abono) o "full" (total)
    const paymentDetails = await paymentService.initiatePayment(
      appointmentId,
      paymentType || "deposit"
    );

    res.status(200).json({
      status: "success",
      payload: paymentDetails,
    });
  } catch (error) {
    next(error);
  }
};

// 2. Retorno de Webpay (Confirmación y redirección al Frontend)
export const webpayReturn = async (req, res, next) => {
  try {
    // Transbank envía los parámetros por POST (en req.body) o GET (en req.query)
    const tokenWs = req.body?.token_ws || req.query?.token_ws;
    const tbkToken = req.body?.TBK_TOKEN_WS || req.query?.TBK_TOKEN_WS;
    const slug = req.query?.slug || "barberia";

    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";

    // A. El usuario abortó o canceló el pago en la pasarela de Webpay
    if (!tokenWs && tbkToken) {
      await logEvent({
        event: "WEBPAY_PAYMENT_REJECTED",
        level: "WARN",
        message: "El usuario abortó o canceló el pago en la pasarela de Webpay.",
        metadata: { tbkToken }
      });
      return res.redirect(`${frontendUrl}/payment-failed?reason=cancelled_by_user&slug=${slug}`);
    }

    // B. Si no hay token de ninguna forma, es una petición inválida
    if (!tokenWs) {
      await logEvent({
        event: "PAYMENT_ERROR",
        level: "ERROR",
        message: "Intento de retorno de Webpay sin ningún token."
      });
      return res.redirect(`${frontendUrl}/payment-failed?reason=missing_token&slug=${slug}`);
    }

    // C. Validar la transacción con Transbank
    const result = await paymentService.confirmPayment(tokenWs);

    if (result.success) {
      // Redirección exitosa: lleva al cliente a la pantalla de éxito en tu frontend
      return res.redirect(
        `${frontendUrl}/payment-success?appointmentId=${result.appointmentId}&code=${result.authorizationCode}&amount=${result.amount}&slug=${slug}`
      );
    } else {
      // Redirección fallida por rechazo bancario
      return res.redirect(
        `${frontendUrl}/payment-failed?appointmentId=${result.appointmentId}&reason=rejected&slug=${slug}`
      );
    }
  } catch (error) {
    // Redirección por error técnico/servidor
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
    const slug = req.query.slug || "barberia";
    return res.redirect(
      `${frontendUrl}/payment-failed?reason=server_error&message=${encodeURIComponent(error.message)}&slug=${slug}`
    );
  }
};
