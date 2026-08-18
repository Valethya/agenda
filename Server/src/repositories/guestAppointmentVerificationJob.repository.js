import crypto from "node:crypto";
import mongoose from "mongoose";
import GuestAppointmentVerificationJob from "../db/models/guestAppointmentVerificationJob.model.js";
import GuestAppointmentIntakeBucket from "../db/models/guestAppointmentIntakeBucket.model.js";
import {
  GUEST_APPOINTMENT_ACTIONS,
  GUEST_APPOINTMENT_IMPLEMENTED_PURPOSE_TO_ACTION,
} from "../security/guestAppointmentCapability.constants.js";
import { CLIENT_CONTACT_VERIFICATION_PURPOSES } from "../db/models/clientContactVerification.model.js";

const OBJECT_ID_HEX_PATTERN = /^[0-9a-fA-F]{24}$/u;
export const GUEST_APPOINTMENT_CHALLENGE_COOLDOWN_MS = 15 * 60 * 1000;
export const GUEST_APPOINTMENT_PROCESSING_LEASE_MS = 60 * 1000;
export const GUEST_APPOINTMENT_DELIVERY_LEASE_MS = 5 * 60 * 1000;
export const GUEST_APPOINTMENT_JOB_RETENTION_MS = 60 * 60 * 1000;
export const GUEST_APPOINTMENT_INTAKE_WINDOW_MS = 60 * 1000;
export const GUEST_APPOINTMENT_INTAKE_MAX_PER_WINDOW = 240;
export const GUEST_APPOINTMENT_INTAKE_BUCKET_RETENTION_MS = 10 * 60 * 1000;

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

const requirePositiveInteger = (value, fieldName, max = 1_000_000) => {
  if (!Number.isInteger(value) || value < 1 || value > max) throw new TypeError(`${fieldName} inválido`);
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

const scopeFingerprint = (scoped) => crypto
  .createHash("sha256")
  .update(scoped.business.toHexString(), "utf8")
  .update("\0", "utf8")
  .update(scoped.appointment.toHexString(), "utf8")
  .update("\0", "utf8")
  .update(scoped.purpose, "utf8")
  .update("\0", "utf8")
  .update(scoped.action, "utf8")
  .digest("hex");

const isDuplicateKey = (error) => error?.code === 11000;

const reserveIntakeSlot = async ({
  scopeKey,
  now,
  windowMs = GUEST_APPOINTMENT_INTAKE_WINDOW_MS,
  maxPerWindow = GUEST_APPOINTMENT_INTAKE_MAX_PER_WINDOW,
  bucketRetentionMs = GUEST_APPOINTMENT_INTAKE_BUCKET_RETENTION_MS,
}) => {
  const scopedNow = requireDate(now, "now");
  const window = requireDuration(windowMs, "windowMs");
  const limit = requirePositiveInteger(maxPerWindow, "maxPerWindow");
  const retention = requireDuration(bucketRetentionMs, "bucketRetentionMs");
  if (retention < window) throw new TypeError("bucketRetentionMs debe cubrir la ventana de intake");
  if (typeof scopeKey !== "string" || !/^[0-9a-f]{64}$/u.test(scopeKey)) {
    throw new TypeError("scopeKey inválido");
  }

  const bucketStart = Math.floor(scopedNow.getTime() / window) * window;
  const bucketId = `guest-appointment-read:${bucketStart}`;
  const expiresAt = new Date(bucketStart + window + retention);

  const filter = {
    _id: bucketId,
    $or: [
      { scopeKeys: scopeKey },
      {
        $expr: {
          $lt: [
            { $size: { $ifNull: ["$scopeKeys", []] } },
            limit,
          ],
        },
      },
    ],
  };

  const updateExisting = async () => {
    const before = await GuestAppointmentIntakeBucket.findOneAndUpdate(
      filter,
      { $addToSet: { scopeKeys: scopeKey } },
      { new: false, runValidators: true },
    ).lean();
    if (!before) return null;
    return {
      accepted: true,
      consumedNewScope: !before.scopeKeys?.includes(scopeKey),
      bucketId,
    };
  };

  const existing = await updateExisting();
  if (existing) return existing;

  try {
    await GuestAppointmentIntakeBucket.create({
      _id: bucketId,
      scopeKeys: [scopeKey],
      expiresAt,
    });
    return { accepted: true, consumedNewScope: true, bucketId };
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
    const raced = await updateExisting();
    return raced ?? { accepted: false, consumedNewScope: false, bucketId };
  }
};

const existingScopeState = (scoped) => GuestAppointmentVerificationJob.findOne(scoped)
  .select("status nextEligibleAt generation")
  .lean();

const isTerminalEligible = (job, now) => (
  job
  && ["delivered", "failed"].includes(job.status)
  && job.nextEligibleAt instanceof Date
  && job.nextEligibleAt.getTime() <= now.getTime()
);

const resetEligibleTerminalScope = ({ scoped, scopedNow, nextEligibleAt }) => (
  GuestAppointmentVerificationJob.findOneAndUpdate(
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
        purgeAfter: null,
      },
      $inc: { generation: 1 },
    },
    { new: true, runValidators: true },
  )
);

