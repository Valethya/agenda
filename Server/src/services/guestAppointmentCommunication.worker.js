import crypto from "node:crypto";
import logger from "../config/logger.js";
import * as appointmentRepository from "../repositories/appointment.repository.js";
import * as communicationRepository from "../repositories/guestAppointmentCommunicationJob.repository.js";
import {
  acquirePublicWebSendFence,
  confirmPublicWebSendFence,
  releasePublicWebSendFence,
  resolveFreshPublicWebTrust,
} from "./publicWeb.service.js";
import {
  buildGuestAppointmentLifecycleDelivery,
  sendGuestAppointmentLifecycleEmail,
} from "./email/emailService.js";
import { buildGuestAppointmentManageUrl } from "../security/guestAppointmentAccessUrl.js";

const POLL_INTERVAL_MS = 1_000;
const MAX_DRAIN_PER_TICK = 10;

const id = (value) => (value?._id ?? value)?.toString?.() || "";
const sameId = (left, right) => id(left) === id(right);

const appointmentScopedDestination = (appointment) => {
  const contact = appointment?.guestContact;
  if (
    !contact
    || contact.channel !== "email"
    || contact.provenance !== "guest-booking-input-v1"
    || !(contact.capturedAt instanceof Date)
    || Number.isNaN(contact.capturedAt.getTime())
    || typeof contact.destination !== "string"
    || contact.destination.trim() === ""
  ) return null;
  return contact.destination;
};

const coherentAppointment = (appointment, businessId) => Boolean(
  appointment
  && sameId(appointment.business, businessId)
  && appointment.service
  && sameId(appointment.service.business, businessId)
  && appointment.worker,
);

const failBeforeSend = async ({ job, workerId, code }) => {
  await communicationRepository.markFailedBeforeSend({
    jobId: job._id,
    workerId,
    failureCode: code,
    now: new Date(),
  });
  logger.warn("Guest lifecycle communication failed before external delivery.");
  return { status: "failed", jobId: job._id };
};

const prepareDelivery = async ({ job, workerId, now }) => {
  if (job.deliveryPayload && job.providerIdempotencyKey) return job;
  if (!job.lifecycleSnapshot) return null;

  const trust = await resolveFreshPublicWebTrust({ businessId: job.business, now });
  if (!trust) return null;

  const appointment = await appointmentRepository.findByIdAndBusiness(job.appointment, job.business);
  if (!coherentAppointment(appointment, job.business)) return null;
  const destination = appointmentScopedDestination(appointment);
  if (!destination) return null;

  const manageUrl = buildGuestAppointmentManageUrl({
    trustedOrigin: trust.origin,
    businessId: job.business,
    appointmentId: job.appointment,
  });
  const deliveryPayload = buildGuestAppointmentLifecycleDelivery({
    event: job.event,
    appointment: job.lifecycleSnapshot.toObject ? job.lifecycleSnapshot.toObject() : job.lifecycleSnapshot,
    destination,
    manageUrl,
  });
  const providerIdempotencyKey = `agenda-i/${job._id}`;

  return communicationRepository.attachPreparedDelivery({
    jobId: job._id,
    workerId,
    publicWebTrustGeneration: trust.trustGeneration,
    trustedOrigin: trust.origin,
    deliveryPayload,
    providerIdempotencyKey,
  });
};

const currentTrustMatchesPreparedPayload = async (job) => {
  const trust = await resolveFreshPublicWebTrust({ businessId: job.business, now: new Date() });
  if (!trust) return null;
  if (trust.trustGeneration !== job.publicWebTrustGeneration || trust.origin !== job.trustedOrigin) return null;
  return trust;
};

const startDeliveryLeaseHeartbeat = ({ jobId, workerId, leaseMs, intervalMs }) => {
  let stopped = false;
  let timer = null;
  let inFlight = null;

  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(pulse, intervalMs);
    timer.unref?.();
  };
  const pulse = () => {
    if (stopped) return;
    inFlight = communicationRepository.renewDeliveryLease({
      jobId,
      workerId,
      now: new Date(),
      leaseMs,
    })
      .then((renewed) => {
        if (!renewed) stopped = true;
      })
      .catch(() => {
        stopped = true;
        logger.warn("Guest lifecycle communication delivery lease heartbeat failed.");
      })
      .finally(() => {
        inFlight = null;
        schedule();
      });
  };

  schedule();
  return async () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    if (inFlight) await inFlight;
  };
};

