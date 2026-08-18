import mongoose from "mongoose";
import { GUEST_APPOINTMENT_ARTIFACT_RETENTION_SECONDS } from "../../security/guestAppointmentArtifactRetention.constants.js";

export const CLIENT_CONTACT_VERIFICATION_CHANNELS = Object.freeze(["email"]);

export const CLIENT_CONTACT_VERIFICATION_PURPOSES = Object.freeze([
  "contact-control",
  "appointment-read-bootstrap",
  "appointment-cancel-bootstrap",
  "appointment-reschedule-bootstrap",
]);

export const CLIENT_CONTACT_VERIFICATION_STATUSES = Object.freeze([
  "pending",
  "consumed",
  "revoked",
]);

const clientContactVerificationSchema = new mongoose.Schema(
  {
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Business",
      required: [true, "El negocio de la verificación es obligatorio"],
    },
    channel: {
      type: String,
      enum: CLIENT_CONTACT_VERIFICATION_CHANNELS,
      required: [true, "El canal de verificación es obligatorio"],
    },
    destination: {
      type: String,
      required: [true, "El destino de verificación es obligatorio"],
      trim: true,
    },
    purpose: {
      type: String,
      enum: CLIENT_CONTACT_VERIFICATION_PURPOSES,
      required: [true, "El propósito de verificación es obligatorio"],
    },
    secretHash: {
      type: String,
      required: [true, "El hash del secreto es obligatorio"],
      match: /^[0-9a-f]{64}$/u,
      select: false,
    },
    status: {
      type: String,
      enum: CLIENT_CONTACT_VERIFICATION_STATUSES,
      default: "pending",
      required: true,
    },
    expiresAt: {
      type: Date,
      required: [true, "La expiración de verificación es obligatoria"],
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

clientContactVerificationSchema.index(
  {
    business: 1,
    purpose: 1,
    secretHash: 1,
    status: 1,
    expiresAt: 1,
  },
  { name: "client_verification_business_purpose_secret_status_expiry" },
);

// Runtime validity still fails closed at expiresAt <= now. TTL is cleanup only:
// verification evidence remains bounded and is removed one retention window
// after its authority has already expired logically.
clientContactVerificationSchema.index(
  { expiresAt: 1 },
  {
    expireAfterSeconds: GUEST_APPOINTMENT_ARTIFACT_RETENTION_SECONDS,
    name: "client_verification_expiry_retention_ttl",
  },
);

const ClientContactVerificationModel = mongoose.model(
  "ClientContactVerification",
  clientContactVerificationSchema,
);

export default ClientContactVerificationModel;
