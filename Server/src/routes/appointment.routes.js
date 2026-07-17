import { Router } from "express";
import {
  createAppointment,
  confirmAppointment,
  completeAppointment,
  cancelAppointment,
  getAppointment,
  getMyAppointments,
  getAppointmentTimeline,
} from "../controllers/appointment.controller.js";
import { isAuthenticated } from "../middleware/auth.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import { createAppointmentSchema } from "../validations/appointment.validation.js";
import { objectIdParamSchema } from "../validations/common.validation.js";

const router = Router();

// La ruta de reserva es pública para clientes sin cuenta
router.post("/", validate(createAppointmentSchema), createAppointment);

// Las demás rutas de administración requieren inicio de sesión (trabajadores y admin)
router.get("/my", isAuthenticated, getMyAppointments);
router.get("/:id", isAuthenticated, validate(objectIdParamSchema), getAppointment);
router.get("/:id/timeline", isAuthenticated, validate(objectIdParamSchema), getAppointmentTimeline);
router.patch("/:id/confirm", isAuthenticated, validate(objectIdParamSchema), confirmAppointment);
router.patch("/:id/complete", isAuthenticated, validate(objectIdParamSchema), completeAppointment);
router.patch("/:id/cancel", isAuthenticated, validate(objectIdParamSchema), cancelAppointment);

export default router;
