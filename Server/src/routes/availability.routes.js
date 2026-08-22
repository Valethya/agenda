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
import { validate } from "../middleware/validate.middleware.js";
import { availabilityQuerySchema, createBlockSchema } from "../validations/appointment.validation.js";
import { saveShiftSchema, objectIdParamSchema, workerIdParamSchema } from "../validations/common.validation.js";

const router = Router();

// Slots pertenece al contrato headless y permanece público aunque exista una
// cookie ambiente. Shift raw y Blocks continúan exclusivamente internos.
router.get("/slots", scopePublicBusiness, validate(availabilityQuerySchema), getSlots);

router.get(
  "/shifts/:workerId",
  scopeBusiness,
  isAuthenticated,
  isWorkerOrAdmin,
  validate(workerIdParamSchema),
  getWorkerShifts,
);

router.post("/shifts", scopeBusiness, isAuthenticated, isWorkerOrAdmin, validate(saveShiftSchema), saveShift);
router.post("/blocks", scopeBusiness, isAuthenticated, isWorkerOrAdmin, validate(createBlockSchema), createBlock);
router.delete("/blocks/:id", scopeBusiness, isAuthenticated, isWorkerOrAdmin, validate(objectIdParamSchema), deleteBlock);

export default router;
