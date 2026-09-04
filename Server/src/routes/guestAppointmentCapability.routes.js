import { Router } from "express";
import {
  consumeCancelCapability,
  consumeReadCapability,
  exchangeCancelChallenge,
  exchangeReadChallenge,
  requestCancelChallenge,
  requestReadChallenge,
} from "../controllers/guestAppointmentCapability.controller.js";
import { validate } from "../middleware/validate.middleware.js";
import { bindExplicitPublicBusinessOrigin } from "../middleware/publicWebBrowserBinding.middleware.js";
import {
  guestCancelChallengeLimiter,
  guestCancelConsumeLimiter,
  guestCancelExchangeLimiter,
  guestReadChallengeLimiter,
  guestReadConsumeLimiter,
  guestReadExchangeLimiter,
} from "../middleware/guestAppointmentCapabilityRateLimit.middleware.js";
import {
  guestAppointmentCancelChallengeSchema,
  guestAppointmentCancelConsumeSchema,
  guestAppointmentCancelExchangeSchema,
  guestAppointmentReadChallengeSchema,
  guestAppointmentReadConsumeSchema,
  guestAppointmentReadExchangeSchema,
} from "../validations/guestAppointmentCapability.validation.js";

const router = Router();

// Challenge issuance/exchange depends on current tenant publicWeb trust for
// browser callers. Already-issued capabilities keep their own bounded TTL.
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
  consumeReadCapability,
);

router.post(
  "/cancel/challenge",
  guestCancelChallengeLimiter,
  validate(guestAppointmentCancelChallengeSchema),
  bindExplicitPublicBusinessOrigin,
  requestCancelChallenge,
);
router.post(
  "/cancel/verify",
  guestCancelExchangeLimiter,
  validate(guestAppointmentCancelExchangeSchema),
  bindExplicitPublicBusinessOrigin,
  exchangeCancelChallenge,
);
// Mutation is POST-only and requires exact Business + Appointment + CANCEL bearer.
router.post(
  "/cancel",
  guestCancelConsumeLimiter,
  validate(guestAppointmentCancelConsumeSchema),
  consumeCancelCapability,
);

export default router;
