import { Router } from "express";
import { startPayment, webpayReturn } from "../controllers/payment.controller.js";
import { validate } from "../middleware/validate.middleware.js";
import { scopeBusiness } from "../middleware/business.middleware.js";
import { initiatePaymentSchema, webpayReturnSchema } from "../validations/common.validation.js";

const router = Router();

// Iniciar transacción (Pública)
router.post("/initiate", scopeBusiness, validate(initiatePaymentSchema), startPayment);

// Rutas de retorno de Webpay (Públicas, llamadas por redirección de Transbank)
// Transbank redirige mediante POST, pero se soporta GET por contingencias
router.post("/webpay-return", validate(webpayReturnSchema), webpayReturn);
router.get("/webpay-return", validate(webpayReturnSchema), webpayReturn);

export default router;
