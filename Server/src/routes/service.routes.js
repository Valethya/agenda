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
import { scopeBusiness, scopePublicBusiness } from "../middleware/business.middleware.js";
import { bindResolvedPublicBusinessOrigin } from "../middleware/publicWebBrowserBinding.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import { createServiceSchema, updateServiceSchema } from "../validations/service.validation.js";
import { objectIdParamSchema } from "../validations/common.validation.js";

const router = Router();

// Estos paths son contractualmente públicos. Una cookie o header del caller no
// puede convertirlos en lecturas administrativas. El panel usa /api/internal/services.
router.get("/", scopePublicBusiness, bindResolvedPublicBusinessOrigin, getServices);
router.get("/:id", scopePublicBusiness, bindResolvedPublicBusinessOrigin, validate(objectIdParamSchema), getService);

// Mutaciones administrativas siempre usan autoridad tenant de sesión vigente.
router.post("/", scopeBusiness, isAuthenticated, isAdmin, validate(createServiceSchema), createService);
router.put("/:id", scopeBusiness, isAuthenticated, isAdmin, validate(updateServiceSchema), updateService);
router.delete("/:id", scopeBusiness, isAuthenticated, isAdmin, validate(objectIdParamSchema), deleteService);

export default router;
