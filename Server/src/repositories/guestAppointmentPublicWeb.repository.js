import mongoose from "mongoose";
import GuestAppointmentVerificationJob from "../db/models/guestAppointmentVerificationJob.model.js";
import { normalizePublicWebsiteUrl } from "../security/publicWebOrigin.js";

const OBJECT_ID_HEX_PATTERN = /^[0-9a-fA-F]{24}$/u;

const objectId = (value, name) => {
  if (value instanceof mongoose.Types.ObjectId) return value;
  if (typeof value === "string" && OBJECT_ID_HEX_PATTERN.test(value)) return new mongoose.Types.ObjectId(value);
  throw new TypeError(`${name} inválido`);
};

const generation = (value, name) => {
  if (!Number.isInteger(value) || value < 1) throw new TypeError(`${name} inválida`);
  return value;
};

const worker = (value) => {
  if (typeof value !== "string" || value.length < 8 || value.length > 128) throw new TypeError("workerId inválido");
  return value;
};

export const attachPublicWebTrust = async ({
  jobId,
  jobGeneration,
  workerId,
  publicWebTrustGeneration,
  trustedOrigin,
}) => GuestAppointmentVerificationJob.findOneAndUpdate(
  {
    _id: objectId(jobId, "jobId"),
    generation: generation(jobGeneration, "jobGeneration"),
    status: "processing",
    leaseOwner: worker(workerId),
  },
  {
    $set: {
      publicWebTrustGeneration: generation(publicWebTrustGeneration, "publicWebTrustGeneration"),
      trustedOrigin: normalizePublicWebsiteUrl(trustedOrigin),
    },
  },
  { new: true, runValidators: true },
).select("+leaseOwner");

export const deliveredJobTrustMatches = async ({
  jobId,
  jobGeneration,
  businessId,
  appointmentId,
  publicWebTrustGeneration,
  trustedOrigin,
}) => Boolean(await GuestAppointmentVerificationJob.exists({
  _id: objectId(jobId, "jobId"),
  generation: generation(jobGeneration, "jobGeneration"),
  business: objectId(businessId, "businessId"),
  appointment: objectId(appointmentId, "appointmentId"),
  status: "delivered",
  publicWebTrustGeneration: generation(publicWebTrustGeneration, "publicWebTrustGeneration"),
  trustedOrigin: normalizePublicWebsiteUrl(trustedOrigin),
}));
