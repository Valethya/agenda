import crypto from "node:crypto";
import mongoose from "mongoose";
import Membership from "../db/models/membership.model.js";
import User from "../db/models/user.model.js";
import {
  PENDING_ONBOARDING_CHANNEL,
  PENDING_ONBOARDING_PURPOSE,
  normalizePendingOnboardingEmail,
} from "../db/models/pendingOnboarding.model.js";
import * as pendingOnboardingRepository from "../repositories/pendingOnboarding.repository.js";
import * as challengeRepository from "../repositories/tenantOnboardingChallenge.repository.js";
import { sendTenantOnboardingChallengeEmail } from "./email/emailService.js";
import { createHash, isValidPassword } from "../utils/password.js";
import { AppError } from "../utils/appError.js";

const OBJECT_ID_HEX_PATTERN = /^[0-9a-fA-F]{24}$/u;
const CHALLENGE_SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const BCRYPT_HASH_PATTERN = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/u;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const CHALLENGE_SECRET_BYTES = 32;

export const TENANT_ONBOARDING_TTL_MS = 15 * 60 * 1000;

export const TENANT_ONBOARDING_ERROR_CODES = Object.freeze({
  INVALID_INPUT: "TENANT_ONBOARDING_INVALID_INPUT",
  ISSUE_FAILED: "TENANT_ONBOARDING_ISSUE_FAILED",
  DELIVERY_FAILED: "TENANT_ONBOARDING_DELIVERY_FAILED",
  BINDING_FAILED: "TENANT_ONBOARDING_BINDING_FAILED",
});

const fail = (message, statusCode, code) => new AppError(message, statusCode, code);
const invalidInput = () => fail(
  "Solicitud de onboarding no válida",
  400,
  TENANT_ONBOARDING_ERROR_CODES.INVALID_INPUT,
);
const issueFailed = () => fail(
  "No fue posible iniciar el onboarding",
  409,
  TENANT_ONBOARDING_ERROR_CODES.ISSUE_FAILED,
);
const deliveryFailed = () => fail(
  "No fue posible entregar el onboarding",
  503,
  TENANT_ONBOARDING_ERROR_CODES.DELIVERY_FAILED,
);
const bindingFailed = () => fail(
  "No fue posible completar el account binding",
  400,
  TENANT_ONBOARDING_ERROR_CODES.BINDING_FAILED,
);

const strictObjectId = (value) => {
  if (value instanceof mongoose.Types.ObjectId) return value;
  if (typeof value === "string" && OBJECT_ID_HEX_PATTERN.test(value)) {
    return new mongoose.Types.ObjectId(value);
  }
  throw invalidInput();
};

const canonicalEmail = (value) => {
  const normalized = normalizePendingOnboardingEmail(value);
  if (
    typeof normalized !== "string"
    || normalized.length === 0
    || normalized.length > 320
    || !EMAIL_PATTERN.test(normalized)
  ) throw invalidInput();
  return normalized;
};

const challengeSecret = (value) => {
  if (typeof value !== "string" || !CHALLENGE_SECRET_PATTERN.test(value)) {
    throw bindingFailed();
  }
  return value;
};

const deriveChallengeHash = ({ onboardingId, businessId, destination, secret }) => crypto
  .createHash("sha256")
  .update(onboardingId.toHexString(), "utf8")
  .update("\0", "utf8")
  .update(businessId.toHexString(), "utf8")
  .update("\0", "utf8")
  .update(PENDING_ONBOARDING_CHANNEL, "utf8")
  .update("\0", "utf8")
  .update(destination, "utf8")
  .update("\0", "utf8")
  .update(PENDING_ONBOARDING_PURPOSE, "utf8")
  .update("\0", "utf8")
  .update(secret, "utf8")
  .digest("hex");

const hashMatches = (actualHex, expectedHex) => {
  if (
    typeof actualHex !== "string"
    || typeof expectedHex !== "string"
    || actualHex.length !== 64
    || expectedHex.length !== 64
  ) return false;
  const actual = Buffer.from(actualHex, "hex");
  const expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
};

const safeIssueProjection = (pending) => ({
  accepted: true,
  onboardingId: pending._id,
  expiresAt: pending.expiresAt,
});

const revokeUndeliveredGrant = async ({ pending, challenge }) => {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const now = new Date();
      await challengeRepository.revokePending({
        challengeId: challenge._id,
        now,
        session,
      });
      await pendingOnboardingRepository.revokePendingForDeliveryFailure({
        onboardingId: pending._id,
        businessId: pending.business,
        now,
        session,
      });
    });
  } finally {
    await session.endSession();
  }
};

/**
 * Admin-only orchestration. The caller identity and Business come from the
 * authenticated tenant boundary; target-account existence is never consulted at
 * issuance, so the response cannot become a global User oracle.
 */
