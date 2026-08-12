import * as appointmentRepository from "../repositories/appointment.repository.js";
import * as serviceRepository from "../repositories/service.repository.js";
import * as availabilityService from "./availability.service.js";
import * as auditLogRepository from "../repositories/auditLog.repository.js";
import * as businessConfigRepository from "../repositories/businessConfig.repository.js";
import {
  assertProfessionalEligibleForService,
  serviceIncludesProfessional,
} from "./professionalEligibility.service.js";
import { findTenantAuthority } from "./tenantAuthority.service.js";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../utils/appError.js";
import { emitAvailabilityChange } from "../config/socket.js";
import { notifyBookingCreated, notifyAppointmentConfirmed, notifyAppointmentCancelled } from "./appointment.notifications.js";
import { logEvent } from "../utils/auditLogger.js";
import { addMinutesToTime } from "../utils/time.js";

const STATUS_TRANSITIONS = Object.freeze({
  confirm: Object.freeze({ from: Object.freeze(["pending"]), to: "confirmed" }),
  complete: Object.freeze({ from: Object.freeze(["pending", "confirmed"]), to: "completed" }),
  cancel: Object.freeze({ from: Object.freeze(["pending", "pending_payment", "confirmed"]), to: "cancelled" }),
});

const asId = (value) => {
  const candidate = value?._id ?? value;
  return candidate?.toString?.() || "";
};

const sameId = (left, right) => asId(left) === asId(right);

export const validateBookingTenantScope = async ({ worker, service, businessId }) => {
  if (!businessId) throw new ValidationError("El contexto de negocio es obligatorio para reservar");

  const serviceDetail = await serviceRepository.findByIdAndBusiness(
    service,
    businessId,
    { onlyActive: true },
  );
  if (!serviceDetail) throw new NotFoundError("El servicio solicitado no está disponible");

  const { user: workerDetail } = await assertProfessionalEligibleForService({
    userId: worker,
    businessId,
    service: serviceDetail,
    requireActiveService: true,
  });

  return { serviceDetail, workerDetail };
};

export const bookAppointment = async (appointmentData) => {
  const {
    client,
    worker,
    service,
    businessId,
    tenantScope,
    date,
    startTime,
    notes,
    paymentOption,
    isSuggestion,
  } = appointmentData;

  await logEvent({
    userId: client,
    event: "APPOINTMENT_REQUEST_RECEIVED",
    level: "INFO",
    message: `Solicitud de reserva recibida para el servicio ${service} con el trabajador ${worker} a las ${startTime} el ${date} (Sugerencia: ${!!isSuggestion}).`,
    metadata: { worker, service, date, startTime, isSuggestion },
  });

  const { serviceDetail } = tenantScope || await validateBookingTenantScope({ worker, service, businessId });
  const targetDate = new Date(date);
  const dateStr = targetDate.toISOString().split("T")[0];

  let isAvailable = true;
  if (!isSuggestion) {
    const availableSlots = await availabilityService.getAvailableSlots(worker, dateStr, service, businessId);
    isAvailable = availableSlots.some((slot) => slot.startTime === startTime && slot.available !== false);
  }

  if (!isAvailable) {
    await logEvent({
      userId: client,
      event: "APPOINTMENT_VALIDATION_FAILED",
      level: "WARN",
      message: `Validación de reserva fallida: El horario ${startTime} con trabajador ${worker} en fecha ${dateStr} ya no está disponible.`,
      metadata: { worker, dateStr, startTime },
    });
    throw new ConflictError("El horario seleccionado ya no se encuentra disponible");
  }

  await logEvent({
    userId: client,
    event: "APPOINTMENT_VALIDATION_SUCCESS",
    level: "INFO",
    message: "Validación de reserva exitosa: horario y servicio disponibles.",
    metadata: { worker, dateStr, startTime },
  });

  const endTime = addMinutesToTime(startTime, serviceDetail.duration);
  let initialStatus = "pending";
  let autoConfirm = false;
  if (businessId) {
    const config = await businessConfigRepository.getConfig(businessId);
    if (config?.appointmentSettings?.autoConfirmLocalBookings) autoConfirm = true;
  }

  const isLocalBooking = serviceDetail.depositAmount === 0 || paymentOption === "local";
  if (autoConfirm && isLocalBooking && !isSuggestion) initialStatus = "confirmed";

  let finalNotes = notes;
  if (isSuggestion) finalNotes = `[⚠️ SUGERENCIA DE CLIENTE: Horario propuesto no disponible en turnos estándar]\n${notes || ""}`;

  const newAppointment = await appointmentRepository.create({
    client,
    worker,
    service,
    date: targetDate,
    startTime,
    endTime,
    status: initialStatus,
    notes: finalNotes,
    business: businessId,
  });

  await auditLogRepository.associateOrphanedLogs(client, newAppointment._id);
  await logEvent({
    appointmentId: newAppointment._id,
    userId: client,
    event: initialStatus === "confirmed" ? "APPOINTMENT_CONFIRMED" : "APPOINTMENT_PENDING_CREATED",
    level: "INFO",
    message: `Reserva creada en estado inicial (${newAppointment.status}).`,
    metadata: { appointmentId: newAppointment._id, status: newAppointment.status },
  });

  emitAvailabilityChange(worker, dateStr, businessId);
  notifyBookingCreated(newAppointment._id, client, initialStatus);
  return newAppointment;
};

