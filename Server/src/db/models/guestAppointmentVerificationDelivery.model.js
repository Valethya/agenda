import mongoose from "mongoose";
import { CLIENT_CONTACT_VERIFICATION_PURPOSES } from "./clientContactVerification.model.js";
import { GUEST_APPOINTMENT_ACTIONS } from "../../security/guestAppointmentCapability.constants.js";

export const GUEST_APPOINTMENT_DELIVERY_STATUSES = Object.freeze([
  "pending",
  "delivered",
  "failed",
]);

const guestAppointmentVerificationDeliverySchema = new mongoose.Schema(
  {
    verification: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ClientContactVerification",
      required: true,
    },
    job: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "GuestAppointmentVerificationJob",
      required: true,
    },
    jobGeneration: {
      type: Number,
      min: 1,
      required: true,
    },
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
      enum: GUEST_APPOINTMENT_DELIVERY_STATUSES,
      default: "pending",
      required: true,
    },
    deliveredAt: {
      type: Date,
      default: null,
    },
    failedAt: {
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

// A challenge emitted by C1 can belong to only one C2 delivery scope.
guestAppointmentVerificationDeliverySchema.index(
  { verification: 1 },
  { unique: true, name: "guest_appointment_delivery_verification_unique" },
);

guestAppointmentVerificationDeliverySchema.index(
  {
    business: 1,
    appointment: 1,
    purpose: 1,
    action: 1,
    status: 1,
  },
  { name: "guest_appointment_delivery_scope_status" },
);

const GuestAppointmentVerificationDeliveryModel = mongoose.model(
  "GuestAppointmentVerificationDelivery",
  guestAppointmentVerificationDeliverySchema,
);

export default GuestAppointmentVerificationDeliveryModel;
