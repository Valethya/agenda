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
import { validate } from "../middleware/validate.middleware.js";
import { createServiceSchema, updateServiceSchema } from "../validations/service.validation.js";
import { objectIdParamSchema } from "../validations/common.validation.js";

const router = Router();

// Rutas públicas / lectura de clientes
router.get("/", getServices);
router.get("/:id", validate(objectIdParamSchema), getService);

// Rutas protegidas: Solo administradores pueden crear, modificar o eliminar
router.post("/", isAuthenticated, isAdmin, validate(createServiceSchema), createService);
router.put("/:id", isAuthenticated, isAdmin, validate(updateServiceSchema), updateService);
router.delete("/:id", isAuthenticated, isAdmin, validate(objectIdParamSchema), deleteService);

export default router;
