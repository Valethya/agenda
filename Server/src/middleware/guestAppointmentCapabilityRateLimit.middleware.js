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

// Independent budgets prevent challenge issuance from becoming an email
// amplification primitive and keep READ/CANCEL mutation budgets separate.
export const guestReadChallengeLimiter = makeLimiter(5);
export const guestReadExchangeLimiter = makeLimiter(10);
export const guestReadConsumeLimiter = makeLimiter(20);

export const guestCancelChallengeLimiter = makeLimiter(5);
export const guestCancelExchangeLimiter = makeLimiter(10);
export const guestCancelConsumeLimiter = makeLimiter(10);
