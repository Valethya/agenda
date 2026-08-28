import rateLimit from "express-rate-limit";

const makeLimiter = (limit) => rateLimit({
  windowMs: 15 * 60 * 1000,
  limit,
  message: {
    status: "fail",
    statusCode: 429,
    code: "TENANT_ONBOARDING_RATE_LIMITED",
    message: "Demasiadas solicitudes de onboarding. Intenta nuevamente más tarde.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Issuance can trigger sensitive email delivery, so its budget is intentionally
// tighter than claimant binding. The 256-bit challenge remains the primary
// brute-force boundary; this limiter also bounds repeated credential attempts.
export const tenantOnboardingIssueLimiter = makeLimiter(5);
export const tenantOnboardingBindLimiter = makeLimiter(10);
