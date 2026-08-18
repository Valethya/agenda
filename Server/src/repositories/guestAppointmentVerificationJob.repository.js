import mongoose from "mongoose";
import GuestAppointmentVerificationJob from "../db/models/guestAppointmentVerificationJob.model.js";
import {
  GUEST_APPOINTMENT_ACTIONS,
  GUEST_APPOINTMENT_IMPLEMENTED_PURPOSE_TO_ACTION,
} from "../security/guestAppointmentCapability.constants.js";
import { CLIENT_CONTACT_VERIFICATION_PURPOSES } from "../db/models/clientContactVerification.model.js";

const OBJECT_ID_HEX_PATTERN = /^[0-9a-fA-F]{24}$/u;
export const GUEST_APPOINTMENT_CHALLENGE_COOLDOWN_MS = 15 * 60 * 1000;
export const GUEST_APPOINTMENT_PROCESSING_LEASE_MS = 60 * 1000;
export const GUEST_APPOINTMENT_DELIVERY_LEASE_MS = 5 * 60 * 1000;

const requireStrictObjectId = (value, fieldName) => {
  if (value instanceof mongoose.Types.ObjectId) return value;
  if (typeof value === "string" && OBJECT_ID_HEX_PATTERN.test(value)) return new mongoose.Types.ObjectId(value);
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
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new TypeError(`${fieldName} inválido`);
  return value;
};

const requireDuration = (value, fieldName) => {
  if (!Number.isInteger(value) || value < 1 || value > 24 * 60 * 60 * 1000) {
    throw new TypeError(`${fieldName} inválido`);
  }
  return value;
};

const requireWorkerId = (value) => {
  if (typeof value !== "string" || value.length < 8 || value.length > 128) {
    throw new TypeError("workerId inválido");
  }
  return value;
};

const scope = ({ businessId, appointmentId, purpose, action }) => {
  const scopedPurpose = requirePurpose(purpose);
  const scopedAction = requireAction(action);
  requireImplementedMapping(scopedPurpose, scopedAction);
  return {
    business: requireStrictObjectId(businessId, "businessId"),
    appointment: requireStrictObjectId(appointmentId, "appointmentId"),
    purpose: scopedPurpose,
    action: scopedAction,
  };
};

const isDuplicateKey = (error) => error?.code === 11000;

export const enqueueForScope = async ({
  businessId,
  appointmentId,
  purpose,
  action,
  now,
  cooldownMs = GUEST_APPOINTMENT_CHALLENGE_COOLDOWN_MS,
}) => {
  const scoped = scope({ businessId, appointmentId, purpose, action });
  const scopedNow = requireDate(now, "now");
  const cooldown = requireDuration(cooldownMs, "cooldownMs");
  const nextEligibleAt = new Date(scopedNow.getTime() + cooldown);

  const reset = await GuestAppointmentVerificationJob.findOneAndUpdate(
    {
      ...scoped,
      status: { $in: ["delivered", "failed"] },
      nextEligibleAt: { $lte: scopedNow },
    },
    {
      $set: {
        status: "queued",
        nextEligibleAt,
        leaseOwner: null,
        leaseExpiresAt: null,
        verification: null,
        delivery: null,
        deliveredAt: null,
        failedAt: null,
      },
      $inc: { generation: 1 },
    },
    { new: true, runValidators: true },
  );
  if (reset) return { enqueued: true, job: reset };

  try {
    const job = await GuestAppointmentVerificationJob.create({
      ...scoped,
      status: "queued",
      generation: 1,
      nextEligibleAt,
      leaseOwner: null,
      leaseExpiresAt: null,
      attempts: 0,
      verification: null,
      delivery: null,
      deliveredAt: null,
      failedAt: null,
    });
    return { enqueued: true, job };
  } catch (error) {
    if (isDuplicateKey(error)) return { enqueued: false, job: null };
    throw error;
  }
};

export const claimNext = async ({
  workerId,
  now,
  leaseMs = GUEST_APPOINTMENT_PROCESSING_LEASE_MS,
}) => {
  const owner = requireWorkerId(workerId);
  const scopedNow = requireDate(now, "now");
  const lease = requireDuration(leaseMs, "leaseMs");
  const leaseExpiresAt = new Date(scopedNow.getTime() + lease);

  return GuestAppointmentVerificationJob.findOneAndUpdate(
    {
      $or: [
        { status: "queued" },
        { status: "processing", leaseExpiresAt: { $lte: scopedNow } },
      ],
    },
    {
      $set: {
        status: "processing",
        leaseOwner: owner,
        leaseExpiresAt,
      },
      $inc: { attempts: 1 },
    },
    {
      sort: { updatedAt: 1, _id: 1 },
      new: true,
      runValidators: true,
    },
  ).select("+leaseOwner");
};

