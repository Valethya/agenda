import * as shiftRepository from "../repositories/shift.repository.js";
import * as blockRepository from "../repositories/block.repository.js";
import * as appointmentRepository from "../repositories/appointment.repository.js";
import * as serviceRepository from "../repositories/service.repository.js";
import * as businessConfigRepository from "../repositories/businessConfig.repository.js";
import * as userRepository from "../repositories/user.repository.js";
import * as holidayRepository from "../repositories/holiday.repository.js";
import * as membershipRepository from "../repositories/membership.repository.js";
import { NotFoundError, ValidationError } from "../utils/appError.js";
import { timeToMinutes, minutesToTime, checkOverlap } from "../utils/time.js";

export const resolveActiveWorkerInTenant = async (workerId, businessId) => {
  const [worker, membership] = await Promise.all([
    userRepository.findById(workerId),
    membershipRepository.findActiveByUserAndBusiness(workerId, businessId),
  ]);

  if (
    !worker ||
    worker.isActive !== true ||
    !membership ||
    membership.role !== "worker" ||
    !membership.business ||
    membership.business.isActive !== true
  ) {
    throw new NotFoundError("El profesional especificado no está disponible");
  }

  return { worker, membership };
};

export const getAvailableSlots = async (workerId, dateStr, serviceId, businessId, excludeAppointmentId = null) => {
  if (!businessId) throw new ValidationError("El contexto de negocio es obligatorio para consultar disponibilidad");

  const dateParts = dateStr.split("-").map(Number);
  const targetDate = new Date(Date.UTC(dateParts[0], dateParts[1] - 1, dateParts[2]));
  const dayOfWeek = targetDate.getUTCDay();

  const [service, worker, workerMembership, shift, holiday, appointments, blocks, businessConfig] = await Promise.all([
    serviceRepository.findByIdAndBusiness(serviceId, businessId),
    userRepository.findById(workerId),
    membershipRepository.findActiveByUserAndBusiness(workerId, businessId),
    shiftRepository.findByWorkerAndDay(workerId, dayOfWeek),
    holidayRepository.findByDate(new Date(Date.UTC(dateParts[0], dateParts[1] - 1, dateParts[2]))),
    appointmentRepository.findByWorkerAndDate(workerId, targetDate),
    blockRepository.findByWorkerAndDateRange(workerId, targetDate, targetDate),
    businessConfigRepository.getConfig(businessId),
  ]);

  if (!service) throw new NotFoundError("El servicio especificado no está disponible");
  if (
    !worker ||
    worker.isActive !== true ||
    !workerMembership ||
    workerMembership.role !== "worker"
  ) {
    throw new NotFoundError("El profesional especificado no está disponible");
  }

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
  let bookingInterval = 30;
  if (businessConfig?.appointmentSettings?.slotDuration) bookingInterval = businessConfig.appointmentSettings.slotDuration;

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
