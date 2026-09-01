import { Router } from "express";
import {
  createWorker,
  deleteWorker,
  getWorkers,
} from "../controllers/user.controller.js";
import { isAuthenticated } from "../middleware/auth.middleware.js";
import { isAdmin } from "../middleware/role.middleware.js";
import { scopeBusiness, scopePublicBusiness } from "../middleware/business.middleware.js";
import { bindResolvedPublicBusinessOrigin } from "../middleware/publicWebBrowserBinding.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import { objectIdParamSchema } from "../validations/common.validation.js";
import { publicProfessionalDiscoverySchema } from "../validations/publicBookingDiscovery.validation.js";

const router = Router();

// Discovery público fijado por routing. Callers sin Origin conservan el contrato
// headless; navegadores deben bindear su Origin al Business explícito. G1 conserva
// esta superficie existente y exige serviceId válido mediante query estricta.
router.get(
  "/workers",
  scopePublicBusiness,
  bindResolvedPublicBusinessOrigin,
  validate(publicProfessionalDiscoverySchema),
  getWorkers,
);

// A2: las mutaciones legacy permanecen fail-closed hasta que exista el onboarding
// canónico. El POST no valida ni consume password/email porque nunca materializa
// identidad o participación. DELETE tampoco interpreta ?hard=true.
router.post("/workers", scopeBusiness, isAuthenticated, isAdmin, createWorker);
router.delete("/workers/:id", scopeBusiness, isAuthenticated, isAdmin, validate(objectIdParamSchema), deleteWorker);

export default router;
