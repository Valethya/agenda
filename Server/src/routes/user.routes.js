import { Router } from "express";
import {
  createWorker,
  deleteWorker,
  getWorkers,
} from "../controllers/user.controller.js";
import { isAuthenticated } from "../middleware/auth.middleware.js";
import { isAdmin } from "../middleware/role.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import { createWorkerSchema, objectIdParamSchema } from "../validations/common.validation.js";

const router = Router();

// Rutas públicas (ej: el cliente visualiza qué profesionales están disponibles)
router.get("/workers", getWorkers);

// Rutas protegidas de administración (Solo administradores)
router.post("/workers", isAuthenticated, isAdmin, validate(createWorkerSchema), createWorker);
router.delete("/workers/:id", isAuthenticated, isAdmin, validate(objectIdParamSchema), deleteWorker);

export default router;
