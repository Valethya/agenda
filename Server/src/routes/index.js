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
import internalBookingRoutes from "./internalBooking.routes.js";
import adminTeamRoutes from "./adminTeam.routes.js";
import { paymentRoutesEnabled } from "../config/env.js";

const router = Router();

router.use("/", authRoutes);

// Surface administrativa fijada por routing del servidor. El caller no puede
// obtenerla declarando un header en una ruta pública.
router.use("/internal", internalBookingRoutes);
router.use("/team", adminTeamRoutes);

// Contrato headless público. Cookies incidentales no cambian estas políticas.
router.use("/services", serviceRoutes);
router.use("/availability", availabilityRoutes);
router.use("/appointments", appointmentRoutes);
router.use("/users", userRoutes);

// C2 tiene su propio contrato businessId/capability y permanece independiente.
router.use("/guest-appointments", guestAppointmentCapabilityRoutes);

if (paymentRoutesEnabled) {
  router.use("/payments", paymentRoutes);
}

router.use("/business-settings", businessConfigRoutes);
router.use("/superadmin", superadminRoutes);
router.use("/health", healthRoutes);

export default router;
