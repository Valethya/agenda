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

export const getAvailableSlots = async (workerId, dateStr, serviceId, businessId, excludeAppointmentId = null) => {
  if (!businessId) {
    throw new ValidationError("El contexto de negocio es obligatorio para consultar disponibilidad");
  }

  const dateParts = dateStr.split("-").map(Number);
  const targetDate = new Date(
    Date.UTC(dateParts[0], dateParts[1] - 1, dateParts[2]),
  );
  const dayOfWeek = targetDate.getUTCDay();

  // Ejecutar todas las consultas a base de datos de forma paralela concurrente
  const [service, worker, workerMembership, shift, holiday, appointments, blocks, businessConfig] = await Promise.all([
    serviceRepository.findByIdAndBusiness(serviceId, businessId),
    userRepository.findById(workerId),
    membershipRepository.findActiveByUserAndBusiness(workerId, businessId),
    shiftRepository.findByWorkerAndDay(workerId, dayOfWeek),
    holidayRepository.findByDate(new Date(Date.UTC(dateParts[0], dateParts[1] - 1, dateParts[2]))),
    appointmentRepository.findByWorkerAndDate(workerId, targetDate),
    blockRepository.findByWorkerAndDateRange(workerId, targetDate, targetDate),
    businessId ? businessConfigRepository.getConfig(businessId) : Promise.resolve(null)
  ]);

  if (!service) {
    throw new NotFoundError("El servicio especificado no está disponible");
  }

  if (
    !worker ||
    !worker.isActive ||
    worker.role !== "worker" ||
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
      shiftBreaks = shift.breaks.map((b) => ({
        start: timeToMinutes(b.startTime),
        end: timeToMinutes(b.endTime),
      }));
    } else {
      isClosed = true;
    }
  } else {
    isClosed = true;
  }

  if (holiday) {
    if (!holiday.isHalfDay) {
      isClosed = true;
    } else {
      shiftEnd = Math.min(shiftEnd, timeToMinutes("13:00"));
    }
  }

  const blockedIntervals = blocks.map((b) => ({
    start: timeToMinutes(b.startTime),
    end: timeToMinutes(b.endTime),
  }));

  let bookingInterval = 30;
  if (businessConfig && businessConfig.appointmentSettings && businessConfig.appointmentSettings.slotDuration) {
    bookingInterval = businessConfig.appointmentSettings.slotDuration;
  }
  
  const availableSlots = [];
  // Usar la zona horaria local de Chile (America/Santiago) para evitar desajustes con el servidor (ej. Railway en UTC)
  const todaySantiago = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Santiago" }));
  const isToday =
    todaySantiago.getFullYear() === dateParts[0] &&
    todaySantiago.getMonth() === dateParts[1] - 1 &&
    todaySantiago.getDate() === dateParts[2];

  const currentMinutes = todaySantiago.getHours() * 60 + todaySantiago.getMinutes();

  for (
    let slotStart = shiftStart;
    slotStart <= shiftEnd - serviceDuration;
    slotStart += bookingInterval
  ) {
    const slotEnd = slotStart + serviceDuration;
    let available = true;

    if (isClosed) {
      available = false;
    } else {
      // 1. Horarios pasados si es el día de hoy
      if (isToday && slotStart <= currentMinutes + 10) {
        available = false;
      }

      // 2. Colaciones / Breaks
      const isInBreak = shiftBreaks.some((brk) =>
        checkOverlap(slotStart, slotEnd, brk.start, brk.end),
      );
      if (isInBreak) {
        available = false;
      }

      // 3. Citas agendadas (excluyendo canceladas y la cita que se está pagando/validando)
      const isBooked = appointments.some((app) => {
        if (app.status === "cancelled") return false;
        if (excludeAppointmentId && app._id.toString() === excludeAppointmentId.toString()) return false;
        const appStart = timeToMinutes(app.startTime);
        const appEnd = timeToMinutes(app.endTime);
        return checkOverlap(slotStart, slotEnd, appStart, appEnd);
      });
      if (isBooked) {
        available = false;
      }

      // 4. Bloqueos administrativos manuales
      const isBlocked = blockedIntervals.some((blk) =>
        checkOverlap(slotStart, slotEnd, blk.start, blk.end),
      );
      if (isBlocked) {
        available = false;
      }
    }

    availableSlots.push({
      startTime: minutesToTime(slotStart),
      endTime: minutesToTime(slotEnd),
      available,
    });
  }

  return availableSlots;
};
