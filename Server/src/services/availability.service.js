import * as shiftRepository from "../repositories/shift.repository.js";
import * as appointmentRepository from "../repositories/appointment.repository.js";
import * as serviceRepository from "../repositories/service.repository.js";
import * as canonicalAvailabilityRepository from "../repositories/canonicalAvailability.repository.js";
import {
  assertServiceBookingEligibility,
  resolveBookableTenantParticipant,
} from "./professionalEligibility.service.js";
import { NotFoundError, ValidationError } from "../utils/appError.js";
import { parseStrictISODate } from "../utils/date.js";
import { checkOverlap, timeToMinutes } from "../utils/time.js";
import { buildCanonicalCalendarSlots } from "../utils/canonicalAvailability.js";

const DEFAULT_SHIFT_STATE = Object.freeze({
  isOpen: false,
  startTime: "09:00",
  endTime: "18:00",
  breaks: [],
});

const asShiftState = (shift) => ({
  isOpen: shift?.isOpen ?? DEFAULT_SHIFT_STATE.isOpen,
  startTime: shift?.startTime ?? DEFAULT_SHIFT_STATE.startTime,
  endTime: shift?.endTime ?? DEFAULT_SHIFT_STATE.endTime,
  breaks: Array.isArray(shift?.breaks)
    ? shift.breaks.map((entry) => ({ startTime: entry.startTime, endTime: entry.endTime }))
    : [],
});

export const assertValidShiftState = (shift) => {
  if (!shift.isOpen) return shift;
  const start = timeToMinutes(shift.startTime);
  const end = timeToMinutes(shift.endTime);
  if (start >= end) throw new ValidationError("La hora de inicio debe ser anterior a la hora de término");

  const orderedBreaks = shift.breaks
    .map((entry) => ({ ...entry, start: timeToMinutes(entry.startTime), end: timeToMinutes(entry.endTime) }))
    .sort((left, right) => left.start - right.start);

  for (let index = 0; index < orderedBreaks.length; index += 1) {
    const current = orderedBreaks[index];
    if (current.start >= current.end) throw new ValidationError("Cada descanso debe comenzar antes de terminar");
    if (current.start < start || current.end > end) {
      throw new ValidationError("Los descansos deben estar contenidos dentro de la jornada");
    }
    if (index > 0 && current.start < orderedBreaks[index - 1].end) {
      throw new ValidationError("Los descansos no pueden solaparse entre sí");
    }
  }
  return shift;
};

export const resolveActiveWorkerInTenant = async (workerId, businessId) =>
  resolveBookableTenantParticipant(workerId, businessId);

export const saveWorkerShift = async ({ businessId, workerId, dayOfWeek, patch }) => {
  await resolveBookableTenantParticipant(workerId, businessId);
  const existing = await shiftRepository.findByBusinessWorkerAndDay(businessId, workerId, dayOfWeek);
  const existingState = asShiftState(existing);
  const finalState = {
    ...existingState,
    ...patch,
    breaks: patch.breaks !== undefined
      ? patch.breaks.map((entry) => ({ ...entry }))
      : existingState.breaks,
  };
  assertValidShiftState(finalState);
  return shiftRepository.upsertByBusinessWorkerAndDay(
    businessId,
    workerId,
    dayOfWeek,
    finalState,
  );
};

export const isCanonicalBookingWindowAtCommit = async ({
  workerId,
  dateStr,
  serviceDuration,
  businessId,
  startTime,
  endTime,
  session,
}) => {
  if (!session) throw new TypeError("La validación canónica de commit requiere session");
  const targetDate = parseStrictISODate(dateStr);
  if (!targetDate) return false;
  const constraints = await canonicalAvailabilityRepository.readCanonicalAvailabilityConstraints({
    businessId,
    workerId,
    date: targetDate,
    session,
  });
  const slots = buildCanonicalCalendarSlots({
    dateStr,
    serviceDuration,
    ...constraints,
  });
  return slots.some((slot) => (
    slot.startTime === startTime
    && slot.endTime === endTime
    && slot.available !== false
  ));
};

export const getAvailableSlots = async (workerId, dateStr, serviceId, businessId, excludeAppointmentId = null) => {
  if (!businessId) throw new ValidationError("El contexto de negocio es obligatorio para consultar disponibilidad");
  const targetDate = parseStrictISODate(dateStr);
  if (!targetDate) throw new ValidationError("La fecha debe ser una fecha Gregoriana válida");

  const service = await serviceRepository.findByIdAndBusiness(
    serviceId,
    businessId,
    { onlyActive: true },
  );
  if (!service) throw new NotFoundError("El servicio especificado no está disponible");

  await assertServiceBookingEligibility({
    userId: workerId,
    businessId,
    service,
    requireActiveService: true,
  });

  const [constraints, appointments] = await Promise.all([
    canonicalAvailabilityRepository.readCanonicalAvailabilityConstraints({
      businessId,
      workerId,
      date: targetDate,
    }),
    appointmentRepository.findByBusinessWorkerAndDate(businessId, workerId, targetDate),
  ]);

  const calendarSlots = buildCanonicalCalendarSlots({
    dateStr,
    serviceDuration: service.duration,
    ...constraints,
  });

  return calendarSlots.map((slot) => {
    if (!slot.available) return slot;
    const slotStart = timeToMinutes(slot.startTime);
    const slotEnd = timeToMinutes(slot.endTime);
    const appointmentOverlap = appointments.some((appointment) => {
      if (appointment.status === "cancelled") return false;
      if (excludeAppointmentId && appointment._id.toString() === excludeAppointmentId.toString()) return false;
      return checkOverlap(
        slotStart,
        slotEnd,
        timeToMinutes(appointment.startTime),
        timeToMinutes(appointment.endTime),
      );
    });
    return appointmentOverlap ? { ...slot, available: false } : slot;
  });
};
