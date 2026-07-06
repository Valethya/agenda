import * as shiftRepository from "../repositories/shift.repository.js";
import * as blockRepository from "../repositories/block.repository.js";
import * as appointmentRepository from "../repositories/appointment.repository.js";
import * as serviceRepository from "../repositories/service.repository.js";
import * as businessConfigRepository from "../repositories/businessConfig.repository.js";
import User from "../db/models/user.model.js";
import HolidayModel from "../db/models/holiday.model.js";
import { NotFoundError, ValidationError } from "../utils/appError.js";

const timeToMinutes = (timeStr) => {
  const [hours, minutes] = timeStr.split(":").map(Number);
  return hours * 60 + minutes;
};

const minutesToTime = (totalMinutes) => {
  const hours = Math.floor(totalMinutes / 60)
    .toString()
    .padStart(2, "0");
  const minutes = (totalMinutes % 60).toString().padStart(2, "0");
  return `${hours}:${minutes}`;
};

const checkOverlap = (startA, endA, startB, endB) => {
  return Math.max(startA, startB) < Math.min(endA, endB);
};
export const getAvailableSlots = async (workerId, dateStr, serviceId, businessId, excludeAppointmentId = null) => {
  const dateParts = dateStr.split("-").map(Number);
  const targetDate = new Date(
    Date.UTC(dateParts[0], dateParts[1] - 1, dateParts[2]),
  );
  const dayOfWeek = targetDate.getUTCDay();

  // Ejecutar todas las consultas a base de datos de forma paralela concurrente
  const [service, worker, shift, holiday, appointments, blocks, businessConfig] = await Promise.all([
    serviceRepository.findById(serviceId),
    User.findById(workerId),
    shiftRepository.findByWorkerAndDay(workerId, dayOfWeek),
    HolidayModel.findOne({
      date: {
        $gte: new Date(Date.UTC(dateParts[0], dateParts[1] - 1, dateParts[2], 0, 0, 0)),
        $lte: new Date(Date.UTC(dateParts[0], dateParts[1] - 1, dateParts[2], 23, 59, 59, 999))
      }
    }),
    appointmentRepository.findByWorkerAndDate(workerId, targetDate),
    blockRepository.findByWorkerAndDateRange(workerId, targetDate, targetDate),
    businessId ? businessConfigRepository.getConfig(businessId) : Promise.resolve(null)
  ]);

  if (!service) {
    throw new NotFoundError("El servicio especificado no existe");
  }
  if (businessId && service.business && service.business.toString() !== businessId.toString()) {
    throw new ValidationError("El servicio especificado no pertenece a este negocio");
  }

  if (!worker || worker.role !== "worker") {
    throw new NotFoundError("El profesional especificado no existe");
  }
  if (businessId && worker.business && worker.business.toString() !== businessId.toString()) {
    throw new ValidationError("El profesional especificado no pertenece a este negocio");
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
  const today = new Date();
  const isToday =
    today.getFullYear() === targetDate.getUTCFullYear() &&
    today.getMonth() === targetDate.getUTCMonth() &&
    today.getDate() === targetDate.getUTCDate();

  const currentMinutes = today.getHours() * 60 + today.getMinutes();

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
    if (slotStart === 960) {
      console.log("DEBUG 16:00 details:", {
        available,
        isInBreak,
        isBooked,
        isBlocked,
        appointments: appointments.map(app => ({
          id: app._id,
          startTime: app.startTime,
          endTime: app.endTime,
          appStart: timeToMinutes(app.startTime),
          appEnd: timeToMinutes(app.endTime),
          overlap: checkOverlap(960, 960 + serviceDuration, timeToMinutes(app.startTime), timeToMinutes(app.endTime))
        }))
      });
    }

    availableSlots.push({
      startTime: minutesToTime(slotStart),
      endTime: minutesToTime(slotEnd),
      available,
    });
  }

  return availableSlots;
};