export const issueTenantOnboarding = async ({
  businessId,
  issuerUserId,
  email,
  deliver = sendTenantOnboardingChallengeEmail,
}) => {
  const business = strictObjectId(businessId);
  const issuer = strictObjectId(issuerUserId);
  const destination = canonicalEmail(email);
  const rawSecret = crypto.randomBytes(CHALLENGE_SECRET_BYTES).toString("base64url");
  const expiresAt = new Date(Date.now() + TENANT_ONBOARDING_TTL_MS);
  const session = await mongoose.startSession();
  let pending;
  let challenge;

  try {
    await session.withTransaction(async () => {
      pending = await pendingOnboardingRepository.createPendingForBusiness(
        business,
        issuer,
        { email: destination, expiresAt },
        { session },
      );

      const secretHash = deriveChallengeHash({
        onboardingId: pending._id,
        businessId: business,
        destination: pending.email,
        secret: rawSecret,
      });

      challenge = await challengeRepository.createForPendingOnboarding({
        pendingOnboarding: pending._id,
        business: pending.business,
        channel: pending.channel,
        destination: pending.email,
        purpose: pending.purpose,
        secretHash,
        status: "pending",
        expiresAt: pending.expiresAt,
      }, { session });
    });
  } catch (error) {
    if (error?.isOperational) throw error;
    throw issueFailed();
  } finally {
    await session.endSession();
  }

  let delivered = false;
  try {
    delivered = await deliver({
      destination: pending.email,
      businessId: pending.business,
      onboardingId: pending._id,
      challengeSecret: rawSecret,
      expiresAt: challenge.expiresAt,
    });
  } catch {
    delivered = false;
  }

  if (!delivered) {
    try {
      await revokeUndeliveredGrant({ pending, challenge });
    } catch {
      // The secret was not delivered. Even if cleanup itself fails, no secret is
      // exposed through the HTTP response or logs; startup/storage gates remain
      // the operational recovery boundary.
    }
    throw deliveryFailed();
  }

  return safeIssueProjection(pending);
};

const requireExistingAccountInput = (account) => {
  if (
    account?.mode !== "existing"
    || typeof account.password !== "string"
    || account.password.length === 0
  ) throw bindingFailed();
  return account.password;
};

const requireNewAccountInput = (account) => {
  if (
    account?.mode !== "new"
    || typeof account.firstName !== "string"
    || account.firstName.trim().length < 2
    || typeof account.lastName !== "string"
    || account.lastName.trim().length < 2
    || typeof account.password !== "string"
    || account.password.length < 6
  ) throw bindingFailed();

  return {
    firstName: account.firstName.trim(),
    lastName: account.lastName.trim(),
    password: account.password,
  };
};

const assertChallengeMatchesGrant = ({ pending, challenge, rawSecret }) => {
  if (
    !challenge
    || challenge.pendingOnboarding.toString() !== pending._id.toString()
    || challenge.business.toString() !== pending.business.toString()
    || challenge.channel !== pending.channel
    || challenge.destination !== pending.email
    || challenge.purpose !== pending.purpose
    || challenge.expiresAt.getTime() > pending.expiresAt.getTime()
  ) throw bindingFailed();

  const expectedHash = deriveChallengeHash({
    onboardingId: pending._id,
    businessId: pending.business,
    destination: pending.email,
    secret: rawSecret,
  });
  if (!hashMatches(challenge.secretHash, expectedHash)) throw bindingFailed();
};

const resolveControlledUser = async ({ pending, account, session }) => {
  const candidate = await User.findOne({ email: pending.email })
    .select("+password")
    .session(session);

  if (candidate) {
    if (candidate.isActive !== true) throw bindingFailed();

    const existingMembership = await Membership.exists({
      user: candidate._id,
      business: pending.business,
    }).session(session);
    if (existingMembership) throw bindingFailed();

    const password = requireExistingAccountInput(account);
    if (!BCRYPT_HASH_PATTERN.test(candidate.password || "")) throw bindingFailed();

    let valid = false;
    try {
      valid = await isValidPassword(password, candidate.password);
    } catch {
      valid = false;
    }
    if (!valid) throw bindingFailed();
    return candidate;
  }

  const input = requireNewAccountInput(account);
  const passwordHash = await createHash(input.password);

  // No fallback is permitted here. If a concurrent actor creates the email after
  // the read above, the physical unique User.email index aborts this transaction.
  // C2 must never catch DuplicateKey and bind to the newly appeared account.
  const created = await User.create([{
    firstName: input.firstName,
    lastName: input.lastName,
    email: [pending.email],
    password: passwordHash,
    role: "user",
    isActive: true,
  }], { session });

  return created[0];
};

/**
 * Claimant boundary. Channel proof + exact-account proof/new-account creation +
 * challenge consume + persisted binding commit atomically. PendingOnboarding
 * remains status=pending; Membership creation belongs exclusively to C3.
 */
export const bindTenantOnboardingAccount = async ({
  onboardingId,
  secret,
  account,
}) => {
  const onboarding = strictObjectId(onboardingId);
  const rawSecret = challengeSecret(secret);
  const session = await mongoose.startSession();
  let bound = false;

  try {
    await session.withTransaction(async () => {
      const now = new Date();
      const pending = await pendingOnboardingRepository.findContinuableForBinding({
        onboardingId: onboarding,
        now,
        session,
      });
      if (!pending) throw bindingFailed();

      const challenge = await challengeRepository.findPendingForBinding({
        pendingOnboardingId: pending._id,
        businessId: pending.business,
        now,
        session,
      });
      assertChallengeMatchesGrant({ pending, challenge, rawSecret });

      const controlledUser = await resolveControlledUser({ pending, account, session });

      const persistedBinding = await pendingOnboardingRepository.bindAccountIfUnbound({
        onboardingId: pending._id,
        businessId: pending.business,
        userId: controlledUser._id,
        challengeId: challenge._id,
        now,
        session,
      });
      if (!persistedBinding) throw bindingFailed();

      const consumedChallenge = await challengeRepository.consumeForBinding({
        challengeId: challenge._id,
        pendingOnboardingId: pending._id,
        businessId: pending.business,
        boundUserId: controlledUser._id,
        now,
        session,
      });
      if (!consumedChallenge) throw bindingFailed();

      bound = true;
    });
  } catch (error) {
    if (error?.code === TENANT_ONBOARDING_ERROR_CODES.BINDING_FAILED) throw error;
    throw bindingFailed();
  } finally {
    await session.endSession();
  }

  if (!bound) throw bindingFailed();
  return { bound: true, onboardingId: onboarding };
};
