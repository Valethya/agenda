import { Router } from "express";
import {
  getServices,
  getService,
  createService,
  updateService,
  deleteService,
} from "../controllers/service.controller.js";
import { isAuthenticated } from "../middleware/auth.middleware.js";
import { isAdmin } from "../middleware/role.middleware.js";
import { scopeBusiness, scopeHeadlessOrSessionBusiness } from "../middleware/business.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import { createServiceSchema, updateServiceSchema } from "../validations/service.validation.js";
import { objectIdParamSchema } from "../validations/common.validation.js";

const router = Router();

// Las lecturas comparten path: tenant explícito => contrato headless público;
// sin tenant explícito => contexto de sesión del panel.
router.get("/", scopeHeadlessOrSessionBusiness, getServices);
router.get("/:id", scopeHeadlessOrSessionBusiness, validate(objectIdParamSchema), getService);

// Mutaciones administrativas siempre usan autoridad tenant de sesión.
router.post("/", scopeBusiness, isAuthenticated, isAdmin, validate(createServiceSchema), createService);
router.put("/:id", scopeBusiness, isAuthenticated, isAdmin, validate(updateServiceSchema), updateService);
router.delete("/:id", scopeBusiness, isAuthenticated, isAdmin, validate(objectIdParamSchema), deleteService);

export default router;
