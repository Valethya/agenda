import mongoose from "mongoose";

const appointmentSchema = new mongoose.Schema(
  {
    client: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "El cliente es obligatorio"],
    },
    worker: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "El trabajador es obligatorio"],
    },
    service: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Service",
      required: [true, "El servicio es obligatorio"],
    },
    date: {
      type: Date,
      required: [true, "La fecha de la cita es obligatoria"],
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
    status: {
      type: String,
      enum: ["pending_payment", "pending", "confirmed", "cancelled", "completed"],
      default: "pending",
    },
    paymentStatus: {
      type: String,
      enum: ["unpaid", "partially_paid", "fully_paid", "refunded"],
      default: "unpaid",
    },
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Business",
      required: [true, "El negocio para la cita es obligatorio"],
      index: true,
    },
    notes: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Índice compuesto parcial para acelerar búsquedas y evitar colisiones de citas activas (omite citas canceladas)
appointmentSchema.index(
  { worker: 1, date: 1, startTime: 1 },
  { 
    unique: true, 
    partialFilterExpression: { status: { $ne: "cancelled" } } 
  }
);

const AppointmentModel = mongoose.model("Appointment", appointmentSchema);

export default AppointmentModel;
