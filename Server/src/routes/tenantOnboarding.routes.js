import { Router } from "express";
import {
  bindOnboardingAccount,
  issueOnboarding,
} from "../controllers/tenantOnboarding.controller.js";
import { isAuthenticated } from "../middleware/auth.middleware.js";
import { scopeBusiness } from "../middleware/business.middleware.js";
import { isAdmin } from "../middleware/role.middleware.js";
import {
  tenantOnboardingBindLimiter,
  tenantOnboardingIssueLimiter,
} from "../middleware/tenantOnboardingRateLimit.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import {
  bindTenantOnboardingSchema,
  issueTenantOnboardingSchema,
} from "../validations/tenantOnboarding.validation.js";

const router = Router();

// Administrative issuance is tenant-internal. Business and issuer are derived
// exclusively from the authenticated scope; the body can contribute only email.
router.post(
  "/",
  scopeBusiness,
  isAuthenticated,
  isAdmin,
  tenantOnboardingIssueLimiter,
  validate(issueTenantOnboardingSchema, { assignBody: "tenantOnboardingIssue" }),
  issueOnboarding,
);

// Claimant binding intentionally has no tenant session middleware. The exact
// PendingOnboarding + high-entropy single-use challenge is its channel-proof
// scope, and successful C2 produces only an account binding, never a session.
router.post(
  "/:onboardingId/bind",
  tenantOnboardingBindLimiter,
  validate(bindTenantOnboardingSchema, { assignBody: "tenantOnboardingBinding" }),
  bindOnboardingAccount,
);

export default router;
