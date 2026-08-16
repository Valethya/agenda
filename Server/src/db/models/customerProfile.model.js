import mongoose from "mongoose";

const customerProfileSchema = new mongoose.Schema(
  {
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Business",
      required: [true, "El negocio del perfil de cliente es obligatorio"],
    },
    firstName: {
      type: String,
      trim: true,
      default: "",
    },
    lastName: {
      type: String,
      trim: true,
      default: "",
    },
    // Contacto operacional declarado. No representa identidad verificada ni autoridad.
    email: {
      type: String,
      trim: true,
      default: "",
    },
    // Contacto operacional declarado. No representa identidad verificada ni autoridad.
    phone: {
      type: String,
      trim: true,
      default: "",
    },
  },
  {
    timestamps: true,
    versionKey: false,
    autoIndex: process.env.NODE_ENV === "test",
  },
);

// Índice tenant-first declarado para el listado estable por createdAt + _id.
// Su materialización física fuera de test requiere un paso operacional controlado posterior.
// Deliberadamente no existen índices unique ni índices globales por contacto.
customerProfileSchema.index(
  { business: 1, createdAt: -1, _id: -1 },
  { name: "customer_profile_business_created_at_id" },
);

const CustomerProfileModel = mongoose.model("CustomerProfile", customerProfileSchema);

export default CustomerProfileModel;
