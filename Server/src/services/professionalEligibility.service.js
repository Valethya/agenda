import mongoose from "mongoose";
import * as userRepository from "../repositories/user.repository.js";
import * as membershipRepository from "../repositories/membership.repository.js";
import { NotFoundError, ValidationError } from "../utils/appError.js";

const TENANT_PARTICIPANT_ROLES = new Set(["admin", "worker"]);
const PROFESSIONAL_NOT_AVAILABLE = "El profesional especificado no está disponible";

const asId = (value) => {
  const candidate = value?._id ?? value;
  return candidate?.toString?.() || "";
};

const sameId = (left, right) => asId(left) === asId(right);

export const serviceIncludesProfessional = (service, userId) =>
  Array.isArray(service?.workers)
  && service.workers.some((worker) => sameId(worker, userId));

export const resolveActiveTenantParticipant = async (
  userId,
  businessId,
  { notFoundMessage = PROFESSIONAL_NOT_AVAILABLE } = {},
) => {
  if (!mongoose.isValidObjectId(userId) || !mongoose.isValidObjectId(businessId)) {
    throw new NotFoundError(notFoundMessage);
  }

  const [user, membership] = await Promise.all([
    userRepository.findById(userId),
    membershipRepository.findActiveByUserAndBusiness(userId, businessId),
  ]);

  const membershipBusiness = membership?.business;
  if (
    !user
    || user.isActive !== true
    || !membership
    || !TENANT_PARTICIPANT_ROLES.has(membership.role)
    || !membershipBusiness
    || membershipBusiness.isActive !== true
    || !sameId(membershipBusiness, businessId)
  ) {
    throw new NotFoundError(notFoundMessage);
  }

  return { user, membership };
};

export const assertProfessionalEligibleForService = async ({
  userId,
  businessId,
  service,
  requireActiveService = false,
  notFoundMessage = PROFESSIONAL_NOT_AVAILABLE,
}) => {
  if (
    !service
    || !sameId(service.business, businessId)
    || (requireActiveService && service.isActive !== true)
  ) {
    throw new NotFoundError(notFoundMessage);
  }

  const participant = await resolveActiveTenantParticipant(userId, businessId, { notFoundMessage });
  if (!serviceIncludesProfessional(service, userId)) {
    throw new NotFoundError(notFoundMessage);
  }

  return participant;
};

export const validateProfessionalAllowlist = async (workerIds = [], businessId) => {
  if (!Array.isArray(workerIds)) {
    throw new ValidationError("La lista de profesionales debe ser un arreglo");
  }

  const normalized = workerIds.map((workerId) => {
    const value = asId(workerId);
    if (!mongoose.isValidObjectId(value)) {
      throw new ValidationError("ID de trabajador inválido");
    }
    return value;
  });

  if (new Set(normalized).size !== normalized.length) {
    throw new ValidationError("La lista de profesionales no puede contener duplicados");
  }

  await Promise.all(normalized.map((userId) =>
    resolveActiveTenantParticipant(userId, businessId)
  ));

  return normalized;
};
