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

const router = Router();

// La ruta de reserva es pública para clientes sin cuenta
router.post("/", validate(createAppointmentSchema), createAppointment);

// Las demás rutas de administración requieren inicio de sesión (trabajadores y admin)
router.get("/my", isAuthenticated, getMyAppointments);
router.get("/:id", isAuthenticated, getAppointment);
router.get("/:id/timeline", isAuthenticated, getAppointmentTimeline);
router.patch("/:id/confirm", isAuthenticated, confirmAppointment);
router.patch("/:id/complete", isAuthenticated, completeAppointment);
router.patch("/:id/cancel", isAuthenticated, cancelAppointment);

export default router;
