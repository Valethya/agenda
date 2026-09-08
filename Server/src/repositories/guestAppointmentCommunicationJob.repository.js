import mongoose from "mongoose";
import GuestAppointmentCommunicationJob, {
  GUEST_APPOINTMENT_COMMUNICATION_EVENTS,
} from "../db/models/guestAppointmentCommunicationJob.model.js";

const OBJECT_ID_HEX_PATTERN = /^[0-9a-fA-F]{24}$/u;
export const GUEST_COMMUNICATION_PROCESSING_LEASE_MS = 60 * 1000;
export const GUEST_COMMUNICATION_DELIVERY_LEASE_MS = 2 * 60 * 1000;
export const GUEST_COMMUNICATION_PROVIDER_WINDOW_MS = 23 * 60 * 60 * 1000;
export const GUEST_COMMUNICATION_MAX_ATTEMPTS = 8;

const RETRY_DELAYS_MS = Object.freeze([
  60_000,
  2 * 60_000,
  5 * 60_000,
  10 * 60_000,
  20 * 60_000,
  30 * 60_000,
  45 * 60_000,
  60 * 60_000,
]);

const objectId = (value, field) => {
  if (value instanceof mongoose.Types.ObjectId) return value;
  if (typeof value === "string" && OBJECT_ID_HEX_PATTERN.test(value)) return new mongoose.Types.ObjectId(value);
  throw new TypeError(`${field} inválido`);
};
const validDate = (value, field) => {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new TypeError(`${field} inválido`);
  return value;
};
const validEvent = (value) => {
  if (!GUEST_APPOINTMENT_COMMUNICATION_EVENTS.includes(value)) throw new TypeError("event no permitido");
  return value;
};
const validWorker = (value) => {
  if (typeof value !== "string" || value.length < 8 || value.length > 128) throw new TypeError("workerId inválido");
  return value;
};
const validJobId = (value) => {
  if (typeof value !== "string" || value.length < 8 || value.length > 220) throw new TypeError("jobId inválido");
  return value;
};

export const buildCommunicationJobId = ({ event, appointmentId, operationId }) => {
  const scopedEvent = validEvent(event);
  const appointment = objectId(appointmentId, "appointmentId").toHexString();
  const operation = operationId ? objectId(operationId, "operationId").toHexString() : appointment;
  return `guest-lifecycle:${scopedEvent}:${appointment}:${operation}`;
};

export const enqueueInSession = async ({
  jobId,
  businessId,
  appointmentId,
  event,
  now = new Date(),
  session,
}) => {
  if (!session) throw new TypeError("session requerida para outbox lifecycle");
  const scopedNow = validDate(now, "now");
  const id = validJobId(jobId);
  const scoped = {
    business: objectId(businessId, "businessId"),
    appointment: objectId(appointmentId, "appointmentId"),
    event: validEvent(event),
  };

  await GuestAppointmentCommunicationJob.updateOne(
    { _id: id },
    {
      $setOnInsert: {
        ...scoped,
        status: "queued",
        attempts: 0,
        nextAttemptAt: scopedNow,
      },
    },
    { upsert: true, runValidators: true, session },
  );

  const stored = await GuestAppointmentCommunicationJob.findById(id).session(session);
  if (!stored
    || stored.business.toString() !== scoped.business.toString()
    || stored.appointment.toString() !== scoped.appointment.toString()
    || stored.event !== scoped.event) {
    throw new Error("GUEST_COMMUNICATION_SCOPE_COLLISION");
  }
  return stored;
};

export const claimNext = async ({ workerId, now = new Date(), leaseMs = GUEST_COMMUNICATION_PROCESSING_LEASE_MS }) => {
  const owner = validWorker(workerId);
  const scopedNow = validDate(now, "now");
  const leaseExpiresAt = new Date(scopedNow.getTime() + leaseMs);
  return GuestAppointmentCommunicationJob.findOneAndUpdate(
    {
      $or: [
        { status: { $in: ["queued", "retry"] }, nextAttemptAt: { $lte: scopedNow } },
        { status: "processing", leaseExpiresAt: { $lte: scopedNow } },
      ],
    },
    {
      $set: {
        status: "processing",
        leaseOwner: owner,
        leaseExpiresAt,
        failedAt: null,
      },
      $inc: { attempts: 1 },
    },
    { sort: { nextAttemptAt: 1, createdAt: 1, _id: 1 }, new: true, runValidators: true },
  ).select("+leaseOwner +deliveryPayload +providerIdempotencyKey");
};

