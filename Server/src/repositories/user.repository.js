import User from "../db/models/user.model.js";

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
  return await User.findByIdAndUpdate(id, updateData, { new: true });
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
