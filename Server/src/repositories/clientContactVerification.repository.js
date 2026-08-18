import mongoose from "mongoose";
import Business from "../db/models/business.model.js";
import ClientContactVerification, {
  CLIENT_CONTACT_VERIFICATION_PURPOSES,
} from "../db/models/clientContactVerification.model.js";

const OBJECT_ID_HEX_PATTERN = /^[0-9a-fA-F]{24}$/u;
const SECRET_HASH_PATTERN = /^[0-9a-f]{64}$/u;

const requireStrictObjectId = (value, fieldName) => {
  if (value instanceof mongoose.Types.ObjectId) return value;

  if (typeof value === "string" && OBJECT_ID_HEX_PATTERN.test(value)) {
    return new mongoose.Types.ObjectId(value);
  }

  throw new TypeError(`${fieldName} debe ser un ObjectId o hexadecimal canónico de 24 caracteres`);
};

const requirePurpose = (purpose) => {
  if (
    typeof purpose !== "string"
    || !CLIENT_CONTACT_VERIFICATION_PURPOSES.includes(purpose)
  ) {
    throw new TypeError("purpose no permitido");
  }
  return purpose;
};

const requireSecretHash = (secretHash) => {
  if (typeof secretHash !== "string" || !SECRET_HASH_PATTERN.test(secretHash)) {
    throw new TypeError("secretHash inválido");
  }
  return secretHash;
};

const requireDate = (value, fieldName) => {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new TypeError(`${fieldName} debe ser una fecha válida`);
  }
  return value;
};

export const createForBusiness = async (businessId, data) => {
  const scopedBusinessId = requireStrictObjectId(businessId, "businessId");
  const businessExists = await Business.exists({ _id: scopedBusinessId });

  if (!businessExists) {
    throw new ReferenceError("Business no disponible");
  }

  return ClientContactVerification.create({
    business: scopedBusinessId,
    channel: data.channel,
    destination: data.destination,
    purpose: requirePurpose(data.purpose),
    secretHash: requireSecretHash(data.secretHash),
    status: "pending",
    expiresAt: requireDate(data.expiresAt, "expiresAt"),
    consumedAt: null,
    revokedAt: null,
  });
};

export const consumeForBusiness = async ({
  businessId,
  purpose,
  secretHash,
  now,
}) => {
  const scopedBusinessId = requireStrictObjectId(businessId, "businessId");
  const scopedPurpose = requirePurpose(purpose);
  const scopedHash = requireSecretHash(secretHash);
  const scopedNow = requireDate(now, "now");

  return ClientContactVerification.findOneAndUpdate(
    {
      business: scopedBusinessId,
      purpose: scopedPurpose,
      secretHash: scopedHash,
      status: "pending",
      expiresAt: { $gt: scopedNow },
    },
    {
      $set: {
        status: "consumed",
        consumedAt: scopedNow,
      },
    },
    {
      new: true,
      runValidators: true,
    },
  );
};

// C2 requires the caller-selected verification id to participate in the same
// atomic consume predicate as Business + purpose + secretHash + lifecycle.
export const consumeExactForBusiness = async ({
  verificationId,
  businessId,
  purpose,
  secretHash,
  now,
}) => {
  const scopedVerificationId = requireStrictObjectId(verificationId, "verificationId");
  const scopedBusinessId = requireStrictObjectId(businessId, "businessId");
  const scopedPurpose = requirePurpose(purpose);
  const scopedHash = requireSecretHash(secretHash);
  const scopedNow = requireDate(now, "now");

  return ClientContactVerification.findOneAndUpdate(
    {
      _id: scopedVerificationId,
      business: scopedBusinessId,
      purpose: scopedPurpose,
      secretHash: scopedHash,
      status: "pending",
      expiresAt: { $gt: scopedNow },
    },
    {
      $set: {
        status: "consumed",
        consumedAt: scopedNow,
      },
    },
    {
      new: true,
      runValidators: true,
    },
  );
};

export const revokeForBusiness = async ({
  verificationId,
  businessId,
  purpose,
  now,
}) => {
  const scopedVerificationId = requireStrictObjectId(verificationId, "verificationId");
  const scopedBusinessId = requireStrictObjectId(businessId, "businessId");
  const scopedPurpose = requirePurpose(purpose);
  const scopedNow = requireDate(now, "now");

  return ClientContactVerification.findOneAndUpdate(
    {
      _id: scopedVerificationId,
      business: scopedBusinessId,
      purpose: scopedPurpose,
      status: "pending",
      expiresAt: { $gt: scopedNow },
    },
    {
      $set: {
        status: "revoked",
        revokedAt: scopedNow,
      },
    },
    {
      new: true,
      runValidators: true,
    },
  );
};
