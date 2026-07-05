import { Router } from "express";
import { startPayment, webpayReturn } from "../controllers/payment.controller.js";
import { isAuthenticated } from "../middleware/auth.middleware.js";

const router = Router();

// Iniciar transacción (Pública)
router.post("/initiate", startPayment);

// Rutas de retorno de Webpay (Públicas, llamadas por redirección de Transbank)
// Transbank redirige mediante POST, pero se soporta GET por contingencias
router.post("/webpay-return", webpayReturn);
router.get("/webpay-return", webpayReturn);

export default router;
