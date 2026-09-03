import * as appointmentRepository from "../repositories/appointment.repository.js";
import * as serviceRepository from "../repositories/service.repository.js";
import * as availabilityService from "./availability.service.js";
import * as auditLogRepository from "../repositories/auditLog.repository.js";
import * as businessConfigRepository from "../repositories/businessConfig.repository.js";
import { assertServiceBookingEligibility } from "./professionalEligibility.service.js";
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

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
let beforeBookingCommitTestHook = null;

export const setBeforeBookingCommitTestHookForTests = (hook) => {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Los hooks de concurrencia sólo están disponibles en tests");
  }
  beforeBookingCommitTestHook = hook;
};

export const buildGuestBookingContactSnapshot = (clientInfo) => {
  const rawEmail = clientInfo?.email;
  if (typeof rawEmail !== "string") throw new ValidationError("El email del cliente no es válido");
  const trimmed = rawEmail.trim();
  if (!trimmed || trimmed.length > 320 || !EMAIL_PATTERN.test(trimmed)) {
    throw new ValidationError("El email del cliente no es válido");
  }
  const separatorIndex = trimmed.lastIndexOf("@");
  const localPart = trimmed.slice(0, separatorIndex);
  const domainPart = trimmed.slice(separatorIndex + 1).toLowerCase();
  return {
    channel: "email",
    destination: `${localPart}@${domainPart}`,
    provenance: "guest-booking-input-v1",
    capturedAt: new Date(),
  };
};

const asId = (value) => {
  const candidate = value?._id ?? value;
  return candidate?.toString?.() || "";
};

const sameId = (left, right) => asId(left) === asId(right);

const assertAppointmentTenantCoherence = (appointment, businessId) => {
  if (
    !appointment
    || !sameId(appointment.business, businessId)
    || !appointment.service
    || !sameId(appointment.service.business, businessId)
  ) {
    throw new NotFoundError("La cita especificada no existe");
  }
  return appointment;
};

