import TenantOnboardingChallenge from "../db/models/tenantOnboardingChallenge.model.js";

export const createForPendingOnboarding = async (data, { session } = {}) => {
  const documents = await TenantOnboardingChallenge.create([data], { session });
  return documents[0];
};

export const findPendingForBinding = async ({
  pendingOnboardingId,
  businessId,
  now,
  session,
}) => TenantOnboardingChallenge.findOne({
  pendingOnboarding: pendingOnboardingId,
  business: businessId,
  status: "pending",
  expiresAt: { $gt: now },
})
  .select("+secretHash")
  .session(session || null);

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
