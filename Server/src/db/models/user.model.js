import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    firstName: {
      type: String,
      required: true,
      trim: true,
    },
    lastName: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: [String],
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    password: {
      type: String,
      required: true,
      select: false,
    },
    role: {
      type: String,
      enum: ["user", "worker", "admin", "superadmin"],
      default: "user",
    },
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Business",
      index: true,
      // DEPRECADO para admins/workers (usar Membership en su lugar). Se conserva para clientes de tipo 'user'.
    },
    phone: {
      type: [String],
      default: [],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    resetPasswordToken: {
      type: String,
      select: false, // No se incluye por defecto en las consultas
    },
    resetPasswordExpires: {
      type: Date,
      select: false,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

const UserModel = mongoose.model("User", userSchema);

export default UserModel;
