import mongoose from "mongoose";
import { GUEST_APPOINTMENT_ACTIONS } from "../../security/guestAppointmentCapability.constants.js";
import { GUEST_APPOINTMENT_ARTIFACT_RETENTION_SECONDS } from "../../security/guestAppointmentArtifactRetention.constants.js";

export const GUEST_APPOINTMENT_CAPABILITY_STATUSES = Object.freeze([
  "active",
  "consumed",
  "revoked",
]);

const guestAppointmentCapabilitySchema = new mongoose.Schema(
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
    verification: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ClientContactVerification",
      required: true,
    },
    action: {
      type: String,
      enum: GUEST_APPOINTMENT_ACTIONS,
      required: true,
    },
    secretHash: {
      type: String,
      required: true,
      match: /^[0-9a-f]{64}$/u,
      select: false,
    },
    status: {
      type: String,
      enum: GUEST_APPOINTMENT_CAPABILITY_STATUSES,
      default: "active",
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    consumedAt: {
      type: Date,
      default: null,
    },
    revokedAt: {
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

guestAppointmentCapabilitySchema.index(
  { verification: 1 },
  { unique: true, name: "guest_appointment_capability_verification_unique" },
);

guestAppointmentCapabilitySchema.index(
  {
    business: 1,
    appointment: 1,
    action: 1,
    secretHash: 1,
    status: 1,
    expiresAt: 1,
  },
  { name: "guest_appointment_capability_scope_secret_status_expiry" },
);

// Application semantics expire exactly at expiresAt; TTL cleanup occurs only
// after an additional bounded retention window.
guestAppointmentCapabilitySchema.index(
  { expiresAt: 1 },
  {
    expireAfterSeconds: GUEST_APPOINTMENT_ARTIFACT_RETENTION_SECONDS,
    name: "guest_appointment_capability_expiry_retention_ttl",
  },
);

const GuestAppointmentCapabilityModel = mongoose.model(
  "GuestAppointmentCapability",
  guestAppointmentCapabilitySchema,
);

export default GuestAppointmentCapabilityModel;
