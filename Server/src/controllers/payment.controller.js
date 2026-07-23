import * as paymentService from "../services/payment.service.js";
import { ValidationError } from "../utils/appError.js";
import { logEvent } from "../utils/auditLogger.js";
import { frontendUrl } from "../config/env.js";

const buildFrontendRedirect = (path, params = {}) => {
  const target = new URL(path, `${frontendUrl.replace(/\/$/, "")}/`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      target.searchParams.set(key, String(value));
    }
  });
  return target.toString();
};

const resolveBusinessSlug = async (token) => {
  try {
    return await paymentService.getBusinessSlugByTransactionToken(token);
  } catch {
    return null;
  }
};

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
    const tbkToken = req.body?.TBK_TOKEN || req.query?.TBK_TOKEN;
    // A. El usuario abortó o canceló el pago en la pasarela de Webpay
    if (!tokenWs && tbkToken) {
      await logEvent({
        event: "WEBPAY_PAYMENT_REJECTED",
        level: "WARN",
        message: "El usuario abortó o canceló el pago en la pasarela de Webpay.",
        metadata: { tbkToken }
      });
      const businessSlug = await resolveBusinessSlug(tbkToken);
      return res.redirect(buildFrontendRedirect("/payment-failed", {
        reason: "cancelled_by_user",
        slug: businessSlug,
      }));
    }

    // B. Si no hay token de ninguna forma, es una petición inválida
    if (!tokenWs) {
      await logEvent({
        event: "PAYMENT_ERROR",
        level: "ERROR",
        message: "Intento de retorno de Webpay sin ningún token."
      });
      return res.redirect(buildFrontendRedirect("/payment-failed", { reason: "missing_token" }));
    }

    // C. Validar la transacción con Transbank
    const result = await paymentService.confirmPayment(tokenWs);

    if (result.success) {
      // Redirección exitosa: lleva al cliente a la pantalla de éxito en tu frontend
      return res.redirect(
        buildFrontendRedirect("/payment-success", {
          appointmentId: result.appointmentId,
          code: result.authorizationCode,
          amount: result.amount,
          slug: result.businessSlug,
        })
      );
    } else {
      // Redirección fallida por rechazo bancario
      return res.redirect(
        buildFrontendRedirect("/payment-failed", {
          appointmentId: result.appointmentId,
          reason: "rejected",
          slug: result.businessSlug,
        })
      );
    }
  } catch (error) {
    // Redirección por error técnico/servidor
    const token = req.body?.token_ws || req.query?.token_ws || req.body?.TBK_TOKEN || req.query?.TBK_TOKEN;
    const businessSlug = await resolveBusinessSlug(token);
    return res.redirect(
      buildFrontendRedirect("/payment-failed", {
        reason: "server_error",
        message: error.message,
        slug: businessSlug,
      })
    );
  }
};
