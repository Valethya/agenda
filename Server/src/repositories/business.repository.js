import Business from "../db/models/business.model.js";

export const findById = async (id) => {
  return await Business.findById(id);
};

export const findByIdPopulated = async (id, populateField) => {
  return await Business.findById(id).populate(populateField);
};

export const findBySlug = async (slug) => {
  return await Business.findOne({ slug: slug.toLowerCase().trim() });
};

export const findOne = async (query = {}) => {
  return await Business.findOne(query);
};

export const findAll = async () => {
  return await Business.find().populate("owner", "firstName lastName email phone");
};

export const create = async (data) => {
  return await Business.create(data);
};

export const update = async (id, data) => {
  return await Business.findByIdAndUpdate(id, data, { new: true });
};

export const save = async (businessDoc) => {
  return await businessDoc.save();
};
