import { Router } from "express";
import {
  getBusinessConfig,
  updateBusinessConfig,
  getBusinessMetrics,
  getBusinessAnalytics,
} from "../controllers/businessConfig.controller.js";
import { isAuthenticated } from "../middleware/auth.middleware.js";
import { isAdmin } from "../middleware/role.middleware.js";
import { scopeBusiness, scopePublicBusiness } from "../middleware/business.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import { updateBusinessConfigSchema } from "../validations/common.validation.js";

const router = Router();

// Config necesaria por la web/widget: tenant explícito, sin autoridad de cookie.
router.get("/", scopePublicBusiness, getBusinessConfig);

// Configuración, métricas y analíticas: sesión + Membership admin vigente.
router.put("/", scopeBusiness, isAuthenticated, isAdmin, validate(updateBusinessConfigSchema), updateBusinessConfig);
router.get("/metrics", scopeBusiness, isAuthenticated, isAdmin, getBusinessMetrics);
router.get("/analytics", scopeBusiness, isAuthenticated, isAdmin, getBusinessAnalytics);

export default router;
