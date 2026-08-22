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
import { scopeBusiness, scopePublicBusiness } from "../middleware/business.middleware.js";
import { bindResolvedPublicBusinessOrigin } from "../middleware/publicWebBrowserBinding.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import { publicCreateAppointmentSchema } from "../validations/appointment.validation.js";
import { objectIdParamSchema } from "../validations/common.validation.js";

const router = Router();

// El path público siempre usa el schema headless strict. Para navegador, el
// binding Origin -> fresh trust del Business ocurre antes de validar/ejecutar el
// controller y por tanto antes de cualquier creación/mutación.
router.post(
  "/",
  scopePublicBusiness,
  bindResolvedPublicBusinessOrigin,
  validate(publicCreateAppointmentSchema, { assignBody: "bookingInput" }),
  createAppointment,
);

router.get("/my", scopeBusiness, isAuthenticated, getMyAppointments);
router.get("/:id", scopeBusiness, isAuthenticated, validate(objectIdParamSchema), getAppointment);
router.get("/:id/timeline", scopeBusiness, isAuthenticated, validate(objectIdParamSchema), getAppointmentTimeline);
router.patch("/:id/confirm", scopeBusiness, isAuthenticated, validate(objectIdParamSchema), confirmAppointment);
router.patch("/:id/complete", scopeBusiness, isAuthenticated, validate(objectIdParamSchema), completeAppointment);
router.patch("/:id/cancel", scopeBusiness, isAuthenticated, validate(objectIdParamSchema), cancelAppointment);

export default router;
