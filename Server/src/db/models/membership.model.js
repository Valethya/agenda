import mongoose from "mongoose";

const membershipSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "El usuario es obligatorio"],
      index: true,
    },
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Business",
      required: [true, "El negocio es obligatorio"],
      index: true,
    },
    role: {
      type: String,
      enum: ["admin", "worker", "superadmin"],
      required: [true, "El rol de membresía es obligatorio"],
    },
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

// Un usuario solo puede tener una membresía por negocio
membershipSchema.index({ user: 1, business: 1 }, { unique: true });

const MembershipModel = mongoose.model("Membership", membershipSchema);

export default MembershipModel;
