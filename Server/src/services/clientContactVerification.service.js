import crypto from "node:crypto";
import mongoose from "mongoose";
import {
  CLIENT_CONTACT_VERIFICATION_CHANNELS,
  CLIENT_CONTACT_VERIFICATION_PURPOSES,
} from "../db/models/clientContactVerification.model.js";
import * as verificationRepository from "../repositories/clientContactVerification.repository.js";

const OBJECT_ID_HEX_PATTERN = /^[0-9a-fA-F]{24}$/u;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const SECRET_BYTES = 32;
const DEFAULT_TTL_MS = 15 * 60 * 1000;
const MIN_TTL_MS = 1_000;
const MAX_TTL_MS = 60 * 60 * 1000;

export const CLIENT_CONTACT_VERIFICATION_ERROR_CODES = Object.freeze({
  INVALID_INPUT: "CLIENT_CONTACT_VERIFICATION_INVALID_INPUT",
  INVALID_PROOF: "CLIENT_CONTACT_VERIFICATION_INVALID_PROOF",
});

const buildError = (message, code, ErrorType = Error) => {
  const error = new ErrorType(message);
  error.code = code;
  return error;
};

const invalidInput = (message) => (
  buildError(
    message,
    CLIENT_CONTACT_VERIFICATION_ERROR_CODES.INVALID_INPUT,
    TypeError,
  )
);

const invalidProof = () => (
  buildError(
    "Verification no válida",
    CLIENT_CONTACT_VERIFICATION_ERROR_CODES.INVALID_PROOF,
  )
);

const requireStrictObjectId = (value, fieldName) => {
  if (value instanceof mongoose.Types.ObjectId) return value;

  if (typeof value === "string" && OBJECT_ID_HEX_PATTERN.test(value)) {
    return new mongoose.Types.ObjectId(value);
  }

  throw invalidInput(`${fieldName} inválido`);
};

const requirePurpose = (purpose) => {
  if (
    typeof purpose !== "string"
    || !CLIENT_CONTACT_VERIFICATION_PURPOSES.includes(purpose)
  ) {
    throw invalidInput("Purpose no permitido");
  }
  return purpose;
};

const requireChannel = (channel) => {
  if (
    typeof channel !== "string"
    || !CLIENT_CONTACT_VERIFICATION_CHANNELS.includes(channel)
  ) {
    throw invalidInput("Canal no permitido");
  }
  return channel;
};

const normalizeEmailDestination = (destination) => {
  if (typeof destination !== "string") {
    throw invalidInput("Contacto no válido");
  }

  const trimmed = destination.trim();

  if (
    trimmed.length === 0
    || trimmed.length > 320
    || !EMAIL_PATTERN.test(trimmed)
  ) {
    throw invalidInput("Contacto no válido");
  }

  const separatorIndex = trimmed.lastIndexOf("@");
  const localPart = trimmed.slice(0, separatorIndex);
  const domainPart = trimmed.slice(separatorIndex + 1).toLowerCase();

  return `${localPart}@${domainPart}`;
};

const requireTtlMs = (ttlMs) => {
  if (
    typeof ttlMs !== "number"
    || !Number.isFinite(ttlMs)
    || !Number.isInteger(ttlMs)
    || ttlMs < MIN_TTL_MS
    || ttlMs > MAX_TTL_MS
  ) {
    throw invalidInput("Expiración no válida");
  }
  return ttlMs;
};

const requireBearerSecret = (secret) => {
  if (typeof secret !== "string" || !SECRET_PATTERN.test(secret)) {
    throw invalidProof();
  }
  return secret;
};

const deriveSecretHash = ({ businessId, purpose, secret }) => (
  crypto
    .createHash("sha256")
    .update(businessId.toHexString(), "utf8")
    .update("\0", "utf8")
    .update(purpose, "utf8")
    .update("\0", "utf8")
    .update(secret, "utf8")
    .digest("hex")
);

const safeVerificationProjection = (verification) => ({
  verificationId: verification._id,
  businessId: verification.business,
  channel: verification.channel,
  destination: verification.destination,
  purpose: verification.purpose,
  status: verification.status,
  expiresAt: verification.expiresAt,
  consumedAt: verification.consumedAt,
  revokedAt: verification.revokedAt,
});