const findTenantAppointment = async (appointmentId, businessId) => {
  if (!businessId) throw new NotFoundError("La cita especificada no existe");
  const appointment = await appointmentRepository.findByIdAndBusiness(appointmentId, businessId);
  if (!appointment) throw new NotFoundError("La cita especificada no existe");
  return appointment;
};

const resolveActorTenantAuthority = async (userId, businessId, preloadedAuthority = null) => {
  if (
    preloadedAuthority
    && typeof preloadedAuthority === "object"
    && sameId(preloadedAuthority.userId, userId)
    && sameId(preloadedAuthority.businessId, businessId)
  ) {
    return preloadedAuthority;
  }

  return await findTenantAuthority(userId, businessId);
};

const resolveAppointmentCapabilities = async ({
  appointment,
  userId,
  businessId,
  tenantAuthority,
}) => {
  const authority = await resolveActorTenantAuthority(userId, businessId, tenantAuthority);
  const isAdmin = Boolean(authority && authority.role === "admin");

  let isProfessional = false;
  if (authority && sameId(appointment.worker, userId)) {
    const serviceId = appointment.service?._id ?? appointment.service;
    const service = serviceId
      ? await serviceRepository.findByIdAndBusiness(serviceId, businessId)
      : null;

    isProfessional = Boolean(
      service
      && serviceIncludesProfessional(service, userId),
    );
  }

  return {
    authority,
    isAdmin,
    isProfessional,
    actorCapability: isAdmin ? "admin" : isProfessional ? "professional" : null,
  };
};

const authorizeProtectedAppointment = async ({
  appointment,
  userId,
  businessId,
  tenantAuthority,
}) => {
  const capabilities = await resolveAppointmentCapabilities({
    appointment,
    userId,
    businessId,
    tenantAuthority,
  });

  if (!capabilities.isAdmin && !capabilities.isProfessional) {
    // APT-CLIENT-01: Appointment.client equality is deliberately NOT a grant.
    throw new NotFoundError("La cita especificada no existe");
  }

  return capabilities;
};

const transitionAppointmentStatus = async ({
  appointment,
  businessId,
  transition,
}) => {
  if (!transition.from.includes(appointment.status)) {
    throw new ConflictError("La cita ya no se encuentra en un estado compatible con esta operación");
  }

  const updated = await appointmentRepository.transitionStatusByBusiness(
    appointment._id,
    businessId,
    transition.from,
    transition.to,
  );

  if (!updated) {
    throw new ConflictError("La cita cambió de estado antes de completar la operación");
  }

  return updated;
};

