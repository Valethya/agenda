import Membership from "../db/models/membership.model.js";

export const findByUserAndBusiness = async (userId, businessId) => {
  return await Membership.findOne({ user: userId, business: businessId });
};

export const findByUserBusinessAndRole = async (userId, businessId, role) => {
  return await Membership.findOne({ user: userId, business: businessId, role });
};

export const findActiveByUserAndBusiness = async (userId, businessId) => {
  return await Membership.findOne({
    user: userId,
    business: businessId,
    isActive: true,
  }).populate("business");
};

export const findActiveByUser = async (userId) => {
  return await Membership.find({ user: userId, isActive: true }).populate("business");
};

export const findAll = async (query = {}) => {
  return await Membership.find(query).populate("user");
};

export const create = async (data) => {
  return await Membership.create(data);
};

export const countByUser = async (userId) => {
  return await Membership.countDocuments({ user: userId });
};

export const save = async (membershipDoc) => {
  return await membershipDoc.save();
};

export const deleteOne = async (membershipDoc) => {
  return await membershipDoc.deleteOne();
};
