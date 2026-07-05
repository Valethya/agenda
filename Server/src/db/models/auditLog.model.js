import mongoose from "mongoose";

const auditLogSchema = new mongoose.Schema(
  {
    appointmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Appointment",
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },
    event: {
      type: String,
      required: [true, "El tipo de evento es obligatorio"],
      index: true,
    },
    level: {
      type: String,
      enum: ["INFO", "SUCCESS", "WARN", "ERROR", "CRITICAL"],
      required: [true, "El nivel de severidad es obligatorio"],
    },
    message: {
      type: String,
      required: [true, "El mensaje descriptivo es obligatorio"],
    },
    technicalMessage: {
      type: String,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false,
  }
);

// Índice compuesto para facilitar consultas rápidas de timeline por cita ordenadas por fecha
auditLogSchema.index({ appointmentId: 1, createdAt: 1 });

const AuditLogModel = mongoose.model("AuditLog", auditLogSchema);

export default AuditLogModel;
