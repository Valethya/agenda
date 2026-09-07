import { Router } from "express";
import {
  consumeCancelCapability,
  consumeReadCapability,
  consumeRescheduleCapability,
  exchangeCancelChallenge,
  exchangeReadChallenge,
  exchangeRescheduleChallenge,
  requestCancelChallenge,
  requestReadChallenge,
  requestRescheduleChallenge,
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
  guestRescheduleChallengeLimiter,
  guestRescheduleConsumeLimiter,
  guestRescheduleExchangeLimiter,
} from "../middleware/guestAppointmentCapabilityRateLimit.middleware.js";
import {
  guestAppointmentCancelChallengeSchema,
  guestAppointmentCancelConsumeSchema,
  guestAppointmentCancelExchangeSchema,
  guestAppointmentReadChallengeSchema,
  guestAppointmentReadConsumeSchema,
  guestAppointmentReadExchangeSchema,
  guestAppointmentRescheduleChallengeSchema,
  guestAppointmentRescheduleConsumeSchema,
  guestAppointmentRescheduleExchangeSchema,
} from "../validations/guestAppointmentCapability.validation.js";

const router = Router();

// Challenge issuance/exchange depends on current tenant publicWeb trust for
// browser callers. Already-issued capabilities keep their own bounded TTL.
router.post("/read/challenge", guestReadChallengeLimiter, validate(guestAppointmentReadChallengeSchema), bindExplicitPublicBusinessOrigin, requestReadChallenge);
router.post("/read/verify", guestReadExchangeLimiter, validate(guestAppointmentReadExchangeSchema), bindExplicitPublicBusinessOrigin, exchangeReadChallenge);
router.post("/read", guestReadConsumeLimiter, validate(guestAppointmentReadConsumeSchema), consumeReadCapability);

router.post("/cancel/challenge", guestCancelChallengeLimiter, validate(guestAppointmentCancelChallengeSchema), bindExplicitPublicBusinessOrigin, requestCancelChallenge);
router.post("/cancel/verify", guestCancelExchangeLimiter, validate(guestAppointmentCancelExchangeSchema), bindExplicitPublicBusinessOrigin, exchangeCancelChallenge);
router.post("/cancel", guestCancelConsumeLimiter, validate(guestAppointmentCancelConsumeSchema), consumeCancelCapability);

router.post("/reschedule/challenge", guestRescheduleChallengeLimiter, validate(guestAppointmentRescheduleChallengeSchema), bindExplicitPublicBusinessOrigin, requestRescheduleChallenge);
router.post("/reschedule/verify", guestRescheduleExchangeLimiter, validate(guestAppointmentRescheduleExchangeSchema), bindExplicitPublicBusinessOrigin, exchangeRescheduleChallenge);
// Mutation is POST-only and accepts no client authority over service/worker/endTime/status.
router.post("/reschedule", guestRescheduleConsumeLimiter, validate(guestAppointmentRescheduleConsumeSchema), consumeRescheduleCapability);

export default router;
