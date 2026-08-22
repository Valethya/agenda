import * as shiftRepository from "../repositories/shift.repository.js";
import * as blockRepository from "../repositories/block.repository.js";
import * as appointmentRepository from "../repositories/appointment.repository.js";
import * as serviceRepository from "../repositories/service.repository.js";
import * as businessConfigRepository from "../repositories/businessConfig.repository.js";
import * as holidayRepository from "../repositories/holiday.repository.js";
import {
  assertProfessionalEligibleForService,
  resolveActiveTenantParticipant,
} from "./professionalEligibility.service.js";
import { NotFoundError, ValidationError } from "../utils/appError.js";
import { parseStrictISODate } from "../utils/date.js";
import { timeToMinutes, minutesToTime, checkOverlap } from "../utils/time.js";
import { DEFAULT_SLOT_DURATION_MINUTES } from "../config/businessConfig.defaults.js";

export const resolveActiveWorkerInTenant = async (workerId, businessId) =>
  resolveActiveTenantParticipant(workerId, businessId);

export const getAvailableSlots = async (workerId, dateStr, serviceId, businessId, excludeAppointmentId = null) => {
  if (!businessId) throw new ValidationError("El contexto de negocio es obligatorio para consultar disponibilidad");

  const targetDate = parseStrictISODate(dateStr);
  if (!targetDate) throw new ValidationError("La fecha debe ser una fecha Gregoriana válida");
  const dateParts = dateStr.split("-").map(Number);
  const dayOfWeek = targetDate.getUTCDay();

  const service = await serviceRepository.findByIdAndBusiness(
    serviceId,
    businessId,
    { onlyActive: true },
  );
  if (!service) throw new NotFoundError("El servicio especificado no está disponible");

  await assertProfessionalEligibleForService({
    userId: workerId,
    businessId,
    service,
    requireActiveService: true,
  });

  const [shift, holiday, appointments, blocks, businessConfig] = await Promise.all([
    shiftRepository.findByBusinessWorkerAndDay(businessId, workerId, dayOfWeek),
    // Holiday es deliberadamente un calendario global compartido. No concede
    // authority tenant y se aplica por igual a todos los Businesses.
    holidayRepository.findByDate(targetDate),
    appointmentRepository.findByBusinessWorkerAndDate(businessId, workerId, targetDate),
    blockRepository.findByBusinessWorkerAndDateRange(businessId, workerId, targetDate, targetDate),
    businessConfigRepository.getConfig(businessId),
  ]);

  const serviceDuration = service.duration;
  let shiftStart = timeToMinutes("09:00");
  let shiftEnd = timeToMinutes("19:00");
  let shiftBreaks = [{ start: timeToMinutes("13:00"), end: timeToMinutes("14:00") }];
  let isClosed = false;

  if (shift) {
    if (shift.isOpen) {
      shiftStart = timeToMinutes(shift.startTime);
      shiftEnd = timeToMinutes(shift.endTime);
      shiftBreaks = shift.breaks.map((b) => ({ start: timeToMinutes(b.startTime), end: timeToMinutes(b.endTime) }));
    } else isClosed = true;
  } else isClosed = true;

  if (holiday) {
    if (!holiday.isHalfDay) isClosed = true;
    else shiftEnd = Math.min(shiftEnd, timeToMinutes("13:00"));
  }

  const blockedIntervals = blocks.map((b) => ({ start: timeToMinutes(b.startTime), end: timeToMinutes(b.endTime) }));
  const bookingInterval = businessConfig?.appointmentSettings?.slotDuration
    ?? DEFAULT_SLOT_DURATION_MINUTES;

  const availableSlots = [];
  const todaySantiago = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Santiago" }));
  const isToday = todaySantiago.getFullYear() === dateParts[0]
    && todaySantiago.getMonth() === dateParts[1] - 1
    && todaySantiago.getDate() === dateParts[2];
  const currentMinutes = todaySantiago.getHours() * 60 + todaySantiago.getMinutes();

  for (let slotStart = shiftStart; slotStart <= shiftEnd - serviceDuration; slotStart += bookingInterval) {
    const slotEnd = slotStart + serviceDuration;
    let available = !isClosed;

    if (available && isToday && slotStart <= currentMinutes + 10) available = false;
    if (available && shiftBreaks.some((brk) => checkOverlap(slotStart, slotEnd, brk.start, brk.end))) available = false;
    if (available && appointments.some((app) => {
      if (app.status === "cancelled") return false;
      if (excludeAppointmentId && app._id.toString() === excludeAppointmentId.toString()) return false;
      return checkOverlap(slotStart, slotEnd, timeToMinutes(app.startTime), timeToMinutes(app.endTime));
    })) available = false;
    if (available && blockedIntervals.some((blk) => checkOverlap(slotStart, slotEnd, blk.start, blk.end))) available = false;

    availableSlots.push({
      startTime: minutesToTime(slotStart),
      endTime: minutesToTime(slotEnd),
      available,
    });
  }

  return availableSlots;
};
