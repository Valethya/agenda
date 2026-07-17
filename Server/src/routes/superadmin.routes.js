import { Router } from "express";
import {
  getPlatformMetrics,
  getAdvancedPlatformAnalytics,
  createBusiness,
  listBusinesses,
  toggleBusinessStatus,
  impersonateBusiness,
} from "../controllers/superadmin.controller.js";
import { isAuthenticated } from "../middleware/auth.middleware.js";
import { isSuperadmin } from "../middleware/role.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import { createBusinessSchema, objectIdParamSchema } from "../validations/common.validation.js";

const router = Router();

// Proteger todas las rutas de superadmin
router.use(isAuthenticated, isSuperadmin);

router.get("/metrics", getPlatformMetrics);
router.get("/analytics", getAdvancedPlatformAnalytics);

// Rutas de gestión de negocios (Multi-Tenancy)
router.get("/businesses", listBusinesses);
router.post("/businesses", validate(createBusinessSchema), createBusiness);
router.patch("/businesses/:id/status", validate(objectIdParamSchema), toggleBusinessStatus);
router.post("/businesses/:id/impersonate", validate(objectIdParamSchema), impersonateBusiness);

export default router;
