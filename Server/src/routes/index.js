import { Router } from "express";
import healthRoutes from "./health.routes.js";
import authRoutes from "./auth.routes.js";
import serviceRoutes from "./service.routes.js";
import availabilityRoutes from "./availability.routes.js";
import appointmentRoutes from "./appointment.routes.js";
import guestAppointmentCapabilityRoutes from "./guestAppointmentCapability.routes.js";
import paymentRoutes from "./payment.routes.js";
import userRoutes from "./user.routes.js";
import businessConfigRoutes from "./businessConfig.routes.js";
import superadminRoutes from "./superadmin.routes.js";
import { scopeBusiness } from "../middleware/business.middleware.js";
import { paymentRoutesEnabled } from "../config/env.js";

const router = Router();

router.use("/", authRoutes);

// Services, availability, appointments and workers contain both public headless
// and internal panel operations. Each router declares its tenant policy at the
// route boundary so an incidental session cannot redefine a public request.
router.use("/services", serviceRoutes);
router.use("/availability", availabilityRoutes);
router.use("/appointments", appointmentRoutes);
router.use("/users", userRoutes);

// C2 has its own explicit businessId contract and intentionally does not use
// the generic Business scoping middleware.
router.use("/guest-appointments", guestAppointmentCapabilityRoutes);

if (paymentRoutesEnabled) {
  router.use("/payments", paymentRoutes);
}

router.use("/business-settings", scopeBusiness, businessConfigRoutes);
router.use("/superadmin", superadminRoutes);
router.use("/health", healthRoutes);

export default router;
