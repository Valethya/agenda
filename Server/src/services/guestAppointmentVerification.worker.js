import crypto from "node:crypto";
import logger from "../config/logger.js";
import * as appointmentRepository from "../repositories/appointment.repository.js";
import * as deliveryRepository from "../repositories/guestAppointmentVerificationDelivery.repository.js";
import * as jobRepository from "../repositories/guestAppointmentVerificationJob.repository.js";
import * as publicWebJobRepository from "../repositories/guestAppointmentPublicWeb.repository.js";
import {
  issueVerificationForBusiness,
  revokeVerificationForBusiness,
} from "./clientContactVerification.service.js";
import {
  acquirePublicWebSendFence,
  confirmPublicWebSendFence,
  releasePublicWebSendFence,
  resolveFreshPublicWebTrust,
} from "./publicWeb.service.js";
import { sendGuestAppointmentVerificationEmail } from "./email/emailService.js";
import { buildGuestAppointmentVerificationUrl } from "../security/guestAppointmentAccessUrl.js";
import { GUEST_APPOINTMENT_IMPLEMENTED_PURPOSE_TO_ACTION } from "../security/guestAppointmentCapability.constants.js";

const POLL_INTERVAL_MS = 1_000;
const MAX_DRAIN_PER_TICK = 10;

const id = (value) => (value?._id ?? value)?.toString?.() || "";
const coherent = (appointment, businessId) => Boolean(
  appointment
  && id(appointment.business) === id(businessId)
  && appointment.service
  && id(appointment.service.business) === id(businessId),
);

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

const jobScopeImplemented = (job) => (
  typeof job?.purpose === "string"
  && typeof job?.action === "string"
  && GUEST_APPOINTMENT_IMPLEMENTED_PURPOSE_TO_ACTION[job.purpose] === job.action
);

const revokeQuietly = async ({ verificationId, businessId, purpose }) => {
  if (!verificationId || !purpose) return;
  try {
    await revokeVerificationForBusiness({
      verificationId,
      businessId,
      purpose,
    });
  } catch {}
};

const failDeliveryQuietly = async ({ job, verificationId, deliveryId, now }) => {
  if (!verificationId || !deliveryId || !jobScopeImplemented(job)) return;
  try {
    await deliveryRepository.markFailed({
      deliveryId,
      verificationId,
      jobId: job._id,
      jobGeneration: job.generation,
      businessId: job.business,
      appointmentId: job.appointment,
      purpose: job.purpose,
      action: job.action,
      now,
    });
  } catch {}
};

const cleanupStaleArtifacts = async ({ job, now }) => {
  await failDeliveryQuietly({
    job,
    verificationId: job.verification,
    deliveryId: job.delivery,
    now,
  });
  await revokeQuietly({
    verificationId: job.verification,
    businessId: job.business,
    purpose: job.purpose,
  });
};

const failJob = async ({ job, workerId, now }) => {
  try {
    await jobRepository.markFailed({
      jobId: job._id,
      generation: job.generation,
      workerId,
      now,
    });
  } catch {}
};

const reconcileOneUnknownDelivery = async (now) => {
  const stale = await jobRepository.failOneStaleDelivery({ now });
  if (!stale) return false;
  await cleanupStaleArtifacts({ job: stale, now });
  logger.warn("Guest appointment delivery lease expired; authority remained fail-closed.");
  return true;
};

