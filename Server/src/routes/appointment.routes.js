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
import { scopeBusiness, scopeHeadlessOrSessionBusiness } from "../middleware/business.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import { createAppointmentSchema, publicCreateAppointmentSchema } from "../validations/appointment.validation.js";
import { objectIdParamSchema } from "../validations/common.validation.js";

const router = Router();

// Path compartido, surface explícita. El controller consume bookingInput, nunca
// req.body raw, para que controles legacy no atraviesen la frontera pública.
router.post(
  "/",
  scopeHeadlessOrSessionBusiness,
  validate(
    (req) => req.bookingSurface === "public" ? publicCreateAppointmentSchema : createAppointmentSchema,
    { assignBody: "bookingInput" },
  ),
  createAppointment,
);

router.get("/my", scopeBusiness, isAuthenticated, getMyAppointments);
router.get("/:id", scopeBusiness, isAuthenticated, validate(objectIdParamSchema), getAppointment);
router.get("/:id/timeline", scopeBusiness, isAuthenticated, validate(objectIdParamSchema), getAppointmentTimeline);
router.patch("/:id/confirm", scopeBusiness, isAuthenticated, validate(objectIdParamSchema), confirmAppointment);
router.patch("/:id/complete", scopeBusiness, isAuthenticated, validate(objectIdParamSchema), completeAppointment);
router.patch("/:id/cancel", scopeBusiness, isAuthenticated, validate(objectIdParamSchema), cancelAppointment);

export default router;
