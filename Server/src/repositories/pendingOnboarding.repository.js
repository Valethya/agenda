import mongoose from "mongoose";
import Business from "../db/models/business.model.js";
import Membership from "../db/models/membership.model.js";
import PendingOnboarding, {
  PENDING_ONBOARDING_CHANNEL,
  PENDING_ONBOARDING_PURPOSE,
} from "../db/models/pendingOnboarding.model.js";
import User from "../db/models/user.model.js";

const OBJECT_ID_HEX_PATTERN = /^[0-9a-fA-F]{24}$/u;
const CANONICAL_INITIAL_ROLE = "worker";
const CANONICAL_INITIAL_BOOKABILITY = false;

const requireStrictObjectId = (value, fieldName) => {
  if (value instanceof mongoose.Types.ObjectId) return value;

  if (typeof value === "string" && OBJECT_ID_HEX_PATTERN.test(value)) {
    return new mongoose.Types.ObjectId(value);
  }

  throw new TypeError(`${fieldName} debe ser un ObjectId o hexadecimal canónico de 24 caracteres`);
};

const requireFutureDate = (value) => {
  if (
    !(value instanceof Date)
    || Number.isNaN(value.getTime())
    || value.getTime() <= Date.now()
  ) {
    throw new TypeError("expiresAt debe ser una fecha futura válida");
  }

  return value;
};

const queryWithSession = (query, session) => (session ? query.session(session) : query);

/**
 * Persiste exclusivamente intención administrativa pendiente.
 *
 * `businessId` e `issuerUserId` son scope server-side; los campos homónimos o
 * policy fields presentes en `data` se ignoran. El issuer se valida por identidad
 * y autoridad tenant vigentes al emitir, pero esa autorización NO queda copiada
 * como autoridad durable: C3 deberá revalidarla al consumir.
 */
export const createPendingForBusiness = async (
  businessId,
  issuerUserId,
  data = {},
  { session } = {},
) => {
  const scopedBusinessId = requireStrictObjectId(businessId, "businessId");
  const scopedIssuerUserId = requireStrictObjectId(issuerUserId, "issuerUserId");
  const expiresAt = requireFutureDate(data.expiresAt);

  // MongoDB transactions do not support parallel operations on one session.
  // Keep these authority reads deliberately sequential when C2 emits atomically.
  const businessExists = await queryWithSession(
    Business.exists({ _id: scopedBusinessId, isActive: true }),
    session,
  );
  const issuerExists = await queryWithSession(
    User.exists({ _id: scopedIssuerUserId, isActive: true }),
    session,
  );
  const issuerAdminMembership = await queryWithSession(Membership.exists({
    user: scopedIssuerUserId,
    business: scopedBusinessId,
    role: "admin",
    isActive: true,
  }), session);

  if (!businessExists) {
    throw new ReferenceError("businessId no corresponde a un Business activo existente");
  }
  if (!issuerExists || !issuerAdminMembership) {
    throw new ReferenceError("issuerUserId no corresponde a un admin tenant activo del Business");
  }

  const documents = await PendingOnboarding.create([{
    business: scopedBusinessId,
    issuer: scopedIssuerUserId,
    channel: PENDING_ONBOARDING_CHANNEL,
    email: data.email,
    purpose: PENDING_ONBOARDING_PURPOSE,
    role: CANONICAL_INITIAL_ROLE,
    isBookable: CANONICAL_INITIAL_BOOKABILITY,
    expiresAt,
    status: "pending",
    accountBinding: null,
  }], session ? { session } : {});

  return documents[0];
};

/**
 * Expiry is logical, while the C1 uniqueness barrier is status-based. Reissue
 * therefore terminalizes only the exact expired Business+email pending grant.
 * accountBinding/history is intentionally preserved by changing status only.
 */
export const revokeExpiredPendingForBusinessEmail = async ({
  businessId,
  email,
  now,
  session,
}) => PendingOnboarding.findOneAndUpdate(
  {
    business: requireStrictObjectId(businessId, "businessId"),
    email,
    status: "pending",
    expiresAt: { $lte: now },
  },
  { $set: { status: "revoked" } },
  { new: true, session },
);

export const findContinuableForBinding = async ({ onboardingId, now, session }) => (
  queryWithSession(PendingOnboarding.findOne({
    _id: requireStrictObjectId(onboardingId, "onboardingId"),
    status: "pending",
    expiresAt: { $gt: now },
    channel: PENDING_ONBOARDING_CHANNEL,
    purpose: PENDING_ONBOARDING_PURPOSE,
    role: CANONICAL_INITIAL_ROLE,
    isBookable: CANONICAL_INITIAL_BOOKABILITY,
    accountBinding: null,
  }), session)
);

export const bindAccountIfUnbound = async ({
  onboardingId,
  businessId,
  userId,
  challengeId,
  now,
  session,
}) => PendingOnboarding.findOneAndUpdate(
  {
    _id: requireStrictObjectId(onboardingId, "onboardingId"),
    business: requireStrictObjectId(businessId, "businessId"),
    status: "pending",
    expiresAt: { $gt: now },
    channel: PENDING_ONBOARDING_CHANNEL,
    purpose: PENDING_ONBOARDING_PURPOSE,
    role: CANONICAL_INITIAL_ROLE,
    isBookable: CANONICAL_INITIAL_BOOKABILITY,
    accountBinding: null,
  },
  {
    $set: {
      accountBinding: {
        user: requireStrictObjectId(userId, "userId"),
        challenge: requireStrictObjectId(challengeId, "challengeId"),
        boundAt: now,
      },
    },
  },
  { new: true, session },
);

export const revokePendingForDeliveryFailure = async ({
  onboardingId,
  businessId,
  now,
  session,
}) => PendingOnboarding.findOneAndUpdate(
  {
    _id: requireStrictObjectId(onboardingId, "onboardingId"),
    business: requireStrictObjectId(businessId, "businessId"),
    status: "pending",
    accountBinding: null,
  },
  { $set: { status: "revoked" } },
  { new: true, session },
);
