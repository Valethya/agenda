import mongoose from "mongoose";
import { GUEST_APPOINTMENT_ACTIONS } from "../../security/guestAppointmentCapability.constants.js";

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

const GuestAppointmentCapabilityModel = mongoose.model(
  "GuestAppointmentCapability",
  guestAppointmentCapabilitySchema,
);

export default GuestAppointmentCapabilityModel;
