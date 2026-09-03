import mongoose from "mongoose";
import * as userRepository from "../repositories/user.repository.js";
import * as membershipRepository from "../repositories/membership.repository.js";
import { NotFoundError, ValidationError } from "../utils/appError.js";

const PROFESSIONAL_NOT_AVAILABLE = "El profesional especificado no está disponible";
let afterEligibilityReadTestHook = null;
let afterEligibilityFenceTestHook = null;

export const setAfterEligibilityReadTestHookForTests = (hook) => {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Los hooks de concurrencia sólo están disponibles en tests");
  }
  afterEligibilityReadTestHook = hook;
};

export const setAfterEligibilityFenceTestHookForTests = (hook) => {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Los hooks de concurrencia sólo están disponibles en tests");
  }
  afterEligibilityFenceTestHook = hook;
};

const asId = (value) => {
  const candidate = value?._id ?? value;
  return candidate?.toString?.() || "";
};

const sameId = (left, right) => asId(left) === asId(right);

export const serviceIncludesProfessional = (service, userId) =>
  Array.isArray(service?.workers)
  && service.workers.some((worker) => sameId(worker, userId));

/**
 * Resuelve una participación tenant activa. Este predicado NO decide si la
 * persona puede recibir nuevas reservas y deliberadamente no consulta role
 * para inferir bookability.
 */
export const resolveActiveTenantParticipant = async (
  userId,
  businessId,
  { notFoundMessage = PROFESSIONAL_NOT_AVAILABLE, session = null } = {},
) => {
  if (!mongoose.isValidObjectId(userId) || !mongoose.isValidObjectId(businessId)) {
    throw new NotFoundError(notFoundMessage);
  }

  const [user, membership] = await Promise.all([
    userRepository.findById(userId, { session }),
    membershipRepository.findActiveByUserAndBusiness(userId, businessId, { session }),
  ]);

  const business = membership?.business;
  if (
    !user
    || user.isActive !== true
    || !membership
    || membership.isActive !== true
    || !business
    || business.isActive !== true
    || !sameId(business, businessId)
  ) {
    throw new NotFoundError(notFoundMessage);
  }

  return { user, membership, business };
};

/**
 * Fuente canónica para decidir si una participación puede recibir NUEVAS
 * reservas. Sólo `isBookable === true` es una condición positiva; ausencia,
 * null o cualquier valor no booleano falla cerrado.
 */
export const resolveBookableTenantParticipant = async (
  userId,
  businessId,
  options = {},
) => {
  const participant = await resolveActiveTenantParticipant(userId, businessId, options);
  if (participant.membership.isBookable !== true) {
    throw new NotFoundError(options.notFoundMessage ?? PROFESSIONAL_NOT_AVAILABLE);
  }
  return participant;
};

const fenceResolvedBookingEligibility = async ({
  participant,
  service,
  userId,
  businessId,
  session,
  notFoundMessage,
}) => {
  const context = {
    businessId: asId(businessId),
    userId: asId(userId),
    membershipId: asId(participant.membership),
    serviceId: asId(service),
  };

  if (afterEligibilityReadTestHook) {
    await afterEligibilityReadTestHook(context);
  }

  // El fence físico es per-worker/per-Business sobre su Membership. Las
  // mutaciones autoritativas de Service/User/Business participan incrementando
  // esta misma revisión dentro de sus transacciones. Así un cambio committed
  // después del snapshot produce WriteConflict y withTransaction revalida todo,
  // sin convertir Business o Service en locks compartidos entre bookings.
  const fencedMembership = await membershipRepository.fenceBookingEligibility({
    membershipId: participant.membership._id,
    userId,
    businessId,
    session,
  });
  if (!fencedMembership) throw new NotFoundError(notFoundMessage);

  // Sólo tests: esta barrera ocurre después del write físico del fence y antes
  // de que el booking continúe hacia overlap/insert/commit.
  if (afterEligibilityFenceTestHook) {
    await afterEligibilityFenceTestHook(context);
  }
};

export const assertServiceBookingEligibility = async ({
  userId,
  businessId,
  service,
  requireActiveService = true,
  notFoundMessage = PROFESSIONAL_NOT_AVAILABLE,
  session = null,
}) => {
  if (
    !service
    || !sameId(service.business, businessId)
    || (requireActiveService && service.isActive !== true)
  ) {
    throw new NotFoundError(notFoundMessage);
  }

  const participant = await resolveBookableTenantParticipant(userId, businessId, { notFoundMessage, session });
  if (!serviceIncludesProfessional(service, userId)) {
    throw new NotFoundError(notFoundMessage);
  }

  if (session) {
    await fenceResolvedBookingEligibility({
      participant,
      service,
      userId,
      businessId,
      session,
      notFoundMessage,
    });
  }

  return participant;
};

// Compatibilidad interna de nombre durante el cutover. La semántica ya es la
// canónica de nuevas reservas; no existe fallback por role.
export const assertProfessionalEligibleForService = assertServiceBookingEligibility;

export const validateProfessionalAllowlist = async (workerIds = [], businessId) => {
  if (!Array.isArray(workerIds)) {
    throw new ValidationError("La lista de profesionales debe ser un arreglo");
  }

  const canonicalWorkerIds = workerIds.map((workerId) => {
    const value = asId(workerId);
    if (!mongoose.isValidObjectId(value)) {
      throw new ValidationError("ID de trabajador inválido");
    }
    return new mongoose.Types.ObjectId(value).toHexString();
  });

  if (new Set(canonicalWorkerIds).size !== canonicalWorkerIds.length) {
    throw new ValidationError("La lista de profesionales no puede contener duplicados");
  }

  await Promise.all(canonicalWorkerIds.map((userId) =>
    resolveBookableTenantParticipant(userId, businessId)
  ));

  return canonicalWorkerIds;
};