export const confirmAppointment = async (appointmentId, userId, tenantAuthority, businessId) => {
  const appointment = await findTenantAppointment(appointmentId, businessId);
  const { actorCapability } = await authorizeProtectedAppointment({
    appointment,
    userId,
    businessId,
    tenantAuthority,
  });

  let updatedAppointment;
  try {
    updatedAppointment = await transitionAppointmentStatus({
      appointment,
      businessId,
      transition: STATUS_TRANSITIONS.confirm,
    });
    await logEvent({
      appointmentId,
      userId,
      event: "APPOINTMENT_CONFIRMED",
      level: "SUCCESS",
      message: "Reserva confirmada exitosamente.",
      metadata: { confirmedBy: userId, actorCapability, businessId },
    });
  } catch (dbError) {
    if (dbError instanceof ConflictError) throw dbError;
    await logEvent({
      appointmentId,
      userId,
      event: "APPOINTMENT_CONFIRMATION_FAILED",
      level: "CRITICAL",
      message: "Error al actualizar estado de la reserva a confirmado en BD.",
      technicalMessage: dbError.message,
      metadata: { confirmedBy: userId, businessId },
    });
    throw dbError;
  }

  notifyAppointmentConfirmed(appointmentId, userId);
  return updatedAppointment;
};

export const completeAppointment = async (appointmentId, userId, tenantAuthority, businessId) => {
  const appointment = await findTenantAppointment(appointmentId, businessId);
  const { actorCapability } = await authorizeProtectedAppointment({
    appointment,
    userId,
    businessId,
    tenantAuthority,
  });

  let updatedAppointment;
  try {
    updatedAppointment = await transitionAppointmentStatus({
      appointment,
      businessId,
      transition: STATUS_TRANSITIONS.complete,
    });
    await logEvent({
      appointmentId,
      userId,
      event: "APPOINTMENT_COMPLETED",
      level: "SUCCESS",
      message: "Reserva marcada como completada exitosamente.",
      metadata: { completedBy: userId, actorCapability, businessId },
    });
  } catch (dbError) {
    if (dbError instanceof ConflictError) throw dbError;
    await logEvent({
      appointmentId,
      userId,
      event: "APPOINTMENT_COMPLETION_FAILED",
      level: "CRITICAL",
      message: "Error al actualizar estado de la reserva a completado en BD.",
      technicalMessage: dbError.message,
      metadata: { completedBy: userId, businessId },
    });
    throw dbError;
  }
  return updatedAppointment;
};

export const cancelAppointment = async (appointmentId, userId, tenantAuthority, businessId) => {
  const appointment = await findTenantAppointment(appointmentId, businessId);
  const { actorCapability } = await authorizeProtectedAppointment({
    appointment,
    userId,
    businessId,
    tenantAuthority,
  });

  const updatedAppointment = await transitionAppointmentStatus({
    appointment,
    businessId,
    transition: STATUS_TRANSITIONS.cancel,
  });

  await logEvent({
    appointmentId,
    userId,
    event: "APPOINTMENT_CANCELLED",
    level: "INFO",
    message: "Reserva cancelada exitosamente.",
    metadata: { cancelledBy: userId, actorCapability, businessId },
  });

  const dateStr = new Date(appointment.date).toISOString().split("T")[0];
  emitAvailabilityChange(appointment.worker._id.toString(), dateStr, businessId);
  notifyAppointmentCancelled(appointmentId, userId);
  return updatedAppointment;
};

export const getAppointmentDetails = async (appointmentId, userId, tenantAuthority, businessId) => {
  const appointment = await findTenantAppointment(appointmentId, businessId);

  await authorizeProtectedAppointment({
    appointment,
    userId,
    businessId,
    tenantAuthority,
  });

  return appointment;
};

export const getMyAppointments = async (userId, tenantAuthority, businessId) => {
  const authority = await resolveActorTenantAuthority(userId, businessId, tenantAuthority);
  if (!authority) {
    throw new ForbiddenError("No tienes una membresía activa con permisos para este negocio");
  }

  if (authority.role === "admin") {
    return await appointmentRepository.findAll({ business: businessId });
  }

  const eligibleServices = await serviceRepository.findAll({
    business: businessId,
    workers: userId,
  });
  const eligibleServiceIds = eligibleServices.map((service) => service._id);

  if (eligibleServiceIds.length === 0) return [];

  return await appointmentRepository.findAll({
    business: businessId,
    worker: userId,
    service: { $in: eligibleServiceIds },
  });
};

export const getAppointmentTimeline = async (appointmentId, userId, tenantAuthority, businessId) => {
  await getAppointmentDetails(appointmentId, userId, tenantAuthority, businessId);
  return await auditLogRepository.findFunctionalTimelineByAppointment(appointmentId);
};
