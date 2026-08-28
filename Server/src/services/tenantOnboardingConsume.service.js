import mongoose from "mongoose";
import Business from "../db/models/business.model.js";
import Membership from "../db/models/membership.model.js";
import User from "../db/models/user.model.js";
import {
  PENDING_ONBOARDING_CHANNEL,
  PENDING_ONBOARDING_PURPOSE,
} from "../db/models/pendingOnboarding.model.js";
import * as pendingOnboardingRepository from "../repositories/pendingOnboarding.repository.js";
import * as challengeRepository from "../repositories/tenantOnboardingChallenge.repository.js";
import { AppError } from "../utils/appError.js";

const OBJECT_ID_HEX_PATTERN = /^[0-9a-fA-F]{24}$/u;
const CANONICAL_INITIAL_ROLE = "worker";
const CANONICAL_INITIAL_BOOKABILITY = false;

export const TENANT_ONBOARDING_CONSUME_ERROR_CODE = "TENANT_ONBOARDING_CONSUME_FAILED";

const consumeFailed = () => new AppError(
  "No fue posible completar el onboarding",
  400,
  TENANT_ONBOARDING_CONSUME_ERROR_CODE,
);

const strictObjectId = (value) => {
  if (value instanceof mongoose.Types.ObjectId) return value;
  if (typeof value === "string" && OBJECT_ID_HEX_PATTERN.test(value)) {
    return new mongoose.Types.ObjectId(value);
  }
  throw consumeFailed();
};

const sameId = (left, right) => Boolean(
  left
  && right
  && left.toString() === right.toString(),
);

const assertConsumedChallengeIntegrity = ({ pending, challenge }) => {
  const binding = pending.accountBinding;

  if (
    !challenge
    || !sameId(challenge._id, binding.challenge)
    || !sameId(challenge.pendingOnboarding, pending._id)
    || !sameId(challenge.business, pending.business)
    || challenge.channel !== PENDING_ONBOARDING_CHANNEL
    || challenge.channel !== pending.channel
    || challenge.destination !== pending.email
    || challenge.purpose !== PENDING_ONBOARDING_PURPOSE
    || challenge.purpose !== pending.purpose
    || challenge.status !== "consumed"
    || !(challenge.deliveredAt instanceof Date)
    || !(challenge.consumedAt instanceof Date)
    || challenge.revokedAt !== null
    || !sameId(challenge.boundUser, binding.user)
    || !(challenge.expiresAt instanceof Date)
    || challenge.expiresAt.getTime() !== pending.expiresAt.getTime()
  ) {
    throw consumeFailed();
  }
};

const fenceOperationalBusiness = async ({ businessId, session }) => Business.findOneAndUpdate(
  { _id: businessId, isActive: true },
  { $inc: { teamAdminRevision: 1 } },
  { new: true, session },
).select("_id isActive teamAdminRevision");

const assertCurrentIssuerAuthority = async ({ pending, session }) => {
  const issuerExists = await User.exists({
    _id: pending.issuer,
    isActive: true,
  }).session(session);

  if (!issuerExists) throw consumeFailed();

  const issuerAdminMembership = await Membership.exists({
    user: pending.issuer,
    business: pending.business,
    role: "admin",
    isActive: true,
  }).session(session);

  if (!issuerAdminMembership) throw consumeFailed();
};

/**
 * Claimant-facing C3 transition.
 *
 * The onboarding id only selects the already-bound grant. User identity comes
 * exclusively from PendingOnboarding.accountBinding.user. No email lookup,
 * session identity, bearer or body authority participates in this transition.
 */
export const consumeTenantOnboarding = async ({ onboardingId }) => {
  const onboarding = strictObjectId(onboardingId);
  const session = await mongoose.startSession();
  let membership = null;

  try {
    await session.withTransaction(async () => {
      const startedAt = new Date();

      // A write (without committing a new lifecycle state) is deliberately the
      // first grant operation. It serializes concurrent C3 consumes on this
      // PendingOnboarding while remaining fully rollback-safe inside Mongo.
      const pending = await pendingOnboardingRepository.reserveBoundForMembershipConsume({
        onboardingId: onboarding,
        now: startedAt,
        session,
      });
      if (!pending) throw consumeFailed();

      const binding = pending.accountBinding;
      if (
        pending.channel !== PENDING_ONBOARDING_CHANNEL
        || pending.purpose !== PENDING_ONBOARDING_PURPOSE
        || pending.role !== CANONICAL_INITIAL_ROLE
        || pending.isBookable !== CANONICAL_INITIAL_BOOKABILITY
        || !binding?.user
        || !binding?.challenge
        || !(binding.boundAt instanceof Date)
      ) {
        throw consumeFailed();
      }

      // Team/B mutations write this same Business fencing document. Therefore a
      // concurrent issuer de-authorization cannot be hidden by snapshot isolation:
      // one transaction wins and the other retries against current persistence.
      const business = await fenceOperationalBusiness({
        businessId: pending.business,
        session,
      });
      if (!business) throw consumeFailed();

      const exactBoundUser = await User.exists({
        _id: binding.user,
        isActive: true,
      }).session(session);
      if (!exactBoundUser) throw consumeFailed();

      await assertCurrentIssuerAuthority({ pending, session });

      const challenge = await challengeRepository.findConsumedForMembership({
        challengeId: binding.challenge,
        pendingOnboardingId: pending._id,
        businessId: pending.business,
        session,
      });
      assertConsumedChallengeIntegrity({ pending, challenge });

      // Active and inactive Memberships both block C3. Reactivation and privilege
      // mutation belong exclusively to normal Team administration.
      const existingMembership = await Membership.exists({
        user: binding.user,
        business: pending.business,
      }).session(session);
      if (existingMembership) throw consumeFailed();

      const created = await Membership.create([{
        user: binding.user,
        business: pending.business,
        role: CANONICAL_INITIAL_ROLE,
        isActive: true,
        isBookable: CANONICAL_INITIAL_BOOKABILITY,
      }], { session });
      membership = created[0];

      // Recheck logical expiry at the terminal write. Any failure here aborts the
      // transaction and rolls the Membership creation back as well.
      const terminalized = await pendingOnboardingRepository.consumeReservedForMembership({
        onboardingId: pending._id,
        businessId: pending.business,
        userId: binding.user,
        challengeId: binding.challenge,
        now: new Date(),
        session,
      });
      if (!terminalized) throw consumeFailed();
    });
  } catch (error) {
    membership = null;
    if (error?.code === TENANT_ONBOARDING_CONSUME_ERROR_CODE) throw error;
    throw consumeFailed();
  } finally {
    await session.endSession();
  }

  if (!membership) throw consumeFailed();

  return {
    completed: true,
    onboardingId: onboarding,
    membershipId: membership._id,
  };
};
