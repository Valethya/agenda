import mongoose from "mongoose";
import { CLIENT_CONTACT_VERIFICATION_RETENTION_SECONDS } from "../../security/clientContactVerificationRetention.constants.js";

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

// Shared C1 policy for every purpose, including contact-control. Logical
// validity still ends exactly at expiresAt; this collection-wide TTL only
// performs eventual physical cleanup one retention window later.
clientContactVerificationSchema.index(
  { expiresAt: 1 },
  {
    expireAfterSeconds: CLIENT_CONTACT_VERIFICATION_RETENTION_SECONDS,
    name: "client_verification_expiry_retention_ttl",
  },
);

const ClientContactVerificationModel = mongoose.model(
  "ClientContactVerification",
  clientContactVerificationSchema,
);

export default ClientContactVerificationModel;