export const attachPreparedDelivery = async ({
  jobId,
  workerId,
  publicWebTrustGeneration,
  trustedOrigin,
  deliveryPayload,
  providerIdempotencyKey,
}) => GuestAppointmentCommunicationJob.findOneAndUpdate(
  {
    _id: validJobId(jobId),
    status: "processing",
    leaseOwner: validWorker(workerId),
    deliveryPayload: null,
  },
  {
    $set: {
      publicWebTrustGeneration,
      trustedOrigin,
      deliveryPayload,
      providerIdempotencyKey,
    },
  },
  { new: true, runValidators: true },
).select("+leaseOwner +deliveryPayload +providerIdempotencyKey");

export const beginDelivery = async ({ jobId, workerId, now = new Date(), leaseMs = GUEST_COMMUNICATION_DELIVERY_LEASE_MS }) => {
  const scopedNow = validDate(now, "now");
  return GuestAppointmentCommunicationJob.findOneAndUpdate(
    {
      _id: validJobId(jobId),
      status: "processing",
      leaseOwner: validWorker(workerId),
      deliveryPayload: { $ne: null },
      providerIdempotencyKey: { $ne: null },
    },
    {
      $set: {
        status: "delivering",
        leaseExpiresAt: new Date(scopedNow.getTime() + leaseMs),
      },
    },
    { new: true, runValidators: true },
  ).select("+leaseOwner +deliveryPayload +providerIdempotencyKey");
};

export const renewDeliveryLease = async ({
  jobId,
  workerId,
  now = new Date(),
  leaseMs = GUEST_COMMUNICATION_DELIVERY_LEASE_MS,
}) => {
  const scopedNow = validDate(now, "now");
  return GuestAppointmentCommunicationJob.findOneAndUpdate(
    {
      _id: validJobId(jobId),
      status: "delivering",
      leaseOwner: validWorker(workerId),
    },
    { $set: { leaseExpiresAt: new Date(scopedNow.getTime() + leaseMs) } },
    { new: true, runValidators: true },
  ).select("+leaseOwner +deliveryPayload +providerIdempotencyKey");
};

const retryDelayForAttempt = (attempts) => RETRY_DELAYS_MS[Math.min(Math.max(attempts - 1, 0), RETRY_DELAYS_MS.length - 1)];

