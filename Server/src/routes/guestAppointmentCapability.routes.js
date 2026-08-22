import { Router } from "express";
import { consumeReadCapability, exchangeReadChallenge, requestReadChallenge } from "../controllers/guestAppointmentCapability.controller.js";
import { validate } from "../middleware/validate.middleware.js";
import { bindExplicitPublicBusinessOrigin } from "../middleware/publicWebBrowserBinding.middleware.js";
import { guestReadChallengeLimiter, guestReadConsumeLimiter, guestReadExchangeLimiter } from "../middleware/guestAppointmentCapabilityRateLimit.middleware.js";
import { guestAppointmentReadChallengeSchema, guestAppointmentReadConsumeSchema, guestAppointmentReadExchangeSchema } from "../validations/guestAppointmentCapability.validation.js";

const router = Router();

// Challenge issuance/exchange still depends on current tenant publicWeb trust for
// browser callers. Requests without Origin preserve C2's generic headless path.
router.post(
  "/read/challenge",
  guestReadChallengeLimiter,
  validate(guestAppointmentReadChallengeSchema),
  bindExplicitPublicBusinessOrigin,
  requestReadChallenge,
);
router.post(
  "/read/verify",
  guestReadExchangeLimiter,
  validate(guestAppointmentReadExchangeSchema),
  bindExplicitPublicBusinessOrigin,
  exchangeReadChallenge,
);

// A successfully exchanged READ capability is already the exact-scope bearer
// authority (Business + Appointment + READ). Do not rebind its later consumption
// to current publicWeb freshness; revocation only makes old Delivery/challenge
// exchange stale and does not shorten an already-issued capability lifetime.
router.post(
  "/read",
  guestReadConsumeLimiter,
  validate(guestAppointmentReadConsumeSchema),
  consumeReadCapability,
);

export default router;
