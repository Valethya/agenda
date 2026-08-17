import mongoose from "mongoose";
import Appointment from "../db/models/appointment.model.js";
import ClientContactVerification, {
  CLIENT_CONTACT_VERIFICATION_PURPOSES,
} from "../db/models/clientContactVerification.model.js";
import GuestAppointmentVerificationDelivery from "../db/models/guestAppointmentVerificationDelivery.model.js";
import {
  GUEST_APPOINTMENT_ACTIONS,
  GUEST_APPOINTMENT_IMPLEMENTED_PURPOSE_TO_ACTION,
} from "../security/guestAppointmentCapability.constants.js";

const OBJECT_ID_HEX_PATTERN = /^[0-9a-fA-F]{24}$/u;

const requireStrictObjectId = (value, fieldName) => {
  if (value instanceof mongoose.Types.ObjectId) return value;
  if (typeof value === "string" && OBJECT_ID_HEX_PATTERN.test(value)) {
    return new mongoose.Types.ObjectId(value);
  }
  throw new TypeError(`${fieldName} inválido`);
};

const requirePurpose = (purpose) => {
  if (typeof purpose !== "string" || !CLIENT_CONTACT_VERIFICATION_PURPOSES.includes(purpose)) {
    throw new TypeError("purpose no permitido");
  }
  return purpose;
};

const requireAction = (action) => {
  if (typeof action !== "string" || !GUEST_APPOINTMENT_ACTIONS.includes(action)) {
    throw new TypeError("action no permitida");
  }
  return action;
};

const requireImplementedMapping = (purpose, action) => {
  if (GUEST_APPOINTMENT_IMPLEMENTED_PURPOSE_TO_ACTION[purpose] !== action) {
    throw new TypeError("purpose/action no implementado");
  }
};

const requireDate = (value, fieldName) => {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new TypeError(`${fieldName} inválido`);
  }
  return value;
};

const scope = ({ verificationId, businessId, appointmentId, purpose, action }) => {
  const scopedPurpose = requirePurpose(purpose);
  const scopedAction = requireAction(action);
  requireImplementedMapping(scopedPurpose, scopedAction);
  return {
    verification: requireStrictObjectId(verificationId, "verificationId"),
    business: requireStrictObjectId(businessId, "businessId"),
    appointment: requireStrictObjectId(appointmentId, "appointmentId"),
    purpose: scopedPurpose,
    action: scopedAction,
  };
};

export const createPending = async ({ verificationId, businessId, appointmentId, purpose, action }) => {
  const scoped = scope({ verificationId, businessId, appointmentId, purpose, action });
  const [appointmentExists, verificationExists] = await Promise.all([
    Appointment.exists({ _id: scoped.appointment, business: scoped.business }),
    ClientContactVerification.exists({
      _id: scoped.verification,
      business: scoped.business,
      purpose: scoped.purpose,
      status: "pending",
    }),
  ]);
  if (!appointmentExists || !verificationExists) throw new ReferenceError("Delivery scope no disponible");
  return GuestAppointmentVerificationDelivery.create({
    ...scoped,
    status: "pending",
    deliveredAt: null,
    failedAt: null,
  });
};

const transition = async ({ deliveryId, verificationId, businessId, appointmentId, purpose, action, now, nextStatus }) => {
  const scopedDeliveryId = requireStrictObjectId(deliveryId, "deliveryId");
  const scoped = scope({ verificationId, businessId, appointmentId, purpose, action });
  const scopedNow = requireDate(now, "now");
  const timestampField = nextStatus === "delivered" ? "deliveredAt" : "failedAt";
  return GuestAppointmentVerificationDelivery.findOneAndUpdate(
    { _id: scopedDeliveryId, ...scoped, status: "pending" },
    { $set: { status: nextStatus, [timestampField]: scopedNow } },
    { new: true, runValidators: true },
  );
};

export const markDelivered = async (args) => transition({ ...args, nextStatus: "delivered" });
export const markFailed = async (args) => transition({ ...args, nextStatus: "failed" });

export const findDeliveredByScope = async ({ verificationId, businessId, appointmentId, purpose, action }) => {
  const scoped = scope({ verificationId, businessId, appointmentId, purpose, action });
  return GuestAppointmentVerificationDelivery.findOne({
    ...scoped,
    status: "delivered",
    deliveredAt: { $ne: null },
  });
};
