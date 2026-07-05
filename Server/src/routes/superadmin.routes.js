import { Router } from "express";
import {
  getPlatformMetrics,
  getAdvancedPlatformAnalytics,
  createBusiness,
  listBusinesses,
  toggleBusinessStatus,
} from "../controllers/superadmin.controller.js";
import { isAuthenticated } from "../middleware/auth.middleware.js";
import { isSuperadmin } from "../middleware/role.middleware.js";

const router = Router();

// Proteger todas las rutas de superadmin
router.use(isAuthenticated, isSuperadmin);

router.get("/metrics", getPlatformMetrics);
router.get("/analytics", getAdvancedPlatformAnalytics);

// Rutas de gestión de negocios (Multi-Tenancy)
router.get("/businesses", listBusinesses);
router.post("/businesses", createBusiness);
router.patch("/businesses/:id/status", toggleBusinessStatus);

export default router;
