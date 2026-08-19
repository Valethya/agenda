import { Router } from "express";
import {
  getBusinessConfig,
  updateBusinessConfig,
  getBusinessMetrics,
  getBusinessAnalytics,
} from "../controllers/businessConfig.controller.js";
import { isAuthenticated } from "../middleware/auth.middleware.js";
import { isAdmin } from "../middleware/role.middleware.js";
import { scopeBusiness } from "../middleware/business.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import { updateBusinessConfigSchema } from "../validations/common.validation.js";

const router = Router();

// BusinessConfig es estado operacional del panel, no parte del contrato headless
// mínimo. Un GET anónimo nunca alcanza getOrInitializeConfig(), por lo que no puede
// crear defaults como side effect de una lectura pública.
router.get("/", scopeBusiness, isAuthenticated, getBusinessConfig);

// Configuración, métricas y analíticas: sesión + Membership admin vigente.
router.put("/", scopeBusiness, isAuthenticated, isAdmin, validate(updateBusinessConfigSchema), updateBusinessConfig);
router.get("/metrics", scopeBusiness, isAuthenticated, isAdmin, getBusinessMetrics);
router.get("/analytics", scopeBusiness, isAuthenticated, isAdmin, getBusinessAnalytics);

export default router;