export const recoverExpiredDelivery = async ({ now = new Date() } = {}) => {
  const scopedNow = validDate(now, "now");
  const current = await GuestAppointmentCommunicationJob.findOne({
    status: "delivering",
    leaseExpiresAt: { $lte: scopedNow },
  })
    .sort({ leaseExpiresAt: 1, createdAt: 1, _id: 1 })
    .select("+leaseOwner +deliveryPayload +providerIdempotencyKey");
  if (!current) return null;

  const attempted = current.providerFirstAttemptAt instanceof Date;
  const providerWindowOpen = !attempted
    || scopedNow.getTime() - current.providerFirstAttemptAt.getTime() < GUEST_COMMUNICATION_PROVIDER_WINDOW_MS;
  const canRetry = current.attempts < GUEST_COMMUNICATION_MAX_ATTEMPTS && providerWindowOpen;
  const nextStatus = canRetry ? "retry" : "failed";
  const recovered = await GuestAppointmentCommunicationJob.findOneAndUpdate(
    {
      _id: current._id,
      status: "delivering",
      leaseOwner: current.leaseOwner,
      leaseExpiresAt: { $lte: scopedNow },
    },
    {
      $set: {
        status: nextStatus,
        nextAttemptAt: canRetry
          ? (attempted ? new Date(scopedNow.getTime() + retryDelayForAttempt(current.attempts)) : scopedNow)
          : scopedNow,
        lastFailureCode: attempted
          ? "DELIVERY_LEASE_EXPIRED_AMBIGUOUS"
          : "DELIVERY_LEASE_EXPIRED_BEFORE_PROVIDER",
        ambiguousOutcome: Boolean(current.ambiguousOutcome || attempted),
        failedAt: canRetry ? null : scopedNow,
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    },
    { new: true, runValidators: true },
  ).select("+deliveryPayload +providerIdempotencyKey");
  return recovered;
};

export const recordProviderAttempt = async ({ jobId, workerId, now = new Date() }) => {
  const scopedNow = validDate(now, "now");
  const scope = { _id: validJobId(jobId), status: "delivering", leaseOwner: validWorker(workerId) };
  const first = await GuestAppointmentCommunicationJob.findOneAndUpdate(
    { ...scope, providerFirstAttemptAt: null },
    { $set: { providerFirstAttemptAt: scopedNow } },
    { new: true, runValidators: true },
  ).select("+leaseOwner +deliveryPayload +providerIdempotencyKey");
  if (first) return first;
  return GuestAppointmentCommunicationJob.findOne(scope)
    .select("+leaseOwner +deliveryPayload +providerIdempotencyKey");
};

export const markDelivered = async ({
  jobId,
  workerId,
  providerIdempotencyKey = null,
  providerMessageId = null,
  now = new Date(),
}) => {
  const id = validJobId(jobId);
  const owner = validWorker(workerId);
  const deliveredAt = validDate(now, "now");
  const update = {
    $set: {
      status: "delivered",
      providerMessageId: providerMessageId || null,
      deliveredAt,
      lastFailureCode: null,
      leaseOwner: null,
      leaseExpiresAt: null,
    },
  };
  const owned = await GuestAppointmentCommunicationJob.findOneAndUpdate(
    { _id: id, status: "delivering", leaseOwner: owner },
    update,
    { new: true, runValidators: true },
  );
  if (owned) return owned;

  if (typeof providerIdempotencyKey !== "string" || providerIdempotencyKey.length === 0) return null;
  return GuestAppointmentCommunicationJob.findOneAndUpdate(
    {
      _id: id,
      status: { $in: ["delivering", "retry", "processing"] },
      providerIdempotencyKey,
      providerFirstAttemptAt: { $ne: null },
    },
    update,
    { new: true, runValidators: true },
  );
};

export const markDeliveryFailure = async ({
  jobId,
  workerId,
  failureCode,
  ambiguous = false,
  retryable = true,
  now = new Date(),
}) => {
  const scopedNow = validDate(now, "now");
  const current = await GuestAppointmentCommunicationJob.findOne({
    _id: validJobId(jobId),
    status: "delivering",
    leaseOwner: validWorker(workerId),
  }).select("+leaseOwner +providerIdempotencyKey");
  if (!current) return null;

  const providerWindowOpen = !current.providerFirstAttemptAt
    || scopedNow.getTime() - current.providerFirstAttemptAt.getTime() < GUEST_COMMUNICATION_PROVIDER_WINDOW_MS;
  const canRetry = retryable
    && current.attempts < GUEST_COMMUNICATION_MAX_ATTEMPTS
    && providerWindowOpen;
  const nextStatus = canRetry ? "retry" : "failed";
  return GuestAppointmentCommunicationJob.findOneAndUpdate(
    { _id: current._id, status: "delivering", leaseOwner: current.leaseOwner },
    {
      $set: {
        status: nextStatus,
        nextAttemptAt: canRetry ? new Date(scopedNow.getTime() + retryDelayForAttempt(current.attempts)) : scopedNow,
        lastFailureCode: typeof failureCode === "string" ? failureCode.slice(0, 96) : "DELIVERY_FAILED",
        ambiguousOutcome: Boolean(current.ambiguousOutcome || ambiguous),
        failedAt: canRetry ? null : scopedNow,
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    },
    { new: true, runValidators: true },
  );
};

export const markFailedBeforeSend = async ({ jobId, workerId, failureCode, now = new Date() }) => (
  GuestAppointmentCommunicationJob.findOneAndUpdate(
    { _id: validJobId(jobId), status: "processing", leaseOwner: validWorker(workerId) },
    {
      $set: {
        status: "failed",
        lastFailureCode: typeof failureCode === "string" ? failureCode.slice(0, 96) : "PRE_SEND_FAILED",
        failedAt: validDate(now, "now"),
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    },
    { new: true, runValidators: true },
  )
);

export const retryFailedWithinProviderWindow = async ({ jobId, now = new Date() }) => {
  const scopedNow = validDate(now, "now");
  const current = await GuestAppointmentCommunicationJob.findOne({ _id: validJobId(jobId), status: "failed" });
  if (!current) return null;
  if (current.ambiguousOutcome && current.providerFirstAttemptAt
    && scopedNow.getTime() - current.providerFirstAttemptAt.getTime() >= GUEST_COMMUNICATION_PROVIDER_WINDOW_MS) {
    return null;
  }
  return GuestAppointmentCommunicationJob.findOneAndUpdate(
    { _id: current._id, status: "failed" },
    {
      $set: {
        status: "retry",
        attempts: 0,
        nextAttemptAt: scopedNow,
        failedAt: null,
        lastFailureCode: null,
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    },
    { new: true, runValidators: true },
  );
};

export const findByIdForTests = (jobId) => GuestAppointmentCommunicationJob.findById(validJobId(jobId))
  .select("+deliveryPayload +providerIdempotencyKey +leaseOwner +leaseExpiresAt");
