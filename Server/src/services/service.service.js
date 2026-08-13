import * as serviceRepository from "../repositories/service.repository.js";
import { validateProfessionalAllowlist } from "./professionalEligibility.service.js";
import { ConflictError, NotFoundError, ValidationError } from "../utils/appError.js";

const MUTABLE_SERVICE_FIELDS = Object.freeze([
  "name",
  "description",
  "duration",
  "price",
  "depositAmount",
  "workers",
  "isActive",
]);
const MUTABLE_SERVICE_FIELD_SET = new Set(MUTABLE_SERVICE_FIELDS);

const buildMutableServiceUpdate = (data) => {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new ValidationError("La actualización del servicio no es válida");
  }

  const suppliedFields = Object.keys(data);
  const forbiddenFields = suppliedFields.filter(
    (field) => field.startsWith("$") || !MUTABLE_SERVICE_FIELD_SET.has(field),
  );
  if (forbiddenFields.length > 0) {
    throw new ValidationError("La actualización contiene campos no permitidos");
  }

  const update = {};
  for (const field of MUTABLE_SERVICE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(data, field)) {
      update[field] = data[field];
    }
  }
  return update;
};

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

  const safeData = buildMutableServiceUpdate(data);

  if (safeData.name && safeData.name !== service.name) {
    const nameCollision = await serviceRepository.findByName(safeData.name, businessId);
    if (nameCollision && nameCollision._id.toString() !== service._id.toString()) {
      throw new ConflictError("Ya existe otro servicio registrado con este nombre en tu negocio");
    }
  }

  if (Object.prototype.hasOwnProperty.call(safeData, "workers")) {
    safeData.workers = await validateProfessionalAllowlist(safeData.workers, businessId);
  }

  const updated = await serviceRepository.updateMutableByIdAndBusiness(id, businessId, safeData);
  if (!updated) throw new NotFoundError("El servicio que intenta actualizar no existe");
  return updated;
};

export const deleteService = async (id, businessId, softDelete = true) => {
  const service = await serviceRepository.findByIdAndBusiness(id, businessId);
  if (!service) {
    throw new NotFoundError("El servicio que intenta eliminar no existe");
  }

  if (softDelete) {
    const updated = await serviceRepository.updateMutableByIdAndBusiness(
      id,
      businessId,
      { isActive: false },
    );
    if (!updated) throw new NotFoundError("El servicio que intenta eliminar no existe");
    return updated;
  }

  const deleted = await serviceRepository.deleteByIdAndBusiness(id, businessId);
  if (!deleted) throw new NotFoundError("El servicio que intenta eliminar no existe");
  return deleted;
};
