import mongoose from "mongoose";
import { DEFAULT_SLOT_DURATION_MINUTES } from "../../config/businessConfig.defaults.js";
import { PUBLIC_WEB_VERIFICATION_METHOD } from "../../config/publicWeb.constants.js";

const publicWebSchema = new mongoose.Schema(
  {
    websiteUrl: { type: String, default: null },
    bookingUrl: { type: String, default: null },
    verificationStatus: {
      type: String,
      enum: ["unconfigured", "pending", "verified"],
      default: "unconfigured",
      required: true,
    },
    verifiedOrigin: { type: String, default: null },
    verifiedAt: { type: Date, default: null },
    verificationValidUntil: { type: Date, default: null },
    trustGeneration: { type: Number, min: 0, default: 0, required: true },
    verificationMethod: {
      type: String,
      enum: [PUBLIC_WEB_VERIFICATION_METHOD],
      default: PUBLIC_WEB_VERIFICATION_METHOD,
      required: true,
    },
    challengeHash: { type: String, default: null, select: false },
    challengeIssuedAt: { type: Date, default: null },
    challengeExpiresAt: { type: Date, default: null },
    verificationAttemptGeneration: { type: Number, min: 0, default: 0, required: true },
    // Persisted short lease used only to linearize C2 outbound authorization
    // against trust-revoking admin commands. It is server-owned and not a grant.
    authorityFence: {
      token: { type: String, default: null, select: false },
      trustGeneration: { type: Number, default: null },
      expiresAt: { type: Date, default: null },
    },
  },
  { _id: false },
);

const businessConfigSchema = new mongoose.Schema(
  {
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Business",
      required: [true, "El negocio para la configuración es obligatorio"],
      unique: true,
      index: true,
    },
    businessName: {
      type: String,
      required: [true, "El nombre del negocio es obligatorio"],
      trim: true,
      default: "Mi Agenda",
    },
    // Jornada laboral del negocio por día de la semana (0 = Domingo, 1 = Lunes, ...)
    workingHours: [
      {
        dayOfWeek: { type: Number, required: true, min: 0, max: 6 },
        isOpen: { type: Boolean, default: true },
        startTime: { type: String, default: "09:00" },
        endTime: { type: String, default: "18:00" },
        breaks: [
          {
            startTime: { type: String, required: true },
            endTime: { type: String, required: true },
          },
        ],
      },
    ],
    appointmentSettings: {
      slotDuration: { type: Number, default: DEFAULT_SLOT_DURATION_MINUTES },
      bufferTime: { type: Number, default: 0 }, // Tiempo de holgura en minutos entre citas
      minAdvanceHours: { type: Number, default: 2 }, // Horas mínimas previas para agendar
      maxAdvanceDays: { type: Number, default: 30 }, // Máximo de días a futuro para ver disponibilidad
      autoConfirmLocalBookings: { type: Boolean, default: false }, // ¿Auto-confirmar reservas presenciales?
    },
    cancellationSettings: {
      allowCancellation: { type: Boolean, default: true },
      limitHours: { type: Number, default: 2 }, // Horas de anticipación mínimas para cancelar gratis
    },
    paymentSettings: {
      requireDeposit: { type: Boolean, default: false }, // ¿Requiere abono obligatorio?
      depositType: { type: String, enum: ["percentage", "fixed"], default: "percentage" },
      depositValue: { type: Number, default: 0 }, // ej: 20 para 20%
    },
    emailSettings: {
      brandColor: { type: String, default: "#4F46E5" }, // Color hexadecimal de botones y acentos
      logoUrl: { type: String, default: "" },          // Enlace al logotipo del negocio
      customFooter: { type: String, default: "" }      // Mensaje de despedida o firma personalizado
    },
    uiSettings: {
      professionalRoleLabel: { type: String, default: "Profesional", trim: true },
      professionalRoleLabelPlural: { type: String, default: "Profesionales", trim: true },
      enabledNavItems: {
        type: [String],
        default: ["calendario", "horarios", "clientes", "servicios", "equipo", "reportes"],
      },
    },
    publicWeb: {
      type: publicWebSchema,
      default: () => ({}),
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Shared origins are deliberately supported; this index is non-unique.
businessConfigSchema.index(
  {
    "publicWeb.verifiedOrigin": 1,
    "publicWeb.verificationStatus": 1,
    "publicWeb.verificationValidUntil": 1,
  },
  { name: "business_config_public_web_origin_fresh" },
);

const BusinessConfigModel = mongoose.model("BusinessConfig", businessConfigSchema);

export default BusinessConfigModel;
