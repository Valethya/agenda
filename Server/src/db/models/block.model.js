import mongoose from "mongoose";

const blockSchema = new mongoose.Schema(
  {
    worker: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "El trabajador para el bloqueo es obligatorio"],
    },
    date: {
      type: Date,
      required: [true, "La fecha del bloqueo es obligatoria"],
    },
    startTime: {
      type: String,
      required: [true, "La hora de inicio es obligatoria"],
      match: [/^([01]\d|2[0-3]):[0-5]\d$/, "Formato de hora de inicio inválido (HH:MM)"],
    },
    endTime: {
      type: String,
      required: [true, "La hora de finalización es obligatoria"],
      match: [/^([01]\d|2[0-3]):[0-5]\d$/, "Formato de hora de finalización inválido (HH:MM)"],
    },
    reason: {
      type: String,
      trim: true,
      default: "Bloqueo de horario administrativo",
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Índice compuesto para acelerar las búsquedas por trabajador y fecha
blockSchema.index({ worker: 1, date: 1 });

const BlockModel = mongoose.model("Block", blockSchema);

export default BlockModel;
