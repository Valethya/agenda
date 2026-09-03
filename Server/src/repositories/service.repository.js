import Service from "../db/models/service.model.js";

const MUTABLE_SERVICE_FIELDS = Object.freeze([
  "name",
  "description",
  "duration",
  "price",
  "depositAmount",
  "workers",
  "isActive",
]);

const pickMutableServiceFields = (data = {}) => {
  const update = {};
  for (const field of MUTABLE_SERVICE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(data, field)) {
      update[field] = data[field];
    }
  }
  return update;
};

export const findAll = async (query = {}) => {
  return await Service.find(query).populate("workers", "firstName lastName email phone");
};

export const findById = async (id) => {
  return await Service.findById(id).populate("workers", "firstName lastName email phone");
};

export const findByIdAndBusiness = async (
  id,
  businessId,
  { onlyActive = false, session = null } = {},
) => {
  const query = { _id: id, business: businessId };
  if (onlyActive) query.isActive = true;

  return await Service.findOne(query)
    .session(session || null)
    .populate("workers", "firstName lastName email phone");
};

export const findByName = async (name, businessId) => {
  return await Service.findOne({ name, business: businessId });
};

export const create = async (data) => {
  return await Service.create(data);
};

export const updateMutableByIdAndBusiness = async (id, businessId, data) => {
  const mutableUpdate = pickMutableServiceFields(data);
  return await Service.findOneAndUpdate(
    { _id: id, business: businessId },
    { $set: mutableUpdate },
    { new: true, runValidators: true },
  );
};
