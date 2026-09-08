import mongoose from "mongoose";

export const GUEST_APPOINTMENT_COMMUNICATION_EVENTS = Object.freeze([
  "booking",
  "cancel",
  "reschedule",
]);

const deliveryPayloadSchema = new mongoose.Schema(
  {
    destination: { type: String, required: true, trim: true, maxlength: 320 },
    fromName: { type: String, required: true, trim: true, maxlength: 160 },
    fromEmail: { type: String, required: true, trim: true, maxlength: 320 },
    replyTo: { type: String, default: null, trim: true, maxlength: 320 },
    subject: { type: String, required: true, maxlength: 240 },
    html: { type: String, required: true, maxlength: 32_000 },
  },
  { _id: false, versionKey: false },
);

const guestAppointmentCommunicationJobSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true, maxlength: 220 },
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Business",
      required: true,
      immutable: true,
    },
    appointment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Appointment",
      required: true,
      immutable: true,
    },
    event: {
      type: String,
      enum: GUEST_APPOINTMENT_COMMUNICATION_EVENTS,
      required: true,
      immutable: true,
    },
    status: {
      type: String,
      enum: ["queued", "processing", "delivering", "retry", "delivered", "failed"],
      default: "queued",
      required: true,
    },
    attempts: { type: Number, default: 0, min: 0 },
    nextAttemptAt: { type: Date, required: true, default: Date.now },
    leaseOwner: { type: String, default: null, select: false, maxlength: 128 },
    leaseExpiresAt: { type: Date, default: null, select: false },
    publicWebTrustGeneration: { type: Number, default: null, min: 1 },
    trustedOrigin: { type: String, default: null, maxlength: 2048 },
    deliveryPayload: { type: deliveryPayloadSchema, default: null, select: false },
    providerIdempotencyKey: { type: String, default: null, maxlength: 256, select: false },
    providerFirstAttemptAt: { type: Date, default: null },
    providerMessageId: { type: String, default: null, maxlength: 512 },
    lastFailureCode: { type: String, default: null, maxlength: 96 },
    ambiguousOutcome: { type: Boolean, default: false },
    deliveredAt: { type: Date, default: null },
    failedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    versionKey: false,
    autoIndex: process.env.NODE_ENV === "test",
  },
);

const GuestAppointmentCommunicationJob = mongoose.model(
  "GuestAppointmentCommunicationJob",
  guestAppointmentCommunicationJobSchema,
);

export default GuestAppointmentCommunicationJob;
