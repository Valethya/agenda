import crypto from "node:crypto";
import mongoose from "mongoose";
import logger from "../config/logger.js";
import * as appointmentRepository from "../repositories/appointment.repository.js";
import * as deliveryRepository from "../repositories/guestAppointmentVerificationDelivery.repository.js";
import * as capabilityRepository from "../repositories/guestAppointmentCapability.repository.js";
import { consumeVerificationForBusiness, issueVerificationForBusiness, revokeVerificationForBusiness } from "./clientContactVerification.service.js";
import { sendGuestAppointmentVerificationEmail } from "./email/emailService.js";
import { buildGuestAppointmentVerificationUrl } from "../security/guestAppointmentAccessUrl.js";
import { GUEST_APPOINTMENT_IMPLEMENTED_PURPOSE_TO_ACTION, GUEST_APPOINTMENT_PURPOSES } from "../security/guestAppointmentCapability.constants.js";

const ID_RE = /^[0-9a-fA-F]{24}$/u;
const BEARER_RE = /^[A-Za-z0-9_-]{43}$/u;
const PURPOSE = GUEST_APPOINTMENT_PURPOSES.READ;
const ACTION = GUEST_APPOINTMENT_IMPLEMENTED_PURPOSE_TO_ACTION[PURPOSE];
const CAPABILITY_TTL_MS = 10 * 60 * 1000;

export const GUEST_APPOINTMENT_CAPABILITY_ERROR_CODES = Object.freeze({
  INVALID_INPUT: "GUEST_APPOINTMENT_CAPABILITY_INVALID_INPUT",
  INVALID_PROOF: "GUEST_APPOINTMENT_CAPABILITY_INVALID_PROOF",
});

const fail = (message, code, ErrorType = Error) => {
  const error = new ErrorType(message);
  error.code = code;
  return error;
};
const invalidInput = () => fail("Solicitud guest no válida", GUEST_APPOINTMENT_CAPABILITY_ERROR_CODES.INVALID_INPUT, TypeError);
const invalidProof = () => fail("Acceso guest no válido", GUEST_APPOINTMENT_CAPABILITY_ERROR_CODES.INVALID_PROOF);
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
const operationalEmail = (appointment) => {
  const emails = Array.isArray(appointment?.client?.email)
    ? appointment.client.email.filter((value) => typeof value === "string" && value.trim())
    : [];
  // Legacy Users can aggregate emails from multiple bookings. Without an
  // Appointment contact snapshot, multiple candidates are ambiguous.
  return emails.length === 1 ? emails[0] : null;
};
const hashCapability = ({ businessId, appointmentId, secret }) => crypto
  .createHash("sha256")
  .update(businessId.toHexString(), "utf8").update("\0", "utf8")
  .update(appointmentId.toHexString(), "utf8").update("\0", "utf8")
  .update(ACTION, "utf8").update("\0", "utf8")
  .update(secret, "utf8").digest("hex");

const ACCEPTED = Object.freeze({ accepted: true });

export const requestGuestAppointmentReadChallenge = async ({
  businessId,
  appointmentId,
  deliverVerification = sendGuestAppointmentVerificationEmail,
}) => {
  const business = objectId(businessId);
  const appointmentIdScoped = objectId(appointmentId);
  let appointment;
  try {
    appointment = await appointmentRepository.findByIdAndBusiness(appointmentIdScoped, business);
  } catch {
    return ACCEPTED;
  }
  const destination = coherent(appointment, business) ? operationalEmail(appointment) : null;
  if (!destination) return ACCEPTED;

  let issued;
  let delivery;
  try {
    issued = await issueVerificationForBusiness({ businessId: business, channel: "email", destination, purpose: PURPOSE });
    delivery = await deliveryRepository.createPending({
      verificationId: issued.verificationId,
      businessId: business,
      appointmentId: appointmentIdScoped,
      purpose: PURPOSE,
      action: ACTION,
    });
    const accessUrl = buildGuestAppointmentVerificationUrl({
      businessId: business,
      appointmentId: appointmentIdScoped,
      verificationId: issued.verificationId,
      purpose: PURPOSE,
      challengeSecret: issued.secret,
    });
    const delivered = await deliverVerification({ destination: issued.destination, businessId: business, accessUrl });
    if (!delivered) throw new Error("DELIVERY_FAILED");
    const marked = await deliveryRepository.markDelivered({
      deliveryId: delivery._id,
      verificationId: issued.verificationId,
      businessId: business,
      appointmentId: appointmentIdScoped,
      purpose: PURPOSE,
      action: ACTION,
      now: new Date(),
    });
    if (!marked) throw new Error("DELIVERY_STATE_FAILED");
  } catch {
    logger.warn("Guest appointment verification delivery was not completed.");
    if (delivery && issued) {
      try {
        await deliveryRepository.markFailed({
          deliveryId: delivery._id,
          verificationId: issued.verificationId,
          businessId: business,
          appointmentId: appointmentIdScoped,
          purpose: PURPOSE,
          action: ACTION,
          now: new Date(),
        });
      } catch {}
    }
    if (issued) {
      try {
        await revokeVerificationForBusiness({ verificationId: issued.verificationId, businessId: business, purpose: PURPOSE });
      } catch {}
    }
  }
  return ACCEPTED;
};

export const exchangeGuestAppointmentReadChallenge = async ({
  businessId,
  appointmentId,
  verificationId,
  challengeSecret,
}) => {
  const business = objectId(businessId);
  const appointment = objectId(appointmentId);
  const verification = objectId(verificationId);
  const challenge = bearer(challengeSecret);

  const delivered = await deliveryRepository.findDeliveredByScope({
    verificationId: verification,
    businessId: business,
    appointmentId: appointment,
    purpose: PURPOSE,
    action: ACTION,
  });
  if (!delivered) throw invalidProof();

  let consumed;
  try {
    consumed = await consumeVerificationForBusiness({ businessId: business, purpose: PURPOSE, secret: challenge });
  } catch {
    throw invalidProof();
  }
  if (id(consumed.verificationId) !== id(verification)) throw invalidProof();

  const secret = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + CAPABILITY_TTL_MS);
  try {
    const capability = await capabilityRepository.createActiveForScope({
      businessId: business,
      appointmentId: appointment,
      verificationId: verification,
      verificationPurpose: PURPOSE,
      action: ACTION,
      secretHash: hashCapability({ businessId: business, appointmentId: appointment, secret }),
      expiresAt,
    });
    return {
      capabilityId: capability._id,
      businessId: business,
      appointmentId: appointment,
      action: ACTION,
      bearer: secret,
      expiresAt: capability.expiresAt,
    };
  } catch {
    throw invalidProof();
  }
};

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

export const consumeGuestAppointmentReadCapability = async ({ businessId, appointmentId, bearer: rawBearer }) => {
  const business = objectId(businessId);
  const appointment = objectId(appointmentId);
  const secret = bearer(rawBearer);
  const consumed = await capabilityRepository.consumeForScope({
    businessId: business,
    appointmentId: appointment,
    action: ACTION,
    secretHash: hashCapability({ businessId: business, appointmentId: appointment, secret }),
    now: new Date(),
  });
  if (!consumed) throw invalidProof();

  const detail = await appointmentRepository.findGuestReadableByIdAndBusiness(appointment, business);
  if (!coherent(detail, business)) throw invalidProof();
  return readProjection(detail);
};
