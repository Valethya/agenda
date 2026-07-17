import { Router } from "express";
import rateLimit from "express-rate-limit";
import {
  register,
  login,
  logout,
  googleLogin,
  getCurrentUser,
  forgotPassword,
  resetPassword,
  changePassword,
  selectMembership,
  switchBusiness,
} from "../controllers/auth.controller.js";
import { stopImpersonatingBusiness } from "../controllers/superadmin.controller.js";
import { isAuthenticated } from "../middleware/auth.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
} from "../validations/auth.validation.js";
import {
  selectMembershipSchema,
  switchBusinessSchema,
  googleLoginSchema,
} from "../validations/common.validation.js";

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

const router = Router();

router.post("/register", validate(registerSchema), register);
router.post("/login", authLimiter, validate(loginSchema), login);
router.post("/select-membership", validate(selectMembershipSchema), selectMembership);
router.post("/switch-business", isAuthenticated, validate(switchBusinessSchema), switchBusiness);
router.post("/stop-impersonating", isAuthenticated, stopImpersonatingBusiness);
router.post("/google", validate(googleLoginSchema), googleLogin);
router.post("/logout", isAuthenticated, logout);
router.get("/me", getCurrentUser);
router.post("/forgot-password", authLimiter, validate(forgotPasswordSchema), forgotPassword);
router.post("/reset-password", validate(resetPasswordSchema), resetPassword);
router.post("/change-password", isAuthenticated, validate(changePasswordSchema), changePassword);

export default router;
