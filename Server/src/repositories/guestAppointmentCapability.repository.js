import mongoose from "mongoose";
import Appointment from "../db/models/appointment.model.js";
import AuditLog from "../db/models/auditLog.model.js";
import ClientContactVerification, {
  CLIENT_CONTACT_VERIFICATION_PURPOSES,
} from "../db/models/clientContactVerification.model.js";
import GuestAppointmentVerificationDelivery from "../db/models/guestAppointmentVerificationDelivery.model.js";
import GuestAppointmentVerificationJob from "../db/models/guestAppointmentVerificationJob.model.js";
import GuestAppointmentCapability from "../db/models/guestAppointmentCapability.model.js";
import {
  GUEST_APPOINTMENT_ACTIONS,
  GUEST_APPOINTMENT_IMPLEMENTED_PURPOSE_TO_ACTION,
} from "../security/guestAppointmentCapability.constants.js";

const OBJECT_ID_HEX_PATTERN = /^[0-9a-fA-F]{24}$/u;
const SECRET_HASH_PATTERN = /^[0-9a-f]{64}$/u;
const GUEST_CANCELABLE_STATUSES = Object.freeze(["pending", "pending_payment", "confirmed"]);
const CANCEL_STATE_CONFLICT = "GUEST_APPOINTMENT_CANCEL_STATE_CONFLICT";

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

const requireImplementedMapping = (purpose, action) => {
  if (GUEST_APPOINTMENT_IMPLEMENTED_PURPOSE_TO_ACTION[purpose] !== action) {
    throw new TypeError("purpose/action no implementado");
  }
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
  requireImplementedMapping(purpose, scopedAction);
  const hash = requireSecretHash(secretHash);
  const expiry = requireDate(expiresAt, "expiresAt");

  const [appointmentExists, verificationConsumed, trustedDelivery] = await Promise.all([
    Appointment.exists({ _id: appointment, business }),
    ClientContactVerification.exists({ _id: verification, business, purpose, status: "consumed" }),
    GuestAppointmentVerificationDelivery.findOne({
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

  const durableDeliveryState = await GuestAppointmentVerificationJob.exists({
    _id: trustedDelivery.job,
    business,
    appointment,
    purpose,
    action: scopedAction,
    generation: trustedDelivery.jobGeneration,
    verification,
    delivery: trustedDelivery._id,
    status: "delivered",
    deliveredAt: { $ne: null },
  });
  if (!durableDeliveryState) throw new ReferenceError("Capability delivery no confirmada");

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
  if (!Object.values(GUEST_APPOINTMENT_IMPLEMENTED_PURPOSE_TO_ACTION).includes(scopedAction)) {
    throw new TypeError("action no implementada");
  }
  const hash = requireSecretHash(secretHash);
  const scopedNow = requireDate(now, "now");
  return GuestAppointmentCapability.findOneAndUpdate(
    { business, appointment, action: scopedAction, secretHash: hash, status: "active", expiresAt: { $gt: scopedNow } },
    { $set: { status: "consumed", consumedAt: scopedNow } },
    { new: true, runValidators: true },
  );
};

/**
 * H2 sensitive mutation boundary. Capability consumption, Appointment status
 * transition and guest actor audit share one MongoDB transaction. A state
 * conflict or process failure aborts all three writes together.
 */
export const consumeAndCancelForScope = async ({ businessId, appointmentId, action, secretHash, now }) => {
  const business = requireStrictObjectId(businessId, "businessId");
  const appointment = requireStrictObjectId(appointmentId, "appointmentId");
  const scopedAction = requireAction(action);
  if (scopedAction !== "cancel" || !Object.values(GUEST_APPOINTMENT_IMPLEMENTED_PURPOSE_TO_ACTION).includes(scopedAction)) {
    throw new TypeError("action de cancelación no implementada");
  }
  const hash = requireSecretHash(secretHash);
  const scopedNow = requireDate(now, "now");
  const session = await mongoose.startSession();
  let result = { kind: "invalid-capability", appointment: null };

  try {
    await session.withTransaction(async () => {
      const capability = await GuestAppointmentCapability.findOneAndUpdate(
        {
          business,
          appointment,
          action: scopedAction,
          secretHash: hash,
          status: "active",
          expiresAt: { $gt: scopedNow },
        },
        { $set: { status: "consumed", consumedAt: scopedNow } },
        { new: true, runValidators: true, session },
      );

      if (!capability) {
        result = { kind: "invalid-capability", appointment: null };
        return;
      }

      const cancelled = await Appointment.findOneAndUpdate(
        {
          _id: appointment,
          business,
          status: { $in: GUEST_CANCELABLE_STATUSES },
        },
        { $set: { status: "cancelled" } },
        { new: true, runValidators: true, session },
      );

      if (!cancelled) {
        const conflict = new Error("Appointment ya no cancelable");
        conflict.code = CANCEL_STATE_CONFLICT;
        throw conflict;
      }

      await AuditLog.create([{
        appointmentId: appointment,
        event: "APPOINTMENT_CANCELLED",
        level: "INFO",
        message: "Reserva cancelada mediante autoridad guest.",
        metadata: {
          actorCapability: "guest-cancel",
          businessId: business,
        },
      }], { session });

      result = { kind: "cancelled", appointment: cancelled };
    }, {
      readConcern: { level: "snapshot" },
      writeConcern: { w: "majority" },
    });
    return result;
  } catch (error) {
    if (error?.code === CANCEL_STATE_CONFLICT) {
      return { kind: "conflict", appointment: null };
    }
    throw error;
  } finally {
    await session.endSession();
  }
};

export const revokeForScope = async ({ capabilityId, businessId, appointmentId, action, now }) => {
  const capability = requireStrictObjectId(capabilityId, "capabilityId");
  const business = requireStrictObjectId(businessId, "businessId");
  const appointment = requireStrictObjectId(appointmentId, "appointmentId");
  const scopedAction = requireAction(action);
  if (!Object.values(GUEST_APPOINTMENT_IMPLEMENTED_PURPOSE_TO_ACTION).includes(scopedAction)) {
    throw new TypeError("action no implementada");
  }
  const scopedNow = requireDate(now, "now");
  return GuestAppointmentCapability.findOneAndUpdate(
    { _id: capability, business, appointment, action: scopedAction, status: "active", expiresAt: { $gt: scopedNow } },
    { $set: { status: "revoked", revokedAt: scopedNow } },
    { new: true, runValidators: true },
  );
};
