import { Router } from "express";
import { consumeReadCapability, exchangeReadChallenge, requestReadChallenge } from "../controllers/guestAppointmentCapability.controller.js";
import { validate } from "../middleware/validate.middleware.js";
import { guestReadChallengeLimiter, guestReadConsumeLimiter, guestReadExchangeLimiter } from "../middleware/guestAppointmentCapabilityRateLimit.middleware.js";
import { guestAppointmentReadChallengeSchema, guestAppointmentReadConsumeSchema, guestAppointmentReadExchangeSchema } from "../validations/guestAppointmentCapability.validation.js";

const router = Router();

router.post("/read/challenge", guestReadChallengeLimiter, validate(guestAppointmentReadChallengeSchema), requestReadChallenge);
router.post("/read/verify", guestReadExchangeLimiter, validate(guestAppointmentReadExchangeSchema), exchangeReadChallenge);
router.post("/read", guestReadConsumeLimiter, validate(guestAppointmentReadConsumeSchema), consumeReadCapability);

export default router;
