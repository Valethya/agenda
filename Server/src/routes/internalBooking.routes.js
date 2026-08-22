import { Router } from "express";
import { getServices, getService } from "../controllers/service.controller.js";
import { getWorkers } from "../controllers/user.controller.js";
import { createAppointment } from "../controllers/appointment.controller.js";
import { scopeBusiness } from "../middleware/business.middleware.js";
import { isAuthenticated } from "../middleware/auth.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import { createAppointmentSchema } from "../validations/appointment.validation.js";
import { objectIdParamSchema } from "../validations/common.validation.js";

const router = Router();

// Surface administrativa fijada por routing del servidor. Ningún header enviado
// por el caller selecciona estas políticas. scopeBusiness exige sesión, origen de
// panel cuando Origin está presente y Membership tenant vigente en cada request.
router.get("/services", scopeBusiness, isAuthenticated, getServices);
router.get("/services/:id", scopeBusiness, isAuthenticated, validate(objectIdParamSchema), getService);
router.get("/users/workers", scopeBusiness, isAuthenticated, getWorkers);
router.post(
  "/appointments",
  scopeBusiness,
  isAuthenticated,
  validate(createAppointmentSchema, { assignBody: "bookingInput" }),
  createAppointment,
);

export default router;
