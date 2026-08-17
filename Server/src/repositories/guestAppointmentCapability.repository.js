import mongoose from "mongoose";
import Appointment from "../db/models/appointment.model.js";
import ClientContactVerification, {
  CLIENT_CONTACT_VERIFICATION_PURPOSES,
} from "../db/models/clientContactVerification.model.js";
import GuestAppointmentVerificationDelivery from "../db/models/guestAppointmentVerificationDelivery.model.js";
import GuestAppointmentCapability from "../db/models/guestAppointmentCapability.model.js";
import { GUEST_APPOINTMENT_ACTIONS } from "../security/guestAppointmentCapability.constants.js";

const OBJECT_ID_HEX_PATTERN = /^[0-9a-fA-F]{24}$/u;
const SECRET_HASH_PATTERN = /^[0-9a-f]{64}$/u;

const requireStrictObjectId = (value, fieldName) => {
  if (value instanceof mongoose.Types.ObjectId) return value;
  if (typeof value === "string" && OBJECT_ID_HEX_PATTERN.test(value)) return new mongoose.Types.ObjectId(value);
  throw new TypeError(`${fieldName} inválido`);
};

const requireAction = (action) => {
  if (typeof action !== "string" || !GUEST_APPOINTMENT_ACTIONS.includes(action)) throw new TypeError("action no permitida");
  return action;
};

const requirePurpose = (purpose) => {
  if (typeof purpose !== "string" || !CLIENT_CONTACT_VERIFICATION_PURPOSES.includes(purpose)) throw new TypeError("purpose no permitido");
  return purpose;
};

const requireSecretHash = (secretHash) => {
  if (typeof secretHash !== "string" || !SECRET_HASH_PATTERN.test(secretHash)) throw new TypeError("secretHash inválido");
  return secretHash;
};

const requireDate = (value, fieldName) => {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new TypeError(`${fieldName} inválido`);
  return value;
};

export const createActiveForScope = async ({ businessId, appointmentId, verificationId, verificationPurpose, action, secretHash, expiresAt }) => {
  const business = requireStrictObjectId(businessId, "businessId");
  const appointment = requireStrictObjectId(appointmentId, "appointmentId");
  const verification = requireStrictObjectId(verificationId, "verificationId");
  const purpose = requirePurpose(verificationPurpose);
  const scopedAction = requireAction(action);
  const hash = requireSecretHash(secretHash);
  const expiry = requireDate(expiresAt, "expiresAt");

  const [appointmentExists, verificationConsumed, trustedDelivery] = await Promise.all([
    Appointment.exists({ _id: appointment, business }),
    ClientContactVerification.exists({ _id: verification, business, purpose, status: "consumed" }),
    GuestAppointmentVerificationDelivery.exists({
      verification,
      business,
      appointment,
      purpose,
      action: scopedAction,
      status: "delivered",
      deliveredAt: { $ne: null },
    }),
  ]);

  if (!appointmentExists || !verificationConsumed || !trustedDelivery) throw new ReferenceError("Capability scope no disponible");

  return GuestAppointmentCapability.create({
    business,
    appointment,
    verification,
    action: scopedAction,
    secretHash: hash,
    status: "active",
    expiresAt: expiry,
    consumedAt: null,
    revokedAt: null,
  });
};

export const consumeForScope = async ({ businessId, appointmentId, action, secretHash, now }) => {
  const business = requireStrictObjectId(businessId, "businessId");
  const appointment = requireStrictObjectId(appointmentId, "appointmentId");
  const scopedAction = requireAction(action);
  const hash = requireSecretHash(secretHash);
  const scopedNow = requireDate(now, "now");
  return GuestAppointmentCapability.findOneAndUpdate(
    { business, appointment, action: scopedAction, secretHash: hash, status: "active", expiresAt: { $gt: scopedNow } },
    { $set: { status: "consumed", consumedAt: scopedNow } },
    { new: true, runValidators: true },
  );
};

export const revokeForScope = async ({ capabilityId, businessId, appointmentId, action, now }) => {
  const capability = requireStrictObjectId(capabilityId, "capabilityId");
  const business = requireStrictObjectId(businessId, "businessId");
  const appointment = requireStrictObjectId(appointmentId, "appointmentId");
  const scopedAction = requireAction(action);
  const scopedNow = requireDate(now, "now");
  return GuestAppointmentCapability.findOneAndUpdate(
    { _id: capability, business, appointment, action: scopedAction, status: "active", expiresAt: { $gt: scopedNow } },
    { $set: { status: "revoked", revokedAt: scopedNow } },
    { new: true, runValidators: true },
  );
};
