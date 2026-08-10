import mongoose from "mongoose";

const shiftSchema = new mongoose.Schema(
  {
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Business",
      required: [true, "El negocio para el turno es obligatorio"],
    },
    worker: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "El trabajador para el turno es obligatorio"],
    },
    dayOfWeek: {
      type: Number,
      required: [true, "El día de la semana es obligatorio (0-6)"],
      min: [0, "El día de la semana debe ser entre 0 (Domingo) y 6 (Sábado)"],
      max: [6, "El día de la semana debe ser entre 0 (Domingo) y 6 (Sábado)"],
    },
    isOpen: {
      type: Boolean,
      default: true,
    },
    startTime: {
      type: String,
      default: "09:00",
      match: [/^([01]\d|2[0-3]):[0-5]\d$/, "Formato de hora de inicio inválido (HH:MM)"],
    },
    endTime: {
      type: String,
      default: "18:00",
      match: [/^([01]\d|2[0-3]):[0-5]\d$/, "Formato de hora de finalización inválido (HH:MM)"],
    },
    breaks: [
      {
        startTime: {
          type: String,
          required: true,
          match: [/^([01]\d|2[0-3]):[0-5]\d$/, "Formato inválido (HH:MM)"],
        },
        endTime: {
          type: String,
          required: true,
          match: [/^([01]\d|2[0-3]):[0-5]\d$/, "Formato inválido (HH:MM)"],
        },
      },
    ],
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// La identidad física de un turno es tenant + worker global + día.
shiftSchema.index(
  { business: 1, worker: 1, dayOfWeek: 1 },
  { unique: true, name: "shift_business_worker_day_unique" },
);

const ShiftModel = mongoose.model("Shift", shiftSchema);

export default ShiftModel;
