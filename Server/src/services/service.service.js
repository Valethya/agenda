import * as serviceRepository from "../repositories/service.repository.js";
import { validateProfessionalAllowlist } from "./professionalEligibility.service.js";
import { ConflictError, NotFoundError } from "../utils/appError.js";

export const getAllServices = async (businessId, onlyActive = false) => {
  const query = onlyActive ? { isActive: true, business: businessId } : { business: businessId };
  return await serviceRepository.findAll(query);
};

export const getServiceById = async (id, businessId, onlyActive = false) => {
  const service = await serviceRepository.findByIdAndBusiness(id, businessId, { onlyActive });
  if (!service) {
    throw new NotFoundError("El servicio solicitado no existe");
  }
  return service;
};

export const createService = async (data, businessId) => {
  const { name } = data;

  const existingService = await serviceRepository.findByName(name, businessId);
  if (existingService) {
    throw new ConflictError("Ya existe un servicio registrado con este nombre en tu negocio");
  }

  const workers = await validateProfessionalAllowlist(data.workers ?? [], businessId);
  return await serviceRepository.create({ ...data, workers, business: businessId });
};

export const updateService = async (id, data, businessId) => {
  const service = await serviceRepository.findByIdAndBusiness(id, businessId);
  if (!service) {
    throw new NotFoundError("El servicio que intenta actualizar no existe");
  }

  if (data.name && data.name !== service.name) {
    const nameCollision = await serviceRepository.findByName(data.name, businessId);
    if (nameCollision && nameCollision._id.toString() !== service._id.toString()) {
      throw new ConflictError("Ya existe otro servicio registrado con este nombre en tu negocio");
    }
  }

  let safeData = data;
  if (Object.prototype.hasOwnProperty.call(data, "workers")) {
    const workers = await validateProfessionalAllowlist(data.workers, businessId);
    safeData = { ...data, workers };
  }

  const updated = await serviceRepository.updateByIdAndBusiness(id, businessId, safeData);
  if (!updated) throw new NotFoundError("El servicio que intenta actualizar no existe");
  return updated;
};

export const deleteService = async (id, businessId, softDelete = true) => {
  const service = await serviceRepository.findByIdAndBusiness(id, businessId);
  if (!service) {
    throw new NotFoundError("El servicio que intenta eliminar no existe");
  }

  if (softDelete) {
    const updated = await serviceRepository.updateByIdAndBusiness(id, businessId, { isActive: false });
    if (!updated) throw new NotFoundError("El servicio que intenta eliminar no existe");
    return updated;
  }

  const deleted = await serviceRepository.deleteByIdAndBusiness(id, businessId);
  if (!deleted) throw new NotFoundError("El servicio que intenta eliminar no existe");
  return deleted;
};
