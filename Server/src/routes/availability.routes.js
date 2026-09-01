import { Router } from "express";
import {
  getSlots,
  getWorkerShifts,
  saveShift,
  createBlock,
  deleteBlock,
} from "../controllers/availability.controller.js";
import { isAuthenticated } from "../middleware/auth.middleware.js";
import { isWorkerOrAdmin } from "../middleware/role.middleware.js";
import { scopeBusiness, scopePublicBusiness } from "../middleware/business.middleware.js";
import { bindResolvedPublicBusinessOrigin } from "../middleware/publicWebBrowserBinding.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import { availabilityQuerySchema, createBlockSchema } from "../validations/appointment.validation.js";
import { saveShiftSchema, objectIdParamSchema, workerIdParamSchema } from "../validations/common.validation.js";

const router = Router();

// Slots pertenece al contrato headless y permanece público para callers sin
// Origin. Navegadores además deben bindear su Origin al Business resuelto.
router.get("/slots", scopePublicBusiness, bindResolvedPublicBusinessOrigin, validate(availabilityQuerySchema), getSlots);

router.get(
  "/shifts/:workerId",
  scopeBusiness,
  isAuthenticated,
  isWorkerOrAdmin,
  validate(workerIdParamSchema),
  getWorkerShifts,
);

router.post(
  "/shifts",
  scopeBusiness,
  isAuthenticated,
  isWorkerOrAdmin,
  validate(saveShiftSchema, { assignBody: "validatedShiftInput" }),
  saveShift,
);
router.post("/blocks", scopeBusiness, isAuthenticated, isWorkerOrAdmin, validate(createBlockSchema), createBlock);
router.delete("/blocks/:id", scopeBusiness, isAuthenticated, isWorkerOrAdmin, validate(objectIdParamSchema), deleteBlock);

export default router;
