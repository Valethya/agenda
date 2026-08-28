import TenantOnboardingChallenge, {
  TENANT_ONBOARDING_ACCOUNT_PROOF_MAX_ATTEMPTS,
} from "../db/models/tenantOnboardingChallenge.model.js";

export const createForPendingOnboarding = async (data, { session } = {}) => {
  const documents = await TenantOnboardingChallenge.create([data], { session });
  return documents[0];
};

export const confirmDelivered = async ({
  challengeId,
  pendingOnboardingId,
  businessId,
  now,
}) => TenantOnboardingChallenge.findOneAndUpdate(
  {
    _id: challengeId,
    pendingOnboarding: pendingOnboardingId,
    business: businessId,
    status: "pending",
    deliveredAt: null,
    expiresAt: { $gt: now },
    consumedAt: null,
    revokedAt: null,
    boundUser: null,
  },
  { $set: { deliveredAt: now } },
  { new: true },
);

export const findPendingForBinding = async ({
  pendingOnboardingId,
  businessId,
  now,
  session,
}) => TenantOnboardingChallenge.findOne({
  pendingOnboarding: pendingOnboardingId,
  business: businessId,
  status: "pending",
  deliveredAt: { $ne: null },
  expiresAt: { $gt: now },
})
  .select("+secretHash")
  .session(session || null);

/**
 * Reserves one exact-account proof attempt outside the binding transaction.
 * The atomic predicate prevents concurrent requests from exceeding the grant
 * budget, and the increment survives a later password/binding failure.
 */
export const reserveAccountProofAttempt = async ({
  challengeId,
  pendingOnboardingId,
  businessId,
  now,
}) => TenantOnboardingChallenge.findOneAndUpdate(
  {
    _id: challengeId,
    pendingOnboarding: pendingOnboardingId,
    business: businessId,
    status: "pending",
    deliveredAt: { $ne: null },
    expiresAt: { $gt: now },
    consumedAt: null,
    boundUser: null,
    accountProofAttempts: { $lt: TENANT_ONBOARDING_ACCOUNT_PROOF_MAX_ATTEMPTS },
  },
  { $inc: { accountProofAttempts: 1 } },
  { new: true },
);

export const consumeForBinding = async ({
  challengeId,
  pendingOnboardingId,
  businessId,
  boundUserId,
  now,
  session,
}) => TenantOnboardingChallenge.findOneAndUpdate(
  {
    _id: challengeId,
    pendingOnboarding: pendingOnboardingId,
    business: businessId,
    status: "pending",
    deliveredAt: { $ne: null },
    expiresAt: { $gt: now },
    consumedAt: null,
    boundUser: null,
  },
  {
    $set: {
      status: "consumed",
      consumedAt: now,
      boundUser: boundUserId,
    },
  },
  { new: true, session },
);

export const revokePending = async ({ challengeId, now, session }) => (
  TenantOnboardingChallenge.findOneAndUpdate(
    { _id: challengeId, status: "pending" },
    { $set: { status: "revoked", revokedAt: now } },
    { new: true, session },
  )
);

export const revokePendingForOnboarding = async ({
  pendingOnboardingId,
  businessId,
  now,
  session,
}) => TenantOnboardingChallenge.findOneAndUpdate(
  {
    pendingOnboarding: pendingOnboardingId,
    business: businessId,
    status: "pending",
  },
  { $set: { status: "revoked", revokedAt: now } },
  { new: true, session },
);
