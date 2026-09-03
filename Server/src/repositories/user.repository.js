import mongoose from "mongoose";
import User from "../db/models/user.model.js";
import Membership from "../db/models/membership.model.js";

export const findById = async (id, { session = null } = {}) => {
  return await User.findById(id).session(session || null);
};

export const findByEmail = async (email) => {
  return await User.findOne({ email }).populate("business");
};

export const findByEmailPassword = async (email) => {
  return await User.findOne({ email }).select("+password").populate("business");
};

export const findByPhone = async (phone) => {
  return await User.findOne({ phone });
};

export const findByIdWithPassword = async (id) => {
  return await User.findById(id).select("+password");
};

export const createUser = async (data) => {
  return await User.create(data);
};

export const updateUser = async (id, updateData) => {
  if (!Object.prototype.hasOwnProperty.call(updateData ?? {}, "isActive")) {
    return await User.findByIdAndUpdate(id, updateData, { new: true });
  }

  const session = await mongoose.startSession();
  let result = null;
  try {
    await session.withTransaction(async () => {
      // User.isActive es autoridad global para bookability. La transición toca
      // cada Membership del usuario para entrar en el mismo fence per-worker
      // que usa el booking, sin crear exclusión entre workers distintos.
      await Membership.updateMany(
        { user: id },
        { $inc: { bookingEligibilityRevision: 1 } },
        { session },
      );
      result = await User.findByIdAndUpdate(id, updateData, { new: true, session });
    });
    return result;
  } finally {
    await session.endSession();
  }
};

export const findByResetToken = async (token) => {
  return await User.findOne({
    resetPasswordToken: token,
    resetPasswordExpires: { $gt: Date.now() },
  }).select("+password");
};

export const findAll = async (query = {}) => {
  return await User.find(query);
};

export const findOne = async (query = {}) => {
  return await User.findOne(query);
};

export const aggregate = async (pipeline) => {
  return await User.aggregate(pipeline);
};
