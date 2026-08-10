import * as appointmentRepository from "../repositories/appointment.repository.js";
import * as serviceRepository from "../repositories/service.repository.js";
import * as availabilityService from "./availability.service.js";
import { ConflictError, NotFoundError, UnauthorizedError, ValidationError } from "../utils/appError.js";
import { emitAvailabilityChange } from "../config/socket.js";
import { notifyBookingCreated, notifyAppointmentConfirmed, notifyAppointmentCancelled } from "./appointment.notifications.js";
import { logEvent } from "../utils/auditLogger.js";
import * as auditLogRepository from "../repositories/auditLog.repository.js";
import * as businessConfigRepository from "../repositories/businessConfig.repository.js";
import * as membershipRepository from "../repositories/membership.repository.js";
import * as userRepository from "../repositories/user.repository.js";
import { addMinutesToTime } from "../utils/time.js";

export const validateBookingTenantScope = async ({ worker, service, businessId }) => {
  if (!businessId) throw new ValidationError("El contexto de negocio es obligatorio para reservar");

  const [serviceDetail, workerDetail, workerMembership] = await Promise.all([
    serviceRepository.findByIdAndBusiness(service, businessId),
    userRepository.findById(worker),
    membershipRepository.findActiveByUserAndBusiness(worker, businessId),
  ]);

  if (!serviceDetail) throw new NotFoundError("El servicio solicitado no está disponible");
  if (
    !workerDetail ||
    workerDetail.isActive !== true ||
    !workerMembership ||
    workerMembership.role !== "worker"
  ) {
    throw new NotFoundError("El profesional especificado no está disponible");
  }

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

const canOperateAsAssignedWorker = (appointment, userId, tenantRole) =>
  tenantRole === "worker" && appointment.worker._id.toString() === userId;

const findTenantAppointment = async (appointmentId, businessId) => {
  if (!businessId) throw new NotFoundError("La cita especificada no existe");
  const appointment = await appointmentRepository.findByIdAndBusiness(appointmentId, businessId);
  if (!appointment) throw new NotFoundError("La cita especificada no existe");
  return appointment;
};

export const confirmAppointment = async (appointmentId, userId, tenantRole, businessId) => {
  const appointment = await findTenantAppointment(appointmentId, businessId);

  const isAdmin = tenantRole === "admin";
  const isWorker = canOperateAsAssignedWorker(appointment, userId, tenantRole);
  if (!isAdmin && !isWorker) throw new UnauthorizedError("No tiene permisos para confirmar esta cita");
  if (appointment.status === "cancelled") throw new ValidationError("No se puede confirmar una cita que ha sido cancelada");

  let updatedAppointment;
  try {
    updatedAppointment = await appointmentRepository.updateByIdAndBusiness(
      appointmentId,
      businessId,
      { status: "confirmed" },
    );
    if (!updatedAppointment) throw new NotFoundError("La cita especificada no existe");
    await logEvent({
      appointmentId,
      userId,
      event: "APPOINTMENT_CONFIRMED",
      level: "SUCCESS",
      message: "Reserva confirmada exitosamente.",
      metadata: { confirmedBy: userId, tenantRole, businessId },
    });
  } catch (dbError) {
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

export const completeAppointment = async (appointmentId, userId, tenantRole, businessId) => {
  const appointment = await findTenantAppointment(appointmentId, businessId);

  const isAdmin = tenantRole === "admin";
  const isWorker = canOperateAsAssignedWorker(appointment, userId, tenantRole);
  if (!isAdmin && !isWorker) throw new UnauthorizedError("No tiene permisos para completar esta cita");
  if (appointment.status === "cancelled") throw new ValidationError("No se puede completar una cita que ha sido cancelada");

  let updatedAppointment;
  try {
    updatedAppointment = await appointmentRepository.updateByIdAndBusiness(
      appointmentId,
      businessId,
      { status: "completed" },
    );
    if (!updatedAppointment) throw new NotFoundError("La cita especificada no existe");
    await logEvent({
      appointmentId,
      userId,
      event: "APPOINTMENT_COMPLETED",
      level: "SUCCESS",
      message: "Reserva marcada como completada exitosamente.",
      metadata: { completedBy: userId, tenantRole, businessId },
    });
  } catch (dbError) {
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

export const cancelAppointment = async (appointmentId, userId, tenantRole, businessId) => {
  const appointment = await findTenantAppointment(appointmentId, businessId);

  const isClient = appointment.client._id.toString() === userId;
  const isWorker = canOperateAsAssignedWorker(appointment, userId, tenantRole);
  const isAdmin = tenantRole === "admin";
  if (!isClient && !isWorker && !isAdmin) throw new UnauthorizedError("No tiene permisos para cancelar esta cita");

  if (isClient && appointment.status !== "cancelled") {
    const now = new Date();
    const appointmentDate = new Date(appointment.date);
    const [hours, minutes] = appointment.startTime.split(":").map(Number);
    appointmentDate.setHours(hours, minutes, 0, 0);
    const differenceInHours = (appointmentDate - now) / (1000 * 60 * 60);
    if (differenceInHours < 2) {
      await logEvent({
        appointmentId,
        userId,
        event: "APPOINTMENT_CANCELLED_FAILED",
        level: "WARN",
        message: "Intento de cancelación de reserva fallido: Fuera del plazo permitido de 2 horas de anticipación.",
        metadata: { differenceInHours, userId, businessId },
      });
      throw new ValidationError("Las citas solo pueden cancelarse con un mínimo de 2 horas de anticipación");
    }
  }

  const updatedAppointment = await appointmentRepository.updateByIdAndBusiness(
    appointmentId,
    businessId,
    { status: "cancelled" },
  );
  if (!updatedAppointment) throw new NotFoundError("La cita especificada no existe");

  await logEvent({
    appointmentId,
    userId,
    event: "APPOINTMENT_CANCELLED",
    level: "INFO",
    message: "Reserva cancelada exitosamente.",
    metadata: { cancelledBy: userId, tenantRole, businessId },
  });

  const dateStr = new Date(appointment.date).toISOString().split("T")[0];
  emitAvailabilityChange(appointment.worker._id.toString(), dateStr, businessId);
  notifyAppointmentCancelled(appointmentId, userId);
  return updatedAppointment;
};

export const getAppointmentDetails = async (appointmentId, userId, tenantRole, businessId) => {
  const appointment = await findTenantAppointment(appointmentId, businessId);

  const isClient = appointment.client._id.toString() === userId;
  const isWorker = canOperateAsAssignedWorker(appointment, userId, tenantRole);
  const isAdmin = tenantRole === "admin";
  if (!isClient && !isWorker && !isAdmin) {
    throw new UnauthorizedError("No autorizado para ver los detalles de esta cita");
  }
  return appointment;
};

export const getMyAppointments = async (userId, tenantRole, businessId) => {
  const query = {};
  if (businessId) query.business = businessId;

  if (tenantRole === "worker") {
    query.worker = userId;
  } else if (tenantRole !== "admin") {
    query.client = userId;
  }

  return await appointmentRepository.findAll(query);
};
