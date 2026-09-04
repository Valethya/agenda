import crypto from "node:crypto";
import mongoose from "mongoose";
import * as appointmentRepository from "../repositories/appointment.repository.js";
import * as deliveryRepository from "../repositories/guestAppointmentVerificationDelivery.repository.js";
import * as capabilityRepository from "../repositories/guestAppointmentCapability.repository.js";
import * as jobRepository from "../repositories/guestAppointmentVerificationJob.repository.js";
import * as publicWebJobRepository from "../repositories/guestAppointmentPublicWeb.repository.js";
import { consumeExactVerificationForBusiness } from "./clientContactVerification.service.js";
import {
  acquirePublicWebSendFence,
  confirmPublicWebSendFence,
  releasePublicWebSendFence,
  resolveFreshPublicWebTrust,
} from "./publicWeb.service.js";
import {
  GUEST_APPOINTMENT_IMPLEMENTED_PURPOSE_TO_ACTION,
  GUEST_APPOINTMENT_PURPOSES,
} from "../security/guestAppointmentCapability.constants.js";
import { emitAvailabilityChange } from "../config/socket.js";
import { notifyAppointmentCancelled } from "./appointment.notifications.js";
import { ConflictError } from "../utils/appError.js";

const ID_RE = /^[0-9a-fA-F]{24}$/u;
const BEARER_RE = /^[A-Za-z0-9_-]{43}$/u;
const CAPABILITY_TTL_MS = 10 * 60 * 1000;

export const GUEST_APPOINTMENT_CAPABILITY_ERROR_CODES = Object.freeze({
  INVALID_INPUT: "GUEST_APPOINTMENT_CAPABILITY_INVALID_INPUT",
  INVALID_PROOF: "GUEST_APPOINTMENT_CAPABILITY_INVALID_PROOF",
  STATE_CONFLICT: "GUEST_APPOINTMENT_CANCEL_STATE_CONFLICT",
});

const fail = (message, code, ErrorType = Error) => {
  const error = new ErrorType(message);
  error.code = code;
  return error;
};
const invalidInput = () => fail("Solicitud guest no válida", GUEST_APPOINTMENT_CAPABILITY_ERROR_CODES.INVALID_INPUT, TypeError);
const invalidProof = () => fail("Acceso guest no válido", GUEST_APPOINTMENT_CAPABILITY_ERROR_CODES.INVALID_PROOF);
const stateConflict = () => fail(
  "La reserva ya no se encuentra en un estado cancelable",
  GUEST_APPOINTMENT_CAPABILITY_ERROR_CODES.STATE_CONFLICT,
  ConflictError,
);
const objectId = (value) => {
  if (value instanceof mongoose.Types.ObjectId) return value;
  if (typeof value === "string" && ID_RE.test(value)) return new mongoose.Types.ObjectId(value);
  throw invalidInput();
};
const bearer = (value) => {
  if (typeof value !== "string" || !BEARER_RE.test(value)) throw invalidProof();
  return value;
};
const id = (value) => (value?._id ?? value)?.toString?.() || "";
const coherent = (appointment, businessId) => Boolean(
  appointment && id(appointment.business) === id(businessId)
  && appointment.service && id(appointment.service.business) === id(businessId),
);
const scopeForPurpose = (purpose) => {
  const action = GUEST_APPOINTMENT_IMPLEMENTED_PURPOSE_TO_ACTION[purpose];
  if (!action) throw invalidProof();
  return { purpose, action };
};
const hashCapability = ({ businessId, appointmentId, action, secret }) => crypto
  .createHash("sha256")
  .update(businessId.toHexString(), "utf8").update("\0", "utf8")
  .update(appointmentId.toHexString(), "utf8").update("\0", "utf8")
  .update(action, "utf8").update("\0", "utf8")
  .update(secret, "utf8").digest("hex");

const ACCEPTED = Object.freeze({ accepted: true });

const requestChallenge = async ({ businessId, appointmentId, purpose }) => {
  const business = objectId(businessId);
  const appointment = objectId(appointmentId);
  const { action } = scopeForPurpose(purpose);
  try {
    await jobRepository.enqueueForScope({
      businessId: business,
      appointmentId: appointment,
      purpose,
      action,
      now: new Date(),
    });
  } catch {
    // External response intentionally stays uniform and non-enumerative.
  }
  return ACCEPTED;
};

export const requestGuestAppointmentReadChallenge = ({ businessId, appointmentId }) => requestChallenge({
  businessId,
  appointmentId,
  purpose: GUEST_APPOINTMENT_PURPOSES.READ,
});

export const requestGuestAppointmentCancelChallenge = ({ businessId, appointmentId }) => requestChallenge({
  businessId,
  appointmentId,
  purpose: GUEST_APPOINTMENT_PURPOSES.CANCEL,
});

const resolveDeliveryPublicWebTrust = async ({ delivered, business, appointment }) => {
  const trust = await resolveFreshPublicWebTrust({ businessId: business, now: new Date() });
  if (
    !trust
    || delivered.publicWebTrustGeneration !== trust.trustGeneration
    || delivered.trustedOrigin !== trust.origin
  ) return null;

  const jobMatches = await publicWebJobRepository.deliveredJobTrustMatches({
    jobId: delivered.job,
    jobGeneration: delivered.jobGeneration,
    businessId: business,
    appointmentId: appointment,
    publicWebTrustGeneration: delivered.publicWebTrustGeneration,
    trustedOrigin: delivered.trustedOrigin,
  });
  return jobMatches ? trust : null;
};

