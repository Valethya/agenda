import mongoose from "mongoose";

const serviceSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "El nombre del servicio es obligatorio"],
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    duration: {
      type: Number,
      required: [true, "La duración del servicio es obligatoria"],
      min: [1, "La duración mínima es de 1 minuto"],
    },
    price: {
      type: Number,
      required: [true, "El precio del servicio es obligatorio"],
      min: [0, "El precio no puede ser negativo"],
    },
    depositAmount: {
      type: Number,
      default: 0,
      min: [0, "El monto de abono no puede ser negativo"],
    },
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Business",
      required: [true, "El negocio para el servicio es obligatorio"],
      index: true,
    },
    workers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

const ServiceModel = mongoose.model("Service", serviceSchema);

export default ServiceModel;
