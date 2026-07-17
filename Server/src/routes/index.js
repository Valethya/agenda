import { Router } from "express";
import healthRoutes from "./health.routes.js";
import authRoutes from "./auth.routes.js";
import serviceRoutes from "./service.routes.js";
import availabilityRoutes from "./availability.routes.js";
import appointmentRoutes from "./appointment.routes.js";
import paymentRoutes from "./payment.routes.js";
import userRoutes from "./user.routes.js";
import businessConfigRoutes from "./businessConfig.routes.js";
import superadminRoutes from "./superadmin.routes.js";
import { scopeBusiness } from "../middleware/business.middleware.js";

const router = Router();

// Auth routes (register, login, logout, password reset, etc.)
router.use("/", authRoutes);

// Business-scoped routes
router.use("/services", scopeBusiness, serviceRoutes);
router.use("/availability", scopeBusiness, availabilityRoutes);
router.use("/appointments", scopeBusiness, appointmentRoutes);
router.use("/payments", scopeBusiness, paymentRoutes);
router.use("/users", scopeBusiness, userRoutes);
router.use("/business-settings", scopeBusiness, businessConfigRoutes);

// Admin routes
router.use("/superadmin", superadminRoutes);

// Health
router.use("/health", healthRoutes);

export default router;
