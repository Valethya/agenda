import { Router } from "express";
import {
  getBusinessConfig,
  updateBusinessConfig,
  getBusinessMetrics,
  getBusinessAnalytics,
} from "../controllers/businessConfig.controller.js";
import { isAuthenticated } from "../middleware/auth.middleware.js";
import { isAdmin } from "../middleware/role.middleware.js";

const router = Router();

// Consultas públicas (para que el frontend o widget obtenga políticas del negocio)
router.get("/", getBusinessConfig);

// Configuración protegida (Solo administradores)
router.put("/", isAuthenticated, isAdmin, updateBusinessConfig);

// Métricas y analíticas (Solo administradores del negocio)
router.get("/metrics", isAuthenticated, isAdmin, getBusinessMetrics);
router.get("/analytics", isAuthenticated, isAdmin, getBusinessAnalytics);

export default router;
