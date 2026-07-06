import { Router } from "express";
import healthRoutes from "./health.routes.js";
import serviceRoutes from "./service.routes.js";
import availabilityRoutes from "./availability.routes.js";
import appointmentRoutes from "./appointment.routes.js";
import paymentRoutes from "./payment.routes.js";
import userRoutes from "./user.routes.js";
import businessConfigRoutes from "./businessConfig.routes.js";
import superadminRoutes from "./superadmin.routes.js";
import { register, login, logout, googleLogin, getCurrentUser, forgotPassword, resetPassword, changePassword, selectMembership, switchBusiness } from "../controllers/auth.controller.js";
import { stopImpersonatingBusiness } from "../controllers/superadmin.controller.js";
import { isAuthenticated } from "../middleware/auth.middleware.js";
import { isAdmin } from "../middleware/role.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import rateLimit from "express-rate-limit";
import {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
} from "../validations/auth.validation.js";

const authLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutos
  limit: 5, // Máximo 5 intentos por IP
  message: {
    status: "fail",
    message: "Demasiados intentos desde esta dirección. Por favor, intente de nuevo en 10 minutos.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

import { scopeBusiness } from "../middleware/business.middleware.js";

const router = Router();

router.post("/register", validate(registerSchema), register);
router.post("/login", authLimiter, validate(loginSchema), login);
router.post("/select-membership", selectMembership);
router.post("/switch-business", isAuthenticated, switchBusiness);
router.post("/stop-impersonating", isAuthenticated, stopImpersonatingBusiness);
router.post("/google", googleLogin);
router.post("/logout", isAuthenticated, logout);
router.get("/me", getCurrentUser);
router.post("/forgot-password", authLimiter, validate(forgotPasswordSchema), forgotPassword);
router.post("/reset-password", validate(resetPasswordSchema), resetPassword);
router.post("/change-password", isAuthenticated, validate(changePasswordSchema), changePassword);

router.use("/services", scopeBusiness, serviceRoutes);
router.use("/availability", scopeBusiness, availabilityRoutes);
router.use("/appointments", scopeBusiness, appointmentRoutes);
router.use("/payments", scopeBusiness, paymentRoutes);
router.use("/users", scopeBusiness, userRoutes);
router.use("/business-settings", scopeBusiness, businessConfigRoutes);
router.use("/superadmin", superadminRoutes);
router.use("/health", healthRoutes);
router.get("/test-auth", isAuthenticated, isAdmin, (req, res) => {
  res.status(200).json({
    status: "success",
    user: req.session.user,
  });
});
export default router;
