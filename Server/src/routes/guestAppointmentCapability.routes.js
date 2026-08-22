import { Router } from "express";
import { consumeReadCapability, exchangeReadChallenge, requestReadChallenge } from "../controllers/guestAppointmentCapability.controller.js";
import { validate } from "../middleware/validate.middleware.js";
import { bindExplicitPublicBusinessOrigin } from "../middleware/publicWebBrowserBinding.middleware.js";
import { guestReadChallengeLimiter, guestReadConsumeLimiter, guestReadExchangeLimiter } from "../middleware/guestAppointmentCapabilityRateLimit.middleware.js";
import { guestAppointmentReadChallengeSchema, guestAppointmentReadConsumeSchema, guestAppointmentReadExchangeSchema } from "../validations/guestAppointmentCapability.validation.js";

const router = Router();

// Validation establishes an explicit businessId. The browser-only binding then
// checks that exact Business without making Origin a tenant selector. Requests
// without Origin preserve C2's existing generic headless acceptance boundary.
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
router.post(
  "/read",
  guestReadConsumeLimiter,
  validate(guestAppointmentReadConsumeSchema),
  bindExplicitPublicBusinessOrigin,
  consumeReadCapability,
);

export default router;