export const attachVerification = async ({
  jobId,
  generation,
  workerId,
  verificationId,
}) => GuestAppointmentVerificationJob.findOneAndUpdate(
  {
    _id: requireStrictObjectId(jobId, "jobId"),
    generation,
    status: "processing",
    leaseOwner: requireWorkerId(workerId),
    verification: null,
  },
  { $set: { verification: requireStrictObjectId(verificationId, "verificationId") } },
  { new: true, runValidators: true },
).select("+leaseOwner");

export const attachDelivery = async ({
  jobId,
  generation,
  workerId,
  verificationId,
  deliveryId,
}) => GuestAppointmentVerificationJob.findOneAndUpdate(
  {
    _id: requireStrictObjectId(jobId, "jobId"),
    generation,
    status: "processing",
    leaseOwner: requireWorkerId(workerId),
    verification: requireStrictObjectId(verificationId, "verificationId"),
    delivery: null,
  },
  { $set: { delivery: requireStrictObjectId(deliveryId, "deliveryId") } },
  { new: true, runValidators: true },
).select("+leaseOwner");

export const beginDelivery = async ({
  jobId,
  generation,
  workerId,
  verificationId,
  deliveryId,
  now,
  leaseMs = GUEST_APPOINTMENT_DELIVERY_LEASE_MS,
}) => {
  const scopedNow = requireDate(now, "now");
  const lease = requireDuration(leaseMs, "leaseMs");
  return GuestAppointmentVerificationJob.findOneAndUpdate(
    {
      _id: requireStrictObjectId(jobId, "jobId"),
      generation,
      status: "processing",
      leaseOwner: requireWorkerId(workerId),
      verification: requireStrictObjectId(verificationId, "verificationId"),
      delivery: requireStrictObjectId(deliveryId, "deliveryId"),
    },
    {
      $set: {
        status: "delivering",
        leaseExpiresAt: new Date(scopedNow.getTime() + lease),
      },
    },
    { new: true, runValidators: true },
  ).select("+leaseOwner");
};

export const markDelivered = async ({
  jobId,
  generation,
  workerId,
  verificationId,
  deliveryId,
  now,
  cooldownMs = GUEST_APPOINTMENT_CHALLENGE_COOLDOWN_MS,
}) => {
  const scopedNow = requireDate(now, "now");
  const cooldown = requireDuration(cooldownMs, "cooldownMs");
  return GuestAppointmentVerificationJob.findOneAndUpdate(
  {
    _id: requireStrictObjectId(jobId, "jobId"),
    generation,
    status: "delivering",
    leaseOwner: requireWorkerId(workerId),
    verification: requireStrictObjectId(verificationId, "verificationId"),
    delivery: requireStrictObjectId(deliveryId, "deliveryId"),
  },
  {
    $set: {
      status: "delivered",
      deliveredAt: scopedNow,
      nextEligibleAt: new Date(scopedNow.getTime() + cooldown),
      leaseOwner: null,
      leaseExpiresAt: null,
    },
  },
  { new: true, runValidators: true },
  );
};

export const markFailed = async ({
  jobId, generation, workerId, now, cooldownMs = GUEST_APPOINTMENT_CHALLENGE_COOLDOWN_MS,
}) => {
  const scopedNow = requireDate(now, "now");
  const cooldown = requireDuration(cooldownMs, "cooldownMs");
  return GuestAppointmentVerificationJob.findOneAndUpdate(
    {
      _id: requireStrictObjectId(jobId, "jobId"),
      generation,
      status: { $in: ["processing", "delivering"] },
      leaseOwner: requireWorkerId(workerId),
    },
    {
      $set: {
        status: "failed",
        failedAt: scopedNow,
        nextEligibleAt: new Date(scopedNow.getTime() + cooldown),
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    },
    { new: true, runValidators: true },
  );
};

export const failOneStaleDelivery = async ({
  now, cooldownMs = GUEST_APPOINTMENT_CHALLENGE_COOLDOWN_MS,
}) => {
  const scopedNow = requireDate(now, "now");
  const cooldown = requireDuration(cooldownMs, "cooldownMs");
  return GuestAppointmentVerificationJob.findOneAndUpdate(
  {
    status: "delivering",
    leaseExpiresAt: { $lte: scopedNow },
  },
  {
    $set: {
      status: "failed",
      failedAt: scopedNow,
      nextEligibleAt: new Date(scopedNow.getTime() + cooldown),
      leaseOwner: null,
      leaseExpiresAt: null,
    },
  },
  { sort: { leaseExpiresAt: 1, _id: 1 }, new: true, runValidators: true },
  );
};

export const hasDeliveredProofState = async ({
  jobId,
  generation,
  businessId,
  appointmentId,
  purpose,
  action,
  verificationId,
  deliveryId,
}) => {
  const scoped = scope({ businessId, appointmentId, purpose, action });
  return GuestAppointmentVerificationJob.exists({
    _id: requireStrictObjectId(jobId, "jobId"),
    ...scoped,
    generation,
    status: "delivered",
    verification: requireStrictObjectId(verificationId, "verificationId"),
    delivery: requireStrictObjectId(deliveryId, "deliveryId"),
    deliveredAt: { $ne: null },
  });
};