const exchangeChallenge = async ({ businessId, appointmentId, verificationId, challengeSecret, purpose }) => {
  const business = objectId(businessId);
  const appointment = objectId(appointmentId);
  const verification = objectId(verificationId);
  const challenge = bearer(challengeSecret);
  const { action } = scopeForPurpose(purpose);

  const delivered = await deliveryRepository.findDeliveredByScope({
    verificationId: verification,
    businessId: business,
    appointmentId: appointment,
    purpose,
    action,
  });
  if (!delivered) throw invalidProof();

  const trustedJob = await jobRepository.hasDeliveredProofState({
    jobId: delivered.job,
    generation: delivered.jobGeneration,
    businessId: business,
    appointmentId: appointment,
    purpose,
    action,
    verificationId: verification,
    deliveryId: delivered._id,
  });
  if (!trustedJob) throw invalidProof();

  if (!await resolveDeliveryPublicWebTrust({ delivered, business, appointment })) throw invalidProof();

  try {
    await consumeExactVerificationForBusiness({
      verificationId: verification,
      businessId: business,
      purpose,
      secret: challenge,
    });
  } catch {
    throw invalidProof();
  }

  const currentTrust = await resolveDeliveryPublicWebTrust({ delivered, business, appointment });
  if (!currentTrust) throw invalidProof();

  const fence = await acquirePublicWebSendFence({ businessId: business, trust: currentTrust, now: new Date() });
  if (!fence) throw invalidProof();

  const secret = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + CAPABILITY_TTL_MS);
  try {
    const stillAuthorized = await confirmPublicWebSendFence({ businessId: business, fence, now: new Date() });
    if (!stillAuthorized) throw invalidProof();

    const capability = await capabilityRepository.createActiveForScope({
      businessId: business,
      appointmentId: appointment,
      verificationId: verification,
      verificationPurpose: purpose,
      action,
      secretHash: hashCapability({ businessId: business, appointmentId: appointment, action, secret }),
      expiresAt,
    });
    return {
      capabilityId: capability._id,
      businessId: business,
      appointmentId: appointment,
      action,
      bearer: secret,
      expiresAt: capability.expiresAt,
    };
  } catch {
    throw invalidProof();
  } finally {
    try { await releasePublicWebSendFence({ businessId: business, fence }); } catch {}
  }
};

export const exchangeGuestAppointmentReadChallenge = (input) => exchangeChallenge({
  ...input,
  purpose: GUEST_APPOINTMENT_PURPOSES.READ,
});

export const exchangeGuestAppointmentCancelChallenge = (input) => exchangeChallenge({
  ...input,
  purpose: GUEST_APPOINTMENT_PURPOSES.CANCEL,
});

const readProjection = (appointment) => ({
  appointmentId: appointment._id,
  business: appointment.business ? { id: appointment.business._id, name: appointment.business.name, slug: appointment.business.slug } : null,
  service: appointment.service ? { id: appointment.service._id, name: appointment.service.name, duration: appointment.service.duration } : null,
  professional: appointment.worker ? { id: appointment.worker._id, firstName: appointment.worker.firstName, lastName: appointment.worker.lastName } : null,
  date: appointment.date,
  startTime: appointment.startTime,
  endTime: appointment.endTime,
  status: appointment.status,
  paymentStatus: appointment.paymentStatus,
});

const cancelProjection = (appointment) => ({
  appointmentId: appointment._id,
  businessId: appointment.business,
  status: appointment.status,
  date: appointment.date,
  startTime: appointment.startTime,
  endTime: appointment.endTime,
});

export const consumeGuestAppointmentReadCapability = async ({ businessId, appointmentId, bearer: rawBearer }) => {
  const business = objectId(businessId);
  const appointment = objectId(appointmentId);
  const secret = bearer(rawBearer);
  const action = GUEST_APPOINTMENT_IMPLEMENTED_PURPOSE_TO_ACTION[GUEST_APPOINTMENT_PURPOSES.READ];
  const consumed = await capabilityRepository.consumeForScope({
    businessId: business,
    appointmentId: appointment,
    action,
    secretHash: hashCapability({ businessId: business, appointmentId: appointment, action, secret }),
    now: new Date(),
  });
  if (!consumed) throw invalidProof();

  const detail = await appointmentRepository.findGuestReadableByIdAndBusiness(appointment, business);
  if (!coherent(detail, business)) throw invalidProof();
  return readProjection(detail);
};

export const consumeGuestAppointmentCancelCapability = async ({ businessId, appointmentId, bearer: rawBearer }) => {
  const business = objectId(businessId);
  const appointment = objectId(appointmentId);
  const secret = bearer(rawBearer);
  const action = GUEST_APPOINTMENT_IMPLEMENTED_PURPOSE_TO_ACTION[GUEST_APPOINTMENT_PURPOSES.CANCEL];
  const outcome = await capabilityRepository.consumeAndCancelForScope({
    businessId: business,
    appointmentId: appointment,
    action,
    secretHash: hashCapability({ businessId: business, appointmentId: appointment, action, secret }),
    now: new Date(),
  });

  if (outcome.kind === "invalid-capability") throw invalidProof();
  if (outcome.kind === "conflict") throw stateConflict();
  const cancelled = outcome.appointment;
  if (!cancelled || cancelled.status !== "cancelled") throw invalidProof();

  const dateStr = new Date(cancelled.date).toISOString().split("T")[0];
  emitAvailabilityChange(cancelled.worker.toString(), dateStr, business);
  notifyAppointmentCancelled(appointment, null);
  return cancelProjection(cancelled);
};
