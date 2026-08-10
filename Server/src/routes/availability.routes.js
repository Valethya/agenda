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
import { validate } from "../middleware/validate.middleware.js";
import { availabilityQuerySchema, createBlockSchema } from "../validations/appointment.validation.js";
import { saveShiftSchema, objectIdParamSchema, workerIdParamSchema } from "../validations/common.validation.js";

const router = Router();

router.get("/slots", validate(availabilityQuerySchema), getSlots);
router.get("/shifts/:workerId", validate(workerIdParamSchema), getWorkerShifts);

router.post("/shifts", isAuthenticated, isWorkerOrAdmin, validate(saveShiftSchema), saveShift);
router.post("/blocks", isAuthenticated, isWorkerOrAdmin, validate(createBlockSchema), createBlock);
router.delete("/blocks/:id", isAuthenticated, isWorkerOrAdmin, validate(objectIdParamSchema), deleteBlock);

export default router;
