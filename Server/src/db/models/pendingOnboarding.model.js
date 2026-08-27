import mongoose from "mongoose";

export const PENDING_ONBOARDING_ROLES = Object.freeze(["admin", "worker"]);
export const PENDING_ONBOARDING_STATUSES = Object.freeze([
  "pending",
  "consumed",
  "revoked",
]);
export const PENDING_ONBOARDING_CHANNEL = "email";
export const PENDING_ONBOARDING_PURPOSE = "tenant-onboarding";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const MAX_EMAIL_LENGTH = 320;

export const normalizePendingOnboardingEmail = (value) => {
  if (typeof value !== "string") return value;
  return value.trim().toLowerCase();
};

const accountBindingSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    challenge: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TenantOnboardingChallenge",
      required: true,
    },
    boundAt: {
      type: Date,
      required: true,
    },
  },
  { _id: false, versionKey: false },
);

const pendingOnboardingSchema = new mongoose.Schema(
  {
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Business",
      required: [true, "El negocio del onboarding pendiente es obligatorio"],
    },
    issuer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "El issuer del onboarding pendiente es obligatorio"],
    },
    channel: {
      type: String,
      enum: [PENDING_ONBOARDING_CHANNEL],
      required: [true, "El canal del onboarding pendiente es obligatorio"],
    },
    email: {
      type: String,
      required: [true, "El email objetivo del onboarding pendiente es obligatorio"],
      set: normalizePendingOnboardingEmail,
      validate: [
        {
          validator: (value) => typeof value === "string" && value.length <= MAX_EMAIL_LENGTH,
          message: "El email objetivo del onboarding pendiente es demasiado largo",
        },
        {
          validator: (value) => EMAIL_PATTERN.test(value),
          message: "El email objetivo del onboarding pendiente no es válido",
        },
      ],
    },
    purpose: {
      type: String,
      enum: [PENDING_ONBOARDING_PURPOSE],
      required: [true, "El purpose del onboarding pendiente es obligatorio"],
    },
    role: {
      type: String,
      enum: PENDING_ONBOARDING_ROLES,
      required: [true, "El rol inicial del onboarding pendiente es obligatorio"],
    },
    isBookable: {
      type: Boolean,
      required: [true, "El estado inicial de agendabilidad es obligatorio"],
    },
    expiresAt: {
      type: Date,
      required: [true, "La expiración del onboarding pendiente es obligatoria"],
    },
    status: {
      type: String,
      enum: PENDING_ONBOARDING_STATUSES,
      default: "pending",
      required: true,
    },
    // C2 fija el User exacto controlado por el claimant. Este subdocumento no es
    // Membership ni autoridad tenant y C3 deberá consumirlo sin volver a inferir
    // identidad por email.
    accountBinding: {
      type: accountBindingSchema,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    autoIndex: process.env.NODE_ENV === "test",
  },
);

// Sólo puede existir un onboarding todavía utilizable por Business + email canónico.
// Los estados terminales quedan fuera del índice para conservar historial sin bloquear
// una futura intención administrativa nueva. La materialización física fuera de test
// se realiza mediante el script de storage controlado de C1; nunca por autoIndex runtime.
pendingOnboardingSchema.index(
  { business: 1, email: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "pending" },
    name: "pending_onboarding_business_email_pending_unique",
  },
);

const PendingOnboardingModel = mongoose.model(
  "PendingOnboarding",
  pendingOnboardingSchema,
);

export default PendingOnboardingModel;
