import mongoose from "mongoose";

const businessSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "El nombre del negocio es obligatorio"],
      trim: true,
    },
    slug: {
      type: String,
      required: [true, "El slug del negocio es obligatorio"],
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    subscriptionStatus: {
      type: String,
      enum: ["active", "trial"],
      default: "active",
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    // Contador interno usado exclusivamente como fencing transaccional para
    // serializar mutaciones administrativas de Team dentro de un Business.
    // No forma parte de BusinessSettings ni de ninguna response pública.
    teamAdminRevision: {
      type: Number,
      default: 0,
      select: false,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

const BusinessModel = mongoose.model("Business", businessSchema);

export default BusinessModel;
