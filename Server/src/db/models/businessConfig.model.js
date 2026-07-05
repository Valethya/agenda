import mongoose from "mongoose";

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
      slotDuration: { type: Number, default: 60 }, // Duración de los bloques en minutos (15, 30, 60, etc.)
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
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

const BusinessConfigModel = mongoose.model("BusinessConfig", businessConfigSchema);

export default BusinessConfigModel;
