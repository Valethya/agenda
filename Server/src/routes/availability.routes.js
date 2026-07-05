import { Router } from "express";
import {
  getSlots,
  getWorkerShifts,
  saveShift,
  createBlock,
  deleteBlock,
} from "../controllers/availability.controller.js";
import { isAuthenticated } from "../middleware/auth.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import { availabilityQuerySchema, createBlockSchema } from "../validations/appointment.validation.js";

const router = Router();

// Consultas públicas (ej: el widget del cliente consulta slots libres)
router.get("/slots", validate(availabilityQuerySchema), getSlots);
router.get("/shifts/:workerId", getWorkerShifts);

// Gestión interna: requiere autenticación de trabajadores o admins
router.post("/shifts", isAuthenticated, saveShift);
router.post("/blocks", isAuthenticated, validate(createBlockSchema), createBlock);
router.delete("/blocks/:id", isAuthenticated, deleteBlock);

export default router;
