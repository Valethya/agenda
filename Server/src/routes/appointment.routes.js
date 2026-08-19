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
import { validate } from "../middleware/validate.middleware.js";
import { publicCreateAppointmentSchema } from "../validations/appointment.validation.js";
import { objectIdParamSchema } from "../validations/common.validation.js";

const router = Router();

// El path público siempre usa el schema headless strict. isSuggestion,
// paymentOption y otros controles internos no pueden habilitarse con headers.
router.post(
  "/",
  scopePublicBusiness,
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