/**
 * ISSUE crea únicamente un challenge pendiente.
 *
 * El `secret` raw retornado es material exclusivo para una futura trusted
 * delivery/orchestration layer. Un controller HTTP de emisión no debe devolverlo
 * directamente al claimant. Issue por sí mismo NO demuestra control del canal.
 */
export const issueVerificationForBusiness = async ({
  businessId,
  channel = "email",
  destination,
  purpose,
  ttlMs = DEFAULT_TTL_MS,
}) => {
  const scopedBusinessId = requireStrictObjectId(businessId, "businessId");
  const scopedChannel = requireChannel(channel);
  const scopedPurpose = requirePurpose(purpose);
  const scopedTtlMs = requireTtlMs(ttlMs);

  const normalizedDestination = normalizeEmailDestination(destination);
  const secret = crypto.randomBytes(SECRET_BYTES).toString("base64url");
  const secretHash = deriveSecretHash({
    businessId: scopedBusinessId,
    purpose: scopedPurpose,
    secret,
  });
  const expiresAt = new Date(Date.now() + scopedTtlMs);

  const verification = await verificationRepository.createForBusiness(
    scopedBusinessId,
    {
      channel: scopedChannel,
      destination: normalizedDestination,
      purpose: scopedPurpose,
      secretHash,
      expiresAt,
    },
  );

  return {
    ...safeVerificationProjection(verification),
    secret,
  };
};

/**
 * CONSUME demuestra posesión del bearer bajo Business + purpose.
 * Sólo puede interpretarse como control actual del canal si una trusted delivery
 * layer entregó ese bearer exclusivamente mediante el channel/destination persistido.
 */
export const consumeVerificationForBusiness = async ({
  businessId,
  purpose,
  secret,
}) => {
  const scopedBusinessId = requireStrictObjectId(businessId, "businessId");
  const scopedPurpose = requirePurpose(purpose);
  const scopedSecret = requireBearerSecret(secret);
  const now = new Date();

  const secretHash = deriveSecretHash({
    businessId: scopedBusinessId,
    purpose: scopedPurpose,
    secret: scopedSecret,
  });

  const verification = await verificationRepository.consumeForBusiness({
    businessId: scopedBusinessId,
    purpose: scopedPurpose,
    secretHash,
    now,
  });

  if (!verification) throw invalidProof();
  return safeVerificationProjection(verification);
};

/**
 * C2-specific consume primitive. The verification id is part of the atomic
 * predicate; a valid secret can never consume a different verification and then
 * fail after the fact.
 */
export const consumeExactVerificationForBusiness = async ({
  verificationId,
  businessId,
  purpose,
  secret,
}) => {
  const scopedVerificationId = requireStrictObjectId(verificationId, "verificationId");
  const scopedBusinessId = requireStrictObjectId(businessId, "businessId");
  const scopedPurpose = requirePurpose(purpose);
  const scopedSecret = requireBearerSecret(secret);
  const now = new Date();
  const secretHash = deriveSecretHash({
    businessId: scopedBusinessId,
    purpose: scopedPurpose,
    secret: scopedSecret,
  });

  const verification = await verificationRepository.consumeExactForBusiness({
    verificationId: scopedVerificationId,
    businessId: scopedBusinessId,
    purpose: scopedPurpose,
    secretHash,
    now,
  });

  if (!verification) throw invalidProof();
  return safeVerificationProjection(verification);
};

export const revokeVerificationForBusiness = async ({
  verificationId,
  businessId,
  purpose,
}) => {
  const scopedVerificationId = requireStrictObjectId(verificationId, "verificationId");
  const scopedBusinessId = requireStrictObjectId(businessId, "businessId");
  const scopedPurpose = requirePurpose(purpose);
  const now = new Date();

  const verification = await verificationRepository.revokeForBusiness({
    verificationId: scopedVerificationId,
    businessId: scopedBusinessId,
    purpose: scopedPurpose,
    now,
  });

  if (!verification) throw invalidProof();
  return safeVerificationProjection(verification);
};
