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
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

const BusinessModel = mongoose.model("Business", businessSchema);

export default BusinessModel;
