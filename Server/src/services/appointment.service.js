import * as appointmentRepository from "../repositories/appointment.repository.js";
import * as serviceRepository from "../repositories/service.repository.js";
import * as availabilityService from "./availability.service.js";
import { ConflictError, NotFoundError, UnauthorizedError, ValidationError } from "../utils/appError.js";
import { emitAvailabilityChange } from "../config/socket.js";
import { notifyBookingCreated, notifyAppointmentConfirmed, notifyAppointmentCancelled } from "./appointment.notifications.js";
import { logEvent } from "../utils/auditLogger.js";
import * as auditLogRepository from "../repositories/auditLog.repository.js";
import * as businessConfigRepository from "../repositories/businessConfig.repository.js";
import { addMinutesToTime } from "../utils/time.js";

// 1. Crear / Reservar una Cita
export const bookAppointment = async (appointmentData) => {
  const { client, worker, service, date, startTime, notes, paymentOption, isSuggestion } = appointmentData;

  await logEvent({
    userId: client,
    event: "APPOINTMENT_REQUEST_RECEIVED",
    level: "INFO",
    message: `Solicitud de reserva recibida para el servicio ${service} con el trabajador ${worker} a las ${startTime} el ${date} (Sugerencia: ${!!isSuggestion}).`,
    metadata: { worker, service, date, startTime, isSuggestion }
  });

  // A. Obtener el servicio y validar existencia/duración
  const serviceDetail = await serviceRepository.findById(service);
  if (!serviceDetail) {
    await logEvent({
      userId: client,
      event: "APPOINTMENT_VALIDATION_FAILED",
      level: "WARN",
      message: `Validación de reserva fallida: El servicio solicitado ${service} no existe.`,
      metadata: { service }
    });
    throw new NotFoundError("El servicio solicitado no existe");
  }
  const businessId = serviceDetail.business;

  // B. Dar formato YYYY-MM-DD a la fecha para validación
  const targetDate = new Date(date);
  const dateStr = targetDate.toISOString().split("T")[0]; // "YYYY-MM-DD"

  // C. VALIDACIÓN CRÍTICA: Verificar que el horario esté libre utilizando el algoritmo
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
      metadata: { worker, dateStr, startTime }
    });
    throw new ConflictError("El horario seleccionado ya no se encuentra disponible");
  }

  await logEvent({
    userId: client,
    event: "APPOINTMENT_VALIDATION_SUCCESS",
    level: "INFO",
    message: "Validación de reserva exitosa: horario y servicio disponibles.",
    metadata: { worker, dateStr, startTime }
  });

  // D. Calcular la hora de finalización (startTime + duración del servicio)
  const endTime = addMinutesToTime(startTime, serviceDetail.duration);

  // Obtener la configuración del negocio
  let initialStatus = "pending";
  let autoConfirm = false;
  if (businessId) {
    const config = await businessConfigRepository.getConfig(businessId);
    if (config && config.appointmentSettings && config.appointmentSettings.autoConfirmLocalBookings) {
      autoConfirm = true;
    }
  }

  // Se auto-confirma si auto-confirmación está activa AND (el servicio no tiene abono o el cliente seleccionó pagar en local) AND no es sugerencia
  const isLocalBooking = serviceDetail.depositAmount === 0 || paymentOption === "local";
  if (autoConfirm && isLocalBooking && !isSuggestion) {
    initialStatus = "confirmed";
  }

  // Prepend note if suggestion
  let finalNotes = notes;
  if (isSuggestion) {
    finalNotes = `[⚠️ SUGERENCIA DE CLIENTE: Horario propuesto no disponible en turnos estándar]\n${notes || ""}`;
  }

  // E. Guardar la cita
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

  // Asociar logs previos de esta solicitud de reserva a la cita recién creada
  await auditLogRepository.associateOrphanedLogs(client, newAppointment._id);

  await logEvent({
    appointmentId: newAppointment._id,
    userId: client,
    event: initialStatus === "confirmed" ? "APPOINTMENT_CONFIRMED" : "APPOINTMENT_PENDING_CREATED",
    level: "INFO",
    message: `Reserva creada en estado inicial (${newAppointment.status}).`,
    metadata: { appointmentId: newAppointment._id, status: newAppointment.status }
  });

  // F. Emitir cambio de disponibilidad en tiempo real mediante WebSockets
  emitAvailabilityChange(worker, dateStr, businessId);

  // G. Enviar correos de notificación (segundo plano diferido)
  notifyBookingCreated(newAppointment._id, client, initialStatus);

  return newAppointment;
};