export const processNextGuestAppointmentCommunicationJob = async ({
  workerId,
  deliver = sendGuestAppointmentLifecycleEmail,
  now = new Date(),
  beforeExternalSend = null,
  deliveryLeaseMs = communicationRepository.GUEST_COMMUNICATION_DELIVERY_LEASE_MS,
  deliveryHeartbeatIntervalMs = Math.max(10, Math.floor(deliveryLeaseMs / 3)),
}) => {
  await communicationRepository.recoverExpiredDelivery({ now });
  const claimed = await communicationRepository.claimNext({ workerId, now });
  if (!claimed) return null;
  let job = claimed;

  try {
    const prepared = await prepareDelivery({ job, workerId, now });
    if (!prepared) return failBeforeSend({ job: claimed, workerId, code: "COMMUNICATION_SCOPE_UNAVAILABLE" });
    job = prepared;
  } catch {
    return failBeforeSend({ job: claimed, workerId, code: "COMMUNICATION_PREPARE_FAILED" });
  }

  const trust = await currentTrustMatchesPreparedPayload(job);
  if (!trust) return failBeforeSend({ job, workerId, code: "PUBLIC_WEB_TRUST_CHANGED" });

  job = await communicationRepository.beginDelivery({
    jobId: job._id,
    workerId,
    now: new Date(),
    leaseMs: deliveryLeaseMs,
  });
  if (!job) return { status: "ownership-lost" };

  let fence = null;
  let stopHeartbeat = null;
  try {
    fence = await acquirePublicWebSendFence({ businessId: job.business, trust, now: new Date() });
    if (!fence) throw new Error("PUBLIC_WEB_SEND_FENCE_UNAVAILABLE");
    if (beforeExternalSend) await beforeExternalSend({ job, trust, fence });
    const authorized = await confirmPublicWebSendFence({ businessId: job.business, fence, now: new Date() });
    if (!authorized) throw new Error("PUBLIC_WEB_SEND_AUTHORITY_LOST");

    job = await communicationRepository.recordProviderAttempt({
      jobId: job._id,
      workerId,
      now: new Date(),
    });
    if (!job) throw new Error("JOB_OWNERSHIP_LOST");

    job = await communicationRepository.renewDeliveryLease({
      jobId: job._id,
      workerId,
      now: new Date(),
      leaseMs: deliveryLeaseMs,
    });
    if (!job) throw new Error("JOB_OWNERSHIP_LOST");
    stopHeartbeat = startDeliveryLeaseHeartbeat({
      jobId: job._id,
      workerId,
      leaseMs: deliveryLeaseMs,
      intervalMs: deliveryHeartbeatIntervalMs,
    });

    let result;
    try {
      result = await deliver({
        deliveryPayload: JSON.parse(JSON.stringify(job.deliveryPayload)),
        idempotencyKey: job.providerIdempotencyKey,
      });
    } finally {
      await releasePublicWebSendFence({ businessId: job.business, fence });
      fence = null;
    }

    if (result?.accepted) {
      const delivered = await communicationRepository.markDelivered({
        jobId: job._id,
        workerId,
        providerIdempotencyKey: job.providerIdempotencyKey,
        providerMessageId: result.providerMessageId || null,
        now: new Date(),
      });
      if (stopHeartbeat) await stopHeartbeat();
      stopHeartbeat = null;
      return { status: delivered ? "delivered" : "ownership-lost", jobId: job._id };
    }

    const failed = await communicationRepository.markDeliveryFailure({
      jobId: job._id,
      workerId,
      failureCode: result?.code || "DELIVERY_FAILED",
      ambiguous: Boolean(result?.ambiguous),
      retryable: result?.retryable !== false,
      now: new Date(),
    });
    if (stopHeartbeat) await stopHeartbeat();
    stopHeartbeat = null;
    return { status: failed?.status || "ownership-lost", jobId: job._id };
  } catch (error) {
    if (stopHeartbeat) {
      try { await stopHeartbeat(); } catch {}
      stopHeartbeat = null;
    }
    if (fence) {
      try { await releasePublicWebSendFence({ businessId: job.business, fence }); } catch {}
    }
    if (job?.status === "delivering") {
      const failed = await communicationRepository.markDeliveryFailure({
        jobId: job._id,
        workerId,
        failureCode: error?.message?.startsWith("PUBLIC_WEB_") ? error.message : "DELIVERY_RUNTIME_FAILED",
        ambiguous: false,
        retryable: !error?.message?.startsWith("PUBLIC_WEB_"),
        now: new Date(),
      });
      logger.warn("Guest lifecycle communication worker attempt failed.");
      return { status: failed?.status || "ownership-lost", jobId: job._id };
    }
    return failBeforeSend({ job, workerId, code: "COMMUNICATION_RUNTIME_FAILED" });
  }
};

export const startGuestAppointmentCommunicationWorker = ({
  intervalMs = POLL_INTERVAL_MS,
  maxDrainPerTick = MAX_DRAIN_PER_TICK,
} = {}) => {
  const workerId = `i-${process.pid}-${crypto.randomBytes(12).toString("hex")}`;
  let stopped = false;
  let timer = null;

  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(run, intervalMs);
    timer.unref?.();
  };
  const run = async () => {
    if (stopped) return;
    try {
      for (let index = 0; index < maxDrainPerTick; index += 1) {
        const result = await processNextGuestAppointmentCommunicationJob({ workerId });
        if (!result) break;
      }
    } catch {
      logger.warn("Guest lifecycle communication worker tick failed.");
    } finally {
      schedule();
    }
  };

  schedule();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
};