export const enqueueForScope = async ({
  businessId,
  appointmentId,
  purpose,
  action,
  now,
  cooldownMs = GUEST_APPOINTMENT_CHALLENGE_COOLDOWN_MS,
  intakeWindowMs = GUEST_APPOINTMENT_INTAKE_WINDOW_MS,
  intakeMaxPerWindow = GUEST_APPOINTMENT_INTAKE_MAX_PER_WINDOW,
  intakeBucketRetentionMs = GUEST_APPOINTMENT_INTAKE_BUCKET_RETENTION_MS,
}) => {
  const scoped = scope({ businessId, appointmentId, purpose, action });
  const scopedNow = requireDate(now, "now");
  const cooldown = requireDuration(cooldownMs, "cooldownMs");
  const nextEligibleAt = new Date(scopedNow.getTime() + cooldown);

  // Exact-scope dedupe happens before touching the global creation budget. This
  // lookup only addresses the durable intent collection and never probes the
  // Business or Appointment resource itself.
  const existing = await existingScopeState(scoped);
  if (existing) {
    if (isTerminalEligible(existing, scopedNow)) {
      const reset = await resetEligibleTerminalScope({ scoped, scopedNow, nextEligibleAt });
      if (reset) return { enqueued: true, job: reset, backpressured: false };
      if (await existingScopeState(scoped)) {
        return { enqueued: false, job: null, backpressured: false };
      }
      // A TTL race removed the terminal record between read/reset. Only then do
      // we fall through to the new-storage admission path.
    } else {
      return { enqueued: false, job: null, backpressured: false };
    }
  }

  const scopeKey = scopeFingerprint(scoped);
  const admission = await reserveIntakeSlot({
    scopeKey,
    now: scopedNow,
    windowMs: intakeWindowMs,
    maxPerWindow: intakeMaxPerWindow,
    bucketRetentionMs: intakeBucketRetentionMs,
  });
  if (!admission.accepted) return { enqueued: false, job: null, backpressured: true };

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
      purgeAfter: null,
    });
    return { enqueued: true, job, backpressured: false };
  } catch (error) {
    // Admission is intentionally not refunded: it represents an attempt to add
    // a new durable scope in this short window. A duplicate race keeps exactly
    // one fingerprint, and transient write failures remain bounded to one slot
    // until the bucket expires.
    if (isDuplicateKey(error)) return { enqueued: false, job: null, backpressured: false };
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
        purgeAfter: null,
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

export const attachVerification = async ({ jobId, generation, workerId, verificationId }) => (
  GuestAppointmentVerificationJob.findOneAndUpdate(
    {
      _id: requireStrictObjectId(jobId, "jobId"),
      generation,
      status: "processing",
      leaseOwner: requireWorkerId(workerId),
      verification: null,
    },
    { $set: { verification: requireStrictObjectId(verificationId, "verificationId") } },
    { new: true, runValidators: true },
  ).select("+leaseOwner")
);

export const attachDelivery = async ({ jobId, generation, workerId, verificationId, deliveryId }) => (
  GuestAppointmentVerificationJob.findOneAndUpdate(
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
  ).select("+leaseOwner")
);

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
        purgeAfter: null,
      },
    },
    { new: true, runValidators: true },
  ).select("+leaseOwner");
};

const terminalTimes = ({ now, cooldownMs, retentionMs }) => {
  const scopedNow = requireDate(now, "now");
  const cooldown = requireDuration(cooldownMs, "cooldownMs");
  const retention = requireDuration(retentionMs, "retentionMs");
  if (retention < cooldown) throw new TypeError("retentionMs debe ser >= cooldownMs");
  return {
    scopedNow,
    nextEligibleAt: new Date(scopedNow.getTime() + cooldown),
    purgeAfter: new Date(scopedNow.getTime() + retention),
  };
};

export const markDelivered = async ({
  jobId,
  generation,
  workerId,
  verificationId,
  deliveryId,
  now,
  cooldownMs = GUEST_APPOINTMENT_CHALLENGE_COOLDOWN_MS,
  retentionMs = GUEST_APPOINTMENT_JOB_RETENTION_MS,
}) => {
  const { scopedNow, nextEligibleAt, purgeAfter } = terminalTimes({ now, cooldownMs, retentionMs });
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
        nextEligibleAt,
        purgeAfter,
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    },
    { new: true, runValidators: true },
  );
};

export const markFailed = async ({
  jobId,
  generation,
  workerId,
  now,
  cooldownMs = GUEST_APPOINTMENT_CHALLENGE_COOLDOWN_MS,
  retentionMs = GUEST_APPOINTMENT_JOB_RETENTION_MS,
}) => {
  const { scopedNow, nextEligibleAt, purgeAfter } = terminalTimes({ now, cooldownMs, retentionMs });
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
        nextEligibleAt,
        purgeAfter,
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    },
    { new: true, runValidators: true },
  );
};

export const failOneStaleDelivery = async ({
  now,
  cooldownMs = GUEST_APPOINTMENT_CHALLENGE_COOLDOWN_MS,
  retentionMs = GUEST_APPOINTMENT_JOB_RETENTION_MS,
}) => {
  const { scopedNow, nextEligibleAt, purgeAfter } = terminalTimes({ now, cooldownMs, retentionMs });
  return GuestAppointmentVerificationJob.findOneAndUpdate(
    {
      status: "delivering",
      leaseExpiresAt: { $lte: scopedNow },
    },
    {
      $set: {
        status: "failed",
        failedAt: scopedNow,
        nextEligibleAt,
        purgeAfter,
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
