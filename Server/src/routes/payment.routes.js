import { Router } from "express";
import { webpayReturn } from "../controllers/payment.controller.js";
import { validate } from "../middleware/validate.middleware.js";
import { scopePublicBusiness } from "../middleware/business.middleware.js";
import { initiatePaymentSchema, webpayReturnSchema } from "../validations/common.validation.js";
import { ForbiddenError } from "../utils/appError.js";

const router = Router();

// 6.2.6-A: Appointment ID no es payment authority. Aunque ENABLE_PAYMENTS=true,
// el inicio público permanece fail-closed hasta existir una autoridad/capability
// purpose-specific de pago en una fase posterior.
router.post(
  "/initiate",
  scopePublicBusiness,
  validate(initiatePaymentSchema),
  (_req, _res, next) => next(new ForbiddenError("El inicio de pago público requiere una autoridad específica")),
);

// Se conserva el callback para transacciones legacy ya iniciadas cuando el
// módulo se habilita explícitamente; esta ruta no permite iniciar una nueva.
router.post("/webpay-return", validate(webpayReturnSchema), webpayReturn);
router.get("/webpay-return", validate(webpayReturnSchema), webpayReturn);

export default router;
