import { Router } from "express";
import {
  configurePublicWeb,
  deletePublicWeb,
  getBusinessConfig,
  getBusinessMetrics,
  getBusinessAnalytics,
  reverifyPublicWeb,
  rotatePublicWebChallenge,
  updateBusinessConfig,
  verifyPublicWeb,
} from "../controllers/businessConfig.controller.js";
import { isAuthenticated } from "../middleware/auth.middleware.js";
import { isAdmin } from "../middleware/role.middleware.js";
import { scopeBusiness } from "../middleware/business.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import { publicWebVerificationLimiter } from "../middleware/publicWebRateLimit.middleware.js";
import {
  configurePublicWebSchema,
  emptyPublicWebCommandSchema,
  updateBusinessConfigSchema,
} from "../validations/common.validation.js";

const router = Router();

// BusinessConfig es estado operacional del panel, no parte del contrato headless.
// GET es internal-only y semánticamente read-only: si no existe configuración,
// devuelve defaults calculados sin materializar un documento. La persistencia
// sólo ocurre mediante comandos explícitos como PUT.
router.get("/", scopeBusiness, isAuthenticated, getBusinessConfig);

// PublicWeb commands remain tenant-internal. scopeBusiness also enforces the
// server-controlled trusted authenticated panel origin before Membership role.
router.put(
  "/public-web",
  scopeBusiness,
  isAuthenticated,
  isAdmin,
  validate(configurePublicWebSchema, { assignBody: "publicWebInput" }),
  configurePublicWeb,
);
router.post(
  "/public-web/verify",
  scopeBusiness,
  isAuthenticated,
  isAdmin,
  publicWebVerificationLimiter,
  validate(emptyPublicWebCommandSchema),
  verifyPublicWeb,
);
router.post(
  "/public-web/reverify",
  scopeBusiness,
  isAuthenticated,
  isAdmin,
  publicWebVerificationLimiter,
  validate(emptyPublicWebCommandSchema),
  reverifyPublicWeb,
);
router.post(
  "/public-web/verification-challenge/rotate",
  scopeBusiness,
  isAuthenticated,
  isAdmin,
  publicWebVerificationLimiter,
  validate(emptyPublicWebCommandSchema),
  rotatePublicWebChallenge,
);
router.delete(
  "/public-web",
  scopeBusiness,
  isAuthenticated,
  isAdmin,
  validate(emptyPublicWebCommandSchema),
  deletePublicWeb,
);

// Configuración, métricas y analíticas: sesión + Membership admin vigente.
router.put("/", scopeBusiness, isAuthenticated, isAdmin, validate(updateBusinessConfigSchema), updateBusinessConfig);
router.get("/metrics", scopeBusiness, isAuthenticated, isAdmin, getBusinessMetrics);
router.get("/analytics", scopeBusiness, isAuthenticated, isAdmin, getBusinessAnalytics);

export default router;
