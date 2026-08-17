import rateLimit from "express-rate-limit";

const message = {
  status: "fail",
  code: "GUEST_APPOINTMENT_RATE_LIMITED",
  message: "Demasiadas solicitudes. Intenta nuevamente más tarde.",
};

const makeLimiter = (limit) => rateLimit({
  windowMs: 15 * 60 * 1000,
  limit,
  message,
  standardHeaders: true,
  legacyHeaders: false,
});

// Independent budgets prevent the issuance endpoint from becoming an email
// amplification primitive while still allowing a reasonable verification/read flow.
export const guestReadChallengeLimiter = makeLimiter(5);
export const guestReadExchangeLimiter = makeLimiter(10);
export const guestReadConsumeLimiter = makeLimiter(20);
