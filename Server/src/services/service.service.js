import * as serviceRepository from "../repositories/service.repository.js";
import { validateProfessionalAllowlist } from "./professionalEligibility.service.js";
import { ConflictError, NotFoundError, ValidationError } from "../utils/appError.js";

const CREATE_SERVICE_FIELDS = Object.freeze([
  "name",
  "description",
  "duration",
  "price",
  "depositAmount",
  "workers",
]);
const MUTABLE_SERVICE_FIELDS = Object.freeze([
  ...CREATE_SERVICE_FIELDS,
  "isActive",
]);
const CREATE_SERVICE_FIELD_SET = new Set(CREATE_SERVICE_FIELDS);
const MUTABLE_SERVICE_FIELD_SET = new Set(MUTABLE_SERVICE_FIELDS);

const buildAllowedServiceInput = (data, allowedFields, allowedFieldSet, errorMessage) => {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new ValidationError(errorMessage);
  }

  const suppliedFields = Object.keys(data);
  const forbiddenFields = suppliedFields.filter(
    (field) => field.startsWith("$") || !allowedFieldSet.has(field),
  );
  if (forbiddenFields.length > 0) {
    throw new ValidationError("El servicio contiene campos no permitidos");
  }

  const safeInput = {};
  for (const field of allowedFields) {
    if (Object.prototype.hasOwnProperty.call(data, field)) {
      safeInput[field] = data[field];
    }
  }
  return safeInput;
};

const buildCreateServiceInput = (data) => buildAllowedServiceInput(
  data,
  CREATE_SERVICE_FIELDS,
  CREATE_SERVICE_FIELD_SET,
  "La creación del servicio no es válida",
);

const buildMutableServiceUpdate = (data) => buildAllowedServiceInput(
  data,
  MUTABLE_SERVICE_FIELDS,
  MUTABLE_SERVICE_FIELD_SET,
  "La actualización del servicio no es válida",
);

const assertDepositWithinPrice = (price, depositAmount) => {
  if (
    typeof price !== "number"
    || !Number.isFinite(price)
    || typeof depositAmount !== "number"
    || !Number.isFinite(depositAmount)
    || price < 0
    || depositAmount < 0
    || depositAmount > price
  ) {
    throw new ValidationError("El monto de abono debe estar entre 0 y el precio del servicio");
  }
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
  const safeData = buildCreateServiceInput(data);
  const depositAmount = safeData.depositAmount ?? 0;
  assertDepositWithinPrice(safeData.price, depositAmount);

  const existingService = await serviceRepository.findByName(safeData.name, businessId);
  if (existingService) {
    throw new ConflictError("Ya existe un servicio registrado con este nombre en tu negocio");
  }

  const workers = await validateProfessionalAllowlist(safeData.workers ?? [], businessId);
  return await serviceRepository.create({
    name: safeData.name,
    description: safeData.description,
    duration: safeData.duration,
    price: safeData.price,
    depositAmount,
    workers,
    business: businessId,
    isActive: true,
  });
};

export const updateService = async (id, data, businessId) => {
  const service = await serviceRepository.findByIdAndBusiness(id, businessId);
  if (!service) {
    throw new NotFoundError("El servicio que intenta actualizar no existe");
  }

  const safeData = buildMutableServiceUpdate(data);
  const finalPrice = Object.prototype.hasOwnProperty.call(safeData, "price")
    ? safeData.price
    : service.price;
  const finalDepositAmount = Object.prototype.hasOwnProperty.call(safeData, "depositAmount")
    ? safeData.depositAmount
    : (service.depositAmount ?? 0);
  assertDepositWithinPrice(finalPrice, finalDepositAmount);

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

export const deleteService = async (id, businessId) => {
  const service = await serviceRepository.findByIdAndBusiness(id, businessId);
  if (!service) {
    throw new NotFoundError("El servicio que intenta desactivar no existe");
  }

  const updated = await serviceRepository.updateMutableByIdAndBusiness(
    id,
    businessId,
    { isActive: false },
  );
  if (!updated) throw new NotFoundError("El servicio que intenta desactivar no existe");
  return updated;
};
