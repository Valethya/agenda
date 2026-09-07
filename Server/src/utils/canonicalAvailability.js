import { DEFAULT_SLOT_DURATION_MINUTES } from "../config/businessConfig.defaults.js";
import { checkOverlap, minutesToTime, timeToMinutes } from "./time.js";

export const buildCanonicalCalendarSlots = ({
  dateStr,
  serviceDuration,
  shift,
  holiday,
  blocks,
  businessConfig,
  now = new Date(),
}) => {
  const dateParts = dateStr.split("-").map(Number);
  let shiftStart = timeToMinutes("09:00");
  let shiftEnd = timeToMinutes("19:00");
  let shiftBreaks = [{ start: timeToMinutes("13:00"), end: timeToMinutes("14:00") }];
  let isClosed = false;

  if (shift) {
    if (shift.isOpen) {
      shiftStart = timeToMinutes(shift.startTime);
      shiftEnd = timeToMinutes(shift.endTime);
      shiftBreaks = shift.breaks.map((entry) => ({
        start: timeToMinutes(entry.startTime),
        end: timeToMinutes(entry.endTime),
      }));
    } else {
      isClosed = true;
    }
  } else {
    isClosed = true;
  }

  if (holiday) {
    if (!holiday.isHalfDay) isClosed = true;
    else shiftEnd = Math.min(shiftEnd, timeToMinutes("13:00"));
  }

  const blockedIntervals = blocks.map((entry) => ({
    start: timeToMinutes(entry.startTime),
    end: timeToMinutes(entry.endTime),
  }));
  const bookingInterval = businessConfig?.appointmentSettings?.slotDuration
    ?? DEFAULT_SLOT_DURATION_MINUTES;

  const todaySantiago = new Date(now.toLocaleString("en-US", { timeZone: "America/Santiago" }));
  const isToday = todaySantiago.getFullYear() === dateParts[0]
    && todaySantiago.getMonth() === dateParts[1] - 1
    && todaySantiago.getDate() === dateParts[2];
  const currentMinutes = todaySantiago.getHours() * 60 + todaySantiago.getMinutes();

  const slots = [];
  for (let slotStart = shiftStart; slotStart <= shiftEnd - serviceDuration; slotStart += bookingInterval) {
    const slotEnd = slotStart + serviceDuration;
    let available = !isClosed;
    if (available && isToday && slotStart <= currentMinutes + 10) available = false;
    if (available && shiftBreaks.some((entry) => checkOverlap(slotStart, slotEnd, entry.start, entry.end))) available = false;
    if (available && blockedIntervals.some((entry) => checkOverlap(slotStart, slotEnd, entry.start, entry.end))) available = false;
    slots.push({
      startTime: minutesToTime(slotStart),
      endTime: minutesToTime(slotEnd),
      available,
    });
  }
  return slots;
};
