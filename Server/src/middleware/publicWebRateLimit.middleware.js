import rateLimit from "express-rate-limit";
import {
  PUBLIC_WEB_VERIFICATION_RATE_LIMIT,
  PUBLIC_WEB_VERIFICATION_RATE_WINDOW_MS,
} from "../config/publicWeb.constants.js";

export const publicWebVerificationLimiter = rateLimit({
  windowMs: PUBLIC_WEB_VERIFICATION_RATE_WINDOW_MS,
  limit: PUBLIC_WEB_VERIFICATION_RATE_LIMIT,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: "fail",
    statusCode: 429,
    code: "RATE_LIMITED",
    message: "Demasiadas operaciones de verificación. Intenta nuevamente más tarde.",
  },
});