// 2. Confirmar una cita (Solo Trabajador asignado o Admin)
export const confirmAppointment = async (appointmentId, userId, userRole) => {
  const appointment = await appointmentRepository.findById(appointmentId);
  if (!appointment) {
    throw new NotFoundError("La cita especificada no existe");
  }

  // Validar permisos (Trabajador asignado, Admin o Superadmin)
  const isAdmin = userRole === "admin" || userRole === "superadmin";
  if (!isAdmin && appointment.worker._id.toString() !== userId) {
    throw new UnauthorizedError("No tiene permisos para confirmar esta cita");
  }

  if (appointment.status === "cancelled") {
    throw new ValidationError("No se puede confirmar una cita que ha sido cancelada");
  }

  let updatedAppointment;
  try {
    updatedAppointment = await appointmentRepository.update(appointmentId, { status: "confirmed" });
    await logEvent({
      appointmentId,
      userId,
      event: "APPOINTMENT_CONFIRMED",
      level: "SUCCESS",
      message: "Reserva confirmada exitosamente.",
      metadata: { confirmedBy: userId, userRole }
    });
  } catch (dbError) {
    await logEvent({
      appointmentId,
      userId,
      event: "APPOINTMENT_CONFIRMATION_FAILED",
      level: "CRITICAL",
      message: "Error al actualizar estado de la reserva a confirmado en BD.",
      technicalMessage: dbError.message,
      metadata: { confirmedBy: userId }
    });
    throw dbError;
  }

  // Enviar correo de confirmación al cliente (segundo plano diferido)
  notifyAppointmentConfirmed(appointmentId, userId);

  return updatedAppointment;
};

// 2b. Completar una cita (Solo Trabajador asignado o Admin)
export const completeAppointment = async (appointmentId, userId, userRole) => {
  const appointment = await appointmentRepository.findById(appointmentId);
  if (!appointment) {
    throw new NotFoundError("La cita especificada no existe");
  }

  // Validar permisos (Trabajador asignado, Admin o Superadmin)
  const isAdmin = userRole === "admin" || userRole === "superadmin";
  if (!isAdmin && appointment.worker._id.toString() !== userId) {
    throw new UnauthorizedError("No tiene permisos para completar esta cita");
  }

  if (appointment.status === "cancelled") {
    throw new ValidationError("No se puede completar una cita que ha sido cancelada");
  }

  let updatedAppointment;
  try {
    updatedAppointment = await appointmentRepository.update(appointmentId, { status: "completed" });
    await logEvent({
      appointmentId,
      userId,
      event: "APPOINTMENT_COMPLETED",
      level: "SUCCESS",
      message: "Reserva marcada como completada exitosamente.",
      metadata: { completedBy: userId, userRole }
    });
  } catch (dbError) {
    await logEvent({
      appointmentId,
      userId,
      event: "APPOINTMENT_COMPLETION_FAILED",
      level: "CRITICAL",
      message: "Error al actualizar estado de la reserva a completado en BD.",
      technicalMessage: dbError.message,
      metadata: { completedBy: userId }
    });
    throw dbError;
  }

  return updatedAppointment;
};

// 3. Cancelar una cita (Cliente, Trabajador asignado o Admin)
export const cancelAppointment = async (appointmentId, userId, userRole) => {
  const appointment = await appointmentRepository.findById(appointmentId);
  if (!appointment) {
    throw new NotFoundError("La cita especificada no existe");
  }

  const isClient = appointment.client._id.toString() === userId;
  const isWorker = appointment.worker._id.toString() === userId;
  const isAdmin = userRole === "admin" || userRole === "superadmin";

  // Validar permisos
  if (!isClient && !isWorker && !isAdmin) {
    throw new UnauthorizedError("No tiene permisos para cancelar esta cita");
  }

  // Regla opcional de negocio: Validar anticipación de cancelación para clientes (ej: mínimo 2 horas)
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
        metadata: { differenceInHours, userId }
      });
      throw new ValidationError("Las citas solo pueden cancelarse con un mínimo de 2 horas de anticipación");
    }
  }

  const updatedAppointment = await appointmentRepository.update(appointmentId, { status: "cancelled" });

  await logEvent({
    appointmentId,
    userId,
    event: "APPOINTMENT_CANCELLED",
    level: "INFO",
    message: "Reserva cancelada exitosamente.",
    metadata: { cancelledBy: userId, userRole }
  });

  // Emitir cambio de disponibilidad en tiempo real mediante WebSockets
  const dateStr = new Date(appointment.date).toISOString().split("T")[0];
  emitAvailabilityChange(appointment.worker._id.toString(), dateStr, appointment.business._id || appointment.business);

  // Enviar correo de cancelación al cliente (segundo plano diferido)
  notifyAppointmentCancelled(appointmentId, userId);

  return updatedAppointment;
};

// 4. Obtener detalles de una cita
export const getAppointmentDetails = async (appointmentId, userId, userRole) => {
  const appointment = await appointmentRepository.findById(appointmentId);
  if (!appointment) {
    throw new NotFoundError("La cita especificada no existe");
  }

  // Validar que solo los involucrados puedan ver los detalles
  const isClient = appointment.client._id.toString() === userId;
  const isWorker = appointment.worker._id.toString() === userId;
  const isAdmin = userRole === "admin";

  if (!isClient && !isWorker && !isAdmin) {
    throw new UnauthorizedError("No autorizado para ver los detalles de esta cita");
  }

  return appointment;
};

// 5. Listar citas propias (según rol)
export const getMyAppointments = async (userId, userRole, businessId) => {
  // Para clientes: citas donde son el 'client'
  // Para trabajadores: citas donde son el 'worker' (de su negocio)
  // Para administradores: todas las citas de su negocio
  const query = {};
  if (userRole === "user") {
    query.client = userId;
  } else if (userRole === "worker") {
    query.worker = userId;
    if (businessId) query.business = businessId;
  } else if (userRole === "admin") {
    if (businessId) query.business = businessId;
  }
  
  // Buscar citas ordenadas por fecha y hora
  return await appointmentRepository.findAll(query);
};