export const processNextGuestAppointmentVerificationJob = async ({
  workerId,
  deliverVerification = sendGuestAppointmentVerificationEmail,
  now = new Date(),
  beforeSendAuthorization = null,
  beforeExternalSend = null,
}) => {
  await reconcileOneUnknownDelivery(now);

  const job = await jobRepository.claimNext({ workerId, now });
  if (!job) return null;
  if (!jobScopeImplemented(job)) {
    await failJob({ job, workerId, now: new Date() });
    logger.warn("Guest appointment verification job used an unimplemented action and failed closed.");
    return { status: "failed", jobId: job._id };
  }

  // A processing lease can be reclaimed after a crash. Any previous challenge
  // is unusable without its raw bearer; revoke/close its derived state before
  // issuing a replacement. No email has been attempted until status=delivering.
  if (job.verification || job.delivery) {
    await cleanupStaleArtifacts({ job, now });
  }

  let issued = null;
  let delivery = null;
  let fence = null;
  try {
    const trust = await resolveFreshPublicWebTrust({ businessId: job.business, now });
    if (!trust) {
      await failJob({ job, workerId, now: new Date() });
      return { status: "failed", jobId: job._id };
    }

    const trustAttached = await publicWebJobRepository.attachPublicWebTrust({
      jobId: job._id,
      jobGeneration: job.generation,
      workerId,
      publicWebTrustGeneration: trust.trustGeneration,
      trustedOrigin: trust.origin,
    });
    if (!trustAttached) throw new Error("JOB_OWNERSHIP_LOST");

    const appointment = await appointmentRepository.findGuestCapabilityBootstrapByIdAndBusiness(
      job.appointment,
      job.business,
    );
    const destination = coherent(appointment, job.business)
      ? appointmentScopedDestination(appointment)
      : null;

    if (!destination) {
      await failJob({ job, workerId, now: new Date() });
      return { status: "failed", jobId: job._id };
    }

    issued = await issueVerificationForBusiness({
      businessId: job.business,
      channel: "email",
      destination,
      purpose: job.purpose,
    });

    const verificationAttached = await jobRepository.attachVerification({
      jobId: job._id,
      generation: job.generation,
      workerId,
      verificationId: issued.verificationId,
    });
    if (!verificationAttached) throw new Error("JOB_OWNERSHIP_LOST");

    delivery = await deliveryRepository.createPending({
      verificationId: issued.verificationId,
      jobId: job._id,
      jobGeneration: job.generation,
      publicWebTrustGeneration: trust.trustGeneration,
      trustedOrigin: trust.origin,
      businessId: job.business,
      appointmentId: job.appointment,
      purpose: job.purpose,
      action: job.action,
    });

    const deliveryAttached = await jobRepository.attachDelivery({
      jobId: job._id,
      generation: job.generation,
      workerId,
      verificationId: issued.verificationId,
      deliveryId: delivery._id,
    });
    if (!deliveryAttached) throw new Error("JOB_OWNERSHIP_LOST");

    const accessUrl = buildGuestAppointmentVerificationUrl({
      trustedOrigin: trust.origin,
      businessId: job.business,
      appointmentId: job.appointment,
      verificationId: issued.verificationId,
      purpose: job.purpose,
      challengeSecret: issued.secret,
    });

    const delivering = await jobRepository.beginDelivery({
      jobId: job._id,
      generation: job.generation,
      workerId,
      verificationId: issued.verificationId,
      deliveryId: delivery._id,
      now: new Date(),
    });
    if (!delivering) throw new Error("JOB_OWNERSHIP_LOST");

    if (beforeSendAuthorization) await beforeSendAuthorization({ job, trust, delivery });

    fence = await acquirePublicWebSendFence({
      businessId: job.business,
      trust,
      now: new Date(),
    });
    if (!fence) throw new Error("PUBLIC_WEB_SEND_FENCE_UNAVAILABLE");

    if (beforeExternalSend) await beforeExternalSend({ job, trust, delivery, fence });

    const sendAuthorized = await confirmPublicWebSendFence({
      businessId: job.business,
      fence,
      now: new Date(),
    });
    if (!sendAuthorized) throw new Error("PUBLIC_WEB_SEND_AUTHORITY_LOST");

    let accepted;
    try {
      accepted = await deliverVerification({
        destination: issued.destination,
        businessId: job.business,
        accessUrl,
      });
    } finally {
      await releasePublicWebSendFence({ businessId: job.business, fence });
      fence = null;
    }
    if (!accepted) throw new Error("DELIVERY_REJECTED");

    const deliveredAt = new Date();
    const markedDelivery = await deliveryRepository.markDelivered({
      deliveryId: delivery._id,
      verificationId: issued.verificationId,
      jobId: job._id,
      jobGeneration: job.generation,
      businessId: job.business,
      appointmentId: job.appointment,
      purpose: job.purpose,
      action: job.action,
      now: deliveredAt,
    });
    if (!markedDelivery) throw new Error("DELIVERY_STATE_LOST");

    const markedJob = await jobRepository.markDelivered({
      jobId: job._id,
      generation: job.generation,
      workerId,
      verificationId: issued.verificationId,
      deliveryId: delivery._id,
      now: deliveredAt,
    });
    if (!markedJob) {
      await revokeQuietly({
        verificationId: issued.verificationId,
        businessId: job.business,
        purpose: job.purpose,
      });
      throw new Error("JOB_DELIVERED_STATE_LOST");
    }

    return { status: "delivered", jobId: job._id };
  } catch {
    if (fence) {
      try { await releasePublicWebSendFence({ businessId: job.business, fence }); } catch {}
    }
    const failedAt = new Date();
    await failDeliveryQuietly({
      job,
      verificationId: issued?.verificationId,
      deliveryId: delivery?._id,
      now: failedAt,
    });
    await revokeQuietly({
      verificationId: issued?.verificationId,
      businessId: job.business,
      purpose: job.purpose,
    });
    await failJob({ job, workerId, now: failedAt });
    logger.warn("Guest appointment verification job failed closed.");
    return { status: "failed", jobId: job._id };
  }
};

export const startGuestAppointmentVerificationWorker = ({
  intervalMs = POLL_INTERVAL_MS,
  maxDrainPerTick = MAX_DRAIN_PER_TICK,
} = {}) => {
  const workerId = `c2-${process.pid}-${crypto.randomBytes(12).toString("hex")}`;
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
        const result = await processNextGuestAppointmentVerificationJob({ workerId });
        if (!result) break;
      }
    } catch {
      logger.warn("Guest appointment verification worker tick failed closed.");
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
