import {
  bindTenantOnboardingAccount,
  issueTenantOnboarding,
} from "../services/tenantOnboarding.service.js";
import { consumeTenantOnboarding } from "../services/tenantOnboardingConsume.service.js";

export const issueOnboarding = async (req, res, next) => {
  try {
    const result = await issueTenantOnboarding({
      businessId: req.businessId,
      issuerUserId: req.tenantAuthority.userId,
      email: req.tenantOnboardingIssue.email,
      // Tests inject a trusted in-memory delivery through app.locals. HTTP input
      // cannot set this value; production falls back to the sensitive mailer.
      deliver: req.app.locals.tenantOnboardingDeliver,
    });

    res.status(202).json({
      status: "success",
      payload: result,
    });
  } catch (error) {
    next(error);
  }
};

export const bindOnboardingAccount = async (req, res, next) => {
  try {
    const result = await bindTenantOnboardingAccount({
      onboardingId: req.params.onboardingId,
      secret: req.tenantOnboardingBinding.secret,
      account: req.tenantOnboardingBinding.account,
    });

    res.status(200).json({
      status: "success",
      payload: result,
    });
  } catch (error) {
    next(error);
  }
};

export const consumeOnboarding = async (req, res, next) => {
  try {
    const result = await consumeTenantOnboarding({
      onboardingId: req.params.onboardingId,
    });

    res.status(200).json({
      status: "success",
      payload: result,
    });
  } catch (error) {
    next(error);
  }
};
