import mongoose from "mongoose";

export const PENDING_ONBOARDING_ROLES = Object.freeze(["admin", "worker"]);
export const PENDING_ONBOARDING_STATUSES = Object.freeze([
  "pending",
  "consumed",
  "revoked",
]);

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const MAX_EMAIL_LENGTH = 320;

export const normalizePendingOnboardingEmail = (value) => {
  if (typeof value !== "string") return value;
  return value.trim().toLowerCase();
};

const pendingOnboardingSchema = new mongoose.Schema(
  {
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Business",
      required: [true, "El negocio del onboarding pendiente es obligatorio"],
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
    role: {
      type: String,
      enum: PENDING_ONBOARDING_ROLES,
      required: [true, "El rol inicial del onboarding pendiente es obligatorio"],
    },
    isBookable: {
      type: Boolean,
      required: [true, "El estado inicial de agendabilidad es obligatorio"],
    },
    status: {
      type: String,
      enum: PENDING_ONBOARDING_STATUSES,
      default: "pending",
      required: true,
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
