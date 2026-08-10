import Service from "../db/models/service.model.js";

export const findAll = async (query = {}) => {
  return await Service.find(query).populate("workers", "firstName lastName email phone");
};

export const findById = async (id) => {
  return await Service.findById(id).populate("workers", "firstName lastName email phone");
};

export const findByIdAndBusiness = async (id, businessId, { onlyActive = false } = {}) => {
  const query = { _id: id, business: businessId };
  if (onlyActive) query.isActive = true;

  return await Service.findOne(query)
    .populate("workers", "firstName lastName email phone");
};

export const findByName = async (name, businessId) => {
  return await Service.findOne({ name, business: businessId });
};

export const create = async (data) => {
  return await Service.create(data);
};

export const update = async (id, data) => {
  return await Service.findByIdAndUpdate(id, data, { new: true, runValidators: true });
};

export const updateByIdAndBusiness = async (id, businessId, data) => {
  return await Service.findOneAndUpdate(
    { _id: id, business: businessId },
    data,
    { new: true, runValidators: true },
  );
};

export const deleteById = async (id) => {
  return await Service.findByIdAndDelete(id);
};

export const deleteByIdAndBusiness = async (id, businessId) => {
  return await Service.findOneAndDelete({ _id: id, business: businessId });
};
