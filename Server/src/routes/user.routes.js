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
import { createWorkerSchema, objectIdParamSchema } from "../validations/common.validation.js";

const router = Router();

// Discovery público fijado por routing. Callers sin Origin conservan el contrato
// headless; navegadores deben bindear su Origin al Business explícito.
router.get("/workers", scopePublicBusiness, bindResolvedPublicBusinessOrigin, getWorkers);

router.post("/workers", scopeBusiness, isAuthenticated, isAdmin, validate(createWorkerSchema), createWorker);
router.delete("/workers/:id", scopeBusiness, isAuthenticated, isAdmin, validate(objectIdParamSchema), deleteWorker);

export default router;
