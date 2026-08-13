import mongoose from "mongoose";
import CustomerProfile from "../db/models/customerProfile.model.js";

const requireObjectId = (value, fieldName) => {
  if (!mongoose.isValidObjectId(value)) {
    throw new TypeError(`${fieldName} válido es obligatorio`);
  }
  return value;
};

const pickCreateFields = (data = {}) => ({
  firstName: data.firstName,
  lastName: data.lastName,
  email: data.email,
  phone: data.phone,
});

export const findByIdAndBusiness = async (profileId, businessId) => {
  requireObjectId(profileId, "profileId");
  requireObjectId(businessId, "businessId");

  return CustomerProfile.findOne({ _id: profileId, business: businessId });
};

export const findAllByBusiness = async (businessId, { limit = 100, skip = 0 } = {}) => {
  requireObjectId(businessId, "businessId");

  const safeLimit = Math.min(Math.max(Number(limit) || 1, 1), 100);
  const safeSkip = Math.max(Number(skip) || 0, 0);

  return CustomerProfile.find({ business: businessId })
    .sort({ createdAt: -1, _id: -1 })
    .skip(safeSkip)
    .limit(safeLimit);
};

export const createForBusiness = async (businessId, data = {}) => {
  requireObjectId(businessId, "businessId");

  return CustomerProfile.create({
    ...pickCreateFields(data),
    business: businessId,
  });
};
