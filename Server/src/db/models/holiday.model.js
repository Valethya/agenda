import mongoose from "mongoose";

const holidaySchema = new mongoose.Schema(
  {
    date: {
      type: Date,
      required: [true, "La fecha del feriado es obligatoria"],
      unique: true,
    },
    name: {
      type: String,
      required: [true, "El nombre del feriado es obligatorio"],
      trim: true,
    },
    isHalfDay: {
      type: Boolean,
      default: false, // Indica si el negocio atiende media jornada (ej: Vísperas de Navidad)
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

const HolidayModel = mongoose.model("Holiday", holidaySchema);

export default HolidayModel;
