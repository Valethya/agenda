import mongoose from "mongoose";
import {
  PENDING_ONBOARDING_CHANNEL,
  PENDING_ONBOARDING_PURPOSE,
} from "./pendingOnboarding.model.js";

export const TENANT_ONBOARDING_CHALLENGE_STATUSES = Object.freeze([
  "pending",
  "consumed",
  "revoked",
]);

export const TENANT_ONBOARDING_ACCOUNT_PROOF_MAX_ATTEMPTS = 5;

const tenantOnboardingChallengeSchema = new mongoose.Schema(
  {
    pendingOnboarding: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PendingOnboarding",
      required: [true, "El onboarding pendiente del challenge es obligatorio"],
    },
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Business",
      required: [true, "El Business del challenge es obligatorio"],
    },
    channel: {
      type: String,
      enum: [PENDING_ONBOARDING_CHANNEL],
      required: true,
    },
    destination: {
      type: String,
      required: [true, "El destino del challenge es obligatorio"],
    },
    purpose: {
      type: String,
      enum: [PENDING_ONBOARDING_PURPOSE],
      required: true,
    },
    secretHash: {
      type: String,
      required: [true, "El hash del challenge es obligatorio"],
      match: /^[0-9a-f]{64}$/u,
      select: false,
    },
    status: {
      type: String,
      enum: TENANT_ONBOARDING_CHALLENGE_STATUSES,
      default: "pending",
      required: true,
    },
    expiresAt: {
      type: Date,
      required: [true, "La expiración del challenge es obligatoria"],
    },
    // A bearer exists before trusted delivery returns, but it is not authority.
    // Binding requires this server-owned confirmation timestamp to be present.
    deliveredAt: {
      type: Date,
      default: null,
    },
    accountProofAttempts: {
      type: Number,
      default: 0,
      min: 0,
      max: TENANT_ONBOARDING_ACCOUNT_PROOF_MAX_ATTEMPTS,
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
    boundUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    autoIndex: process.env.NODE_ENV === "test",
  },
);

// C2 emite exactamente un challenge por grant. No existe resend/rotation en esta
// fase; la unicidad física evita que carreras creen bearers alternativos para el
// mismo PendingOnboarding.
tenantOnboardingChallengeSchema.index(
  { pendingOnboarding: 1 },
  {
    unique: true,
    name: "tenant_onboarding_challenge_pending_unique",
  },
);

const TenantOnboardingChallengeModel = mongoose.model(
  "TenantOnboardingChallenge",
  tenantOnboardingChallengeSchema,
);

export default TenantOnboardingChallengeModel;
