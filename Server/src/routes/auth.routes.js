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
import { requireTrustedAuthenticatedOrigin } from "../middleware/trustedAuthenticatedOrigin.middleware.js";
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
// Login/admin session creation is a panel operation when a browser supplies Origin.
router.post("/login", requireTrustedAuthenticatedOrigin, authLimiter, validate(loginSchema), login);
router.post("/select-membership", requireTrustedAuthenticatedOrigin, validate(selectMembershipSchema), selectMembership);
router.post("/switch-business", requireTrustedAuthenticatedOrigin, isAuthenticated, validate(switchBusinessSchema), switchBusiness);
router.post("/stop-impersonating", requireTrustedAuthenticatedOrigin, isAuthenticated, stopImpersonatingBusiness);
router.post("/google", requireTrustedAuthenticatedOrigin, validate(googleLoginSchema), googleLogin);
router.post("/logout", requireTrustedAuthenticatedOrigin, isAuthenticated, logout);
router.get("/me", requireTrustedAuthenticatedOrigin, getCurrentUser);
router.post("/forgot-password", authLimiter, validate(forgotPasswordSchema), forgotPassword);
router.post("/reset-password", validate(resetPasswordSchema), resetPassword);
router.post("/change-password", requireTrustedAuthenticatedOrigin, isAuthenticated, validate(changePasswordSchema), changePassword);

export default router;
