import * as serviceRepository from "../repositories/service.repository.js";
import { ConflictError, NotFoundError } from "../utils/appError.js";

export const getAllServices = async (businessId, onlyActive = false) => {
  const query = onlyActive ? { isActive: true, business: businessId } : { business: businessId };
  return await serviceRepository.findAll(query);
};

export const getServiceById = async (id) => {
  const service = await serviceRepository.findById(id);
  if (!service) {
    throw new NotFoundError("El servicio solicitado no existe");
  }
  return service;
};

export const createService = async (data, businessId) => {
  const { name } = data;
  
  // Evitar duplicados por nombre en el mismo negocio
  const existingService = await serviceRepository.findByName(name, businessId);
  if (existingService) {
    throw new ConflictError("Ya existe un servicio registrado con este nombre en tu negocio");
  }

  return await serviceRepository.create({ ...data, business: businessId });
};

export const updateService = async (id, data, businessId) => {
  // Verificar existencia
  const service = await serviceRepository.findById(id);
  if (!service) {
    throw new NotFoundError("El servicio que intenta actualizar no existe");
  }

  // Si cambia el nombre, verificar que el nuevo nombre no esté tomado por otro servicio en el mismo negocio
  if (data.name && data.name !== service.name) {
    const nameCollision = await serviceRepository.findByName(data.name, businessId);
    if (nameCollision) {
      throw new ConflictError("Ya existe otro servicio registrado con este nombre en tu negocio");
    }
  }

  return await serviceRepository.update(id, data);
};

export const deleteService = async (id, softDelete = true) => {
  const service = await serviceRepository.findById(id);
  if (!service) {
    throw new NotFoundError("El servicio que intenta eliminar no existe");
  }

  if (softDelete) {
    // Soft delete: mantiene integridad referencial para citas pasadas
    return await serviceRepository.update(id, { isActive: false });
  } else {
    // Hard delete
    return await serviceRepository.deleteById(id);
  }
};
