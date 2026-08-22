import BusinessConfig from "../db/models/businessConfig.model.js";

const BUSINESS_SUMMARY_PROJECTION = "_id name slug";

// Obtener la configuración única del negocio
export const getConfig = async (businessId) => {
  return await BusinessConfig.findOne({ business: businessId })
    .populate("business", BUSINESS_SUMMARY_PROJECTION);
};

// Crear la configuración inicial por defecto
export const createDefaultConfig = async (defaultData) => {
  return await BusinessConfig.create(defaultData);
};

// Actualizar la configuración existente
export const updateConfig = async (id, updateData) => {
  return await BusinessConfig.findByIdAndUpdate(id, updateData, { new: true, runValidators: true })
    .populate("business", BUSINESS_SUMMARY_PROJECTION);
};
