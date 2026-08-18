import mongoose from "mongoose";
import { CLIENT_CONTACT_VERIFICATION_PURPOSES } from "./clientContactVerification.model.js";
import { GUEST_APPOINTMENT_ACTIONS } from "../../security/guestAppointmentCapability.constants.js";

export const GUEST_APPOINTMENT_JOB_STATUSES = Object.freeze([
  "queued",
  "processing",
  "delivering",
  "delivered",
  "failed",
]);

const guestAppointmentVerificationJobSchema = new mongoose.Schema(
  {
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Business",
      required: true,
    },
    appointment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Appointment",
      required: true,
    },
    purpose: {
      type: String,
      enum: CLIENT_CONTACT_VERIFICATION_PURPOSES,
      required: true,
    },
    action: {
      type: String,
      enum: GUEST_APPOINTMENT_ACTIONS,
      required: true,
    },
    status: {
      type: String,
      enum: GUEST_APPOINTMENT_JOB_STATUSES,
      default: "queued",
      required: true,
    },
    generation: {
      type: Number,
      min: 1,
      default: 1,
      required: true,
    },
    nextEligibleAt: {
      type: Date,
      required: true,
    },
    leaseOwner: {
      type: String,
      default: null,
      select: false,
    },
    leaseExpiresAt: {
      type: Date,
      default: null,
    },
    attempts: {
      type: Number,
      min: 0,
      default: 0,
      required: true,
    },
    verification: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ClientContactVerification",
      default: null,
    },
    delivery: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "GuestAppointmentVerificationDelivery",
      default: null,
    },
    deliveredAt: {
      type: Date,
      default: null,
    },
    failedAt: {
      type: Date,
      default: null,
    },
    // Only terminal jobs receive purgeAfter. Active jobs keep this null so the
    // MongoDB TTL monitor can never remove queued/processing/delivering work.
    purgeAfter: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    autoIndex: process.env.NODE_ENV === "test",
  },
);

// One durable operation/cooldown record exists per exact resource/action scope.
guestAppointmentVerificationJobSchema.index(
  { business: 1, appointment: 1, purpose: 1, action: 1 },
  { unique: true, name: "guest_appointment_job_scope_unique" },
);

// Supports atomic worker claiming and stale-processing recovery.
guestAppointmentVerificationJobSchema.index(
  { status: 1, leaseExpiresAt: 1, updatedAt: 1 },
  { name: "guest_appointment_job_claim" },
);

// expireAfterSeconds:0 means purgeAfter itself is the expiry timestamp. Missing
// or null purgeAfter values are ignored by MongoDB's TTL monitor.
guestAppointmentVerificationJobSchema.index(
  { purgeAfter: 1 },
  { expireAfterSeconds: 0, name: "guest_appointment_job_terminal_ttl" },
);

const GuestAppointmentVerificationJobModel = mongoose.model(
  "GuestAppointmentVerificationJob",
  guestAppointmentVerificationJobSchema,
);

export default GuestAppointmentVerificationJobModel;