export const validateBookingTenantScope = async ({ worker, service, businessId, session = null }) => {
  if (!businessId) throw new ValidationError("El contexto de negocio es obligatorio para reservar");

  const serviceDetail = await serviceRepository.findByIdAndBusiness(
    service,
    businessId,
    { onlyActive: true, session },
  );
  if (!serviceDetail) throw new NotFoundError("El servicio solicitado no está disponible");

  const { user: workerDetail } = await assertServiceBookingEligibility({
    userId: worker,
    businessId,
    service: serviceDetail,
    requireActiveService: true,
    session,
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
    guestContact = null,
  } = appointmentData;

  await logEvent({
    userId: client,
    event: "APPOINTMENT_REQUEST_RECEIVED",
    level: "INFO",
    message: `Solicitud de reserva recibida para el servicio ${service} con el trabajador ${worker} a las ${startTime} el ${date} (Sugerencia: ${!!isSuggestion}).`,
    metadata: { worker, service, date, startTime, isSuggestion },
  });

  await (tenantScope ? Promise.resolve(tenantScope) : validateBookingTenantScope({ worker, service, businessId }));
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

  let autoConfirm = false;
  if (businessId) {
    const config = await businessConfigRepository.getConfig(businessId);
    if (config?.appointmentSettings?.autoConfirmLocalBookings) autoConfirm = true;
  }

  let finalNotes = notes;
  if (isSuggestion) finalNotes = `[⚠️ SUGERENCIA DE CLIENTE: Horario propuesto no disponible en turnos estándar]\n${notes || ""}`;

  if (beforeBookingCommitTestHook) {
    await beforeBookingCommitTestHook({ businessId, worker, service, date: dateStr, startTime });
  }

  const baseAppointment = {
    client,
    worker,
    service,
    date: targetDate,
    startTime,
    notes: finalNotes,
    business: businessId,
    guestContact,
  };

  const newAppointment = await appointmentRepository.create(baseAppointment, {
    prepareCommit: async (session, data) => {
      // La selección previa y getAvailableSlots() son informativos. La autoridad
      // final se revalida después de adquirir el mutex worker/día y dentro de la
      // misma sesión que comprueba overlap e inserta la Appointment.
      const commitScope = await validateBookingTenantScope({
        worker,
        service,
        businessId,
        session,
      });
      const serviceDetail = commitScope.serviceDetail;
      const endTime = addMinutesToTime(startTime, serviceDetail.duration);
      const isLocalBooking = serviceDetail.depositAmount === 0 || paymentOption === "local";
      const initialStatus = autoConfirm && isLocalBooking && !isSuggestion ? "confirmed" : "pending";

      return {
        ...data,
        service: serviceDetail._id,
        endTime,
        status: initialStatus,
      };
    },
  });

  await logEvent({
    userId: client,
    event: "APPOINTMENT_VALIDATION_SUCCESS",
    level: "INFO",
    message: "Validación de reserva exitosa: horario, servicio y bookability vigentes al commit.",
    metadata: { worker, dateStr, startTime },
  });

  await auditLogRepository.associateOrphanedLogs(client, newAppointment._id);
  await logEvent({
    appointmentId: newAppointment._id,
    userId: client,
    event: newAppointment.status === "confirmed" ? "APPOINTMENT_CONFIRMED" : "APPOINTMENT_PENDING_CREATED",
    level: "INFO",
    message: `Reserva creada en estado inicial (${newAppointment.status}).`,
    metadata: { appointmentId: newAppointment._id, status: newAppointment.status },
  });

  emitAvailabilityChange(worker, dateStr, businessId);
  notifyBookingCreated(newAppointment._id, client, newAppointment.status);
  return newAppointment;
};

const findTenantAppointment = async (appointmentId, businessId) => {
  if (!businessId) throw new NotFoundError("La cita especificada no existe");
  const appointment = await appointmentRepository.findByIdAndBusiness(appointmentId, businessId);
  return assertAppointmentTenantCoherence(appointment, businessId);
};

const resolveActorTenantAuthority = async (userId, businessId, _preloadedAuthority = null) =>
  findTenantAuthority(userId, businessId);

export const resolveExistingAppointmentActorCapabilities = async ({
  appointment,
  userId,
  businessId,
  tenantAuthority,
}) => {
  const authority = await resolveActorTenantAuthority(userId, businessId, tenantAuthority);
  const isAdmin = Boolean(authority && authority.role === "admin");
  const isProfessional = Boolean(authority && sameId(appointment.worker, userId));

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
  const capabilities = await resolveExistingAppointmentActorCapabilities({
    appointment,
    userId,
    businessId,
    tenantAuthority,
  });

  if (!capabilities.isAdmin && !capabilities.isProfessional) {
    throw new NotFoundError("La cita especificada no existe");
  }
  return capabilities;
};

const transitionAppointmentStatus = async ({ appointment, businessId, transition }) => {
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
  const { actorCapability } = await authorizeProtectedAppointment({ appointment, userId, businessId, tenantAuthority });

  let updatedAppointment;
  try {
    updatedAppointment = await transitionAppointmentStatus({ appointment, businessId, transition: STATUS_TRANSITIONS.confirm });
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
  const { actorCapability } = await authorizeProtectedAppointment({ appointment, userId, businessId, tenantAuthority });

  let updatedAppointment;
  try {
    updatedAppointment = await transitionAppointmentStatus({ appointment, businessId, transition: STATUS_TRANSITIONS.complete });
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
  const { actorCapability } = await authorizeProtectedAppointment({ appointment, userId, businessId, tenantAuthority });

  const updatedAppointment = await transitionAppointmentStatus({ appointment, businessId, transition: STATUS_TRANSITIONS.cancel });
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
  await authorizeProtectedAppointment({ appointment, userId, businessId, tenantAuthority });
  return appointment;
};

export const getMyAppointments = async (userId, tenantAuthority, businessId) => {
  const authority = await resolveActorTenantAuthority(userId, businessId, tenantAuthority);
  if (!authority) {
    throw new ForbiddenError("No tienes una membresía activa con permisos para este negocio");
  }

  if (authority.role === "admin") {
    return await appointmentRepository.findCoherentAllByBusiness(businessId);
  }
  return await appointmentRepository.findCoherentAllByBusiness(businessId, { worker: userId });
};

export const getAppointmentTimeline = async (appointmentId, userId, tenantAuthority, businessId) => {
  await getAppointmentDetails(appointmentId, userId, tenantAuthority, businessId);
  return await auditLogRepository.findFunctionalTimelineByAppointment(appointmentId);
};
