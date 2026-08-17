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

router.use("/services", scopeBusiness, serviceRoutes);
router.use("/availability", scopeBusiness, availabilityRoutes);
router.use("/appointments", scopeBusiness, appointmentRoutes);

// C2 has its own explicit businessId contract and intentionally does not use
// scopeBusiness, which also accepts session/slug/header-derived tenant context.
router.use("/guest-appointments", guestAppointmentCapabilityRoutes);

if (paymentRoutesEnabled) {
  router.use("/payments", paymentRoutes);
}
router.use("/users", scopeBusiness, userRoutes);
router.use("/business-settings", scopeBusiness, businessConfigRoutes);

router.use("/superadmin", superadminRoutes);
router.use("/health", healthRoutes);

export default router;
