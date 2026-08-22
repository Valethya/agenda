import mongoose from "mongoose";
import * as serviceRepository from "../repositories/service.repository.js";
import { resolveActiveTenantParticipant } from "./professionalEligibility.service.js";
import { NotFoundError, ValidationError } from "../utils/appError.js";

const PUBLIC_RESOURCE_NOT_AVAILABLE = "El recurso solicitado no está disponible";

const asId = (value) => {
  const candidate = value?._id ?? value;
  return candidate?.toString?.() || "";
};

const asPlainObject = (value) => {
  if (!value) return {};
  if (typeof value.toObject === "function") return value.toObject();
  return value;
};

export const projectPublicService = (service) => {
  const value = asPlainObject(service);
  return {
    id: asId(value),
    business: asId(value.business),
    name: value.name,
    description: value.description ?? "",
    duration: value.duration,
    price: value.price,
    depositAmount: value.depositAmount ?? 0,
  };
};

export const projectPublicProfessional = (user) => {
  const value = asPlainObject(user);
  return {
    id: asId(value),
    firstName: value.firstName,
    lastName: value.lastName,
  };
};

export const projectPublicAppointmentCreated = (appointment) => {
  const value = asPlainObject(appointment);
  return {
    appointmentId: asId(value),
    businessId: asId(value.business),
    serviceId: asId(value.service),
    workerId: asId(value.worker),
    date: value.date,
    startTime: value.startTime,
    endTime: value.endTime,
    status: value.status,
  };
};

export const getPublicProfessionalsForService = async ({ businessId, serviceId }) => {
  if (!businessId) {
    throw new ValidationError("El contexto de negocio es obligatorio");
  }
  if (!mongoose.isValidObjectId(serviceId)) {
    throw new ValidationError("serviceId debe ser un ObjectId válido");
  }

  const service = await serviceRepository.findByIdAndBusiness(
    serviceId,
    businessId,
    { onlyActive: true },
  );
  if (!service) throw new NotFoundError(PUBLIC_RESOURCE_NOT_AVAILABLE);

  const workerIds = Array.isArray(service.workers) ? service.workers : [];
  const participants = await Promise.all(workerIds.map(async (workerId) => {
    try {
      return await resolveActiveTenantParticipant(workerId, businessId, {
        notFoundMessage: PUBLIC_RESOURCE_NOT_AVAILABLE,
      });
    } catch (error) {
      // Un profesional revocado/inactivo deja de ser elegible y se omite. Los
      // errores de infraestructura o programación deben propagarse; nunca se
      // degradan silenciosamente a un array parcial con 200.
      if (error instanceof NotFoundError) return null;
      throw error;
    }
  }));

  return participants
    .filter(Boolean)
    .map((participant) => projectPublicProfessional(participant.user));
};
